"""
backend/app.py — Flask REST API for Home Tax Reminder System.
Exposes JSON endpoints for the React frontend and manages the background APScheduler.
"""

import os
import sys
import logging
from datetime import date
from flask import Flask, request, jsonify

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

from config import HOST, PORT
from database.db import init_db
from scheduler import start_scheduler, stop_scheduler, get_scheduler_status, trigger_now
from services import (
    resident_service,
    settings_service,
    template_service,
    reminder_engine,
    word_import_service,
)

app = Flask(__name__)

# Basic CORS headers for local frontend integration
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response

@app.route("/", methods=["GET"])
def root():
    return jsonify({
        "status": "online",
        "app": "Home Tax Reminder Manager API",
        "version": "1.0.0"
    })

# ── Health & Auth Check ───────────────────────────────────────────────────────

@app.route("/api/auth/check", methods=["GET"])
def auth_check():
    return jsonify({"authenticated": True, "user": "admin"})

# ── Stats & Dashboard ─────────────────────────────────────────────────────────

@app.route("/api/stats", methods=["GET"])
def get_stats():
    cycle = settings_service.get_active_cycle()
    stats = resident_service.get_stats(cycle)
    return jsonify(stats)

# ── Tax Cycle & Cadence ───────────────────────────────────────────────────────

@app.route("/api/cycle", methods=["GET"])
def get_active_cycle():
    cycle = settings_service.get_active_cycle()
    return jsonify(cycle)

@app.route("/api/cycles", methods=["GET"])
def get_all_cycles():
    cycles = settings_service.get_all_cycles()
    return jsonify(cycles)

@app.route("/api/cycle", methods=["POST"])
def save_cycle():
    data = request.get_json() or {}
    try:
        ok = settings_service.update_active_cycle(data)
        if ok:
            return jsonify({"success": True})
        cycle_id = settings_service.upsert_cycle(data)
        return jsonify({"success": True, "cycle_id": cycle_id})
    except Exception as e:
        log.exception("save_cycle failed")
        return jsonify({"success": False, "error": str(e)}), 400

@app.route("/api/cadence/<int:cycle_id>", methods=["GET"])
def get_cadence(cycle_id: int):
    cadence = settings_service.get_cadence(cycle_id)
    return jsonify(cadence)

# ── Residents CRUD ────────────────────────────────────────────────────────────

@app.route("/api/residents", methods=["GET"])
def get_residents():
    search = request.args.get("search", "")
    status_filter = request.args.get("status", "all")
    ward_filter = request.args.get("ward", "all")
    sort_by = request.args.get("sort_by", "name")
    sort_dir = request.args.get("sort_dir", "ASC")

    residents = resident_service.get_all_residents(search, status_filter, ward_filter, sort_by, sort_dir)
    return jsonify(residents)

@app.route("/api/residents/<int:resident_id>", methods=["GET"])
def get_resident(resident_id: int):
    r = resident_service.get_resident_by_id(resident_id)
    if not r:
        return jsonify({"error": "Resident not found"}), 404
    return jsonify(r)

@app.route("/api/residents", methods=["POST"])
def create_resident():
    data = request.get_json() or {}
    try:
        r = resident_service.create_resident(data)
        return jsonify({"success": True, "resident": r}), 201
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        log.exception("create_resident failed")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/residents/<int:resident_id>", methods=["PUT"])
def update_resident(resident_id: int):
    data = request.get_json() or {}
    try:
        r = resident_service.update_resident(resident_id, data)
        if not r:
            return jsonify({"success": False, "error": "Resident not found"}), 404
        return jsonify({"success": True, "resident": r})
    except Exception as e:
        log.exception("update_resident failed")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/residents/<int:resident_id>", methods=["DELETE"])
def delete_resident(resident_id: int):
    try:
        ok = resident_service.delete_resident(resident_id)
        return jsonify({"success": ok})
    except Exception as e:
        log.exception("delete_resident failed")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/residents/<int:resident_id>/mark-paid", methods=["POST"])
def mark_paid(resident_id: int):
    data = request.get_json() or {}
    paid_date = data.get("paid_date", "")
    try:
        r = resident_service.mark_paid(resident_id, paid_date or None)
        return jsonify({"success": True, "resident": r})
    except Exception as e:
        log.exception("mark_paid failed")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/residents/<int:resident_id>/mark-unpaid", methods=["POST"])
def mark_unpaid(resident_id: int):
    try:
        r = resident_service.mark_unpaid(resident_id)
        return jsonify({"success": True, "resident": r})
    except Exception as e:
        log.exception("mark_unpaid failed")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/wards", methods=["GET"])
def get_wards():
    wards = resident_service.get_all_wards()
    return jsonify(wards)

# ── Templates ─────────────────────────────────────────────────────────────────

@app.route("/api/templates", methods=["GET"])
def get_all_templates():
    tmpls = template_service.get_templates_as_dict()
    return jsonify(tmpls)

@app.route("/api/templates", methods=["PUT"])
def update_template():
    data = request.get_json() or {}
    ttype = data.get("template_type", "")
    lang = data.get("language", "")
    body = data.get("body", "")
    ok = template_service.update_template(ttype, lang, body)
    return jsonify({"success": ok})

@app.route("/api/templates/reset", methods=["POST"])
def reset_templates():
    try:
        template_service.reset_to_defaults()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Reminders & Messaging ─────────────────────────────────────────────────────

@app.route("/api/reminders/preview", methods=["POST"])
def preview_message():
    data = request.get_json() or {}
    resident_id = int(data.get("resident_id", 0))
    template_type = data.get("template_type", "upcoming")
    language = data.get("language", "mr")
    msg = reminder_engine.preview_message(resident_id, template_type, language)
    return jsonify({"body": msg})

@app.route("/api/reminders/send-now", methods=["POST"])
def send_reminder_now():
    data = request.get_json() or {}
    resident_id = int(data.get("resident_id", 0))
    stage_type = data.get("stage_type", "pre_due")
    force = bool(data.get("force", False))
    try:
        res = reminder_engine.send_now(resident_id, stage_type, force)
        return jsonify(res)
    except Exception as e:
        log.exception("send_reminder_now failed")
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route("/api/reminders/trigger-daily", methods=["POST"])
def trigger_daily_check():
    res = trigger_now()
    return jsonify(res)

@app.route("/api/reminders/failed", methods=["GET"])
def get_failed_sends():
    fails = reminder_engine.get_failed_sends()
    return jsonify(fails)

@app.route("/api/reminders/retry/<int:log_id>", methods=["POST"])
def retry_failed_send(log_id: int):
    try:
        res = reminder_engine.retry_failed(log_id)
        return jsonify(res)
    except Exception as e:
        log.exception("retry_failed_send failed")
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route("/api/reminders/log", methods=["GET"])
def get_reminder_log():
    resident_id = request.args.get("resident_id", type=int)
    limit = request.args.get("limit", default=200, type=int)
    logs = reminder_engine.get_reminder_log(resident_id, limit)
    return jsonify(logs)

@app.route("/api/scheduler/status", methods=["GET"])
def scheduler_status():
    status = get_scheduler_status()
    return jsonify(status)

# ── Word Import ───────────────────────────────────────────────────────────────

@app.route("/api/import/parse", methods=["POST"])
def parse_import_text():
    data = request.get_json() or {}
    raw_text = data.get("text", "")
    try:
        parsed = word_import_service.parse_text(raw_text)
        existing_ids = resident_service.get_all_property_ids()
        new_records, dup_records = word_import_service.check_duplicates(parsed, existing_ids)
        return jsonify({
            "success": True,
            "new": [{k: v for k, v in r.items() if not k.startswith("_")} for r in new_records],
            "duplicates": [{k: v for k, v in r.items() if not k.startswith("_")} for r in dup_records],
            "total_parsed": len(parsed),
        })
    except Exception as e:
        log.exception("parse_import_text failed")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/import/confirm", methods=["POST"])
def confirm_import():
    data = request.get_json() or {}
    new_records = data.get("records", [])
    try:
        res = word_import_service.confirm_import(new_records)
        return jsonify({"success": True, **res})
    except Exception as e:
        log.exception("confirm_import failed")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/import/merge/<int:existing_id>", methods=["POST"])
def merge_resident_import(existing_id: int):
    data = request.get_json() or {}
    try:
        res = word_import_service.merge_resident(existing_id, data)
        return jsonify({"success": True, **res})
    except Exception as e:
        log.exception("merge_resident_import failed")
        return jsonify({"success": False, "error": str(e)}), 500

# ── Report Data ───────────────────────────────────────────────────────────────

@app.route("/api/report", methods=["GET"])
def get_report():
    period = request.args.get("period", "all")
    period_value = request.args.get("period_value", "")
    status_filter = request.args.get("status", "all")

    try:
        cycle = settings_service.get_active_cycle()
        residents = resident_service.get_all_residents()

        filtered = []
        for r in residents:
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

            days_overdue = 0
            if cycle:
                try:
                    due_dt = date.fromisoformat(cycle["due_date"])
                    days_overdue = max(0, (date.today() - due_dt).days)
                except Exception:
                    pass

            penalty = settings_service.calculate_penalty(r["base_amount"], cycle, days_overdue) if cycle else 0
            rebate  = settings_service.calculate_rebate(r["base_amount"], cycle) if cycle else 0
            net     = r["base_amount"] - rebate if r["payment_status"] == "paid" else r["base_amount"] + penalty

            filtered.append({
                **r,
                "penalty":  round(penalty, 2),
                "rebate":   round(rebate,  2),
                "net_due":  round(net,     2),
            })

        paid_recs   = [x for x in filtered if x["payment_status"] == "paid"]
        unpaid_recs = [x for x in filtered if x["payment_status"] == "unpaid"]

        return jsonify({
            "success":     True,
            "records":     filtered,
            "paid_sum":    round(sum(x["base_amount"] for x in paid_recs), 2),
            "rebate_sum":  round(sum(x["rebate"]      for x in paid_recs), 2),
            "unpaid_sum":  round(sum(x["base_amount"] for x in unpaid_recs), 2),
            "penalty_sum": round(sum(x["penalty"]     for x in unpaid_recs), 2),
            "total_outstanding": round(sum(x["net_due"] for x in unpaid_recs), 2),
            "paid_count":  len(paid_recs),
            "unpaid_count": len(unpaid_recs),
        })
    except Exception as e:
        log.exception("get_report failed")
        return jsonify({"success": False, "error": str(e)}), 500

# ── App Settings ──────────────────────────────────────────────────────────────

@app.route("/api/settings", methods=["GET"])
def get_app_settings():
    settings = settings_service.get_all_app_settings()
    return jsonify(settings)

@app.route("/api/settings", methods=["POST"])
def set_app_settings():
    data = request.get_json() or {}
    try:
        settings_service.set_all_app_settings(data)
        return jsonify({"success": True})
    except Exception as e:
        log.exception("set_app_settings failed")
        return jsonify({"success": False, "error": str(e)}), 500


def main():
    init_db()
    start_scheduler()
    try:
        log.info("Starting Home Tax Reminder API Server on http://%s:%d", HOST, PORT)
        app.run(host=HOST, port=PORT, debug=False)
    finally:
        stop_scheduler()

if __name__ == "__main__":
    main()
