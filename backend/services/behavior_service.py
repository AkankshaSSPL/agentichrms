"""
Behavior Service — business logic for behavioral analytics.
Entry point: record_access() called from chat.py after every AI response.
Never raises — all errors are caught and logged so chat is never blocked.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.email import send_email
from backend.core.render_template import render_template
from backend.enums import DocumentCategory
from backend.notifications.notification_templates import NotifKey
from backend.notifications.notifier import Notifier
from backend.repositories.behavior_repository import BehaviorRepository

logger = logging.getLogger(__name__)

# Category → threshold setting. GENERAL is deliberately absent (never tracked).
def _thresholds() -> dict[str, int]:
    return {
        DocumentCategory.SENSITIVE:    settings.BEHAVIOR_THRESHOLD_SENSITIVE,
        DocumentCategory.LEAVE_INTENT: settings.BEHAVIOR_THRESHOLD_LEAVE_INTENT,
        DocumentCategory.EXIT_INTENT:  settings.BEHAVIOR_THRESHOLD_EXIT_INTENT,
        DocumentCategory.GROWTH:       settings.BEHAVIOR_THRESHOLD_GROWTH,
    }


class BehaviorService:

    def __init__(self, db: Session):
        self.repo = BehaviorRepository(db)
        self.db = db

    # ── Public entry point (called from chat.py) ───────────────────────────────

    def record_access(
        self,
        employee_id: int,
        sources: list[dict],
        session_id: Optional[int] = None,
    ) -> None:
        """
        Log document accesses from a chat response and evaluate alert thresholds.
        Wraps everything in try/except — must never break the chat response.
        """
        try:
            if not settings.BEHAVIOR_ANALYTICS_ENABLED:
                return

            # Dedupe by filename — one answer may cite many chunks of the same doc
            seen: set[str] = set()
            unique_sources: list[dict] = []
            for src in sources:
                fname = src.get("source_file") or src.get("source") or ""
                if fname and fname not in seen:
                    seen.add(fname)
                    unique_sources.append(src)

            for src in unique_sources:
                fname = src.get("source_file") or src.get("source") or ""
                if not fname:
                    continue

                category = self.repo.get_category_for(fname)
                if not category:
                    continue  # untagged doc — skip entirely

                # Always log the access for the audit trail
                self.repo.log_access(employee_id, fname, category, session_id)

                # Evaluate threshold only for tracked categories
                self._evaluate(employee_id, category)

        except Exception as e:  # noqa: BLE001
            logger.warning("behavior_analytics skipped for emp=%s: %s", employee_id, e)

    # ── Alert evaluation ───────────────────────────────────────────────────────

    def _evaluate(self, employee_id: int, category: str) -> None:
        thresholds = _thresholds()
        # Normalise to enum for dict lookup
        try:
            cat_enum = DocumentCategory(category)
        except ValueError:
            return

        threshold = thresholds.get(cat_enum)
        if threshold is None:
            return  # GENERAL or unknown — never alert

        since = datetime.now(tz=timezone.utc) - timedelta(days=settings.BEHAVIOR_WINDOW_DAYS)
        count = self.repo.count_access_in_window(employee_id, category, since)

        if count < threshold:
            return

        existing = self.repo.get_open_alert(employee_id, category)
        if existing:
            self.repo.update_alert(
                existing,
                score=count,
                trigger_count=existing.trigger_count + 1,
                last_triggered_at=datetime.utcnow(),
            )
            logger.info(
                "BehaviorAlert updated: emp=%d category=%s count=%d",
                employee_id, category, count,
            )
        else:
            alert = self.repo.create_alert(
                employee_id=employee_id,
                category=category,
                score=count,
                window_days=settings.BEHAVIOR_WINDOW_DAYS,
            )
            # Notify HR only on first creation
            employee = self.repo.db.query(
                __import__("backend.database.models", fromlist=["Employee"]).Employee
            ).filter_by(id=employee_id).first()
            if employee:
                self._notify_hr(employee, category, count)

    # ── HR notification ────────────────────────────────────────────────────────

    def _notify_hr(self, employee, category: str, count: int) -> None:
        # In-app bell notification to all HR/Admin
        try:
            Notifier(self.db).from_template_to_hr(
                NotifKey.BEHAVIOR_ALERT_HR,
                employee_name=employee.name,
                category=category,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("Behavior in-app notification failed: %s", e)

        # Email to all HR/Admin (if enabled)
        if not settings.BEHAVIOR_ALERT_EMAIL_ENABLED:
            return

        try:
            hr_employees = self.repo.get_hr_employees()
            html = render_template(
                "behavior_alert.html",
                employee_name=employee.name,
                category=category,
                count=count,
                window_days=settings.BEHAVIOR_WINDOW_DAYS,
            )
            for hr in hr_employees:
                try:
                    send_email(
                        to=hr.email,
                        subject=f"Document Activity Signal — {employee.name} ({category})",
                        html=html,
                        triggered_by="behavior_alert",
                        db=self.db,
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning("Behavior email failed for hr=%s: %s", hr.email, e)
        except Exception as e:  # noqa: BLE001
            logger.warning("Behavior email block failed: %s", e)

    # ── HR-facing queries ──────────────────────────────────────────────────────

    def list_alerts(self, status: Optional[str] = None) -> list[dict]:
        rows = self.repo.list_alerts(status)
        return [
            {
                "id": alert.id,
                "employee_id": alert.employee_id,
                "employee_name": emp.name,
                "employee_email": emp.email,
                "category": alert.category,
                "status": alert.status,
                "score": alert.score,
                "trigger_count": alert.trigger_count,
                "window_days": alert.window_days,
                "first_triggered_at": alert.first_triggered_at.isoformat() if alert.first_triggered_at else None,
                "last_triggered_at": alert.last_triggered_at.isoformat() if alert.last_triggered_at else None,
                "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
                "hr_note": alert.hr_note,
            }
            for alert, emp in rows
        ]

    def resolve_alert(self, alert_id: int, hr_id: int, note: Optional[str] = None) -> dict:
        from fastapi import HTTPException
        alert = self.repo.get_alert(alert_id)
        if not alert:
            raise HTTPException(404, "Alert not found")
        if alert.status == "RESOLVED":
            raise HTTPException(400, "Alert is already resolved")
        self.repo.resolve_alert(alert, hr_id, note)
        return {"message": "Alert resolved", "alert_id": alert_id}

    # ── Admin tag management ───────────────────────────────────────────────────

    def list_tags(self) -> list[dict]:
        return [
            {"id": t.id, "filename": t.filename, "category": t.category}
            for t in self.repo.list_tags()
        ]

    def set_tag(self, filename: str, category: str) -> dict:
        from fastapi import HTTPException
        try:
            DocumentCategory(category)
        except ValueError:
            raise HTTPException(
                400,
                f"Invalid category '{category}'. "
                f"Valid values: {[c.value for c in DocumentCategory]}"
            )
        tag = self.repo.upsert_tag(filename, category)
        return {"id": tag.id, "filename": tag.filename, "category": tag.category}