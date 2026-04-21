"""Email notification tool using SMTP – PostgreSQL version."""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from .base import hr_tool
from backend.database.session import SessionLocal
from backend.database.models import Employee
from config import EMAIL_USER, EMAIL_PASS, EMAIL_HOST, EMAIL_PORT

SMTP_TIMEOUT_SECONDS = 10


def _send_smtp_email(to_email: str, subject: str, body: str) -> str:
    """Internal helper to send email via SMTP."""
    if not EMAIL_USER or not EMAIL_PASS:
        return "Email not configured. Set EMAIL_USER and EMAIL_PASS in .env."
    try:
        msg = MIMEMultipart()
        msg["From"] = EMAIL_USER
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
            server.starttls()
            server.login(EMAIL_USER, EMAIL_PASS)
            server.send_message(msg)
        return f"Email sent successfully to {to_email}"
    except smtplib.SMTPAuthenticationError:
        return "Email authentication failed. Check EMAIL_USER and EMAIL_PASS in .env."
    except smtplib.SMTPConnectError:
        return f"Could not connect to mail server {EMAIL_HOST}:{EMAIL_PORT}."
    except TimeoutError:
        return f"SMTP connection timed out after {SMTP_TIMEOUT_SECONDS}s."
    except Exception as e:
        return f"Failed to send email: {str(e)}"


def _lookup_employee_email(employee_name: str) -> str | None:
    """Look up employee email by name."""
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.name.ilike(f"%{employee_name}%")).first()
        return emp.email if emp else None
    finally:
        db.close()


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