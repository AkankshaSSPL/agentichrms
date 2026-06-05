"""
Leave Management for HR/Admin
All endpoints require role 'hr' or 'admin'
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from backend.database.session import SessionLocal
from backend.database.models import Leave, Employee, Notification
from backend.core.permissions import require_permission
from backend.core.email import send_email
from backend.enums import RoleName, LeaveStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/leaves", tags=["Leave Management"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/pending")
def get_pending_leaves(
    payload: dict = Depends(require_permission("leave.view")),
    db: Session = Depends(get_db),
):
    """Get all pending leave requests (HR/Admin only) — returns flat array with employee info."""
    leaves = (
        db.query(Leave, Employee)
        .join(Employee, Leave.employee_id == Employee.id)
        .filter(Leave.status == LeaveStatus.PENDING)
        .all()
    )
    return [
        {
            "id": leave.id,
            "employee_id": leave.employee_id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "leave_type": leave.leave_type,
            "start_date": leave.start_date.strftime("%Y-%m-%d") if leave.start_date else "",
            "end_date": leave.end_date.strftime("%Y-%m-%d") if leave.end_date else "",
            "days": ((leave.end_date - leave.start_date).days + 1) if leave.start_date and leave.end_date else 0,
            "status": leave.status.value if hasattr(leave.status, "value") else leave.status,
            "reason": leave.reason or "",
            "rejection_reason": leave.rejection_reason or "",
        }
        for leave, emp in leaves
    ]


@router.get("/all")
def get_all_leaves(
    payload: dict = Depends(require_permission("leave.view")),
    db: Session = Depends(get_db),
    status_filter: Optional[str] = None,
):
    """Get all leave requests with employee info (HR/Admin only)"""
    query = db.query(Leave, Employee).join(Employee, Leave.employee_id == Employee.id)
    if status_filter and status_filter.lower() != "all":
        try:
            query = query.filter(Leave.status == LeaveStatus(status_filter.capitalize()))
        except ValueError:
            raise HTTPException(400, f"Invalid status: {status_filter}")
    rows = query.order_by(Leave.id.desc()).all()

    result = []
    for leave, emp in rows:
        start = leave.start_date
        end   = leave.end_date
        days  = ((end - start).days + 1) if start and end else 0
        result.append({
            "id": leave.id,
            "employee_id": leave.employee_id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "leave_type": leave.leave_type,
            "start_date": start.strftime("%Y-%m-%d") if start else "",
            "end_date":   end.strftime("%Y-%m-%d")   if end   else "",
            "days": days,
            "status": leave.status.value if hasattr(leave.status, "value") else leave.status,
            "reason": leave.reason or "",
            "rejection_reason": leave.rejection_reason or "",
        })
    return result


class ApproveRequest(BaseModel):
    leave_id: int
    reason: Optional[str] = ""


class RejectRequest(BaseModel):
    leave_id: int
    reason: str


@router.post("/approve")
def approve_leave_post(
    req: ApproveRequest,
    payload: dict = Depends(require_permission("leave.approve")),
    db: Session = Depends(get_db),
):
    """Approve a leave request — POST with {leave_id} (used by LeaveRequests UI)"""
    leave = db.query(Leave).filter(Leave.id == req.leave_id).first()
    if not leave:
        raise HTTPException(404, "Leave request not found")
    leave.status = LeaveStatus.APPROVED
    db.commit()
    logger.info("Leave %d approved by %s", req.leave_id, payload.get("email"))

    try:
        start = leave.start_date.strftime("%d %b %Y") if leave.start_date else ""
        end   = leave.end_date.strftime("%d %b %Y")   if leave.end_date   else ""
        date_str = start if start == end else f"{start} – {end}"
        notif = Notification(
            employee_id=leave.employee_id,
            title="Leave Approved",
            message=f"Your {leave.leave_type} leave request ({date_str}) has been approved by HR.",
            is_read=False,
        )
        db.add(notif)
        db.commit()
        emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
        if emp:
            send_email(
                to=emp.email,
                subject=f"Leave Approved — {leave.leave_type} ({date_str})",
                body=(
                    f"Hi {emp.name},\n\n"
                    f"Your {leave.leave_type} leave request for {date_str} has been approved by HR.\n\n"
                    f"Best regards,\nHRMS System"
                ),
                triggered_by="leave_approve",
                db=db,
            )
    except Exception as e:
        logger.warning("Failed to create approval notification: %s", e)

    return {"message": "Leave approved", "leave_id": req.leave_id}


@router.put("/{leave_id}/approve")
def approve_leave(
    leave_id: int,
    payload: dict = Depends(require_permission("leave.approve")),
    db: Session = Depends(get_db),
):
    """Approve a leave request (HR/Admin only)"""
    leave = db.query(Leave).filter(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(404, "Leave request not found")
    leave.status = LeaveStatus.APPROVED
    db.commit()
    return {"message": "Leave approved", "leave_id": leave_id}


@router.post("/reject")
def reject_leave_post(
    req: RejectRequest,
    payload: dict = Depends(require_permission("leave.reject")),
    db: Session = Depends(get_db),
):
    """Reject a leave request — POST with {leave_id, reason} (used by LeaveRequests UI)"""
    leave = db.query(Leave).filter(Leave.id == req.leave_id).first()
    if not leave:
        raise HTTPException(404, "Leave request not found")
    leave.status = LeaveStatus.REJECTED
    leave.rejection_reason = req.reason
    db.commit()
    logger.info("Leave %d rejected by %s — reason: %s", req.leave_id, payload.get("email"), req.reason)

    try:
        start = leave.start_date.strftime("%d %b %Y") if leave.start_date else ""
        end   = leave.end_date.strftime("%d %b %Y")   if leave.end_date   else ""
        date_str = start if start == end else f"{start} – {end}"
        reason_text = f" Reason: {req.reason}" if req.reason else ""
        notif = Notification(
            employee_id=leave.employee_id,
            title="Leave Rejected",
            message=f"Your {leave.leave_type} leave request ({date_str}) has been rejected.{reason_text}",
            is_read=False,
        )
        db.add(notif)
        db.commit()
        emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
        if emp:
            send_email(
                to=emp.email,
                subject=f"Leave Rejected — {leave.leave_type} ({date_str})",
                body=(
                    f"Hi {emp.name},\n\n"
                    f"Your {leave.leave_type} leave request for {date_str} has been rejected.\n"
                    f"{('Reason: ' + req.reason) if req.reason else ''}\n\n"
                    f"Please contact HR if you have questions.\n\nBest regards,\nHRMS System"
                ),
                triggered_by="leave_reject",
                db=db,
            )
    except Exception as e:
        logger.warning("Failed to create rejection notification: %s", e)

    return {"message": "Leave rejected", "leave_id": req.leave_id}


@router.put("/{leave_id}/reject")
def reject_leave(
    leave_id: int,
    payload: dict = Depends(require_permission("leave.reject")),
    db: Session = Depends(get_db),
):
    """Reject a leave request (HR/Admin only)"""
    leave = db.query(Leave).filter(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(404, "Leave request not found")
    leave.status = LeaveStatus.REJECTED
    db.commit()
    return {"message": "Leave rejected", "leave_id": leave_id}


@router.get("/employee/{employee_id}")
def get_leaves_by_employee(
    employee_id: int,
    payload: dict = Depends(require_permission("leave.view")),
    db: Session = Depends(get_db),
):
    """Get all leave requests for a specific employee (HR/Admin only)"""
    leaves = db.query(Leave).filter(Leave.employee_id == employee_id).all()
    return {"employee_id": employee_id, "leaves": leaves}