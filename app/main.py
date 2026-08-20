"""
main.py — Eel entry point.
Exposes all backend functions to the JS frontend.
Starts APScheduler alongside the Eel window.
"""

import logging
import sys
import os

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("app.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

import eel
from database.db import init_db
from scheduler import start_scheduler, stop_scheduler, get_scheduler_status, trigger_now
from services import (
    resident_service,
    settings_service,
    template_service,
    reminder_engine,
    word_import_service,
    excel_service,
)

# ── Init ──────────────────────────────────────────────────────────────────────

_app_dir = os.path.dirname(os.path.abspath(__file__))
_web_dir = os.path.join(_app_dir, "web")
eel.init(_web_dir)
init_db()

# ── Auth placeholder (for future login system) ────────────────────────────────

@eel.expose
def auth_check() -> dict:
    """Placeholder — always returns authenticated for MVP single-user mode."""
    return {"authenticated": True, "user": "admin"}


# ── App Settings ──────────────────────────────────────────────────────────────

@eel.expose
def get_all_app_settings() -> dict:
    return settings_service.get_all_app_settings()

@eel.expose
def set_all_app_settings(settings: dict) -> dict:
    try:
        settings_service.set_all_app_settings(settings)
        return {"success": True}
    except Exception as e:
        log.exception("set_all_app_settings failed")
        return {"success": False, "error": str(e)}


# ── Tax Cycle ─────────────────────────────────────────────────────────────────

@eel.expose
def get_active_cycle() -> dict | None:
    return settings_service.get_active_cycle()

@eel.expose
def get_all_cycles() -> list:
    return settings_service.get_all_cycles()

@eel.expose
def save_cycle(data: dict) -> dict:
    """
    Save (update in-place) the active cycle.
    data must include all tax_cycle_settings fields + pre_reminders/post_reminders lists.
    """
    try:
        ok = settings_service.update_active_cycle(data)
        if ok:
            return {"success": True}
        # No active cycle exists — create one
        cycle_id = settings_service.upsert_cycle(data)
        return {"success": True, "cycle_id": cycle_id}
    except Exception as e:
        log.exception("save_cycle failed")
        return {"success": False, "error": str(e)}

@eel.expose
def get_cadence(cycle_id: int) -> list:
    return settings_service.get_cadence(cycle_id)


# ── Residents ─────────────────────────────────────────────────────────────────

@eel.expose
def get_all_residents(search="", status_filter="all", ward_filter="all",
                      sort_by="name", sort_dir="ASC") -> list:
    return resident_service.get_all_residents(search, status_filter, ward_filter, sort_by, sort_dir)

@eel.expose
def get_resident(resident_id: int) -> dict | None:
    return resident_service.get_resident_by_id(resident_id)

@eel.expose
def create_resident(data: dict) -> dict:
    try:
        r = resident_service.create_resident(data)
        return {"success": True, "resident": r}
    except ValueError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        log.exception("create_resident failed")
        return {"success": False, "error": str(e)}

@eel.expose
def update_resident(resident_id: int, data: dict) -> dict:
    try:
        r = resident_service.update_resident(resident_id, data)
        return {"success": True, "resident": r}
    except Exception as e:
        log.exception("update_resident failed")
        return {"success": False, "error": str(e)}

@eel.expose
def delete_resident(resident_id: int) -> dict:
    try:
        ok = resident_service.delete_resident(resident_id)
        return {"success": ok}
    except Exception as e:
        log.exception("delete_resident failed")
        return {"success": False, "error": str(e)}

@eel.expose
def mark_paid(resident_id: int, paid_date: str = "") -> dict:
    try:
        r = resident_service.mark_paid(resident_id, paid_date or None)
        return {"success": True, "resident": r}
    except Exception as e:
        log.exception("mark_paid failed")
        return {"success": False, "error": str(e)}

@eel.expose
def mark_unpaid(resident_id: int) -> dict:
    try:
        r = resident_service.mark_unpaid(resident_id)
        return {"success": True, "resident": r}
    except Exception as e:
        log.exception("mark_unpaid failed")
        return {"success": False, "error": str(e)}

@eel.expose
def get_resident_stats() -> dict:
    cycle = settings_service.get_active_cycle()
    return resident_service.get_stats(cycle)

@eel.expose
def get_all_wards() -> list:
    return resident_service.get_all_wards()

@eel.expose
def get_resident_by_property_id(property_id: str) -> dict | None:
    return resident_service.get_resident_by_property_id(property_id)


# ── Yearly Payment Tracking ───────────────────────────────────────────────────

@eel.expose
def get_payments_by_year(cycle_id: int) -> dict:
    """
    Returns {'paid': [...], 'unpaid': [...]} for a given cycle/FY.
    Unpaid rows include is_overdue (bool) and carry_forward_fy_label fields.
    Each row: resident name, property_id, phone, ward, base_amount,
              penalty_amount, status, paid_date, carry_forward_from_cycle_id,
              carry_forward_fy_label.
    """
    try:
        return resident_service.get_payments_by_cycle(cycle_id)
    except Exception as e:
        log.exception("get_payments_by_year failed")
        return {"paid": [], "unpaid": [], "error": str(e)}

@eel.expose
def get_resident_payment_history(resident_id: int) -> list:
    """
    Returns all resident_payments rows for a resident, ordered by FY ascending.
    Each row includes fy_label, due_date, status, base_amount, penalty_amount,
    paid_date, carry_forward_fy_label.
    """
    try:
        return resident_service.get_resident_payment_history(resident_id)
    except Exception as e:
        log.exception("get_resident_payment_history failed")
        return []

@eel.expose
def add_yearly_cycle_for_resident(
    resident_id: int, cycle_id: int, base_amount: float
) -> dict:
    """
    Creates a new resident_payments row for the given resident+cycle.
    If a prior unpaid/overdue cycle exists, sets carry_forward_from_cycle_id.
    Returns {'success': True, 'payment': {...}} or {'success': False, 'error': '...'}.
    """
    try:
        return resident_service.add_yearly_cycle(resident_id, cycle_id, base_amount)
    except Exception as e:
        log.exception("add_yearly_cycle_for_resident failed")
        return {"success": False, "error": str(e)}

@eel.expose
def mark_payment_paid_for_year(
    resident_id: int, cycle_id: int, paid_date: str = "", penalty_amount: float = 0.0
) -> dict:
    """
    Marks the resident_payments row for (resident_id, cycle_id) as paid.
    Also syncs the legacy residents.payment_status for reminder engine.
    Returns the updated payment row.
    """
    try:
        row = resident_service.mark_payment_paid(
            resident_id, cycle_id, paid_date or None, penalty_amount
        )
        return {"success": True, "payment": row}
    except Exception as e:
        log.exception("mark_payment_paid_for_year failed")
        return {"success": False, "error": str(e)}

@eel.expose
def mark_payment_unpaid_for_year(resident_id: int, cycle_id: int) -> dict:
    """
    Reverts the resident_payments row for (resident_id, cycle_id) to unpaid.
    Also syncs legacy residents.payment_status.
    """
    try:
        row = resident_service.mark_payment_unpaid(resident_id, cycle_id)
        return {"success": True, "payment": row}
    except Exception as e:
        log.exception("mark_payment_unpaid_for_year failed")
        return {"success": False, "error": str(e)}


# ── Templates ─────────────────────────────────────────────────────────────────

@eel.expose
def get_all_templates() -> dict:
    return template_service.get_templates_as_dict()

@eel.expose
def update_template(template_type: str, language: str, body: str) -> dict:
    ok = template_service.update_template(template_type, language, body)
    return {"success": ok}

@eel.expose
def reset_templates() -> dict:
    try:
        template_service.reset_to_defaults()
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ── Reminders & Messaging ─────────────────────────────────────────────────────

@eel.expose
def preview_message(resident_id: int, template_type: str, language: str) -> str:
    return reminder_engine.preview_message(resident_id, template_type, language)

@eel.expose
def send_reminder_now(resident_id: int, stage_type: str = "pre_due", force: bool = False) -> dict:
    try:
        return reminder_engine.send_now(resident_id, stage_type, force)
    except Exception as e:
        log.exception("send_reminder_now failed")
        return {"status": "error", "error": str(e)}

@eel.expose
def get_failed_sends() -> list:
    return reminder_engine.get_failed_sends()

@eel.expose
def retry_failed_send(log_id: int) -> dict:
    try:
        return reminder_engine.retry_failed(log_id)
    except Exception as e:
        log.exception("retry_failed_send failed")
        return {"status": "error", "error": str(e)}

@eel.expose
def get_reminder_log(resident_id: int = 0) -> list:
    return reminder_engine.get_reminder_log(resident_id if resident_id else None)

@eel.expose
def trigger_daily_check() -> dict:
    """Manual trigger from UI — runs daily check immediately."""
    return trigger_now()


# ── Scheduler ─────────────────────────────────────────────────────────────────

@eel.expose
def get_scheduler_status_js() -> dict:
    return get_scheduler_status()


# ── Word Import ───────────────────────────────────────────────────────────────

@eel.expose
def parse_import_text(raw_text: str) -> dict:
    """
    Parse pasted Word text and return new + duplicate records for review.
    Does NOT insert anything — admin must call confirm_import() explicitly.
    """
    try:
        parsed = word_import_service.parse_text(raw_text)
        existing_ids = resident_service.get_all_property_ids()
        new_records, dup_records = word_import_service.check_duplicates(parsed, existing_ids)
        return {
            "success": True,
            "new":        [_clean_rec(r) for r in new_records],
            "duplicates": [_clean_rec(r) for r in dup_records],
            "total_parsed": len(parsed),
        }
    except Exception as e:
        log.exception("parse_import_text failed")
        return {"success": False, "error": str(e)}

@eel.expose
def parse_import_docx(base64_content: str) -> dict:
    """
    Parse uploaded .docx file content (passed as base64 string from browser)
    and return new + duplicate records for review.
    """
    try:
        import base64
        if "," in base64_content:
            base64_content = base64_content.split(",", 1)[1]
        docx_bytes = base64.b64decode(base64_content)
        parsed = word_import_service.parse_docx_bytes(docx_bytes)
        existing_ids = resident_service.get_all_property_ids()
        new_records, dup_records = word_import_service.check_duplicates(parsed, existing_ids)
        return {
            "success": True,
            "new":        [_clean_rec(r) for r in new_records],
            "duplicates": [_clean_rec(r) for r in dup_records],
            "total_parsed": len(parsed),
        }
    except Exception as e:
        log.exception("parse_import_docx failed")
        return {"success": False, "error": str(e)}

@eel.expose
def parse_import_excel(base64_content: str) -> dict:
    """
    Parse uploaded .xlsx / .xls / .csv file content (passed as base64 string from browser)
    and return new + duplicate records for review.
    """
    try:
        import base64
        if "," in base64_content:
            base64_content = base64_content.split(",", 1)[1]
        file_bytes = base64.b64decode(base64_content)
        parsed = excel_service.parse_excel_bytes(file_bytes)
        existing_ids = resident_service.get_all_property_ids()
        new_records, dup_records = excel_service.check_duplicates(parsed, existing_ids)
        return {
            "success": True,
            "new":        [_clean_rec(r) for r in new_records],
            "duplicates": [_clean_rec(r) for r in dup_records],
            "total_parsed": len(parsed),
        }
    except Exception as e:
        log.exception("parse_import_excel failed")
        return {"success": False, "error": str(e)}

@eel.expose
def get_excel_import_template() -> dict:
    """Generates a downloadable sample Excel spreadsheet template."""
    try:
        import base64
        tpl_bytes = excel_service.generate_sample_excel_template()
        b64 = base64.b64encode(tpl_bytes).decode("utf-8")
        return {
            "success": True,
            "filename": "Taxpayer_Import_Template.xlsx",
            "data": f"data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,{b64}",
        }
    except Exception as e:
        log.exception("get_excel_import_template failed")
        return {"success": False, "error": str(e)}

@eel.expose
def confirm_import(new_records: list) -> dict:
    """Insert admin-confirmed new records. Never auto-inserts duplicates."""
    try:
        result = excel_service.confirm_import(new_records)
        return {"success": True, **result}
    except Exception as e:
        log.exception("confirm_import failed")
        return {"success": False, "error": str(e)}

@eel.expose
def merge_resident_import(existing_id: int, new_data: dict) -> dict:
    """Staff-approved merge of duplicate record into existing resident."""
    try:
        result = excel_service.merge_resident(existing_id, new_data)
        # Normalise: always include "success" key alongside "merged" for JS compatibility
        return {"success": result.get("merged", False), **result}
    except Exception as e:
        log.exception("merge_resident_import failed")
        return {"success": False, "error": str(e)}


# ── Report data & Excel Export ────────────────────────────────────────────────

@eel.expose
def get_report_data(period: str = "all", period_value: str = "",
                    status_filter: str = "all") -> dict:
    """
    Returns filtered resident data for the Tax Report screen.
    period: 'all' | 'yearly' | 'monthly' | 'daily'
    period_value: '2026' | '2026-03' | '2026-03-31'
    """
    try:
        cycle = settings_service.get_active_cycle()
        residents = resident_service.get_all_residents()

        filtered = []
        for r in residents:
            # Period filter — use paid_date for paid records, due_date for unpaid
            if period != "all":
                target = r.get("paid_date") or (cycle["due_date"] if cycle else "")
                if not target:
                    continue
                if period == "yearly"  and not target.startswith(period_value):
                    continue
                if period == "monthly" and not target.startswith(period_value):
                    continue
                if period == "daily"   and target != period_value:
                    continue

            if status_filter == "paid"   and r["payment_status"] != "paid":
                continue
            if status_filter == "unpaid" and r["payment_status"] != "unpaid":
                continue

            from datetime import date as date_cls
            import math
            days_overdue = 0
            if cycle:
                try:
                    due_dt = date_cls.fromisoformat(cycle["due_date"])
                    days_overdue = max(0, (date_cls.today() - due_dt).days)
                except Exception:
                    pass

            penalty = settings_service.calculate_penalty(r["base_amount"], cycle, days_overdue) if cycle else 0
            rebate  = settings_service.calculate_rebate(r["base_amount"], cycle) if cycle else 0
            net     = r["base_amount"] - rebate if r["payment_status"] == "paid" else r["base_amount"] + penalty

            filtered.append({
                **r,
                "due_date": cycle.get("due_date") if cycle else None,
                "penalty":  round(penalty, 2),
                "rebate":   round(rebate,  2),
                "net_due":  round(net,     2),
            })

        paid_recs   = [x for x in filtered if x["payment_status"] == "paid"]
        unpaid_recs = [x for x in filtered if x["payment_status"] == "unpaid"]

        return {
            "success":     True,
            "records":     filtered,
            "paid_sum":    round(sum(x["base_amount"] for x in paid_recs), 2),
            "rebate_sum":  round(sum(x["rebate"]      for x in paid_recs), 2),
            "unpaid_sum":  round(sum(x["base_amount"] for x in unpaid_recs), 2),
            "penalty_sum": round(sum(x["penalty"]     for x in unpaid_recs), 2),
            "total_outstanding": round(sum(x["net_due"] for x in unpaid_recs), 2),
            "paid_count":  len(paid_recs),
            "unpaid_count": len(unpaid_recs),
        }
    except Exception as e:
        log.exception("get_report_data failed")
        return {"success": False, "error": str(e)}

@eel.expose
def generate_report_excel(period: str = "all", period_value: str = "",
                          status_filter: str = "all") -> dict:
    """
    Generates a styled Excel (.xlsx) file of the Tax Report and returns it as a Base64 Data URL.
    """
    try:
        import base64
        rep = get_report_data(period, period_value, status_filter)
        if not rep.get("success"):
            return {"success": False, "error": rep.get("error", "Failed to retrieve report data")}

        app_settings = settings_service.get_all_app_settings()
        gp_name = app_settings.get("gram_panchayat_name", "Gram Panchayat Office")

        period_lbl = f"{period.capitalize()}" + (f" ({period_value})" if period_value else "")
        if status_filter != "all":
            period_lbl += f" - {status_filter.capitalize()} only"

        excel_bytes = excel_service.generate_excel_report(rep, period_label=period_lbl, gp_name=gp_name)
        b64 = base64.b64encode(excel_bytes).decode("utf-8")

        safe_period = period_value.replace("-", "_") if period_value else "All"
        filename = f"Tax_Report_{period}_{safe_period}.xlsx"

        return {
            "success": True,
            "filename": filename,
            "data": f"data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,{b64}",
        }
    except Exception as e:
        log.exception("generate_report_excel failed")
        return {"success": False, "error": str(e)}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean_rec(rec: dict) -> dict:
    """Remove internal _block_index / _raw_block keys before sending to JS."""
    return {k: v for k, v in rec.items() if not k.startswith("_")}


# ── Launch ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("Starting Home Tax Reminder Manager")
    start_scheduler()

    try:
        eel.start(
            "index.html",
            size=(1280, 820),
            port=8765,
            shutdown_delay=5.0,
        )
    except (SystemExit, KeyboardInterrupt):
        log.info("Application closing")
    finally:
        stop_scheduler()
