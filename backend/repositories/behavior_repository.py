"""
Behavior Repository — database operations only for behavioral analytics.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from sqlalchemy.orm import Session

from backend.database.models import Employee
from backend.database.models.behavior_analytics import (
    BehaviorAlert,
    DocumentAccessLog,
    DocumentTag,
)
from backend.enums import BehaviorAlertStatus, AccessSource, NudgeStatus, DocumentCategory

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

    def delete_tag(self, filename: str) -> bool:
        """
        Delete the DocumentTag for the given filename.
        Returns True if a row was deleted, False if it didn't exist.
        """
        tag = self.db.query(DocumentTag).filter(DocumentTag.filename == filename).first()
        if not tag:
            logger.warning("delete_tag: no tag found for filename=%s", filename)
            return False
        self.db.delete(tag)
        self.db.commit()
        logger.info("DocumentTag deleted: %s", filename)
        return True

    # ── Access log operations ──────────────────────────────────────────────────

    def log_access(
        self,
        employee_id: int,
        filename: str,
        category: str,
        session_id: Optional[int],
        access_source: str = AccessSource.CHAT,
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

    def list_recent_accesses(
        self,
        employee_id: int,
        since: datetime,
        limit: int = 20,
    ) -> List[DocumentAccessLog]:
        """
        Return this employee's most recent document accesses (chat + viewer
        combined), newest-first, within the given window.

        Used by BehaviourAnalysisService to surface "what this person has
        been reading" alongside the chat-derived mood/trait summary the admin
        sees — same underlying audit trail, no separate tracking, no
        duplicated logic.
        """
        return (
            self.db.query(DocumentAccessLog)
            .filter(
                DocumentAccessLog.employee_id == employee_id,
                DocumentAccessLog.accessed_at >= since,
            )
            .order_by(DocumentAccessLog.accessed_at.desc())
            .limit(limit)
            .all()
        )

    # ── Nudge ledger operations (replaces alert methods) ──────────────────────

    def get_active_nudge(
        self,
        employee_id: int,
        category: str,
    ) -> Optional[BehaviorAlert]:
        """
        Return an existing nudge that is still active (PENDING or DELIVERED)
        for this employee+category.
        """
        return (
            self.db.query(BehaviorAlert)
            .filter(
                BehaviorAlert.employee_id == employee_id,
                BehaviorAlert.category == category,
                BehaviorAlert.status.in_([NudgeStatus.PENDING, NudgeStatus.DELIVERED]),
            )
            .first()
        )

    def create_nudge(
        self,
        employee_id: int,
        category: str,
        score: int,
        window_days: int,
        nudge_text: str,
        last_filename: Optional[str] = None,
    ) -> BehaviorAlert:
        """
        Create a new nudge with status PENDING.
        """
        alert = BehaviorAlert(
            employee_id=employee_id,
            category=category,
            status=NudgeStatus.PENDING,
            score=score,
            trigger_count=1,
            window_days=window_days,
            first_triggered_at=datetime.now(timezone.utc),
            last_triggered_at=datetime.now(timezone.utc),
            last_filename=last_filename,
            nudge_text=nudge_text,
            # delivered_at/dismissed_at remain None
        )
        self.db.add(alert)
        self.db.commit()
        self.db.refresh(alert)
        logger.info(
            "Nudge created: emp=%d category=%s score=%d filename=%s",
            employee_id, category, score, last_filename,
        )
        return alert

    def list_pending_nudges(self, employee_id: int) -> List[BehaviorAlert]:
        """
        Return all PENDING nudges for an employee, ordered by priority:
        POSH > EXIT_INTENT > LEAVE_INTENT > GROWTH.
        """
        # Define priority order
        priority_order = {
            DocumentCategory.POSH: 0,
            DocumentCategory.EXIT_INTENT: 1,
            DocumentCategory.LEAVE_INTENT: 2,
            DocumentCategory.GROWTH: 3,
        }
        # We'll fetch all pending and sort in Python, or use CASE in SQL.
        # Simpler: fetch and sort in Python for clarity.
        pending = (
            self.db.query(BehaviorAlert)
            .filter(
                BehaviorAlert.employee_id == employee_id,
                BehaviorAlert.status == NudgeStatus.PENDING,
            )
            .all()
        )
        # Sort by priority (lower number = higher priority)
        pending.sort(key=lambda a: priority_order.get(a.category, 99))
        return pending

    def mark_delivered(self, nudge: BehaviorAlert) -> None:
        """Mark a nudge as delivered and set delivered_at."""
        nudge.status = NudgeStatus.DELIVERED
        nudge.delivered_at = datetime.now(timezone.utc)
        self.db.commit()
        logger.info("Nudge %d marked delivered", nudge.id)

    def mark_dismissed(self, nudge: BehaviorAlert) -> None:
        """Mark a nudge as dismissed and set dismissed_at."""
        nudge.status = NudgeStatus.DISMISSED
        nudge.dismissed_at = datetime.now(timezone.utc)
        self.db.commit()
        logger.info("Nudge %d marked dismissed", nudge.id)

    def recent_nudge_exists(
        self,
        employee_id: int,
        category: str,
        since: datetime,
    ) -> bool:
        """
        Check if there is any nudge (any status) for this employee+category
        that was created after `since`. Used for throttle.
        """
        return (
            self.db.query(BehaviorAlert)
            .filter(
                BehaviorAlert.employee_id == employee_id,
                BehaviorAlert.category == category,
                BehaviorAlert.first_triggered_at >= since,
            )
            .first()
        ) is not None

    # ── Legacy alert methods removed ──────────────────────────────────────────
    # get_open_alert, create_alert, update_alert, list_alerts, resolve_alert, get_hr_employees
    # are gone. They are replaced by the above.