"""
services/settings_service.py
CRUD for tax_cycle_settings, reminder_cadence, and app_settings.
All due dates, rebate %, penalty % come from the DB — never hardcoded.
"""

import logging
from datetime import date
from typing import Any
from database.db import get_connection, execute_write, execute_write_many

log = logging.getLogger(__name__)


# ── Tax Cycle ─────────────────────────────────────────────────────────────────

def get_active_cycle() -> dict | None:
    """Returns the currently active tax cycle as a plain dict, or None."""
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM tax_cycle_settings WHERE is_active=1 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return dict(row) if row else None


def get_cycle_by_id(cycle_id: int) -> dict | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM tax_cycle_settings WHERE id=?", (cycle_id,)).fetchone()
    return dict(row) if row else None


def get_all_cycles() -> list[dict]:
    conn = get_connection()
    rows = conn.execute("SELECT * FROM tax_cycle_settings ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


def upsert_cycle(data: dict) -> int:
    """
    Insert a new cycle (deactivating all others) and replace cadence rows.
    data keys: fy_label, collection_from_month, collection_to_month, due_date,
               rebate_enabled, rebate_percent, rebate_deadline,
               penalty_type, penalty_value, penalty_start_days,
               pre_reminders (list[int]), post_reminders (list[int])
    Returns the new cycle_id.
    """
    pre_days:  list[int] = data.pop("pre_reminders",  [30, 15, 7, 3, 1])
    post_days: list[int] = data.pop("post_reminders", [3, 7, 15, 30])

    statements: list[tuple] = []

    # Deactivate all existing cycles
    statements.append(("UPDATE tax_cycle_settings SET is_active=0", ()))

    # Insert new cycle — use lastrowid from a separate write
    execute_write_many(statements)

    cycle_id = execute_write(
        """INSERT INTO tax_cycle_settings
           (fy_label, collection_from_month, collection_to_month, due_date,
            rebate_enabled, rebate_percent, rebate_deadline,
            penalty_type, penalty_value, penalty_start_days, is_active)
           VALUES (?,?,?,?,?,?,?,?,?,?,1)""",
        (
            data.get("fy_label", ""),
            int(data.get("collection_from_month", 1)),
            int(data.get("collection_to_month", 3)),
            data.get("due_date", ""),
            1 if data.get("rebate_enabled") else 0,
            float(data.get("rebate_percent", 0)),
            data.get("rebate_deadline", ""),
            data.get("penalty_type", "flat"),
            float(data.get("penalty_value", 0)),
            int(data.get("penalty_start_days", 1)),
        )
    )

    # Insert cadence rows
    cadence_stmts: list[tuple] = []
    for d in pre_days:
        cadence_stmts.append((
            "INSERT INTO reminder_cadence (cycle_id,stage_type,days_offset) VALUES (?,?,?)",
            (cycle_id, "pre_due", int(d))
        ))
    for d in post_days:
        cadence_stmts.append((
            "INSERT INTO reminder_cadence (cycle_id,stage_type,days_offset) VALUES (?,?,?)",
            (cycle_id, "post_due", int(d))
        ))
    if cadence_stmts:
        execute_write_many(cadence_stmts)

    log.info("Tax cycle upserted: id=%s fy=%s", cycle_id, data.get("fy_label"))
    return cycle_id


def update_active_cycle(data: dict) -> bool:
    """
    Update fields of the currently active cycle in-place (without creating a new row).
    Pre/post reminders lists replace the cadence for the active cycle.
    """
    cycle = get_active_cycle()
    if not cycle:
        return False

    cycle_id = cycle["id"]
    pre_days:  list[int] = data.pop("pre_reminders",  None)
    post_days: list[int] = data.pop("post_reminders", None)

    execute_write(
        """UPDATE tax_cycle_settings
           SET fy_label=?, collection_from_month=?, collection_to_month=?,
               due_date=?, rebate_enabled=?, rebate_percent=?, rebate_deadline=?,
               penalty_type=?, penalty_value=?, penalty_start_days=?
           WHERE id=?""",
        (
            data.get("fy_label", cycle["fy_label"]),
            int(data.get("collection_from_month", cycle["collection_from_month"])),
            int(data.get("collection_to_month", cycle["collection_to_month"])),
            data.get("due_date", cycle["due_date"]),
            1 if data.get("rebate_enabled") else 0,
            float(data.get("rebate_percent", cycle["rebate_percent"])),
            data.get("rebate_deadline", cycle["rebate_deadline"]),
            data.get("penalty_type", cycle["penalty_type"]),
            float(data.get("penalty_value", cycle["penalty_value"])),
            int(data.get("penalty_start_days", cycle["penalty_start_days"])),
            cycle_id,
        )
    )

    # Replace cadence if provided
    if pre_days is not None or post_days is not None:
        set_cadence(
            cycle_id,
            pre_days  if pre_days  is not None else [r["days_offset"] for r in get_cadence(cycle_id) if r["stage_type"] == "pre_due"],
            post_days if post_days is not None else [r["days_offset"] for r in get_cadence(cycle_id) if r["stage_type"] == "post_due"],
        )

    return True


# ── Cadence ───────────────────────────────────────────────────────────────────

def get_cadence(cycle_id: int) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM reminder_cadence WHERE cycle_id=? ORDER BY stage_type, days_offset",
        (cycle_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def set_cadence(cycle_id: int, pre_days: list[int], post_days: list[int]) -> None:
    """Replace all cadence rows for a cycle."""
    stmts: list[tuple] = [
        ("DELETE FROM reminder_cadence WHERE cycle_id=?", (cycle_id,))
    ]
    for d in pre_days:
        stmts.append((
            "INSERT INTO reminder_cadence (cycle_id,stage_type,days_offset) VALUES (?,?,?)",
            (cycle_id, "pre_due", int(d))
        ))
    for d in post_days:
        stmts.append((
            "INSERT INTO reminder_cadence (cycle_id,stage_type,days_offset) VALUES (?,?,?)",
            (cycle_id, "post_due", int(d))
        ))
    execute_write_many(stmts)


# ── Penalty & Rebate Calculations ─────────────────────────────────────────────

def calculate_penalty(base_amount: float, cycle: dict, days_overdue: int) -> float:
    """
    Computes penalty fresh at call time (see Point 3 in design notes).
    Returns 0.0 if days_overdue < penalty_start_days.
    """
    if days_overdue < cycle.get("penalty_start_days", 1):
        return 0.0
    import math
    months_late = math.ceil(days_overdue / 30)
    p_type  = cycle.get("penalty_type", "flat")
    p_value = float(cycle.get("penalty_value", 0))
    if p_type == "flat":
        return round(p_value * months_late, 2)
    else:  # percent
        return round(base_amount * (p_value / 100) * months_late, 2)


def calculate_rebate(base_amount: float, cycle: dict) -> float:
    """Returns the rebate discount amount (not net amount) if rebate is active today."""
    if not cycle.get("rebate_enabled"):
        return 0.0
    deadline = cycle.get("rebate_deadline", "")
    if not deadline:
        return 0.0
    today_str = date.today().isoformat()
    if today_str <= deadline:
        return round(base_amount * (float(cycle.get("rebate_percent", 0)) / 100), 2)
    return 0.0


# ── App Settings ──────────────────────────────────────────────────────────────

def get_app_setting(key: str, default: str = "") -> str:
    conn = get_connection()
    row = conn.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_app_setting(key: str, value: str) -> None:
    execute_write(
        "INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value)
    )


def get_all_app_settings() -> dict:
    conn = get_connection()
    rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


def set_all_app_settings(settings: dict) -> None:
    stmts = [
        ("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
         (k, v))
        for k, v in settings.items()
    ]
    if stmts:
        execute_write_many(stmts)
