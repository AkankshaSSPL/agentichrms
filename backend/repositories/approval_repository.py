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
            query = query.filter(ApprovalRequest.status == status)
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
        # Type coercions
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