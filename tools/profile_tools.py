"""
Profile update tool for the HR assistant.
Allows the agent to update employee profile fields via the existing /onboarding-profile/save endpoint.
"""

from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool
from sqlalchemy.orm import Session
from backend.database.session import SessionLocal
from backend.database.models import Employee
from datetime import datetime


class UpdateProfileInput(BaseModel):
    employee_email: str = Field(description="The email of the logged-in employee (provided automatically)")
    updates: Dict[str, Any] = Field(
        description="Dictionary of profile fields to update. Valid keys: department, designation, join_date, employment_type, date_of_birth, gender, address_line1, address_line2, city, state, country, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, bank_name, account_holder_name, account_number, bank_branch, base_salary."
    )


def _parse_date(val: Optional[str]) -> Optional[datetime.date]:
    if not val:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    return None


def update_employee_profile(employee_email: str, updates: Dict[str, Any]) -> str:
    """
    Update profile fields of the logged-in employee.
    Uses the same logic as the /api/onboarding-profile/save endpoint.
    """
    db = SessionLocal()
    try:
        employee = db.query(Employee).filter(Employee.email == employee_email).first()
        if not employee:
            return f"Error: No employee found with email {employee_email}"

        updated_fields = []
        errors = []

        for key, value in updates.items():
            if value is None:
                continue

            # Date fields need parsing
            if key == "join_date":
                parsed = _parse_date(value)
                if parsed:
                    employee.join_date = parsed
                    updated_fields.append("join_date")
                else:
                    errors.append(f"Invalid date format for join_date: {value}")
            elif key == "date_of_birth":
                parsed = _parse_date(value)
                if parsed:
                    employee.date_of_birth = parsed
                    updated_fields.append("date_of_birth")
                else:
                    errors.append(f"Invalid date format for date_of_birth: {value}")
            elif hasattr(employee, key):
                setattr(employee, key, value)
                updated_fields.append(key)
            else:
                errors.append(f"Unknown profile field '{key}'")

        if errors:
            return f"Partial update: Updated {', '.join(updated_fields)} but errors: {'; '.join(errors)}"

        if updated_fields:
            employee.profile_completed = True
            db.commit()
            return f"Successfully updated profile fields: {', '.join(updated_fields)}"
        else:
            return "No valid fields to update."
    except Exception as e:
        db.rollback()
        return f"Error updating profile: {str(e)}"
    finally:
        db.close()


# Create the LangChain tool
update_profile_tool = StructuredTool.from_function(
    func=update_employee_profile,
    name="update_employee_profile",
    description="Update one or more profile fields for the logged-in employee. Provide a dictionary of fields to update. Valid keys: department, designation, join_date, employment_type, date_of_birth, gender, address_line1, address_line2, city, state, country, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, bank_name, account_holder_name, account_number, bank_branch, base_salary.",
    args_schema=UpdateProfileInput,
)