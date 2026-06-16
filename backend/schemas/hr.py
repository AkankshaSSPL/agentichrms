from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel

# ── Employee ──────────────────────────────────────────────────────────────────

class EmployeeResponse(BaseModel):
    """
    Safe employee response for frontend — strips all sensitive fields:
    permanent_pin_hash, pin_type, pin_set_at, face_embedding,
    bank_account_number, bank_name, bank_branch, base_salary, role_id.
    """
    id: int
    name: str
    email: str
    phone: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    status: Optional[str] = None
    employee_code: Optional[str] = None
    join_date: Optional[datetime] = None
    employment_type: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    emergency_contact_relation: Optional[str] = None
    face_enrolled: Optional[bool] = None
    onboarding_completed: Optional[bool] = None
    profile_completed: Optional[bool] = None
    role: Optional[str] = None  # flattened from relationship

    class Config:
        from_attributes = True


class EmployeeProfileResponse(EmployeeResponse):
    """
    Extended response for HR/admin only — adds banking fields.
    Never use on employee self-service endpoints.
    """
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_branch: Optional[str] = None
    base_salary: Optional[float] = None
    manager_id: Optional[int] = None


# ── Leave ─────────────────────────────────────────────────────────────────────

class LeaveResponse(BaseModel):
    id: int
    employee_id: int
    leave_type: str
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    status: str
    reason: Optional[str] = None
    rejection_reason: Optional[str] = None

    class Config:
        from_attributes = True


class LeaveBalanceResponse(BaseModel):
    leave_type: str
    days_remaining: int


# ── Onboarding ────────────────────────────────────────────────────────────────

class OnboardingTaskResponse(BaseModel):
    id: int
    task_name: str
    description: Optional[str]
    is_completed: bool
    due_date: Optional[datetime] = None
    completed_at: Optional[datetime] = None