"""
Email utility — SMTP send + automatic DB logging via EmailLog model.

Supports both plain-text and HTML emails (multipart/alternative).
HTML emails include an auto-generated plain-text fallback via html2text
so they degrade gracefully in clients that don't render HTML.

Typical usage
-------------
from backend.core.email import send_email
from backend.core.render_template import render_template

html = render_template("leave_approved.html", employee_name="Alice", ...)
send_email(to="alice@company.com", subject="Leave Approved", html=html, db=db)
"""

import re
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from backend.core.config import settings

# ── Plain-text fallback ───────────────────────────────────────────────────────

def _html_to_plain(html: str) -> str:
    """
    Lightweight HTML → plain text conversion.
    Strips tags and collapses whitespace — no extra dependency required.
    Used only as the plain-text fallback part of a multipart/alternative email.
    """
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ── Public API ────────────────────────────────────────────────────────────────

def send_email(
    to: str,
    subject: str,
    body: Optional[str] = None,   # plain-text body (legacy / simple emails)
    html: Optional[str] = None,   # HTML body rendered from a template
    triggered_by: str = "system",
    db=None,                       # optional SQLAlchemy session — logs the send
) -> None:
    """
    Send an email via SMTP.

    Pass ``html=`` for rich template-based emails (preferred).
    Pass ``body=`` for simple plain-text emails (legacy / test emails).
    At least one of ``html`` or ``body`` must be provided.

    If *db* is supplied, writes an ``EmailLog`` row regardless of outcome.
    If *db* is None and the send fails, raises ``RuntimeError``.
    """
    if not html and not body:
        raise ValueError("send_email requires at least one of: html=, body=")

    status = "sent"
    error_msg = None

    # Derive plain text for logging preview and multipart fallback
    plain_text: str = body or _html_to_plain(html)

    if not settings.EMAIL_USER or not settings.EMAIL_PASS:
        print(  # noqa: T201
            f"⚠️  Email not configured (EMAIL_USER/EMAIL_PASS missing). "
            f"Would have sent to {to}: {subject}"
        )
        status = "failed"
        error_msg = "EMAIL_USER or EMAIL_PASS not configured"
    else:
        try:
            if html:
                # multipart/alternative: plain-text first, HTML last (RFC 2046 §5.1.4)
                msg = MIMEMultipart("alternative")
                msg.attach(MIMEText(plain_text, "plain", "utf-8"))
                msg.attach(MIMEText(html, "html", "utf-8"))
            else:
                msg = MIMEMultipart()
                msg.attach(MIMEText(plain_text, "plain", "utf-8"))

            msg["Subject"] = subject
            msg["From"] = settings.EMAIL_USER
            msg["To"] = to

            with smtplib.SMTP(settings.EMAIL_HOST, settings.EMAIL_PORT, timeout=settings.SMTP_TIMEOUT) as server:
                server.ehlo()
                server.starttls()
                server.login(settings.EMAIL_USER, settings.EMAIL_PASS)
                server.sendmail(settings.EMAIL_USER, to, msg.as_string())

        except Exception as e:  # noqa: BLE001
            status = "failed"
            error_msg = str(e)
            print(f"⚠️  Email send failed to {to}: {e}")  # noqa: T201

    # ── Log to DB if session provided ────────────────────────────────────────
    if db is not None:
        try:
            from backend.database.models import EmailLog
            log = EmailLog(
                recipient=to,
                subject=subject,
                body_preview=plain_text[:300],
                status=status,
                error=error_msg,
                sent_at=datetime.utcnow(),
                triggered_by=triggered_by,
            )
            db.add(log)
            db.commit()
        except Exception as log_err:  # noqa: BLE001
            print(f"⚠️  EmailLog write failed: {log_err}")  # noqa: T201

    # Raise only when no db is provided and credentials are present (caller decides)
    if status == "failed" and db is None and settings.EMAIL_USER and settings.EMAIL_PASS:
        raise RuntimeError(error_msg)