"""
Onboarding Repository — database operations only.
"""

import logging
from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect

from backend.database.models import Employee, Notification, ApprovalRequest
from backend.enums import ApprovalStatus

logger = logging.getLogger(__name__)


class OnboardingRepository:

    def __init__(self, db: Session):
        self.db = db

    def get_employee(self, employee_id: int) -> Optional[Employee]:
        return self.db.query(Employee).filter(Employee.id == employee_id).first()

    def get_pending_onboarding(self) -> list[Employee]:
        return (
            self.db.query(Employee)
            .filter(
                Employee.onboarding_completed == False,
                Employee.deleted_at.is_(None),
            )
            .order_by(Employee.created_at.desc())
            .all()
        )

    def save(self, employee: Employee) -> None:
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

    def save_approval_request(
        self,
        employee_id: int,
        requested_by_id: int,
        field_name: str,
        old_value: Optional[str],
        new_value: str,
    ) -> ApprovalRequest:
        req = ApprovalRequest(
            employee_id=employee_id,
            requested_by_employee_id=requested_by_id,
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
            status=ApprovalStatus.PENDING,
        )
        self.db.add(req)
        self.db.commit()
        self.db.refresh(req)
        return req

    def get_columns(self, employee: Employee, skip: set) -> dict:
        mapper = sa_inspect(Employee)
        result = {}
        for col in mapper.columns:
            name = col.key
            if name in skip:
                continue
            result[name] = getattr(employee, name, None)
        return result