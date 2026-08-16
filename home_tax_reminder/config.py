"""
config.py — Loads .env and exposes all app constants.
Never hardcode secrets or environment-specific values here.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (one level up from this file's dir if needed,
# but main.py sets cwd to project root before importing)
load_dotenv(override=False)

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_PATH: str = os.getenv("DATABASE_PATH", "data/tax_reminder.db")

# ── Twilio ────────────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID: str  = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN: str   = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_SMS_FROM: str     = os.getenv("TWILIO_SMS_FROM", "")
TWILIO_WHATSAPP_FROM: str = os.getenv("TWILIO_WHATSAPP_FROM", "")

# ── Messaging ─────────────────────────────────────────────────────────────────
DRY_RUN_MODE: bool   = os.getenv("DRY_RUN_MODE", "true").strip().lower() == "true"
PRIMARY_CHANNEL: str = os.getenv("PRIMARY_CHANNEL", "sms")   # "sms" | "whatsapp"

# ── Scheduler ─────────────────────────────────────────────────────────────────
REMINDER_CHECK_TIME: str = os.getenv("REMINDER_CHECK_TIME", "09:00")  # HH:MM 24h

# ── App ───────────────────────────────────────────────────────────────────────
APP_ENV: str          = os.getenv("APP_ENV", "development")
DEFAULT_LANGUAGE: str = os.getenv("DEFAULT_LANGUAGE", "mr")

# ── Derived / computed ────────────────────────────────────────────────────────
_check_hour, _check_minute = (int(x) for x in REMINDER_CHECK_TIME.split(":"))
REMINDER_HOUR:   int = _check_hour
REMINDER_MINUTE: int = _check_minute

# Ensure DB directory exists at import time
Path(DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
