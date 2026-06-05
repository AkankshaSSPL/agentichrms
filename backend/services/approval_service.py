"""
Approval Service — business logic for approval workflow.
"""

import logging
from typing import Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException

from backend.database.models import ApprovalRequest
from backend.enums import ApprovalStatus
from backend.repositories.approval_repository import ApprovalRepository

logger = logging.getLogger(__name__)

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


def _serialize(r: ApprovalRequest) -> dict:
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


class ApprovalService:

    def __init__(self, db: Session):
        self.repo = ApprovalRepository(db)

    # ── Queries ───────────────────────────────────────────────────────────────

    def list_requests(self, status: Optional[str], hr_email: str) -> list[dict]:
        rows = self.repo.get_all(status=status)
        logger.info("Approval requests fetched by %s: %d rows", hr_email, len(rows))
        return [_serialize(r) for r in rows]

    def my_requests(self, employee_id: int) -> list[dict]:
        rows = self.repo.get_by_employee(employee_id)
        return [_serialize(r) for r in rows]

    # ── Actions ───────────────────────────────────────────────────────────────

    def process_action(
        self,
        request_id: int,
        action: str,
        hr_id: int,
        reason: Optional[str] = None,
    ) -> dict:
        apr = self.repo.get_by_id(request_id)
        if not apr:
            raise HTTPException(404, "Request not found")
        if apr.status != ApprovalStatus.PENDING:
            raise HTTPException(400, f"Request is already {apr.status}")

        emp = self.repo.get_employee(apr.employee_id)
        if not emp:
            raise HTTPException(404, "Employee not found")

        field_label = FIELD_LABELS.get(apr.field_name, apr.field_name)

        if action == "approve":
            self.repo.apply_field_change(emp, apr.field_name, apr.new_value)
            self.repo.resolve(apr, ApprovalStatus.APPROVED, hr_id, reason)
            self.repo.save_notification(
                emp.id,
                title="Profile Update Approved",
                message=f"Your request to change {field_label} to '{apr.new_value}' has been approved by HR.",
            )

        elif action == "reject":
            self.repo.resolve(apr, ApprovalStatus.REJECTED, hr_id, reason)
            self.repo.save_notification(
                emp.id,
                title="Profile Update Rejected",
                message=(
                    f"Your request to change {field_label} to '{apr.new_value}' was not approved."
                    + (f" Reason: {reason}" if reason else "")
                ),
            )

        else:
            raise HTTPException(400, f"Unknown action '{action}'. Use 'approve' or 'reject'.")

        return _serialize(apr)