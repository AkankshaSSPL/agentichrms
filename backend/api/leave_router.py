"""
Leave Management Router — HR/Admin only.
Thin layer: receives request, delegates to LeaveService, returns response.

FILE: save as backend/api/leaves.py
      (replaces backend/api/leaves_admin.py — delete that file)
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, validator
from sqlalchemy.orm import Session
from typing import Optional

from backend.database.session import get_db
from backend.core.permissions import require_permission
from backend.services.leave_service import LeaveService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/leaves", tags=["Leave Management"])




# ── Request schemas ───────────────────────────────────────────────────────────

class ApproveRequest(BaseModel):
    leave_id: int
    reason: Optional[str] = ""


class RejectRequest(BaseModel):
    leave_id: int
    reason: str

    @validator("reason")
    def reason_not_blank(cls, v):
        if not v or not v.strip():
            raise ValueError("Rejection reason cannot be empty")
        return v.strip()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/pending")
def get_pending_leaves(
    payload: dict = Depends(require_permission("leave.view")),
    db: Session = Depends(get_db),
):
    """Get all pending leave requests (HR/Admin only)."""
    return LeaveService(db).get_pending_leaves()


@router.get("/all")
def get_all_leaves(
    payload: dict = Depends(require_permission("leave.view")),
    db: Session = Depends(get_db),
    status_filter: Optional[str] = None,
):
    """Get all leave requests with employee info (HR/Admin only)."""
    return LeaveService(db).get_all_leaves(status_filter)


@router.post("/approve")
def approve_leave_post(
    req: ApproveRequest,
    payload: dict = Depends(require_permission("leave.approve")),
    db: Session = Depends(get_db),
):
    """Approve a leave — POST with {leave_id} (used by LeaveRequests UI)."""
    return LeaveService(db).approve_leave(req.leave_id, approved_by=payload.get("email"))


@router.put("/{leave_id}/approve")
def approve_leave(
    leave_id: int,
    payload: dict = Depends(require_permission("leave.approve")),
    db: Session = Depends(get_db),
):
    """Approve a leave — PUT /{id}/approve (used by agent)."""
    return LeaveService(db).approve_leave(leave_id, approved_by=payload.get("email"))


@router.post("/reject")
def reject_leave_post(
    req: RejectRequest,
    payload: dict = Depends(require_permission("leave.reject")),
    db: Session = Depends(get_db),
):
    """Reject a leave — POST with {leave_id, reason} (used by LeaveRequests UI)."""
    return LeaveService(db).reject_leave(req.leave_id, reason=req.reason, rejected_by=payload.get("email"))


@router.put("/{leave_id}/reject")
def reject_leave(
    leave_id: int,
    payload: dict = Depends(require_permission("leave.reject")),
    db: Session = Depends(get_db),
):
    """Reject a leave — PUT /{id}/reject (used by agent)."""
    return LeaveService(db).reject_leave(leave_id, reason="", rejected_by=payload.get("email"))


@router.get("/employee/{employee_id}")
def get_leaves_by_employee(
    employee_id: int,
    payload: dict = Depends(require_permission("leave.view")),
    db: Session = Depends(get_db),
):
    """Get all leave requests for a specific employee (HR/Admin only)."""
    leaves = LeaveService(db).get_leaves_by_employee(employee_id)
    return {"employee_id": employee_id, "leaves": leaves}