"""
Enum definitions for miscellaneous status columns that don't belong
in the domain-specific enums (leave, approval).

Usage:
    from backend.enums.statuses import EmployeeStatus, EmailLogStatus

    Employee(status=EmployeeStatus.ACTIVE, ...)
    EmailLog(status=EmailLogStatus.SENT, ...)
"""

from enum import Enum


class EmployeeStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"


class EmailLogStatus(str, Enum):
    SENT = "sent"
    FAILED = "failed"