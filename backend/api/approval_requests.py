"""
Approval Requests API
GET   /api/approvals/requests        — HR/Admin lists all approval requests
PATCH /api/approvals/{id}/action     — HR approves or rejects
GET   /api/approvals/my-requests     — Employee views their own requests
"""

import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.database.session import SessionLocal
from backend.database.models import Employee, ApprovalRequest, Notification
from backend.core.security import verify_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/approvals", tags=["Approval Requests"])

# Fields the employee can update directly — keep in sync with tools_registry.py
EMPLOYEE_UPDATABLE = {
    "phone", "phone_country_code", "address_line1", "address_line2",
    "city", "state", "country", "emergency_contact_name",
    "emergency_contact_phone", "emergency_contact_relation",
    "bank_name", "bank_branch", "account_holder_name",
    "date_of_birth", "gender",
}

FIELD_LABELS = {
    "name":               "Full name",
    "email":              "Email address",
    "department":         "Department",
    "designation":        "Designation / Job title",
    "manager_id":         "Reporting manager",
    "employment_type":    "Employment type",
    "bank_account_number": "Bank account number",
    "base_salary":        "Base salary",
    "status":             "Employment status",
    "role_id":            "Role / Access level",
    "phone":              "Phone number",
    "address_line1":      "Address",
    "city":               "City",
    "state":              "State",
    "country":            "Country",
    "date_of_birth":      "Date of birth",
    "gender":             "Gender",
    "emergency_contact_name":     "Emergency contact name",
    "emergency_contact_phone":    "Emergency contact phone",
    "emergency_contact_relation": "Emergency contact relation",
    "bank_name":          "Bank name",
    "bank_branch":        "Bank branch",
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def auth_employee(request: Request, db: Session) -> Employee:
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


def auth_hr(request: Request, db: Session) -> Employee:
    emp = auth_employee(request, db)
    role = emp.role.name if hasattr(emp.role, "name") else str(emp.role)
    if role not in ("hr", "admin"):
        raise HTTPException(403, "HR or Admin only")
    return emp


def notify(db: Session, employee_id: int, title: str, message: str):
    try:
        db.add(Notification(
            employee_id=employee_id,
            title=title,
            message=message,
            is_read=False,
            created_at=datetime.utcnow(),
        ))
        db.commit()
    except Exception as e:
        logger.warning("Notify failed: %s", e)
        db.rollback()


def req_to_dict(r: ApprovalRequest) -> dict:
    emp = r.employee
    return {
        "id": r.id,
        "employee_id": r.employee_id,
        "employee_name": emp.name if emp else None,
        "employee_email": emp.email if emp else None,
        "field_name": r.field_name,
        "field_label": FIELD_LABELS.get(r.field_name, r.field_name),
        "old_value": r.old_value,
        "new_value": r.new_value,
        "status": r.status,
        "reason": r.reason,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        "resolved_by": r.resolved_by.name if r.resolved_by else None,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/requests")
def list_requests(
    request: Request,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """HR/Admin: list all approval requests, optionally filtered by status."""
    hr = auth_hr(request, db)
    query = db.query(ApprovalRequest)
    if status:
        query = query.filter(ApprovalRequest.status == status)
    rows = query.order_by(ApprovalRequest.id.desc()).all()
    logger.info("Approval requests fetched by %s: %d rows", hr.email, len(rows))
    return [req_to_dict(r) for r in rows]


@router.get("/my-requests")
def my_requests(request: Request, db: Session = Depends(get_db)):
    """Employee: view their own approval requests."""
    emp = auth_employee(request, db)
    rows = db.query(ApprovalRequest).filter(
        ApprovalRequest.employee_id == emp.id
    ).order_by(ApprovalRequest.id.desc()).all()
    return [req_to_dict(r) for r in rows]


class ActionPayload(BaseModel):
    action: str             # approve | reject
    reason: Optional[str] = None


@router.patch("/{request_id}/action")
def hr_action(
    request_id: int,
    payload: ActionPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    """HR approves or rejects an approval request."""
    hr = auth_hr(request, db)
    apr = db.query(ApprovalRequest).filter(ApprovalRequest.id == request_id).first()
    if not apr:
        raise HTTPException(404, "Request not found")
    if apr.status != "pending":
        raise HTTPException(400, f"Request is already {apr.status}")

    emp = db.query(Employee).filter(Employee.id == apr.employee_id).first()
    if not emp:
        raise HTTPException(404, "Employee not found")

    field_label = FIELD_LABELS.get(apr.field_name, apr.field_name)

    if payload.action == "approve":
        # Apply the change to the employee record
        if hasattr(emp, apr.field_name):
            new_val = apr.new_value
            # Type coercions
            if apr.field_name == "base_salary":
                try:
                    new_val = float(new_val)
                except ValueError:
                    pass
            elif apr.field_name in ("role_id", "manager_id"):
                try:
                    new_val = int(new_val)
                except ValueError:
                    pass
            setattr(emp, apr.field_name, new_val)

        apr.status = "approved"
        apr.reason = payload.reason
        apr.resolved_at = datetime.utcnow()
        apr.resolved_by_employee_id = hr.id
        db.commit()

        notify(db, emp.id,
            title="Profile Update Approved",
            message=f"Your request to change {field_label} to '{apr.new_value}' has been approved by HR.",
        )

    elif payload.action == "reject":
        apr.status = "rejected"
        apr.reason = payload.reason
        apr.resolved_at = datetime.utcnow()
        apr.resolved_by_employee_id = hr.id
        db.commit()

        notify(db, emp.id,
            title="Profile Update Rejected",
            message=f"Your request to change {field_label} to '{apr.new_value}' was not approved."
                    + (f" Reason: {payload.reason}" if payload.reason else ""),
        )

    else:
        raise HTTPException(400, f"Unknown action: {payload.action}")

    return req_to_dict(apr)