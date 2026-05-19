"""
Email utility — SMTP send + automatic DB logging via EmailLog model.
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from typing import Optional

from backend.core.config import settings


def send_email(
    to: str,
    subject: str,
    body: str,
    triggered_by: str = "system",
    db=None,          # optional SQLAlchemy session — if provided, logs the send
) -> None:
    """
    Send a plain-text email via SMTP.
    If db is provided, writes an EmailLog row (sent or failed).
    Raises on failure only if db is None; otherwise swallows and logs.
    """
    status = "sent"
    error_msg = None

    if not settings.EMAIL_USER or not settings.EMAIL_PASS:
        print(f"⚠️  Email not configured (EMAIL_USER/EMAIL_PASS missing). Would have sent to {to}: {subject}")
        status = "failed"
        error_msg = "EMAIL_USER or EMAIL_PASS not configured"
    else:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = settings.EMAIL_USER
            msg["To"] = to
            msg.attach(MIMEText(body, "plain"))

            with smtplib.SMTP(settings.EMAIL_HOST, settings.EMAIL_PORT, timeout=settings.SMTP_TIMEOUT) as server:
                server.ehlo()
                server.starttls()
                server.login(settings.EMAIL_USER, settings.EMAIL_PASS)
                server.sendmail(settings.EMAIL_USER, to, msg.as_string())
        except Exception as e:
            status = "failed"
            error_msg = str(e)
            print(f"⚠️  Email send failed to {to}: {e}")

    # ── Log to DB if session provided ────────────────────────────────────────
    if db is not None:
        try:
            from backend.database.models import EmailLog
            log = EmailLog(
                recipient=to,
                subject=subject,
                body_preview=body[:300] if body else "",
                status=status,
                error=error_msg,
                sent_at=datetime.utcnow(),
                triggered_by=triggered_by,
            )
            db.add(log)
            db.commit()
        except Exception as log_err:
            print(f"⚠️  EmailLog write failed: {log_err}")

    # Raise if no db provided and send failed (caller decides)
    if status == "failed" and db is None and settings.EMAIL_USER and settings.EMAIL_PASS:
        raise RuntimeError(error_msg)