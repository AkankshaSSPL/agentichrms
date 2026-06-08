"""
Leave Repository — database operations only, no business logic.
"""

import logging
from typing import Optional
from sqlalchemy.orm import Session

from backend.database.models import Leave, Employee
from backend.enums import LeaveStatus

logger = logging.getLogger(__name__)


class LeaveRepository:

    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, leave_id: int) -> Optional[Leave]:
        return self.db.query(Leave).filter(Leave.id == leave_id).first()

    def get_pending(self) -> list[tuple[Leave, Employee]]:
        return (
            self.db.query(Leave, Employee)
            .join(Employee, Leave.employee_id == Employee.id)
            .filter(Leave.status == LeaveStatus.PENDING)
            .all()
        )

    def get_all(self, status_filter: Optional[LeaveStatus] = None) -> list[Leave]:
        query = self.db.query(Leave)
        if status_filter:
            query = query.filter(Leave.status == status_filter)
        return query.all()

    def get_all_with_employee(
        self, status_filter: Optional[LeaveStatus] = None
    ) -> list[tuple[Leave, Employee]]:
        query = (
            self.db.query(Leave, Employee)
            .join(Employee, Leave.employee_id == Employee.id)
        )
        if status_filter:
            query = query.filter(Leave.status == status_filter)
        return query.order_by(Leave.id.desc()).all()

    def get_by_employee(self, employee_id: int) -> list[Leave]:
        return self.db.query(Leave).filter(Leave.employee_id == employee_id).all()

    def get_employee(self, employee_id: int) -> Optional[Employee]:
        return self.db.query(Employee).filter(Employee.id == employee_id).first()

    def update_status(self, leave: Leave, status: LeaveStatus, rejection_reason: Optional[str] = None) -> Leave:
        leave.status = status
        if rejection_reason is not None:
            leave.rejection_reason = rejection_reason
        self.db.commit()
        return leave