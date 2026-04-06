"""
Twilio SMS Service
Sends a 6-digit PIN to the employee's registered phone number via Twilio.

Requirements:
    pip install twilio

.env variables required:
    TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    TWILIO_AUTH_TOKEN=your_auth_token
    TWILIO_PHONE_NUMBER=+14782093970
"""

import random
import string
import logging

from backend.core.config import settings

logger = logging.getLogger(__name__)


# ── PIN Generation ─────────────────────────────────────────────────────────────

def generate_pin(length: int = 6) -> str:
    """Generate a cryptographically random numeric PIN string."""
    return "".join(random.choices(string.digits, k=length))


# ── SMS Delivery ───────────────────────────────────────────────────────────────

def send_pin_sms(phone_number: str, employee_name: str, pin: str) -> dict:
    """
    Send the PIN via Twilio SMS.

    Args:
        phone_number: E.164 format preferred, e.g. '+919876543210'
                      If the number has no country code, '+91' is prepended
                      (change default_country_code below to match your region).
        employee_name: Used in the SMS body greeting.
        pin: The 6-digit PIN string to send.

    Returns:
        { "success": bool, "sid": str | None, "error": str | None }
    """
    # ── Validate config ────────────────────────────────────────────────────────
    missing = [
        v for v in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]
        if not getattr(settings, v, None)
    ]
    if missing:
        logger.error("Missing Twilio config: %s", missing)
        return {
            "success": False,
            "sid": None,
            "error": f"Twilio not configured. Missing: {', '.join(missing)}",
        }

    # ── Normalize phone number ─────────────────────────────────────────────────
    default_country_code = "+91"   # ← change if your employees are in a different country
    normalized = _normalize_phone(phone_number, default_country_code)
    if not normalized:
        logger.error("Invalid phone number: %s", phone_number)
        return {
            "success": False,
            "sid": None,
            "error": f"Invalid phone number: {phone_number}",
        }

    # ── Build message ──────────────────────────────────────────────────────────
    message_body = (
        f"Hi {employee_name}, your HRMS login PIN is: {pin}\n"
        f"Valid for {settings.PIN_EXPIRY_MINUTES} minutes. Do not share it."
    )

    # ── Send via Twilio ────────────────────────────────────────────────────────
    try:
        from twilio.rest import Client  # type: ignore
        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        message = client.messages.create(
            body=message_body,
            from_=settings.TWILIO_PHONE_NUMBER,
            to=normalized,
        )
        logger.info(
            "PIN SMS sent to %s (SID: %s)", _mask_phone(normalized), message.sid
        )
        return {"success": True, "sid": message.sid, "error": None}

    except ImportError:
        logger.error("twilio package not installed — run: pip install twilio")
        return {
            "success": False,
            "sid": None,
            "error": "twilio package not installed",
        }
    except Exception as exc:
        logger.error("Twilio send failed for %s: %s", _mask_phone(normalized), exc)
        return {
            "success": False,
            "sid": None,
            "error": str(exc),
        }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalize_phone(phone: str, default_country_code: str = "+91") -> str | None:
    """
    Ensure the phone number is in E.164 format.
    Handles: +919876543210, 919876543210, 9876543210, 09876543210
    Returns None if the number looks invalid.
    """
    if not phone:
        return None

    # Strip spaces, dashes, parentheses
    cleaned = "".join(c for c in phone if c.isdigit() or c == "+")

    if cleaned.startswith("+"):
        return cleaned  # already E.164

    # Strip leading zeros
    cleaned = cleaned.lstrip("0")

    if len(cleaned) == 10:
        # Bare 10-digit number — prepend default country code
        return f"{default_country_code}{cleaned}"

    if len(cleaned) >= 11:
        # Assume it includes country code digits (e.g. 919876543210)
        return f"+{cleaned}"

    return None  # too short to be valid


def _mask_phone(phone: str) -> str:
    """Return a masked phone like ******3210 for safe logging."""
    return f"{'*' * max(0, len(phone) - 4)}{phone[-4:]}"