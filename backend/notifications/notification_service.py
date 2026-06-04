"""
Notification Service — Phase 5: Dynamic Notifications
Builds Notification objects and email payloads from templates.
No message strings live here — all text is sourced from notification_templates.py.
"""

from backend.database.models import Leave, Notification
from backend.notifications.notification_templates import NotifKey, get_template


def build_notification(
    key: NotifKey,
    leave: Leave,
    date_str: str,
    reason: str = "",
) -> Notification:
    """Return an unsaved Notification ORM object built from a template."""
    tmpl = get_template(key)
    reason_text = f" Reason: {reason}" if reason else ""
    message = tmpl["message"].format(
        leave_type=leave.leave_type,
        date_str=date_str,
        reason_text=reason_text,
    )
    return Notification(
        employee_id=leave.employee_id,
        title=tmpl["title"],
        message=message,
        is_read=False,
    )


def build_email(
    key: NotifKey,
    leave: Leave,
    date_str: str,
    emp_name: str,
    reason: str = "",
) -> dict:
    """Return a dict with 'subject' and 'body' keys, ready to pass to send_email()."""
    tmpl = get_template(key)
    reason_line = f"Reason: {reason}" if reason else ""
    return {
        "subject": tmpl["email_subject"].format(
            leave_type=leave.leave_type,
            date_str=date_str,
        ),
        "body": tmpl["email_body"].format(
            name=emp_name,
            leave_type=leave.leave_type,
            date_str=date_str,
            reason_line=reason_line,
        ),
    }