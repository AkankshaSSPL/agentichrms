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
from backend.core.security import require_role
from backend.core.email import send_email   # re-use existing email helper

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


class EmployeeRoleResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str


@router.get("/employees", response_model=List[EmployeeRoleResponse])
def list_employees(
    payload: dict = Depends(require_role(["admin"])),
    db: Session = Depends(get_db),
):
    employees = db.query(Employee).all()
    result = []
    for emp in employees:
        role_name = emp.role.name if emp.role else "employee"
        result.append({
            "id": emp.id,
            "name": emp.name,
            "email": emp.email,
            "role": role_name,
        })
    return result


@router.put("/role")
def update_user_role(
    req: RoleUpdateRequest,
    payload: dict = Depends(require_role(["admin"])),
    db: Session = Depends(get_db),
):
    if req.employee_id == int(payload.get("sub")):
        raise HTTPException(400, "You cannot change your own role.")

    employee = db.query(Employee).filter(Employee.id == req.employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")

    role = db.query(Role).filter(Role.name == req.role_name).first()
    if not role:
        raise HTTPException(400, f"Role '{req.role_name}' does not exist.")

    employee.role_id = role.id
    db.commit()

    # ── Notify the employee by email ──────────────────────────────────────────
    role_labels = {"admin": "Administrator", "hr": "HR Manager", "employee": "Employee"}
    role_label = role_labels.get(req.role_name, req.role_name.capitalize())
    try:
        send_email(
            to=employee.email,
            subject=f"Your role has been updated — {role_label}",
            body=(
                f"Hi {employee.name},\n\n"
                f"Your role in the HRMS system has been updated by an administrator.\n\n"
                f"New Role: {role_label}\n\n"
                f"If you have any questions about this change, please reach out to your HR team.\n\n"
                f"Best regards,\nHRMS System"
            ),
        )
    except Exception as e:
        # Email failure should not block the API response
        print(f"⚠️  Role-change email failed for {employee.email}: {e}")

    return {"message": f"Role for {employee.name} updated to {req.role_name}"}


@router.delete("/employees/{employee_id}")
def delete_employee(
    employee_id: int,
    payload: dict = Depends(require_role(["admin"])),
    db: Session = Depends(get_db),
):
    if employee_id == int(payload.get("sub")):
        raise HTTPException(400, "You cannot delete your own account.")

    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")

    # Hard delete – remove completely
    db.delete(employee)
    db.commit()

    return {"message": f"Employee {employee.name} (ID {employee_id}) deleted successfully"}