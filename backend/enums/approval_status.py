"""
Enum definitions for approval request statuses (profile-change workflow).

The DB column stores lowercase strings — values here must match exactly.

Usage:
    from backend.enums.approval_status import ApprovalStatus

    # Model default
    status = Column(String(20), default=ApprovalStatus.PENDING)

    # Querying
    .filter(ApprovalRequest.status == ApprovalStatus.PENDING)

    # Setting
    approval_req.status = ApprovalStatus.APPROVED
"""

from enum import Enum


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"