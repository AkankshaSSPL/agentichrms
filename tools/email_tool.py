"""Email notification tool using SMTP."""
import smtplib
import sqlite3
import os
import sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from .base import hr_tool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import EMAIL_USER, EMAIL_PASS, EMAIL_HOST, EMAIL_PORT, DB_PATH

# GAP-031 FIX: SMTP connection timeout in seconds.
# Without a timeout, smtplib.SMTP() blocks indefinitely when the mail server
# is unreachable — freezing the agent's tool execution and hanging the UI.
# 10 seconds is enough for a responsive server and short enough to fail fast.
SMTP_TIMEOUT_SECONDS = int(os.getenv("SMTP_TIMEOUT", "10"))


def _send_smtp_email(to_email: str, subject: str, body: str) -> str:
    """Internal helper to send an email via SMTP."""
    if not EMAIL_USER or not EMAIL_PASS:
        return "Email not configured. Set EMAIL_USER and EMAIL_PASS in .env."

    try:
        msg = MIMEMultipart()
        msg["From"] = EMAIL_USER
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        # GAP-031 FIX: Pass timeout= so the connection attempt cannot hang forever.
        with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
            server.starttls()
            server.login(EMAIL_USER, EMAIL_PASS)
            server.send_message(msg)

        return f"Email sent successfully to {to_email}"
    except smtplib.SMTPAuthenticationError:
        return "Email authentication failed. Check EMAIL_USER and EMAIL_PASS in .env."
    except smtplib.SMTPConnectError:
        return f"Could not connect to mail server {EMAIL_HOST}:{EMAIL_PORT}. Check EMAIL_HOST and EMAIL_PORT."
    except TimeoutError:
        return f"SMTP connection timed out after {SMTP_TIMEOUT_SECONDS}s. Mail server may be unreachable."
    except Exception as e:
        return f"Failed to send email: {str(e)}"


def _lookup_employee_email(employee_name: str) -> str | None:
    """Look up an employee's email from the database."""
    # GAP-024 FIX: Use context manager so connection is always released.
    try:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.cursor().execute(
                "SELECT email FROM employees WHERE LOWER(name) LIKE ?",
                (f"%{employee_name.lower()}%",),
            ).fetchone()
        return row[0] if row else None
    except Exception:
        return None


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


def _check_meetings_in_range(start_date: str, end_date: str) -> list[dict]:
    """
    Query meetings table for any meetings between start_date and end_date.
    Returns list of dicts: {title, date, start_time, end_time, organizer, attendees}

    Called automatically from apply_leave — not by the user directly.
    Returns an empty list (never raises) so a missing meetings table or
    any DB error never breaks the leave application flow.
    """
    try:
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.cursor().execute(
                """
                SELECT title, meeting_date, start_time, end_time, organizer, attendees
                FROM meetings
                WHERE meeting_date >= ? AND meeting_date <= ?
                ORDER BY meeting_date, start_time
                """,
                (start_date, end_date),
            ).fetchall()

        return [
            {
                "title":     row[0],
                "date":      row[1],
                "start_time": row[2] or "",
                "end_time":  row[3] or "",
                "organizer": row[4] or "",
                "attendees": row[5] or "",
            }
            for row in rows
        ]
    except Exception:
        # meetings table may not exist on older DBs — fail silently
        return []


def _format_meeting_reminder(meetings: list[dict]) -> str:
    """
    Format a list of meeting dicts into a plain-text reminder block
    to append to leave notification emails.
    """
    if not meetings:
        return ""

    lines = [
        "",
        "⚠️  MEETING CONFLICT ALERT",
        "The following meetings are scheduled during your leave period.",
        "Please inform your team or reschedule as needed:",
        "",
    ]
    for m in meetings:
        time_str = f" at {m['start_time']}" if m["start_time"] else ""
        org_str  = f" (organised by {m['organizer']})" if m["organizer"] else ""
        lines.append(f"  • {m['title']} — {m['date']}{time_str}{org_str}")

    lines += ["", "Please coordinate with your manager and team before your leave begins."]
    return "\n".join(lines)