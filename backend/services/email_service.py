# backend/services/email_service.py

import os
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib

logger = logging.getLogger(__name__)

def send_pin_email(to_email: str, employee_name: str, pin: str) -> dict:
    """
    Send the 6-digit PIN via Gmail SMTP using app password.
    """
    use_smtp = os.getenv("EMAIL_HOST") and os.getenv("EMAIL_PASS")

    if not use_smtp:
        logger.info(f"📧 [EMAIL SIMULATION] PIN for {to_email}: {pin}")
        return {"success": True, "error": None}

    try:
        sender = os.getenv("EMAIL_USER")          # your Gmail address
        password = os.getenv("EMAIL_PASS")        # app password (16 chars)
        host = os.getenv("EMAIL_HOST", "smtp.gmail.com")
        port = int(os.getenv("EMAIL_PORT", 587))

        subject = "Your HRMS Login PIN"
        body = f"""
Hello {employee_name},

Your permanent HRMS login PIN is: {pin}

You can use this PIN to log in, or change it to a custom PIN after first login.

Keep this PIN safe. Do not share it.

Regards,
HRMS Team
"""
        msg = MIMEMultipart()
        msg["From"] = sender
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        with smtplib.SMTP(host, port) as server:
            server.starttls()
            server.login(sender, password)
            server.sendmail(sender, to_email, msg.as_string())

        logger.info(f"PIN email sent to {to_email}")
        return {"success": True, "error": None}
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return {"success": False, "error": str(e)}