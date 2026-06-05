"""
backend/database/models/__init__.py

Re-exports every model so all existing imports continue to work unchanged:
    from backend.database.models import Employee, Leave, ...
"""

# Import order matters — Base models before anything that references them
from backend.database.models.base import BaseModel
from backend.database.models.rbac import Role, Permission, RolePermission
from backend.database.models.employee import Employee
from backend.database.models.leave import Leave, LeaveBalance
from backend.database.models.chat import User, ChatSession, ChatMessage
from backend.database.models.auth import FaceLoginAttempt, PINVerification
from backend.database.models.notification import Notification
from backend.database.models.workflow import (
    ApprovalRequest,
    Meeting,
    OnboardingTask,
    EmailLog,
    SystemSetting,
)

__all__ = [
    "BaseModel",
    "Role", "Permission", "RolePermission",
    "Employee",
    "Leave", "LeaveBalance",
    "User", "ChatSession", "ChatMessage",
    "FaceLoginAttempt", "PINVerification",
    "Notification",
    "ApprovalRequest", "Meeting", "OnboardingTask", "EmailLog", "SystemSetting",
]