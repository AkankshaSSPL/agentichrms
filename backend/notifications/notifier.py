"""
backend/notifications/notifier.py
─────────────────────────────────────────────────────────────────────────────
Single entry point for all in-app notification persistence and fan-out.

Every producer (leave, onboarding, approval) uses this class instead of
writing Notification rows inline. Notification failures are logged and
swallowed — they must never break the main action.

Usage:
    notifier = Notifier(db)
    notifier.to_employee(emp.id, "Leave Approved", "Your leave was approved.")
    notifier.to_hr("New Leave Request", f"{emp.name} applied for leave.")
    notifier.from_template(NotifKey.LEAVE_SUBMITTED, emp.id,
                           leave_type="Sick", date_str="01 Jul – 03 Jul")
"""

import logging
from sqlalchemy.orm import Session

from backend.database.models import Employee, Notification, Role
from backend.enums import RoleName
from backend.notifications.notification_templates import NotifKey, get_template

logger = logging.getLogger(__name__)


class Notifier:

    def __init__(self, db: Session):
        self.db = db

    # ── Core write ────────────────────────────────────────────────────────────

    def _write(self, employee_id: int, title: str, message: str) -> None:
        """Persist a single Notification row. Rolls back on failure."""
        try:
            self.db.add(Notification(
                employee_id=employee_id,
                title=title,
                message=message,
                is_read=False,
            ))
            self.db.commit()
        except Exception as e:
            logger.warning("Notification write failed (emp=%s): %s", employee_id, e)
            self.db.rollback()

    # ── Public API ────────────────────────────────────────────────────────────

    def to_employee(self, employee_id: int, title: str, message: str) -> None:
        """Send an in-app notification to a single employee."""
        self._write(employee_id, title, message)

    def to_hr(self, title: str, message: str) -> None:
        """Fan out an in-app notification to every active HR and Admin employee."""
        hr_employees = self._get_hr_employees()
        for emp in hr_employees:
            self._write(emp.id, title, message)

    def from_template(self, key: NotifKey, employee_id: int, **ctx) -> None:
        """
        Build and persist a notification from a template key.

        ctx keys must match the placeholders in the template's message string.
        Example:
            notifier.from_template(
                NotifKey.LEAVE_SUBMITTED,
                emp.id,
                leave_type="Sick",
                date_str="01 Jul – 03 Jul",
            )
        """
        tmpl = get_template(key)
        try:
            message = tmpl["message"].format(**ctx)
        except KeyError as e:
            logger.warning("Template %s missing placeholder %s", key, e)
            message = tmpl["message"]
        self._write(employee_id, tmpl["title"], message)

    def from_template_to_hr(self, key: NotifKey, **ctx) -> None:
        """Fan out a templated notification to all HR/Admin employees."""
        tmpl = get_template(key)
        try:
            message = tmpl["message"].format(**ctx)
        except KeyError as e:
            logger.warning("Template %s missing placeholder %s", key, e)
            message = tmpl["message"]
        self.to_hr(tmpl["title"], message)

    # ── HR employee query ─────────────────────────────────────────────────────

    def _get_hr_employees(self) -> list[Employee]:
        """Return all active HR and Admin employees."""
        try:
            return (
                self.db.query(Employee)
                .join(Role, Employee.role_id == Role.id)
                .filter(
                    Role.name.in_([RoleName.HR, RoleName.ADMIN]),
                    Employee.deleted_at.is_(None),
                )
                .all()
            )
        except Exception as e:
            logger.warning("Could not fetch HR employees for notification: %s", e)
            return []