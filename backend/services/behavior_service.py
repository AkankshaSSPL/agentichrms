"""
Behavior Service — business logic for behavioral analytics.

Entry points:
  record_access() — called from chat.py after every AI response (chat source)
  record_view()   — called from docs.py when employee opens a doc in the viewer

Never raises — all errors caught and logged so chat/viewer are never blocked.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.database.models import Employee
from backend.enums import DocumentCategory, AccessSource, NudgeStatus
from backend.repositories.behavior_repository import BehaviorRepository
from backend.database.models.behavior_analytics import BehaviorAlert

logger = logging.getLogger(__name__)


def _thresholds() -> dict[str, int]:
    return {
        DocumentCategory.SENSITIVE:    settings.BEHAVIOR_THRESHOLD_SENSITIVE,
        DocumentCategory.LEAVE_INTENT: settings.BEHAVIOR_THRESHOLD_LEAVE_INTENT,
        DocumentCategory.EXIT_INTENT:  settings.BEHAVIOR_THRESHOLD_EXIT_INTENT,
        DocumentCategory.GROWTH:       settings.BEHAVIOR_THRESHOLD_GROWTH,
        DocumentCategory.POSH:         settings.BEHAVIOR_THRESHOLD_POSH,
    }


# ── Nudge Playbook ───────────────────────────────────────────────────────────

NUDGE_PLAYBOOK = {
    DocumentCategory.POSH: {
        "opener": "I noticed you've been looking into our conduct/harassment policies. If you ever want to raise a concern — including a POSH complaint — I can privately walk you through the process whenever you're ready.",
        "agent_instruction": "If the employee engages, explain the POSH process + Internal Committee confidentially, offer to help them draft/organize their account. Never auto-file or route to HR.",
        "action": "guidance_only"
    },
    DocumentCategory.EXIT_INTENT: {
        "opener": "Just checking in — if anything about your role or growth is on your mind, I'm here to help, confidentially.",
        "agent_instruction": "Offer a supportive conversation, surface internal growth/mobility options; if they want, help them think through next steps. No escalation.",
        "action": "guidance_and_resources"
    },
    DocumentCategory.LEAVE_INTENT: {
        "opener": "I've seen you reviewing leave / WFH policies. Want me to check your balance or help you apply for leave?",
        "agent_instruction": "If yes → call check_leave_balance / apply_leave (existing tools).",
        "action": "real_action"
    },
    DocumentCategory.GROWTH: {
        "opener": "Looks like you're exploring development resources. Want suggestions on learning paths or growth opportunities?",
        "agent_instruction": "Offer learning paths / mentorship ideas; conversational.",
        "action": "guidance"
    }
}


def compose_nudge(category: str, filename: Optional[str] = None) -> str:
    """Return the opener for a category."""
    playbook = NUDGE_PLAYBOOK.get(category)
    if not playbook:
        return ""  # Should not happen
    return playbook["opener"]


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
                self._evaluate(employee_id, category, fname)

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
        Reuses the same _evaluate() → nudge pipeline as chat accesses.
        """
        try:
            if not settings.BEHAVIOR_ANALYTICS_ENABLED:
                return

            category = self.repo.get_category_for(filename)
            if not category:
                return  # untagged doc — viewable but not tracked

            # Cooldown: skip if this employee already opened this file recently via viewer
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

            # Same evaluation path as chat — chat + viewer counts combine
            self._evaluate(employee_id, category, filename)

        except Exception as e:  # noqa: BLE001
            logger.warning("record_view skipped for emp=%d file=%s: %s", employee_id, filename, e)

    # ── Evaluation & nudge creation ───────────────────────────────────────────

    def _evaluate(self, employee_id: int, category: str, filename: Optional[str] = None) -> None:
        """Check threshold and raise a nudge if needed."""
        thresholds = _thresholds()
        try:
            cat_enum = DocumentCategory(category)
        except ValueError:
            return

        # GENERAL is never nudged
        if cat_enum == DocumentCategory.GENERAL:
            return

        threshold = thresholds.get(cat_enum)
        if threshold is None:
            return

        since = datetime.now(tz=timezone.utc) - timedelta(days=settings.BEHAVIOR_WINDOW_DAYS)
        count = self.repo.count_access_in_window(employee_id, category, since)

        if count < threshold:
            return

        # If we already have an active nudge for this category, update its score and trigger_count
        existing = self.repo.get_active_nudge(employee_id, category)
        if existing:
            # Update score and trigger_count, but don't change status
            existing.score = count
            existing.trigger_count += 1
            existing.last_triggered_at = datetime.now(timezone.utc)
            if filename:
                existing.last_filename = filename
            self.db.commit()
            logger.info("Nudge updated: emp=%d category=%s count=%d filename=%s", employee_id, category, count, filename)
            return

        # No active nudge — attempt to create one (respects throttle)
        self._raise_nudge(employee_id, category, count, filename)

    def _raise_nudge(
        self,
        employee_id: int,
        category: str,
        count: int,
        filename: Optional[str],
    ) -> None:
        """
        Create a nudge if throttle allows and no active nudge exists.
        """
        # Throttle: check if there was a recent nudge for this category
        cooldown_days = settings.NUDGE_REPEAT_COOLDOWN_DAYS
        cooldown_since = datetime.now(timezone.utc) - timedelta(days=cooldown_days)
        if self.repo.recent_nudge_exists(employee_id, category, cooldown_since):
            logger.debug(
                "Nudge throttled: emp=%d category=%s (recent within %d days)",
                employee_id, category, cooldown_days,
            )
            return

        # Also check if there is an active nudge (redundant but safe)
        if self.repo.get_active_nudge(employee_id, category):
            return

        # Compose the nudge text
        nudge_text = compose_nudge(category, filename)
        if not nudge_text:
            # Should not happen if category is in playbook
            return

        # Create the nudge
        self.repo.create_nudge(
            employee_id=employee_id,
            category=category,
            score=count,
            window_days=settings.BEHAVIOR_WINDOW_DAYS,
            nudge_text=nudge_text,
            last_filename=filename,
        )
        logger.info("Nudge created: emp=%d category=%s count=%d filename=%s", employee_id, category, count, filename)

    # ── Public nudge methods for chat delivery ────────────────────────────────

    def get_pending_nudges(self, employee_id: int) -> List[dict]:
        """
        Return a list of pending nudges for the employee, with priority order.
        Each dict contains id, category, nudge_text.
        """
        alerts = self.repo.list_pending_nudges(employee_id)
        return [
            {
                "id": a.id,
                "category": a.category,
                "nudge_text": a.nudge_text,
            }
            for a in alerts
        ]

    def mark_nudge_delivered(self, nudge_id: int) -> None:
        """Mark a specific nudge as delivered."""
        nudge = self.repo.db.query(BehaviorAlert).filter(BehaviorAlert.id == nudge_id).first()
        if nudge:
            self.repo.mark_delivered(nudge)

    def dismiss_nudge(self, nudge_id: int, employee_id: int) -> bool:
        """
        Dismiss a nudge if it belongs to the employee.
        Returns True if successful.
        """
        nudge = self.repo.db.query(BehaviorAlert).filter(
            BehaviorAlert.id == nudge_id,
            BehaviorAlert.employee_id == employee_id,
        ).first()
        if nudge and nudge.status in (NudgeStatus.PENDING, NudgeStatus.DELIVERED):
            self.repo.mark_dismissed(nudge)
            return True
        return False

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