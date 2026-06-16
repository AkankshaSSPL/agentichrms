"""
Onboarding Profile Router — thin layer, delegates to OnboardingService.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, validator
from sqlalchemy.orm import Session

from backend.core.security import verify_token
from backend.database.models import Employee
from backend.database.session import get_db
from backend.enums import RoleName
from backend.services.onboarding_service import OnboardingService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/onboarding-profile", tags=["Onboarding Profile"])




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


def _require_hr_payload(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload:
        raise HTTPException(401, "Invalid token")
    role = payload.get("role")
    if not role or role not in (RoleName.HR, RoleName.ADMIN):
        raise HTTPException(403, "Only HR or admin can perform this action")
    return payload


# ── Request schemas ───────────────────────────────────────────────────────────

class OnboardingChatRequest(BaseModel):
    message: str
    history: Optional[List[dict]] = []
    resume_text: Optional[str] = None

class OnboardingChatForRequest(BaseModel):
    employee_id: int
    message: str
    history: Optional[List[dict]] = []
    resume_text: Optional[str] = None

class SelfChatRequest(BaseModel):
    message: str
    history: Optional[List[dict]] = []
    resume_text: Optional[str] = None

class ProfileSaveRequest(BaseModel):
    department: Optional[str] = None
    designation: Optional[str] = None
    join_date: Optional[str] = None
    employment_type: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    emergency_contact_relation: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_branch: Optional[str] = None
    base_salary: Optional[float] = None

    @validator("date_of_birth")
    def dob_not_future(cls, v):
        if v:
            from datetime import date, datetime
            try:
                parsed = datetime.strptime(v, "%Y-%m-%d").date()
            except ValueError:
                raise ValueError("Date of birth must be in YYYY-MM-DD format")
            if parsed > date.today():
                raise ValueError("Date of birth cannot be in the future")
        return v

    @validator("gender")
    def gender_valid(cls, v):
        allowed = {"Male", "Female", "Other", "Prefer not to say"}
        if v and v not in allowed:
            raise ValueError(f"Gender must be one of: {', '.join(sorted(allowed))}")
        return v

    @validator("bank_account_number")
    def bank_account_alphanumeric(cls, v):
        if v and not v.replace(" ", "").isalnum():
            raise ValueError("Bank account number must contain only letters and digits")
        return v

    @validator("base_salary")
    def salary_positive(cls, v):
        if v is not None and v < 0:
            raise ValueError("Base salary cannot be negative")
        return v

    @validator("emergency_contact_phone")
    def emergency_phone_format(cls, v):
        if v:
            import re
            if not re.match(r"^\+?[\d\s\-]{7,20}$", v.strip()):
                raise ValueError("Emergency contact phone must be a valid phone number")
        return v

class HRDirectUpdateRequest(BaseModel):
    fields: dict

class ApproveRejectPayload(BaseModel):
    notes: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/chat")
async def onboarding_chat(payload: OnboardingChatRequest, request: Request, db: Session = Depends(get_db)):
    employee = _get_employee(request, db)
    return await OnboardingService(db).hr_chat(employee, payload.message, payload.history, payload.resume_text)


@router.post("/chat-for")
async def onboarding_chat_for_hr(payload: OnboardingChatForRequest, request: Request, db: Session = Depends(get_db)):
    _require_hr_payload(request)
    svc = OnboardingService(db)
    target = db.query(Employee).filter(Employee.id == payload.employee_id).first()
    if not target:
        raise HTTPException(404, "Employee not found")
    return await svc.hr_chat(target, payload.message, payload.history, payload.resume_text)


@router.post("/chat-self")
async def employee_self_chat(payload: SelfChatRequest, request: Request, db: Session = Depends(get_db)):
    employee = _get_employee(request, db)
    return await OnboardingService(db).self_chat(employee, payload.message, payload.history, payload.resume_text)


@router.post("/extract-resume")
async def extract_resume_text(request: Request):
    data = await request.json()
    pdf_base64 = data.get("pdf_base64", "")
    if not pdf_base64:
        return {"text": ""}
    text = await OnboardingService.extract_resume_text(pdf_base64)
    return {"text": text}


@router.post("/save")
async def save_profile(payload: ProfileSaveRequest, request: Request, db: Session = Depends(get_db)):
    employee = _get_employee(request, db)
    return OnboardingService(db).save_profile(
        employee,
        payload.dict(exclude_none=True),
        requested_by_id=employee.id,
    )


@router.get("/employees-pending")
def get_employees_pending(request: Request, db: Session = Depends(get_db)):
    _require_hr_payload(request)
    return OnboardingService(db).get_pending_employees()


@router.patch("/employee/{employee_id}/profile")
def hr_direct_update(employee_id: int, payload: HRDirectUpdateRequest, request: Request, db: Session = Depends(get_db)):
    _require_hr_payload(request)
    target = db.query(Employee).filter(Employee.id == employee_id).first()
    if not target:
        raise HTTPException(404, "Employee not found")
    return OnboardingService(db).hr_direct_update(target, payload.fields)


@router.get("/me")
def get_my_profile(request: Request, employee_id: Optional[int] = None, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload:
        raise HTTPException(401, "Invalid token")
    if employee_id:
        if payload.get("role") not in (RoleName.HR, RoleName.ADMIN):
            raise HTTPException(403, "Only HR or admin can view other employees' profiles")
        emp = db.query(Employee).filter(Employee.id == employee_id).first()
        if not emp:
            raise HTTPException(404, "Employee not found")
    else:
        emp = db.query(Employee).filter(Employee.id == int(payload["sub"])).first()
        if not emp:
            raise HTTPException(404, "Employee not found")
    return OnboardingService(db).get_profile(emp)


# ── Approval endpoints (backward compat, delegate to ApprovalService) ─────────

@router.get("/approval-requests/pending")
def get_pending_approval_requests(request: Request, db: Session = Depends(get_db)):
    from backend.services.approval_service import ApprovalService
    employee = _get_employee(request, db)
    role = employee.role.name if employee.role else None
    if role not in [RoleName.HR, RoleName.ADMIN]:
        raise HTTPException(403, "Only HR/Admin can view pending requests")
    return ApprovalService(db).list_requests(status="pending", hr_email=employee.email)


@router.post("/approval-requests/{request_id}/approve")
def approve_approval_request(request_id: int, payload: ApproveRejectPayload, request: Request, db: Session = Depends(get_db)):
    from backend.services.approval_service import ApprovalService
    employee = _get_employee(request, db)
    role = employee.role.name if employee.role else None
    if role not in [RoleName.HR, RoleName.ADMIN]:
        raise HTTPException(403, "Only HR/Admin can approve requests")
    return ApprovalService(db).process_action(request_id, "approve", employee.id, payload.notes)


@router.post("/approval-requests/{request_id}/reject")
def reject_approval_request(request_id: int, payload: ApproveRejectPayload, request: Request, db: Session = Depends(get_db)):
    from backend.services.approval_service import ApprovalService
    employee = _get_employee(request, db)
    role = employee.role.name if employee.role else None
    if role not in [RoleName.HR, RoleName.ADMIN]:
        raise HTTPException(403, "Only HR/Admin can reject requests")
    return ApprovalService(db).process_action(request_id, "reject", employee.id, payload.notes)