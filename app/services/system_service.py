"""
system_service.py — App status, messaging config, test SMS.
"""

import json
from datetime import datetime

from config import (
    DRY_RUN_MODE,
    PRIMARY_CHANNEL,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_SMS_FROM,
    REMINDER_CHECK_TIME,
)
from services import messaging_service, settings_service


def get_messaging_status() -> dict:
    twilio_configured = bool(
        TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_SMS_FROM
    )
    return {
        "dry_run": DRY_RUN_MODE,
        "primary_channel": PRIMARY_CHANNEL,
        "twilio_configured": twilio_configured,
        "ready_to_send": (DRY_RUN_MODE or twilio_configured),
        "reminder_check_time": REMINDER_CHECK_TIME,
    }


def get_scheduler_info(scheduler_status: dict) -> dict:
    last_run = settings_service.get_app_setting("last_scheduler_run", "")
    last_result_raw = settings_service.get_app_setting("last_scheduler_result", "")
    last_result = None
    if last_result_raw:
        try:
            last_result = json.loads(last_result_raw)
        except json.JSONDecodeError:
            last_result = {"raw": last_result_raw}
    return {
        **scheduler_status,
        "last_run": last_run or None,
        "last_result": last_result,
        "reminder_check_time": REMINDER_CHECK_TIME,
    }


def record_scheduler_run(result: dict) -> None:
    settings_service.set_app_setting("last_scheduler_run", datetime.now().isoformat(timespec="seconds"))
    settings_service.set_app_setting("last_scheduler_result", json.dumps(result))


def send_test_sms(phone: str) -> dict:
    phone = (phone or "").strip()
    if not phone:
        return {"status": "error", "reason": "phone_required"}

    gp_name = settings_service.get_app_setting("gram_panchayat_name", "Gram Panchayat")
    body = (
        f"Home Tax Reminder test from {gp_name}. "
        "If you received this, SMS delivery is working."
    )
    result = messaging_service.send_message(phone, body)
    if result.get("dry_run"):
        result["notice"] = "DRY_RUN_MODE is on — logged only, no real SMS sent."
    return result
