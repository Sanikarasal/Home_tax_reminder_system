"""
services/messaging_service.py
Twilio SMS + WhatsApp wrapper with:
  - DRY_RUN_MODE (logs instead of sending)
  - 3-category failure classification
  - Rate-limit backoff (retries only for rate-limit errors)
  - 300ms inter-send sleep enforced at caller (reminder_engine)
"""

import logging
import time
from config import (
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
    TWILIO_SMS_FROM, TWILIO_WHATSAPP_FROM,
    DRY_RUN_MODE, PRIMARY_CHANNEL,
)

log = logging.getLogger(__name__)

# Twilio error code classifications
_INVALID_NUM_CODES  = {21211, 21614, 21216, 21217, 21401, 21601}
_CARRIER_REJECT_CODES = {30003, 30006, 30008, 30005, 30007}
_RATE_LIMIT_CODES   = {429, 20429, 14107}

_MAX_RETRIES    = 3
_BACKOFF_SECS   = [1, 5, 15]   # wait between retries on rate-limit


def _classify_twilio_error(exc) -> str:
    """
    Returns a structured error category string stored in reminder_log.error_message.
    Format: '<category>:<code>[:detail]'
    Categories: invalid_number | carrier_rejected | rate_limited | api_error | network
    """
    try:
        code   = int(getattr(exc, "code", 0) or 0)
        status = int(getattr(exc, "status", 0) or 0)
        msg    = str(getattr(exc, "msg", str(exc)))
    except Exception:
        return f"api_error:0:{exc}"

    if code in _INVALID_NUM_CODES:
        return f"invalid_number:{code}"
    if code in _CARRIER_REJECT_CODES:
        return f"carrier_rejected:{code}"
    if code in _RATE_LIMIT_CODES or status == 429:
        return f"rate_limited:{code}"
    return f"api_error:{code}:{msg[:120]}"


def _send_sms_real(to_phone: str, body: str) -> dict:
    from twilio.rest import Client
    from twilio.base.exceptions import TwilioRestException

    to_e164 = to_phone if to_phone.startswith("+") else f"+91{to_phone}"
    client  = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

    for attempt in range(_MAX_RETRIES):
        try:
            message = client.messages.create(
                body=body,
                from_=TWILIO_SMS_FROM,
                to=to_e164,
            )
            log.info("SMS sent sid=%s to=%s", message.sid, to_e164)
            return {"status": "sent", "sid": message.sid}

        except TwilioRestException as e:
            category = _classify_twilio_error(e)
            log.warning("SMS failed attempt=%d category=%s to=%s", attempt + 1, category, to_e164)

            # No retry for these — permanent failures
            if category.startswith(("invalid_number", "carrier_rejected")):
                return {"status": "failed", "error": category}

            # Retry on rate-limit with backoff
            if category.startswith("rate_limited") and attempt < _MAX_RETRIES - 1:
                time.sleep(_BACKOFF_SECS[attempt])
                continue

            return {"status": "failed", "error": category}

        except Exception as e:
            category = f"network:{type(e).__name__}:{str(e)[:80]}"
            log.error("SMS network error attempt=%d: %s", attempt + 1, category)
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_BACKOFF_SECS[attempt])
                continue
            return {"status": "failed", "error": category}

    return {"status": "failed", "error": "max_retries_exceeded"}


def _send_whatsapp_real(to_phone: str, body: str) -> dict:
    from twilio.rest import Client
    from twilio.base.exceptions import TwilioRestException

    to_e164 = to_phone if to_phone.startswith("+") else f"+91{to_phone}"
    to_wa   = f"whatsapp:{to_e164}"
    client  = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

    for attempt in range(_MAX_RETRIES):
        try:
            message = client.messages.create(
                body=body,
                from_=TWILIO_WHATSAPP_FROM,
                to=to_wa,
            )
            log.info("WhatsApp sent sid=%s to=%s", message.sid, to_wa)
            return {"status": "sent", "sid": message.sid}

        except TwilioRestException as e:
            category = _classify_twilio_error(e)
            log.warning("WhatsApp failed attempt=%d category=%s to=%s", attempt + 1, category, to_wa)

            if category.startswith(("invalid_number", "carrier_rejected")):
                return {"status": "failed", "error": category}
            if category.startswith("rate_limited") and attempt < _MAX_RETRIES - 1:
                time.sleep(_BACKOFF_SECS[attempt])
                continue
            return {"status": "failed", "error": category}

        except Exception as e:
            category = f"network:{type(e).__name__}:{str(e)[:80]}"
            log.error("WhatsApp network error attempt=%d: %s", attempt + 1, category)
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_BACKOFF_SECS[attempt])
                continue
            return {"status": "failed", "error": category}

    return {"status": "failed", "error": "max_retries_exceeded"}


def send_message(to_phone: str, body: str, channel: str | None = None) -> dict:
    """
    Primary public interface. Dispatches via channel or falls back to PRIMARY_CHANNEL.
    In DRY_RUN_MODE: logs the message body and returns {"status": "sent", "dry_run": True}.
    """
    ch = channel or PRIMARY_CHANNEL

    if DRY_RUN_MODE:
        log.info(
            "[DRY RUN] channel=%s to=%s body=%.80s...",
            ch, to_phone, body
        )
        return {"status": "sent", "dry_run": True, "channel": ch}

    if ch == "whatsapp":
        return _send_whatsapp_real(to_phone, body)
    return _send_sms_real(to_phone, body)


def send_both(to_phone: str, body_mr: str, body_en: str) -> dict:
    """
    Sends Marathi message first via PRIMARY_CHANNEL, then English.
    Used by reminder_engine when bilingual send is requested.
    """
    result_mr = send_message(to_phone, body_mr)
    time.sleep(0.3)   # Rate-limit spacing between the two sends
    result_en = send_message(to_phone, body_en)
    return {
        "marathi": result_mr,
        "english": result_en,
        "status":  "sent" if result_mr["status"] == "sent" else "failed",
    }
