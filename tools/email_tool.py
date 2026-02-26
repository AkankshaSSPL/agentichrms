"""Email notification tool using SMTP."""
import smtplib
import sqlite3
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import sys
import os
from .base import hr_tool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import EMAIL_USER, EMAIL_PASS, EMAIL_HOST, EMAIL_PORT, DB_PATH


def _send_smtp_email(to_email: str, subject: str, body: str) -> str:
    """Internal helper to send an email via SMTP."""
    if not EMAIL_USER or not EMAIL_PASS:
        return "Email not configured. Set EMAIL_USER and EMAIL_PASS in .env."

    try:
        msg = MIMEMultipart()
        msg['From'] = EMAIL_USER
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        server = smtplib.SMTP(EMAIL_HOST, EMAIL_PORT)
        server.starttls()
        server.login(EMAIL_USER, EMAIL_PASS)
        server.send_message(msg)
        server.quit()
        return f"Email sent successfully to {to_email}"
    except Exception as e:
        return f"Failed to send email: {str(e)}"


def _lookup_employee_email(employee_name: str) -> str | None:
    """Look up an employee's email from the database."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.cursor().execute(
        "SELECT email FROM employees WHERE LOWER(name) LIKE ?",
        (f"%{employee_name.lower()}%",)
    ).fetchone()
    conn.close()
    return row[0] if row else None


@hr_tool
def send_email(to_email: str, subject: str, body: str) -> str:
    """Send an email to a specific email address with a subject and body."""
    return _send_smtp_email(to_email, subject, body)


@hr_tool
def notify_employee(employee_name: str, subject: str, body: str) -> str:
    """Look up an employee by name and send them an email notification."""
    email = _lookup_employee_email(employee_name)
    if not email:
        return f"Could not find email for '{employee_name}'."
    return _send_smtp_email(email, subject, body)


@hr_tool
def notify_hr(subject: str, body: str) -> str:
    """Send an email notification to the HR department."""
    if not EMAIL_USER:
        return "HR email not configured."
    return _send_smtp_email(EMAIL_USER, f"[HR] {subject}", body)
