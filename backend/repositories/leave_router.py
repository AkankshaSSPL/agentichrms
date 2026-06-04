"""
Leave Management Router — HR/Admin only.
Thin layer: receives request, delegates to LeaveService, returns response.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from backend.database.session import SessionLocal
from backend.core.security import require_role
from backend.enums import RoleName
from backend.services.leave_service import LeaveService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/leaves", tags=["Leave Management"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Request schemas ───────────────────────────────────────────────────────────

class ApproveRequest(BaseModel):
    leave_id: int
    reason: Optional[str] = ""


class RejectRequest(BaseModel):
    leave_id: int
    reason: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/pending")
def get_pending_leaves(
    payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN])),
    db: Session = Depends(get_db),
):
    return LeaveService(db).get_pending_leaves()


@router.get("/all")
def get_all_leaves(
    payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN])),
    db: Session = Depends(get_db),
    status_filter: Optional[str] = None,
):
    leaves = LeaveService(db).get_all_leaves(status_filter)
    return {"leaves": leaves}


@router.post("/approve")
def approve_leave_post(
    req: ApproveRequest,
    payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN])),
    db: Session = Depends(get_db),
):
    return LeaveService(db).approve_leave(req.leave_id, approved_by=payload.get("email"))


@router.put("/{leave_id}/approve")
def approve_leave(
    leave_id: int,
    payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN])),
    db: Session = Depends(get_db),
):
    return LeaveService(db).approve_leave(leave_id, approved_by=payload.get("email"))


@router.post("/reject")
def reject_leave_post(
    req: RejectRequest,
    payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN])),
    db: Session = Depends(get_db),
):
    return LeaveService(db).reject_leave(req.leave_id, reason=req.reason, rejected_by=payload.get("email"))


@router.put("/{leave_id}/reject")
def reject_leave(
    leave_id: int,
    payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN])),
    db: Session = Depends(get_db),
):
    return LeaveService(db).reject_leave(leave_id, reason="", rejected_by=payload.get("email"))


@router.get("/employee/{employee_id}")
def get_leaves_by_employee(
    employee_id: int,
    payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN])),
    db: Session = Depends(get_db),
):
    leaves = LeaveService(db).get_leaves_by_employee(employee_id)
    return {"employee_id": employee_id, "leaves": leaves}