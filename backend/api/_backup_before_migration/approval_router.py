"""
Approval Requests Router — thin layer, delegates to ApprovalService.
"""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database.session import SessionLocal
from backend.database.models import Employee
from backend.core.security import verify_token
from backend.core.permissions import require_permission
from backend.services.approval_service import ApprovalService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/approvals", tags=["Approval Requests"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _get_employee(request: Request, db: Session) -> Employee:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload:
        raise HTTPException(401, "Invalid token")
    emp = db.query(Employee).filter(Employee.id == int(payload["sub"])).first()
    if not emp:
        raise HTTPException(404, "Employee not found")
    return emp


# ── Request schema ────────────────────────────────────────────────────────────

class ActionPayload(BaseModel):
    action: str
    reason: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/requests")
def list_requests(
    request: Request,
    status: Optional[str] = None,
    payload: dict = Depends(require_permission("approval.view")),
    db: Session = Depends(get_db),
):
    emp = _get_employee(request, db)
    return ApprovalService(db).list_requests(status=status, hr_email=emp.email)


@router.get("/my-requests")
def my_requests(request: Request, db: Session = Depends(get_db)):
    emp = _get_employee(request, db)
    return ApprovalService(db).my_requests(employee_id=emp.id)


@router.patch("/{request_id}/action")
def hr_action(
    request_id: int,
    payload: ActionPayload,
    request: Request,
    permission: dict = Depends(require_permission("approval.action")),
    db: Session = Depends(get_db),
):
    emp = _get_employee(request, db)
    return ApprovalService(db).process_action(
        request_id=request_id,
        action=payload.action,
        hr_id=emp.id,
        reason=payload.reason,
    )