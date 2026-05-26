"""
Name Change Request API
POST   /name-change/request          — employee submits request
POST   /name-change/upload-doc/{id}  — employee uploads document
GET    /name-change/my-requests       — employee sees their requests
GET    /name-change/pending           — HR/admin sees pending requests
POST   /name-change/approve/{id}      — HR approves
POST   /name-change/reject/{id}       — HR rejects
POST   /name-change/request-doc/{id}  — HR requests document
GET    /name-change/requests          — alias for /pending (used by HRPanel)
GET    /name-change/all               — HR sees all requests
"""

import os
import shutil
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from backend.database.session import SessionLocal
from backend.database.models import Employee, NameChangeRequest, Notification
from backend.core.security import verify_token, require_role
from backend.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/name-change", tags=["Name Change"])

UPLOAD_DIR = "uploads/name_change"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_employee(request: Request, db: Session):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload:
        raise HTTPException(401, "Invalid token")
    emp = db.query(Employee).filter(Employee.id == int(payload["sub"])).first()
    if not emp:
        raise HTTPException(404, "Employee not found")
    return emp, payload


def notify_employee(db: Session, employee_id: int, title: str, message: str):
    try:
        notif = Notification(employee_id=employee_id, title=title, message=message, is_read=False)
        db.add(notif)
        db.commit()
    except Exception as e:
        logger.warning("Failed to create notification: %s", e)


def notify_hr(db: Session, message: str):
    """Notify all HR and admin employees."""
    try:
        from backend.database.models import Role
        hr_roles = db.query(Role).filter(Role.name.in_(["hr", "admin"])).all()
        role_ids = [r.id for r in hr_roles]
        hr_employees = db.query(Employee).filter(Employee.role_id.in_(role_ids)).all()
        for emp in hr_employees:
            notif = Notification(
                employee_id=emp.id,
                title=" Name Change Request",
                message=message,
                is_read=False,
            )
            db.add(notif)
        db.commit()
    except Exception as e:
        logger.warning("Failed to notify HR: %s", e)


# ── Helper to format a single request ────────────────────────────────────────
def _format_request(r: NameChangeRequest, db: Session = None) -> dict:
    """Convert a NameChangeRequest object to a dictionary for JSON responses."""
    employee_name = ""
    employee_email = ""
    if db and r.employee_id:
        emp = db.query(Employee).filter(Employee.id == r.employee_id).first()
        if emp:
            employee_name = emp.name
            employee_email = emp.email
    return {
        "id": r.id,
        "employee_id": r.employee_id,
        "employee_name": employee_name,
        "employee_email": employee_email,
        "current_name": r.old_name,
        "requested_name": r.new_name,
        "reason": r.reason,
        "status": r.status,
        "document_provided": r.document_provided,
        "document_filename": r.document_filename,
        "rejection_reason": r.rejection_reason,
        "hr_note": r.rejection_reason,  # for compatibility with HRPanel
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ── Employee: submit request ──────────────────────────────────────────────────
class NameChangeRequestBody(BaseModel):
    new_name: str
    reason: Optional[str] = None


@router.post("/request")
def submit_request(
    body: NameChangeRequestBody,
    request: Request,
    db: Session = Depends(get_db),
):
    employee, _ = get_current_employee(request, db)

    # Check no pending request already exists
    existing = db.query(NameChangeRequest).filter(
        NameChangeRequest.employee_id == employee.id,
        NameChangeRequest.status.in_(["pending", "awaiting_document"])
    ).first()
    if existing:
        raise HTTPException(400, "You already have a pending name change request.")

    req = NameChangeRequest(
        employee_id=employee.id,
        old_name=employee.name,
        new_name=body.new_name.strip(),
        reason=body.reason,
        status="pending",
        document_provided=False,
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    # Notify HR
    notify_hr(db, f"{employee.name} has requested a name change to '{body.new_name}'.")

    return {
        "id": req.id,
        "status": req.status,
        "old_name": req.old_name,
        "new_name": req.new_name,
        "document_provided": req.document_provided,
        "message": "Name change request submitted. HR will review it shortly.",
    }


# ── Employee: upload document ─────────────────────────────────────────────────
@router.post("/upload-doc/{request_id}")
async def upload_document(
    request_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    employee, _ = get_current_employee(request, db)

    ncr = db.query(NameChangeRequest).filter(
        NameChangeRequest.id == request_id,
        NameChangeRequest.employee_id == employee.id,
    ).first()
    if not ncr:
        raise HTTPException(404, "Request not found")

    # Save file
    ext = os.path.splitext(file.filename)[1]
    filename = f"ncr_{request_id}_{employee.id}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    ncr.document_path = filepath
    ncr.document_filename = file.filename
    ncr.document_provided = True
    if ncr.status == "awaiting_document":
        ncr.status = "pending"  # move back to pending for HR review
    db.commit()

    # Notify HR
    notify_hr(db, f"{employee.name} uploaded a document for their name change request.")

    return {"message": "Document uploaded successfully.", "document_provided": True, "status": ncr.status}


# ── Employee: view own requests ───────────────────────────────────────────────
@router.get("/my-requests")
def my_requests(request: Request, db: Session = Depends(get_db)):
    employee, _ = get_current_employee(request, db)
    reqs = db.query(NameChangeRequest).filter(
        NameChangeRequest.employee_id == employee.id
    ).order_by(NameChangeRequest.created_at.desc()).all()
    return [_format_request(r, db) for r in reqs]


# ── HR/Admin: view all pending requests (used by HRPanel) ─────────────────────
@router.get("/pending")
def pending_requests(
    request: Request,
    db: Session = Depends(get_db),
):
    # Check role
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload or payload.get("role") not in ["hr", "admin"]:
        raise HTTPException(403, "Not authorised")

    reqs = db.query(NameChangeRequest).filter(
        NameChangeRequest.status.in_(["pending", "awaiting_document"])
    ).order_by(NameChangeRequest.created_at.desc()).all()
    return [_format_request(r, db) for r in reqs]


@router.get("/all")
def all_requests(
    request: Request,
    db: Session = Depends(get_db),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload or payload.get("role") not in ["hr", "admin"]:
        raise HTTPException(403, "Not authorised")

    reqs = db.query(NameChangeRequest).order_by(NameChangeRequest.created_at.desc()).all()
    return [_format_request(r, db) for r in reqs]


# Alias used by HRPanel.jsx
@router.get("/requests")
def requests_alias(request: Request, db: Session = Depends(get_db)):
    """Alias for /pending – returns pending and awaiting_document requests."""
    return pending_requests(request, db)


# ── HR: approve ───────────────────────────────────────────────────────────────
class ReviewBody(BaseModel):
    reason: Optional[str] = None


@router.post("/approve/{request_id}")
def approve_request(
    request_id: int,
    body: ReviewBody,
    request: Request,
    db: Session = Depends(get_db),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload or payload.get("role") not in ["hr", "admin"]:
        raise HTTPException(403, "Not authorised")
    reviewer_id = int(payload["sub"])

    ncr = db.query(NameChangeRequest).filter(NameChangeRequest.id == request_id).first()
    if not ncr:
        raise HTTPException(404, "Request not found")

    # Update employee name
    employee = db.query(Employee).filter(Employee.id == ncr.employee_id).first()
    if employee:
        employee.name = ncr.new_name

    ncr.status = "approved"
    ncr.reviewed_by = reviewer_id
    ncr.reviewed_at = datetime.utcnow()
    db.commit()

    notify_employee(db, ncr.employee_id, " Name Change Approved",
        f"Your name change request to '{ncr.new_name}' has been approved. Your name has been updated.")

    return {"message": f"Name changed to '{ncr.new_name}' and employee record updated."}


# ── HR: reject ────────────────────────────────────────────────────────────────
@router.post("/reject/{request_id}")
def reject_request(
    request_id: int,
    body: ReviewBody,
    request: Request,
    db: Session = Depends(get_db),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload or payload.get("role") not in ["hr", "admin"]:
        raise HTTPException(403, "Not authorised")
    reviewer_id = int(payload["sub"])

    ncr = db.query(NameChangeRequest).filter(NameChangeRequest.id == request_id).first()
    if not ncr:
        raise HTTPException(404, "Request not found")

    ncr.status = "rejected"
    ncr.rejection_reason = body.reason
    ncr.reviewed_by = reviewer_id
    ncr.reviewed_at = datetime.utcnow()
    db.commit()

    reason_text = f" Reason: {body.reason}" if body.reason else ""
    notify_employee(db, ncr.employee_id, " Name Change Rejected",
        f"Your name change request to '{ncr.new_name}' has been rejected.{reason_text}")

    return {"message": "Request rejected."}


# ── HR: request document ──────────────────────────────────────────────────────
@router.post("/request-doc/{request_id}")
def request_document(
    request_id: int,
    body: ReviewBody,
    request: Request,
    db: Session = Depends(get_db),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload or payload.get("role") not in ["hr", "admin"]:
        raise HTTPException(403, "Not authorised")

    ncr = db.query(NameChangeRequest).filter(NameChangeRequest.id == request_id).first()
    if not ncr:
        raise HTTPException(404, "Request not found")

    ncr.status = "awaiting_document"
    db.commit()

    msg = body.reason or "Please upload your marriage certificate or relevant document to proceed."
    notify_employee(db, ncr.employee_id, "📎 Document Required for Name Change",
        f"HR has requested a document for your name change request. {msg} Please upload it via your profile or chat.")

    return {"message": "Employee notified to upload document."}


# ── HR submits name change on behalf of employee ─────────────────────────────
class HRNameChangeRequest(BaseModel):
    employee_id: int
    new_name: str
    reason: Optional[str] = None


@router.post("/request-for")
def hr_submit_request(
    body: HRNameChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload or payload.get("role") not in ["hr", "admin"]:
        raise HTTPException(403, "Not authorised")

    employee = db.query(Employee).filter(Employee.id == body.employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")

    existing = db.query(NameChangeRequest).filter(
        NameChangeRequest.employee_id == body.employee_id,
        NameChangeRequest.status.in_(["pending", "awaiting_document"])
    ).first()
    if existing:
        raise HTTPException(400, "This employee already has a pending name change request.")

    req = NameChangeRequest(
        employee_id=body.employee_id,
        old_name=employee.name,
        new_name=body.new_name.strip(),
        reason=body.reason,
        status="pending",
        document_provided=False,
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    # Notify the employee
    notify_employee(db, body.employee_id, " Name Change Request Submitted",
        f"HR has submitted a name change request on your behalf: '{employee.name}' → '{body.new_name}'. You will be notified once it's reviewed.")

    return {"id": req.id, "status": req.status, "message": f"Name change request created for {employee.name}."}


# ── PATCH endpoint for HR actions (approve/reject/request_document) ──────────
class ActionBody(BaseModel):
    action: str           # approve | reject | request_document
    hr_note: Optional[str] = None


@router.patch("/{request_id}/action")
def action_request(
    request_id: int,
    body: ActionBody,
    request: Request,
    db: Session = Depends(get_db),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload or payload.get("role") not in ["hr", "admin"]:
        raise HTTPException(403, "Not authorised")
    reviewer_id = int(payload["sub"])

    ncr = db.query(NameChangeRequest).filter(NameChangeRequest.id == request_id).first()
    if not ncr:
        raise HTTPException(404, "Request not found")

    if body.action == "approve":
        employee = db.query(Employee).filter(Employee.id == ncr.employee_id).first()
        if employee:
            employee.name = ncr.new_name
        ncr.status = "approved"
        ncr.reviewed_by = reviewer_id
        ncr.reviewed_at = datetime.utcnow()
        db.commit()
        notify_employee(db, ncr.employee_id, " Name Change Approved",
            f"Your name change request to '{ncr.new_name}' has been approved. Your name has been updated.")
        return {"message": f"Name changed to '{ncr.new_name}'."}

    elif body.action == "reject":
        ncr.status = "rejected"
        ncr.rejection_reason = body.hr_note
        ncr.reviewed_by = reviewer_id
        ncr.reviewed_at = datetime.utcnow()
        db.commit()
        reason_text = f" Reason: {body.hr_note}" if body.hr_note else ""
        notify_employee(db, ncr.employee_id, "Name Change Rejected",
            f"Your name change request to '{ncr.new_name}' has been rejected.{reason_text}")
        return {"message": "Request rejected."}

    elif body.action == "request_document":
        ncr.status = "awaiting_document"
        db.commit()
        msg = body.hr_note or "Please upload your marriage certificate or relevant document."
        notify_employee(db, ncr.employee_id, "📎 Document Required for Name Change",
            f"HR has requested a document for your name change. {msg}")
        return {"message": "Employee notified to upload document."}

    else:
        raise HTTPException(400, f"Unknown action: {body.action}")