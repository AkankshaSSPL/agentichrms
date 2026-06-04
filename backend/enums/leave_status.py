"""
Enum definitions for leave request statuses.

The DB column stores these exact string values (capitalised), so
the enum values must match what is already in the database.

Usage:
    from backend.enums.leave_status import LeaveStatus

    # Model default
    status = Column(String, default=LeaveStatus.PENDING)

    # Querying
    .filter(Leave.status == LeaveStatus.PENDING)

    # Setting
    leave.status = LeaveStatus.APPROVED
"""

from enum import Enum


class LeaveStatus(str, Enum):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"