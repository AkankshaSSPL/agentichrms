"""
Notification Templates — Phase 5: Dynamic Notifications
All user-facing notification text lives here. No hardcoded strings in services.
"""

from enum import Enum


class NotifKey(Enum):
    LEAVE_APPROVED = "LEAVE_APPROVED"
    LEAVE_REJECTED = "LEAVE_REJECTED"


NOTIFICATION_TEMPLATES = {
    NotifKey.LEAVE_APPROVED: {
        "title": "Leave Approved",
        "message": "Your {leave_type} leave request ({date_str}) has been approved by HR.",
        "email_subject": "Leave Approved — {leave_type} ({date_str})",
        "email_body": (
            "Hi {name},\n\n"
            "Your {leave_type} leave request for {date_str} has been approved by HR.\n\n"
            "Best regards,\nHRMS System"
        ),
    },
    NotifKey.LEAVE_REJECTED: {
        "title": "Leave Rejected",
        "message": "Your {leave_type} leave request ({date_str}) has been rejected.{reason_text}",
        "email_subject": "Leave Rejected — {leave_type} ({date_str})",
        "email_body": (
            "Hi {name},\n\n"
            "Your {leave_type} leave request for {date_str} has been rejected.\n"
            "{reason_line}\n\n"
            "Please contact HR if you have questions.\n\nBest regards,\nHRMS System"
        ),
    },
}


def get_template(key: NotifKey) -> dict:
    """Fetch a template by key. Returns a safe fallback if key is not found."""
    return NOTIFICATION_TEMPLATES.get(key, {
        "title": "Notification",
        "message": "You have a new notification.",
        "email_subject": "HRMS Notification",
        "email_body": (
            "Hi {name},\n\nYou have a new notification.\n\nBest regards,\nHRMS System"
        ),
    })