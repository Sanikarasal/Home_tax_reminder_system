"""
backend/config.py — Loads .env and exposes backend configuration.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from root or backend directory
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path, override=False)
else:
    load_dotenv(override=False)

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_PATH: str = os.getenv("DATABASE_PATH", str(Path(__file__).resolve().parent / "data" / "tax_reminder.db"))

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

# ── App & Server ──────────────────────────────────────────────────────────────
APP_ENV: str          = os.getenv("APP_ENV", "development")
PORT: int             = int(os.getenv("PORT", "5000"))
HOST: str             = os.getenv("HOST", "127.0.0.1")
DEFAULT_LANGUAGE: str = os.getenv("DEFAULT_LANGUAGE", "mr")

# ── Derived ───────────────────────────────────────────────────────────────────
_check_hour, _check_minute = (int(x) for x in REMINDER_CHECK_TIME.split(":"))
REMINDER_HOUR:   int = _check_hour
REMINDER_MINUTE: int = _check_minute

# Ensure DB data directory exists at import time
Path(DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
