"""
Leave Service — business logic for leave approval/rejection.
Handles validation, status updates, notifications, and email.
No direct DB access — delegates to LeaveRepository.
No hardcoded notification strings — all text sourced from notification_templates.py.
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from backend.core.email import send_email
from backend.database.models import Leave
from backend.enums import LeaveStatus
from backend.notifications.notification_service import build_email
from backend.notifications.notification_templates import NotifKey
from backend.notifications.notifier import Notifier
from backend.repositories.leave_repository import LeaveRepository

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
        return [self._serialize(leave, emp) for leave, emp in rows]

    def get_all_leaves(self, status_filter: Optional[str] = None) -> list[dict]:
        if status_filter and status_filter.lower() != "all":
            try:
                status = LeaveStatus(status_filter.capitalize())
            except ValueError:
                from fastapi import HTTPException
                raise HTTPException(
                    400,
                    f"Invalid status filter '{status_filter}'. "
                    f"Valid values: {[s.value for s in LeaveStatus]}"
                )
            rows = self.repo.get_all_with_employee(status_filter=status)
        else:
            rows = self.repo.get_all_with_employee()
        return [self._serialize(leave, emp) for leave, emp in rows]

    def get_leaves_by_employee(self, employee_id: int) -> list[dict]:
        leaves = self.repo.get_by_employee(employee_id)
        emp = self.repo.get_employee(employee_id)
        return [self._serialize(leave, emp) for leave in leaves]

    # ── Serializer ────────────────────────────────────────────────────────────

    @staticmethod
    def _serialize(leave, emp) -> dict:
        """Single canonical shape returned by every list endpoint."""
        start = leave.start_date
        end   = leave.end_date
        days  = ((end - start).days + 1) if start and end else 0
        return {
            "id": leave.id,
            "employee_id": leave.employee_id,
            "employee_name": emp.name if emp else "",
            "employee_email": emp.email if emp else "",
            "leave_type": leave.leave_type,
            "start_date": start.strftime("%Y-%m-%d") if start else "",
            "end_date":   end.strftime("%Y-%m-%d")   if end   else "",
            "days": days,
            "status": leave.status.value if hasattr(leave.status, "value") else leave.status,
            "reason": leave.reason or "",
            "rejection_reason": leave.rejection_reason or "",
        }

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
            Notifier(self.db).from_template(
                NotifKey.LEAVE_APPROVED,
                leave.employee_id,
                leave_type=leave.leave_type,
                date_str=date_str,
                reason_text="",
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
        except Exception as e:  # noqa: BLE001
            logger.warning("Approval notification failed: %s", e)

    def _notify_rejection(self, leave: Leave, reason: str) -> None:
        try:
            date_str = _format_date_range(leave)
            reason_text = f" Reason: {reason}" if reason else ""
            Notifier(self.db).from_template(
                NotifKey.LEAVE_REJECTED,
                leave.employee_id,
                leave_type=leave.leave_type,
                date_str=date_str,
                reason_text=reason_text,
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
        except Exception as e:  # noqa: BLE001
            logger.warning("Rejection notification failed: %s", e)