"""
services/reminder_engine.py
Core daily reminder algorithm.

Key design decisions (from pre-build review):
  - Dedup key: (resident_id, cycle_id, stage_type) — NOT date-keyed
  - Penalty computed fresh inside send_reminder() — not at batch start
  - Paid status re-checked inside send_reminder() — mid-batch pay handled
  - 300ms sleep between sends for Twilio rate-limit compliance
"""

import logging
import time
from datetime import date, datetime
from database.db import get_connection, execute_write
from services import settings_service, resident_service, template_service, messaging_service

log = logging.getLogger(__name__)


# ── Dedup ─────────────────────────────────────────────────────────────────────

def already_sent(resident_id: int, cycle_id: int, stage_type: str) -> bool:
    """
    Dedup key: (resident_id, cycle_id, stage_type) with status='sent'.
    days_offset is intentionally excluded — one send per stage per cycle.
    This handles the 'laptop was off on exact day' case correctly.
    """
    conn = get_connection()
    row = conn.execute(
        """SELECT 1 FROM reminder_log
           WHERE resident_id=? AND cycle_id=? AND stage_type=? AND status='sent'
           LIMIT 1""",
        (resident_id, cycle_id, stage_type)
    ).fetchone()
    return row is not None


# ── Log Write ─────────────────────────────────────────────────────────────────

def _log_send(
    resident_id: int,
    cycle_id: int,
    stage_type: str,
    days_offset: int,
    channel: str,
    status: str,
    error_message: str = "",
) -> None:
    execute_write(
        """INSERT INTO reminder_log
           (resident_id, cycle_id, stage_type, days_offset, channel, status, error_message)
           VALUES (?,?,?,?,?,?,?)""",
        (resident_id, cycle_id, stage_type, days_offset, channel, status, error_message)
    )


# ── Single Resident Send ──────────────────────────────────────────────────────

def send_reminder(
    resident_id: int,
    cycle: dict,
    stage_type: str,
    days_offset: int,
    channel: str | None = None,
) -> dict:
    """
    Sends bilingual reminder to one resident.

    Point 3 compliance:
      1. Re-fetches resident from DB right now (not from batch snapshot)
      2. Skips if resident is now paid
      3. Computes penalty fresh at this exact moment
    """
    # 1. Re-fetch — detect mid-batch mark_paid()
    resident = resident_service.get_resident_by_id(resident_id)
    if not resident:
        log.warning("send_reminder: resident %d not found, skipping", resident_id)
        return {"status": "skipped", "reason": "not_found"}

    # 2. Bail if paid since batch started
    if resident["payment_status"] == "paid":
        log.info("send_reminder: resident %d already paid, skipping", resident_id)
        return {"status": "skipped", "reason": "paid"}

    # 3. Compute penalty fresh NOW
    due_str      = cycle.get("due_date", "")
    today        = date.today()
    try:
        due_dt   = date.fromisoformat(due_str)
        days_overdue = max(0, (today - due_dt).days)
    except (ValueError, TypeError):
        days_overdue = 0

    penalty  = settings_service.calculate_penalty(resident["base_amount"], cycle, days_overdue)
    rebate   = settings_service.calculate_rebate(resident["base_amount"], cycle)
    total_due = round(resident["base_amount"] + penalty, 2)
    after_rebate = round(resident["base_amount"] - rebate, 2)

    gp_name = settings_service.get_app_setting("gram_panchayat_name", "Gram Panchayat")

    variables = {
        "name":            resident["name"],
        "due_date":        _fmt_date(due_str),
        "amount":          _fmt_currency(resident["base_amount"]),
        "penalty_amount":  _fmt_currency(penalty),
        "rebate_deadline": _fmt_date(cycle.get("rebate_deadline", "")),
        "rebate_percent":  str(cycle.get("rebate_percent", 0)),
        "total":           _fmt_currency(total_due),
        "after_rebate":    _fmt_currency(after_rebate),
        "ward":            resident.get("ward", ""),
        "property_id":     resident.get("property_id", ""),
        "gram_panchayat":  gp_name,
    }

    # Determine template type to use
    template_map = {
        "pre_due":  "upcoming",
        "rebate":   "rebate",
        "post_due": "penalty" if penalty > 0 else "overdue",
    }
    template_type = template_map.get(stage_type, "upcoming")

    body_mr = template_service.render_template(template_type, "mr", variables)
    body_en = template_service.render_template(template_type, "en", variables)

    ch = channel or messaging_service.PRIMARY_CHANNEL
    result = messaging_service.send_both(resident["phone"], body_mr, body_en)

    status       = result.get("status", "failed")
    error_msg    = ""
    if status == "failed":
        # Prefer the Marathi send error for logging
        error_msg = (
            result.get("marathi", {}).get("error", "") or
            result.get("english", {}).get("error", "")
        )

    _log_send(resident_id, cycle["id"], stage_type, days_offset, ch, status, error_msg)
    return result


# ── Main Daily Job ────────────────────────────────────────────────────────────

def run_daily_check() -> dict:
    """
    Called by APScheduler once per day.
    Returns a summary dict for logging / dashboard status.
    """
    log.info("=== Daily reminder check started ===")
    today = date.today()

    cycle = settings_service.get_active_cycle()
    if not cycle:
        log.warning("No active tax cycle found — skipping daily check")
        return {"status": "no_cycle", "sent": 0, "skipped": 0, "failed": 0}

    cadence_rows = settings_service.get_cadence(cycle["id"])
    pre_due_offsets  = {r["days_offset"] for r in cadence_rows if r["stage_type"] == "pre_due"}
    post_due_offsets = {r["days_offset"] for r in cadence_rows if r["stage_type"] == "post_due"}

    try:
        due_dt = date.fromisoformat(cycle["due_date"])
    except (ValueError, TypeError):
        log.error("Invalid due_date in cycle: %s", cycle.get("due_date"))
        return {"status": "invalid_cycle", "sent": 0, "skipped": 0, "failed": 0}

    days_until_due = (due_dt - today).days   # negative if past due
    days_overdue   = (today - due_dt).days   # negative if before due

    unpaid_residents = resident_service.get_unpaid_residents()
    log.info("Checking %d unpaid residents | days_until_due=%d", len(unpaid_residents), days_until_due)

    sent = skipped = failed = 0

    for resident in unpaid_residents:
        rid = resident["id"]

        # ── Rebate reminder (pre-due, within rebate window) ──────────────────
        if (
            cycle.get("rebate_enabled")
            and cycle.get("rebate_deadline")
            and today.isoformat() <= cycle["rebate_deadline"]
            and days_until_due >= 0
            and days_until_due in pre_due_offsets
        ):
            if already_sent(rid, cycle["id"], "rebate"):
                skipped += 1
                continue
            result = send_reminder(rid, cycle, "rebate", days_until_due)

        # ── Standard pre-due reminder (rebate window passed or disabled) ─────
        elif days_until_due >= 0 and days_until_due in pre_due_offsets:
            if already_sent(rid, cycle["id"], "pre_due"):
                skipped += 1
                continue
            result = send_reminder(rid, cycle, "pre_due", days_until_due)

        # ── Overdue / penalty reminder (post-due) ────────────────────────────
        elif days_overdue > 0 and days_overdue in post_due_offsets:
            if already_sent(rid, cycle["id"], "post_due"):
                skipped += 1
                continue
            result = send_reminder(rid, cycle, "post_due", days_overdue)

        else:
            skipped += 1
            continue

        if result.get("status") == "sent":
            sent += 1
        elif result.get("status") == "skipped":
            skipped += 1
        else:
            failed += 1

        time.sleep(0.3)   # 300ms inter-send — Twilio rate-limit compliance

    summary = {"status": "done", "sent": sent, "skipped": skipped, "failed": failed, "date": today.isoformat()}
    log.info("=== Daily check done: %s ===", summary)
    return summary


# ── Manual Send (triggered from UI) ──────────────────────────────────────────

def send_now(resident_id: int, stage_type: str = "pre_due", force: bool = False) -> dict:
    """
    Staff-triggered send for a single resident.
    If force=True, skips the already_sent() dedup check.
    """
    cycle = settings_service.get_active_cycle()
    if not cycle:
        return {"status": "error", "reason": "no_active_cycle"}

    if not force and already_sent(resident_id, cycle["id"], stage_type):
        return {"status": "skipped", "reason": "already_sent"}

    due_dt = date.fromisoformat(cycle["due_date"])
    days_until = (due_dt - date.today()).days
    days_over  = (date.today() - due_dt).days
    offset = days_until if days_until >= 0 else days_over

    return send_reminder(resident_id, cycle, stage_type, offset)


# ── Failed Sends Dashboard ────────────────────────────────────────────────────

def get_failed_sends(limit: int = 100) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        """SELECT rl.*, r.name, r.phone, r.property_id
           FROM reminder_log rl
           JOIN residents r ON r.id = rl.resident_id
           WHERE rl.status='failed'
           ORDER BY rl.sent_at DESC
           LIMIT ?""",
        (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


def retry_failed(log_id: int) -> dict:
    """Re-sends based on a failed reminder_log row. Updates the log row on result."""
    conn = get_connection()
    row = conn.execute(
        """SELECT rl.*, r.name, r.phone FROM reminder_log rl
           JOIN residents r ON r.id = rl.resident_id
           WHERE rl.id=?""",
        (log_id,)
    ).fetchone()

    if not row:
        return {"status": "error", "reason": "log_not_found"}

    row = dict(row)
    cycle = settings_service.get_cycle_by_id(row["cycle_id"])
    if not cycle:
        return {"status": "error", "reason": "cycle_not_found"}

    result = send_reminder(
        row["resident_id"], cycle,
        row["stage_type"], row["days_offset"],
        channel=row["channel"],
    )

    # Update the original log row to reflect retry outcome
    if result.get("status") == "sent":
        execute_write(
            "UPDATE reminder_log SET status='sent', error_message='', sent_at=datetime('now') WHERE id=?",
            (log_id,)
        )

    return result


def get_reminder_log(resident_id: int | None = None, limit: int = 200) -> list[dict]:
    conn = get_connection()
    if resident_id:
        rows = conn.execute(
            "SELECT * FROM reminder_log WHERE resident_id=? ORDER BY sent_at DESC LIMIT ?",
            (resident_id, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT rl.*, r.name, r.property_id FROM reminder_log rl
               JOIN residents r ON r.id = rl.resident_id
               ORDER BY rl.sent_at DESC LIMIT ?""",
            (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


# ── Preview (no send) ─────────────────────────────────────────────────────────

def preview_message(resident_id: int, template_type: str, language: str) -> str:
    """Renders a message preview for the reminders screen without sending."""
    resident = resident_service.get_resident_by_id(resident_id)
    cycle    = settings_service.get_active_cycle()
    if not resident or not cycle:
        return ""

    due_str = cycle.get("due_date", "")
    today   = date.today()
    try:
        due_dt       = date.fromisoformat(due_str)
        days_overdue = max(0, (today - due_dt).days)
    except (ValueError, TypeError):
        days_overdue = 0

    penalty    = settings_service.calculate_penalty(resident["base_amount"], cycle, days_overdue)
    rebate     = settings_service.calculate_rebate(resident["base_amount"], cycle)
    total_due  = round(resident["base_amount"] + penalty, 2)
    after_reb  = round(resident["base_amount"] - rebate, 2)
    gp_name    = settings_service.get_app_setting("gram_panchayat_name", "Gram Panchayat")

    variables = {
        "name":            resident["name"],
        "due_date":        _fmt_date(due_str),
        "amount":          _fmt_currency(resident["base_amount"]),
        "penalty_amount":  _fmt_currency(penalty),
        "rebate_deadline": _fmt_date(cycle.get("rebate_deadline", "")),
        "rebate_percent":  str(cycle.get("rebate_percent", 0)),
        "total":           _fmt_currency(total_due),
        "after_rebate":    _fmt_currency(after_reb),
        "ward":            resident.get("ward", ""),
        "property_id":     resident.get("property_id", ""),
        "gram_panchayat":  gp_name,
    }
    return template_service.render_template(template_type, language, variables)


# ── Formatting helpers ────────────────────────────────────────────────────────

def _fmt_currency(amount: float) -> str:
    """₹2,500 style Indian number formatting."""
    try:
        s = f"{int(amount):,}"
        return s
    except Exception:
        return str(amount)


def _fmt_date(iso: str) -> str:
    """'2026-03-31' → '31 Mar 2026'"""
    try:
        return datetime.strptime(iso, "%Y-%m-%d").strftime("%d %b %Y")
    except Exception:
        return iso
