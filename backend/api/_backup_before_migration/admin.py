"""
Admin Endpoints – Role Management (admin only)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import datetime

from backend.database.session import SessionLocal
from backend.database.models import Employee, Role
from backend.core.permissions import require_permission
from backend.core.email import send_email
from backend.enums import RoleName

router = APIRouter(prefix="/admin", tags=["Admin"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class RoleUpdateRequest(BaseModel):
    employee_id: int
    role_name: str


# Must match COMPLETION_FIELDS in HRPanel.jsx exactly
COMPLETION_FIELDS = [
    'gender', 'date_of_birth', 'department', 'designation', 'employment_type',
    'join_date', 'address_line1', 'city', 'state', 'country',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation',
    'bank_name', 'bank_account_number', 'bank_branch',
]


def calc_completion(emp: Employee) -> int:
    """Return 0-100 profile completion percentage based on COMPLETION_FIELDS."""
    filled = sum(
        1 for f in COMPLETION_FIELDS
        if getattr(emp, f, None) not in (None, '', 'None')
    )
    return round((filled / len(COMPLETION_FIELDS)) * 100)


class EmployeeRoleResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    profile_completion: int = 0


@router.get("/employees", response_model=List[EmployeeRoleResponse])
def list_employees(
    payload: dict = Depends(require_permission("employee.view")),
    db: Session = Depends(get_db),
):
    employees = db.query(Employee).all()
    result = []
    for emp in employees:
        role_name = emp.role.name if emp.role else RoleName.EMPLOYEE
        result.append({
            "id": emp.id,
            "name": emp.name,
            "email": emp.email,
            "role": role_name,
            "profile_completion": calc_completion(emp),
        })
    return result


@router.put("/role")
def update_user_role(
    req: RoleUpdateRequest,
    payload: dict = Depends(require_permission("admin.role_manage")),
    db: Session = Depends(get_db),
):
    if req.employee_id == int(payload.get("sub")):
        raise HTTPException(400, "You cannot change your own role.")

    employee = db.query(Employee).filter(Employee.id == req.employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")

    # Validate the requested role name is a known role
    try:
        requested_role = RoleName(req.role_name)
    except ValueError:
        raise HTTPException(400, f"Role '{req.role_name}' does not exist. Valid roles: {[r.value for r in RoleName]}")

    role = db.query(Role).filter(Role.name == requested_role).first()
    if not role:
        raise HTTPException(400, f"Role '{req.role_name}' does not exist.")

    employee.role_id = role.id
    db.commit()

    # ── Notify the employee by email ──────────────────────────────────────────
    try:
        send_email(
            to=employee.email,
            subject=f"Your role has been updated — {requested_role.label}",
            body=(
                f"Hi {employee.name},\n\n"
                f"Your role in the HRMS system has been updated by an administrator.\n\n"
                f"New Role: {requested_role.label}\n\n"
                f"If you have any questions about this change, please reach out to your HR team.\n\n"
                f"Best regards,\nHRMS System"
            ),
        )
    except Exception as e:
        print(f"Role-change email failed for {employee.email}: {e}")

    return {"message": f"Role for {employee.name} updated to {requested_role.value}"}


@router.delete("/employees/{employee_id}")
def delete_employee(
    employee_id: int,
    payload: dict = Depends(require_permission("employee.delete")),
    db: Session = Depends(get_db),
):
    if employee_id == int(payload.get("sub")):
        raise HTTPException(400, "You cannot delete your own account.")

    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")

    db.delete(employee)
    db.commit()

    return {"message": f"Employee {employee.name} (ID {employee_id}) deleted successfully"}