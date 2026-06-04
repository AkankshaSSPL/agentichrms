"""
Leave Service — business logic for leave approval/rejection.
Handles validation, status updates, notifications, and email.
No direct DB access — delegates to LeaveRepository.
No hardcoded notification strings — all text sourced from notification_templates.py.
"""

import logging
from typing import Optional
from sqlalchemy.orm import Session

from backend.database.models import Leave, Notification
from backend.enums import LeaveStatus
from backend.core.email import send_email
from backend.repositories.leave_repository import LeaveRepository
from backend.notifications.notification_templates import NotifKey
from backend.notifications.notification_service import build_notification, build_email

logger = logging.getLogger(__name__)


def _format_date_range(leave: Leave) -> str:
    start = leave.start_date.strftime("%d %b %Y") if leave.start_date else ""
    end   = leave.end_date.strftime("%d %b %Y")   if leave.end_date   else ""
    return start if start == end else f"{start} – {end}"


class LeaveService:

    def __init__(self, db: Session):
        self.repo = LeaveRepository(db)
        self.db = db

    # ── Queries ───────────────────────────────────────────────────────────────

    def get_pending_leaves(self) -> list[dict]:
        rows = self.repo.get_pending()
        return [
            {
                "id": leave.id,
                "employee_id": leave.employee_id,
                "employee_name": emp.name,
                "employee_email": emp.email,
                "leave_type": leave.leave_type,
                "start_date": leave.start_date.strftime("%Y-%m-%d") if leave.start_date else "",
                "end_date": leave.end_date.strftime("%Y-%m-%d") if leave.end_date else "",
                "status": leave.status,
                "reason": leave.reason or "",
            }
            for leave, emp in rows
        ]

    def get_all_leaves(self, status_filter: Optional[str] = None) -> list[Leave]:
        if status_filter:
            try:
                status = LeaveStatus(status_filter.capitalize())
            except ValueError:
                from fastapi import HTTPException
                raise HTTPException(
                    400,
                    f"Invalid status filter '{status_filter}'. "
                    f"Valid values: {[s.value for s in LeaveStatus]}"
                )
            return self.repo.get_all(status_filter=status)
        return self.repo.get_all()

    def get_leaves_by_employee(self, employee_id: int) -> list[Leave]:
        return self.repo.get_by_employee(employee_id)

    # ── Update status (approve or reject) ────────────────────────────────────

    def update_leave_status(
        self,
        leave_id: int,
        status: LeaveStatus,
        comments: Optional[str] = None,
        actioned_by: str = "HR",
    ) -> dict:
        """Single entry point for approve and reject. Validates, updates, notifies."""
        from fastapi import HTTPException

        if status not in (LeaveStatus.APPROVED, LeaveStatus.REJECTED):
            raise HTTPException(400, f"Invalid status '{status.value}'. Must be Approved or Rejected.")

        leave = self.repo.get_by_id(leave_id)
        if not leave:
            raise HTTPException(404, "Leave request not found")

        if leave.status != LeaveStatus.PENDING:
            raise HTTPException(400, f"Leave is already {leave.status.value}")

        self.repo.update_status(
            leave,
            status,
            rejection_reason=comments if status == LeaveStatus.REJECTED else None,
        )
        logger.info("Leave %d set to %s by %s", leave_id, status.value, actioned_by)

        if status == LeaveStatus.APPROVED:
            self._notify_approval(leave)
        else:
            self._notify_rejection(leave, comments or "")

        return {"message": f"Leave {status.value.lower()}", "leave_id": leave_id}

    # ── Backward-compatible wrappers ──────────────────────────────────────────

    def approve_leave(self, leave_id: int, approved_by: str) -> dict:
        return self.update_leave_status(leave_id, LeaveStatus.APPROVED, actioned_by=approved_by)

    def reject_leave(self, leave_id: int, reason: str, rejected_by: str) -> dict:
        return self.update_leave_status(leave_id, LeaveStatus.REJECTED, comments=reason, actioned_by=rejected_by)

    # ── Private helpers ───────────────────────────────────────────────────────

    def _notify_approval(self, leave: Leave) -> None:
        try:
            date_str = _format_date_range(leave)
            self.repo.save_notification(
                build_notification(NotifKey.LEAVE_APPROVED, leave, date_str)
            )
            emp = self.repo.get_employee(leave.employee_id)
            if emp:
                email = build_email(NotifKey.LEAVE_APPROVED, leave, date_str, emp.name)
                send_email(
                    to=emp.email,
                    triggered_by="leave_approve",
                    db=self.db,
                    **email,
                )
        except Exception as e:
            logger.warning("Approval notification failed: %s", e)

    def _notify_rejection(self, leave: Leave, reason: str) -> None:
        try:
            date_str = _format_date_range(leave)
            self.repo.save_notification(
                build_notification(NotifKey.LEAVE_REJECTED, leave, date_str, reason)
            )
            emp = self.repo.get_employee(leave.employee_id)
            if emp:
                email = build_email(NotifKey.LEAVE_REJECTED, leave, date_str, emp.name, reason)
                send_email(
                    to=emp.email,
                    triggered_by="leave_reject",
                    db=self.db,
                    **email,
                )
        except Exception as e:
            logger.warning("Rejection notification failed: %s", e)