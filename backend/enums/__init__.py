"""
Central re-export for all HRMS enums.
Add new enums here — never import from sub-modules directly in app code.
"""

from .access_source import AccessSource
from .approval_status import ApprovalStatus
from .behavior_alert_status import BehaviorAlertStatus  # kept for backward compatibility, but no longer used
from .chat_role import ChatRole
from .document_category import DocumentCategory
from .leave_status import LeaveStatus
from .nudge_status import NudgeStatus
from .pin_type import PinType
from .roles import RoleName
from .statuses import EmployeeStatus, EmailLogStatus

__all__ = [
    "AccessSource",
    "ApprovalStatus",
    "BehaviorAlertStatus",
    "ChatRole",
    "DocumentCategory",
    "LeaveStatus",
    "NudgeStatus",
    "PinType",
    "RoleName",
    "EmployeeStatus",
    "EmailLogStatus",
]