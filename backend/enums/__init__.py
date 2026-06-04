"""
Central re-export for all HRMS enums.

Preferred import style (single source of truth):
    from backend.enums import RoleName, LeaveStatus, ApprovalStatus
    from backend.enums import EmployeeStatus, EmailLogStatus
    from backend.enums import PinType, ChatRole
"""

from .roles import RoleName
from .leave_status import LeaveStatus
from .approval_status import ApprovalStatus
from .statuses import EmployeeStatus, EmailLogStatus
from .pin_type import PinType
from .chat_role import ChatRole

__all__ = [
    "RoleName",
    "LeaveStatus",
    "ApprovalStatus",
    "EmployeeStatus",
    "EmailLogStatus",
    "PinType",
    "ChatRole",
]