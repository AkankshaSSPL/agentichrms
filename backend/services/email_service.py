"""
DEPRECATED — email_service.py

This module is kept for backward compatibility only.
All new code should use:

    from backend.core.email import send_email
    from backend.core.render_template import render_template

The functions below are thin shims that delegate to the canonical
send_email() in backend.core.email. They will be removed in a future phase.
"""

import logging
from backend.core.render_template import render_template
from backend.core.email import send_email as _send_email
from backend.core.config import settings

logger = logging.getLogger(__name__)


def send_pin_email(to_email: str, employee_name: str, pin: str) -> dict:
    """
    Send onboarding PIN email using the onboarding.html template.

    .. deprecated::
        Call send_email() + render_template("onboarding.html", ...) directly.
    """
    logger.warning(
        "send_pin_email() is deprecated. "
        "Use send_email(html=render_template('onboarding.html', ...)) instead."
    )
    try:
        html = render_template(
            "onboarding.html",
            employee_name=employee_name,
            employee_email=to_email,
            pin=pin,
            hr_email=getattr(settings, "HR_EMAIL", None),
        )
        _send_email(
            to=to_email,
            subject="Welcome to HRMS — Your Login Credentials",
            html=html,
            triggered_by="onboarding",
        )
        return {"success": True, "error": None}
    except Exception as e:
        logger.error(f"send_pin_email failed: {e}")
        return {"success": False, "error": str(e)}


def send_email(to_email: str, subject: str, body: str) -> dict:
    """
    Send a plain-text email.

    .. deprecated::
        Call backend.core.email.send_email() directly.
    """
    logger.warning(
        "email_service.send_email() is deprecated. "
        "Use backend.core.email.send_email() directly."
    )
    try:
        _send_email(to=to_email, subject=subject, body=body)
        return {"success": True, "error": None}
    except Exception as e:
        logger.error(f"send_email failed: {e}")
        return {"success": False, "error": str(e)}