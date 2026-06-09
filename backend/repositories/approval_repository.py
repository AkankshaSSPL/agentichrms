"""
Approval Repository — database operations only.
"""
import logging
from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Session
from backend.database.models import ApprovalRequest, Employee, Notification
from backend.enums import ApprovalStatus

logger = logging.getLogger(__name__)


class ApprovalRepository:

    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, request_id: int) -> Optional[ApprovalRequest]:
        return self.db.query(ApprovalRequest).filter(ApprovalRequest.id == request_id).first()

    def get_all(self, status: Optional[str] = None) -> list[ApprovalRequest]:
        query = self.db.query(ApprovalRequest)
        if status:
            # Normalise to lowercase — DB stores 'pending', 'approved', 'rejected'
            normalised = status.strip().lower()
            query = query.filter(ApprovalRequest.status == normalised)
        return query.order_by(ApprovalRequest.id.desc()).all()

    def get_by_employee(self, employee_id: int) -> list[ApprovalRequest]:
        return (
            self.db.query(ApprovalRequest)
            .filter(ApprovalRequest.employee_id == employee_id)
            .order_by(ApprovalRequest.id.desc())
            .all()
        )

    def get_employee(self, employee_id: int) -> Optional[Employee]:
        return self.db.query(Employee).filter(Employee.id == employee_id).first()

    def create_request(
        self,
        employee_id: int,
        requested_by_employee_id: int,
        field_name: str,
        old_value: Optional[str],
        new_value: str,
    ) -> ApprovalRequest:
        """Create a new pending approval request for a field change."""
        # Cancel any existing pending request for the same employee + field
        existing = (
            self.db.query(ApprovalRequest)
            .filter(
                ApprovalRequest.employee_id == employee_id,
                ApprovalRequest.field_name == field_name,
                ApprovalRequest.status == ApprovalStatus.PENDING,
            )
            .first()
        )
        if existing:
            existing.status = ApprovalStatus.CANCELLED if hasattr(ApprovalStatus, "CANCELLED") else "cancelled"
            existing.reason = "Superseded by a newer request"
            existing.resolved_at = datetime.utcnow()

        apr = ApprovalRequest(
            employee_id=employee_id,
            requested_by_employee_id=requested_by_employee_id,
            field_name=field_name,
            old_value=str(old_value) if old_value is not None else None,
            new_value=str(new_value),
            status=ApprovalStatus.PENDING,
        )
        self.db.add(apr)
        self.db.commit()
        self.db.refresh(apr)
        logger.info(
            "ApprovalRequest created: emp=%d field=%s old=%s new=%s",
            employee_id, field_name, old_value, new_value,
        )
        return apr

    def resolve(
        self,
        apr: ApprovalRequest,
        status: ApprovalStatus,
        resolved_by_id: int,
        reason: Optional[str] = None,
    ) -> ApprovalRequest:
        apr.status = status
        apr.reason = reason
        apr.resolved_at = datetime.utcnow()
        apr.resolved_by_employee_id = resolved_by_id
        self.db.commit()
        return apr

    def apply_field_change(self, emp: Employee, field_name: str, new_value: str) -> None:
        if not hasattr(emp, field_name):
            return
        if field_name == "base_salary":
            try:
                new_value = float(new_value)
            except ValueError:
                pass
        elif field_name in ("role_id", "manager_id"):
            try:
                new_value = int(new_value)
            except ValueError:
                pass
        setattr(emp, field_name, new_value)
        self.db.commit()

    def get_hr_employees(self) -> list[Employee]:
        """Return all active HR and Admin employees to notify of pending approvals."""
        from backend.enums import RoleName
        from backend.database.models import Role
        return (
            self.db.query(Employee)
            .join(Role, Employee.role_id == Role.id)
            .filter(
                Role.name.in_([RoleName.HR, RoleName.ADMIN]),
                Employee.deleted_at.is_(None),
            )
            .all()
        )

    def save_notification(self, employee_id: int, title: str, message: str) -> None:
        try:
            self.db.add(Notification(
                employee_id=employee_id,
                title=title,
                message=message,
                is_read=False,
            ))
            self.db.commit()
        except Exception as e:
            logger.warning("Notification failed: %s", e)
            self.db.rollback()