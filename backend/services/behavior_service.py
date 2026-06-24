"""
Behavior Service — business logic for behavioral analytics.

Entry points:
  record_access() — called from chat.py after every AI response (chat source)
  record_view()   — called from docs.py when employee opens a doc in the viewer

Never raises — all errors caught and logged so chat/viewer are never blocked.

NOTE: The nudge system (NUDGE_PLAYBOOK, compose_nudge, _evaluate, _raise_nudge,
get_pending_nudges, mark_nudge_delivered, dismiss_nudge) has been removed as part
of the June 2025 cleanup. BehaviorAlert rows are left in place as append-only
history; nothing writes to them any more.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.enums import DocumentCategory, AccessSource
from backend.repositories.behavior_repository import BehaviorRepository

logger = logging.getLogger(__name__)


class BehaviorService:

    def __init__(self, db: Session):
        self.repo = BehaviorRepository(db)
        self.db = db

    # ── Chat entry point ───────────────────────────────────────────────────────

    def record_access(
        self,
        employee_id: int,
        sources: list[dict],
        session_id: Optional[int] = None,
    ) -> None:
        """
        Log document accesses surfaced in a chat response.
        access_source is always "chat" here.
        """
        try:
            if not settings.BEHAVIOR_ANALYTICS_ENABLED:
                return

            seen: set[str] = set()
            for src in sources:
                fname = src.get("source_file") or src.get("source") or ""
                if not fname or fname in seen:
                    continue
                seen.add(fname)

                category = self.repo.get_category_for(fname)
                if not category:
                    continue

                self.repo.log_access(
                    employee_id, fname, category, session_id,
                    access_source=AccessSource.CHAT,
                )

        except Exception as e:  # noqa: BLE001
            logger.warning("behavior_analytics skipped for emp=%s: %s", employee_id, e)

    # ── Viewer entry point ─────────────────────────────────────────────────────

    def record_view(
        self,
        employee_id: int,
        filename: str,
        session_id: Optional[int] = None,
    ) -> None:
        """
        Log a document open from the Document Library viewer.
        Guarded by a per-(employee, file) cooldown to prevent rapid re-open spam.
        """
        try:
            if not settings.BEHAVIOR_ANALYTICS_ENABLED:
                return

            category = self.repo.get_category_for(filename)
            if not category:
                return  # untagged doc — viewable but not tracked

            since = datetime.now(tz=timezone.utc) - timedelta(
                minutes=settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES
            )
            if self.repo.recent_view_exists(employee_id, filename, since):
                logger.debug(
                    "view cooldown active: emp=%d file=%s — skipping log",
                    employee_id, filename,
                )
                return

            self.repo.log_access(
                employee_id, filename, category, session_id,
                access_source=AccessSource.VIEWER,
            )

        except Exception as e:  # noqa: BLE001
            logger.warning("record_view skipped for emp=%d file=%s: %s", employee_id, filename, e)

    # ── Tag management (internal config, not HR signalling) ──────────────────

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