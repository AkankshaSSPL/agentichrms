"""
Behavior Repository — database operations only for behavioral analytics.
"""
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from backend.database.models import Employee
from backend.database.models.behavior_analytics import (
    BehaviorAlert,
    DocumentAccessLog,
    DocumentTag,
)
from backend.enums import BehaviorAlertStatus, RoleName, AccessSource
from backend.database.models import Role

logger = logging.getLogger(__name__)


class BehaviorRepository:

    def __init__(self, db: Session):
        self.db = db

    # ── Document tag operations ────────────────────────────────────────────────

    def get_category_for(self, filename: str) -> Optional[str]:
        """Return the category string for a filename, or None if untagged."""
        tag = self.db.query(DocumentTag).filter(DocumentTag.filename == filename).first()
        return tag.category if tag else None

    def list_tags(self) -> list[DocumentTag]:
        return self.db.query(DocumentTag).order_by(DocumentTag.filename).all()

    def upsert_tag(self, filename: str, category: str) -> DocumentTag:
        """Insert or update a filename → category mapping."""
        tag = self.db.query(DocumentTag).filter(DocumentTag.filename == filename).first()
        if tag:
            tag.category = category
        else:
            tag = DocumentTag(filename=filename, category=category)
            self.db.add(tag)
        self.db.commit()
        self.db.refresh(tag)
        logger.info("DocumentTag upserted: %s → %s", filename, category)
        return tag

    # ── Access log operations ──────────────────────────────────────────────────

    def log_access(
        self,
        employee_id: int,
        filename: str,
        category: str,
        session_id: Optional[int],
        access_source: str = AccessSource.CHAT,   # ← new param, default preserves chat behaviour
    ) -> DocumentAccessLog:
        """Append a new access log entry — never updated or deleted."""
        entry = DocumentAccessLog(
            employee_id=employee_id,
            filename=filename,
            category=category,
            chat_session_id=session_id,
            access_source=access_source,
        )
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)
        return entry

    def recent_view_exists(
        self,
        employee_id: int,
        filename: str,
        since: datetime,
    ) -> bool:
        """
        Return True if this employee already opened this file via the viewer
        within the cooldown window — used to de-spam rapid re-opens.
        """
        return (
            self.db.query(DocumentAccessLog)
            .filter(
                DocumentAccessLog.employee_id == employee_id,
                DocumentAccessLog.filename == filename,
                DocumentAccessLog.access_source == AccessSource.VIEWER,
                DocumentAccessLog.accessed_at >= since,
            )
            .first()
        ) is not None

    def count_access_in_window(
        self,
        employee_id: int,
        category: str,
        since: datetime,
    ) -> int:
        """
        Count all accesses (chat + viewer) for an employee+category within the window.
        Both access sources count toward the same threshold — no separate models.
        """
        return (
            self.db.query(DocumentAccessLog)
            .filter(
                DocumentAccessLog.employee_id == employee_id,
                DocumentAccessLog.category == category,
                DocumentAccessLog.accessed_at >= since,
            )
            .count()
        )

    # ── Alert operations ───────────────────────────────────────────────────────

    def get_open_alert(self, employee_id: int, category: str) -> Optional[BehaviorAlert]:
        return (
            self.db.query(BehaviorAlert)
            .filter(
                BehaviorAlert.employee_id == employee_id,
                BehaviorAlert.category == category,
                BehaviorAlert.status == BehaviorAlertStatus.OPEN,
            )
            .first()
        )

    def create_alert(
        self,
        employee_id: int,
        category: str,
        score: int,
        window_days: int,
    ) -> BehaviorAlert:
        alert = BehaviorAlert(
            employee_id=employee_id,
            category=category,
            status=BehaviorAlertStatus.OPEN,
            score=score,
            trigger_count=1,
            window_days=window_days,
            first_triggered_at=datetime.utcnow(),
            last_triggered_at=datetime.utcnow(),
        )
        self.db.add(alert)
        self.db.commit()
        self.db.refresh(alert)
        logger.info(
            "BehaviorAlert created: emp=%d category=%s score=%d",
            employee_id, category, score,
        )
        return alert

    def update_alert(self, alert: BehaviorAlert, **fields) -> BehaviorAlert:
        for key, value in fields.items():
            setattr(alert, key, value)
        self.db.commit()
        self.db.refresh(alert)
        return alert

    def list_alerts(self, status: Optional[str] = None) -> list[tuple[BehaviorAlert, Employee]]:
        query = (
            self.db.query(BehaviorAlert, Employee)
            .join(Employee, BehaviorAlert.employee_id == Employee.id)
        )
        if status and status != "all":
            query = query.filter(BehaviorAlert.status == status.upper())
        return query.order_by(BehaviorAlert.last_triggered_at.desc()).all()

    def get_alert(self, alert_id: int) -> Optional[BehaviorAlert]:
        return self.db.query(BehaviorAlert).filter(BehaviorAlert.id == alert_id).first()

    def resolve_alert(
        self,
        alert: BehaviorAlert,
        resolved_by_id: int,
        note: Optional[str] = None,
    ) -> BehaviorAlert:
        alert.status = BehaviorAlertStatus.RESOLVED
        alert.resolved_at = datetime.utcnow()
        alert.resolved_by_employee_id = resolved_by_id
        alert.hr_note = note
        self.db.commit()
        self.db.refresh(alert)
        logger.info("BehaviorAlert resolved: id=%d by emp=%d", alert.id, resolved_by_id)
        return alert

    def get_hr_employees(self) -> list[Employee]:
        return (
            self.db.query(Employee)
            .join(Role, Employee.role_id == Role.id)
            .filter(
                Role.name.in_([RoleName.HR, RoleName.ADMIN]),
                Employee.deleted_at.is_(None),
            )
            .all()
        )