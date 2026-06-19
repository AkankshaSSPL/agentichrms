"""
backend/repositories/behaviour_analysis_repository.py
────────────────────────────────────────────────────
Database operations only — no LLM calls, no business logic.

Chat history path:
  Employee → User (User.employee_id == employee.id)
           → ChatSession (user_id == user.id, deleted_at IS NULL)
           → ChatMessage (session_id, role, content, created_at)
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from backend.database.models import (
    Employee,
    User,
    ChatSession,
    ChatMessage,
)
from backend.database.models.behaviour_analysis import BehaviourAnalysis

logger = logging.getLogger(__name__)


class BehaviourAnalysisRepository:

    def __init__(self, db: Session):
        self.db = db

    # ── Chat history retrieval ─────────────────────────────────────────────────

    def get_employee_messages(self, employee_id: int, limit: int) -> list[dict]:
        """
        Return the most recent `limit` chat messages for this employee,
        across all their (non-deleted) chat sessions, oldest-first.

        Returns plain dicts — never the ORM object — so the caller can't
        accidentally leak SQLAlchemy state into the LLM prompt or response.
        """
        user = self.db.query(User).filter(User.employee_id == employee_id).first()
        if not user:
            return []

        rows = (
            self.db.query(ChatMessage)
            .join(ChatSession, ChatMessage.session_id == ChatSession.id)
            .filter(
                ChatSession.user_id == user.id,
                ChatSession.deleted_at.is_(None),
            )
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
            .all()
        )
        # Re-reverse to chronological order (oldest first) for the prompt
        rows = list(reversed(rows))

        return [
            {
                "role": r.role,
                "content": r.content,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]

    # ── Snapshot persistence ───────────────────────────────────────────────────

    def save_analysis(self, **fields) -> BehaviourAnalysis:
        """Insert one new analysis snapshot row. Never updates existing rows."""
        snapshot = BehaviourAnalysis(**fields)
        self.db.add(snapshot)
        self.db.commit()
        self.db.refresh(snapshot)
        logger.info(
            "BehaviourAnalysis saved: id=%d employee_id=%d by=%d",
            snapshot.id, snapshot.employee_id, snapshot.analyzed_by_employee_id,
        )
        return snapshot

    def get_latest(self, employee_id: int) -> Optional[BehaviourAnalysis]:
        """Return the most recent snapshot for this employee, or None."""
        return (
            self.db.query(BehaviourAnalysis)
            .filter(BehaviourAnalysis.employee_id == employee_id)
            .order_by(BehaviourAnalysis.created_at.desc())
            .first()
        )

    def get_history(self, employee_id: int, limit: int = 10) -> list[BehaviourAnalysis]:
        """
        Return up to `limit` most recent snapshots for this employee,
        oldest-first, for trend charting. Excludes raw chat content by
        construction — BehaviourAnalysis never stores it.
        """
        rows = (
            self.db.query(BehaviourAnalysis)
            .filter(BehaviourAnalysis.employee_id == employee_id)
            .order_by(BehaviourAnalysis.created_at.desc())
            .limit(limit)
            .all()
        )
        return list(reversed(rows))

    def list_latest_per_employee(self) -> list[tuple[BehaviourAnalysis, Employee]]:
        """
        Return the latest snapshot per employee (one row per employee who has
        ever been analyzed), joined with Employee for name/email display.

        Implementation: fetch all snapshots ordered newest-first, then keep
        only the first occurrence per employee_id in Python. Simpler and more
        portable than a correlated subquery, and the table is small (one row
        per analysis run, not per message).
        """
        all_rows = (
            self.db.query(BehaviourAnalysis, Employee)
            .join(Employee, BehaviourAnalysis.employee_id == Employee.id)
            .order_by(BehaviourAnalysis.created_at.desc())
            .all()
        )
        seen: set[int] = set()
        latest: list[tuple[BehaviourAnalysis, Employee]] = []
        for snapshot, emp in all_rows:
            if snapshot.employee_id in seen:
                continue
            seen.add(snapshot.employee_id)
            latest.append((snapshot, emp))
        return latest