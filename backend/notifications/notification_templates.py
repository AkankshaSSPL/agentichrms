"""
Notification Templates — Phase 5: Dynamic Notifications
All user-facing notification text lives here. No hardcoded strings in services.
"""

from enum import Enum


class NotifKey(Enum):
    LEAVE_APPROVED = "LEAVE_APPROVED"
    LEAVE_REJECTED = "LEAVE_REJECTED"
    LEAVE_SUBMITTED = "LEAVE_SUBMITTED"
    LEAVE_SUBMITTED_HR = "LEAVE_SUBMITTED_HR"
    PROFILE_CHANGE_REQUESTED = "PROFILE_CHANGE_REQUESTED"
    PROFILE_CHANGE_REQUESTED_HR = "PROFILE_CHANGE_REQUESTED_HR"
    # BEHAVIOR_ALERT_HR removed — HR no longer receives behavioral alerts


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
    NotifKey.LEAVE_SUBMITTED: {
        "title": "Leave Request Submitted",
        "message": "Your {leave_type} leave request ({date_str}) has been submitted and is awaiting approval.",
    },
    NotifKey.LEAVE_SUBMITTED_HR: {
        "title": "New Leave Request",
        "message": "{employee_name} has submitted a {leave_type} leave request ({date_str}). Please review.",
    },
    NotifKey.PROFILE_CHANGE_REQUESTED: {
        "title": "Profile Change Requested",
        "message": "Your request to update '{field_label}' to '{new_value}' has been submitted to HR for approval.",
    },
    NotifKey.PROFILE_CHANGE_REQUESTED_HR: {
        "title": "Profile Update Request",
        "message": "{employee_name} has requested to update '{field_label}' to '{new_value}'. Please review in the Approval Requests section.",
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