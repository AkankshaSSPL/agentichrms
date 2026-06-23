"""
backend/services/behaviour_analysis_service.py
───────────────────────────────────────────────
Admin-only, on-demand AI read of an employee's chat history (plus recent
document-view activity) to infer mood, personality, traits, and talking
points.

Privacy guardrails (enforced here):
  - Raw ChatMessage content is sent to the model in-memory only.
  - It is NEVER returned to the API caller and NEVER persisted —
    only the model's inferred summary fields are saved.
  - Document activity (filenames/categories/timestamps) is read live from the
    existing BehaviorRepository audit trail on every call — it is NOT stored
    on the BehaviourAnalysis snapshot, so it always reflects current state
    rather than being frozen at analysis time.
  - Every run records who triggered it (analyzed_by_employee_id) for audit.

Never raises to the caller for expected conditions (disabled / insufficient
data / LLM failure) — those return a status dict instead, so the admin UI
can show a clean message rather than a 500.
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from langchain_openai import ChatOpenAI
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.repositories.behaviour_analysis_repository import BehaviourAnalysisRepository
from backend.repositories.behavior_repository import BehaviorRepository

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are an organisational psychologist assistant helping HR \
understand an employee's general wellbeing signals from their assistant chat \
history. This is a private, internal signal intended to help a manager start \
a thoughtful human conversation — it is NOT a performance judgement, NOT \
evidence of wrongdoing, and must NOT be treated as fact.

Read the following employee <-> assistant conversation messages. You may also \
be given a short list of internal documents the employee has recently \
accessed (by category — e.g. exit-related, growth/promotion-related, leave \
policy, sensitive HR documents). Treat this as weak supporting context only: \
a single document open proves nothing on its own, but a pattern of activity \
across both the chat and the document list can support your inference. Never \
treat document access as direct evidence of intent.

Infer:
  - mood: the employee's general emotional tone (1-3 words, e.g. "Stressed", "Positive", "Neutral")
  - personality: a short paragraph describing communication style and apparent personality traits
  - traits: a list of 3-6 short trait words/phrases (e.g. "Detail-oriented", "Direct communicator")
  - attitude_trend: how their tone seems to be shifting over the conversation history, if at all (e.g. "Stable", "Improving", "Declining", "Unclear")
  - observations: 1-3 sentences of neutral, specific observations grounded in the text
  - suggested_talking_points: a list of 2-4 gentle, constructive conversation starters a manager could use
  - confidence: "low", "medium", or "high" — how confident you are given the volume/quality of data

Rules:
  - Do NOT fabricate or infer beyond what the text supports.
  - Do NOT diagnose any medical or mental health condition.
  - Be balanced and fair — avoid negative framing unless clearly supported.
  - Return ONLY valid JSON, no markdown fences, no commentary, with exactly these keys:
    {"mood": "...", "personality": "...", "traits": ["...", "..."], "attitude_trend": "...", "observations": "...", "suggested_talking_points": ["...", "..."], "confidence": "..."}
"""


def _build_transcript(messages: list[dict]) -> str:
    """Render messages as a simple role: content transcript for the prompt."""
    lines = []
    for m in messages:
        role = "Employee" if m["role"] == "user" else "Assistant"
        lines.append(f"{role}: {m['content']}")
    return "\n".join(lines)


def _build_document_activity_block(accesses: list) -> str:
    """
    Render recent document accesses as a short, clearly-labeled block for
    the LLM prompt. Returns "" if there's nothing to show, so callers can
    skip appending an empty section.
    """
    if not accesses:
        return ""
    lines = ["Recently accessed internal documents (most recent first):"]
    for a in accesses:
        when = a.accessed_at.strftime("%d %b %Y") if a.accessed_at else "unknown date"
        lines.append(f"- {a.filename} (category: {a.category}, via {a.access_source}) — {when}")
    return "\n".join(lines)


def _parse_llm_json(raw: str) -> Optional[dict]:
    """
    Tolerant JSON parse — strips markdown code fences if the model added them,
    falls back to None (caller handles the failure) rather than raising.
    """
    text = raw.strip()
    if text.startswith("```"):
        # Strip ```json ... ``` or ``` ... ``` fences
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        logger.warning("Could not parse LLM JSON response: %s", raw[:200])
        return None


def _humanize(value: Optional[str]) -> str:
    """Title-case and trim a raw label for display (e.g. 'low' -> 'Low')."""
    if not value:
        return ""
    return value.strip().title()


class BehaviourAnalysisService:

    def __init__(self, db: Session):
        self.db = db
        self.repo = BehaviourAnalysisRepository(db)
        self.behavior_repo = BehaviorRepository(db)

    # ── Public entry point ─────────────────────────────────────────────────────

    def analyze(self, employee_id: int, admin_id: int) -> dict:
        """
        Run a fresh AI analysis of the employee's chat history (plus recent
        document-view activity, factored in as weak supporting context).
        Always returns a dict with a "status" key the frontend can branch on:
          "ok"                — analysis succeeded, full result included
          "disabled"          — feature flag off
          "insufficient_data" — not enough messages to analyze
          "error"             — LLM call or parsing failed
        """
        if not settings.BEHAVIOUR_ANALYSIS_ENABLED:
            return {"status": "disabled"}

        try:
            messages = self.repo.get_employee_messages(
                employee_id, settings.BEHAVIOUR_ANALYSIS_MESSAGE_LIMIT
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("Failed to fetch chat history for employee %d: %s", employee_id, e)
            return {"status": "error", "detail": "Could not fetch chat history."}

        if len(messages) < settings.BEHAVIOUR_ANALYSIS_MIN_MESSAGES:
            return {
                "status": "insufficient_data",
                "message_count": len(messages),
                "min_required": settings.BEHAVIOUR_ANALYSIS_MIN_MESSAGES,
            }

        transcript = _build_transcript(messages)

        # ── Document activity (non-fatal — analysis still works without it) ──
        doc_activity_block = ""
        try:
            since = datetime.now(timezone.utc) - timedelta(
                days=settings.BEHAVIOUR_ANALYSIS_DOC_WINDOW_DAYS
            )
            accesses = self.behavior_repo.list_recent_accesses(employee_id, since, limit=20)
            doc_activity_block = _build_document_activity_block(accesses)
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "Could not fetch document activity for employee %d: %s", employee_id, e
            )

        full_input = transcript
        if doc_activity_block:
            full_input = f"{transcript}\n\n{doc_activity_block}"

        try:
            llm = ChatOpenAI(
                model=settings.AI_MODEL,
                api_key=settings.OPENAI_API_KEY,
                temperature=0.3,
            )
            response = llm.invoke([
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": full_input},
            ])
            raw_text = response.content if hasattr(response, "content") else str(response)
        except Exception as e:  # noqa: BLE001
            logger.exception("LLM call failed for behaviour analysis (employee %d): %s", employee_id, e)
            return {"status": "error", "detail": "AI analysis failed. Please try again."}

        parsed = _parse_llm_json(raw_text)
        if not parsed:
            return {"status": "error", "detail": "Could not parse AI response. Please try again."}

        # Persist only the inferred summary — never raw messages, never document content
        traits_list = parsed.get("traits", [])
        talking_points_list = parsed.get("suggested_talking_points", [])

        try:
            snapshot = self.repo.save_analysis(
                employee_id=employee_id,
                analyzed_by_employee_id=admin_id,
                mood=parsed.get("mood"),
                personality=parsed.get("personality"),
                traits=json.dumps(traits_list) if isinstance(traits_list, list) else None,
                attitude_trend=parsed.get("attitude_trend"),
                observations=parsed.get("observations"),
                suggested_talking_points=(
                    json.dumps(talking_points_list) if isinstance(talking_points_list, list) else None
                ),
                confidence=parsed.get("confidence"),
                message_count=len(messages),
                model=settings.AI_MODEL,
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("Failed to save behaviour analysis snapshot: %s", e)
            return {"status": "error", "detail": "Analysis succeeded but could not be saved."}

        result = self._serialize(snapshot, status="ok")
        result["recent_document_activity"] = self._get_recent_document_activity(employee_id)
        return result

    # ── Read endpoints ──────────────────────────────────────────────────────────

    def get_detail(self, employee_id: int) -> Optional[dict]:
        """Return the latest stored snapshot for an employee, or None."""
        snapshot = self.repo.get_latest(employee_id)
        if not snapshot:
            return None
        result = self._serialize(snapshot, status="ok")
        result["recent_document_activity"] = self._get_recent_document_activity(employee_id)
        return result

    def get_dashboard(self) -> list[dict]:
        """Return the latest snapshot per employee, for the overview list."""
        rows = self.repo.list_latest_per_employee()
        result = []
        for snapshot, emp in rows:
            result.append({
                "employee_id": emp.id,
                "employee_name": emp.name,
                "employee_email": emp.email,
                "mood": snapshot.mood,
                "attitude_trend": snapshot.attitude_trend,
                "confidence": snapshot.confidence,
                "analyzed_at": snapshot.created_at.isoformat() if snapshot.created_at else None,
            })
        return result

    def get_history(self, employee_id: int, limit: int = 10) -> list[dict]:
        """Return this employee's past snapshots, oldest-first, for a trend line."""
        rows = self.repo.get_history(employee_id, limit)
        return [
            {
                "mood": s.mood,
                "attitude_trend": s.attitude_trend,
                "confidence": s.confidence,
                "analyzed_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in rows
        ]

    def get_overview(self) -> dict:
        """
        Org-wide aggregate across the latest snapshot per employee — for
        dashboard charts. Counts moods/confidence/trend buckets and surfaces
        the most common traits. All labels are humanized for display.
        """
        rows = self.repo.list_latest_per_employee()

        mood_counts: dict[str, int] = {}
        confidence_counts: dict[str, int] = {}
        trend_counts: dict[str, int] = {}
        trait_counts: dict[str, int] = {}

        for snapshot, _emp in rows:
            mood = _humanize(snapshot.mood) or "Unknown"
            mood_counts[mood] = mood_counts.get(mood, 0) + 1

            confidence = _humanize(snapshot.confidence) or "Unknown"
            confidence_counts[confidence] = confidence_counts.get(confidence, 0) + 1

            trend = _humanize(snapshot.attitude_trend) or "Unknown"
            trend_counts[trend] = trend_counts.get(trend, 0) + 1

            for t in self._safe_json_list(snapshot.traits):
                t_clean = _humanize(t)
                if t_clean:
                    trait_counts[t_clean] = trait_counts.get(t_clean, 0) + 1

        top_traits = sorted(trait_counts.items(), key=lambda kv: kv[1], reverse=True)[:10]

        return {
            "total_analyzed": len(rows),
            "mood_breakdown": [
                {"label": k, "count": v}
                for k, v in sorted(mood_counts.items(), key=lambda kv: kv[1], reverse=True)
            ],
            "confidence_breakdown": [
                {"label": k, "count": v}
                for k, v in sorted(confidence_counts.items(), key=lambda kv: kv[1], reverse=True)
            ],
            "trend_breakdown": [
                {"label": k, "count": v}
                for k, v in sorted(trend_counts.items(), key=lambda kv: kv[1], reverse=True)
            ],
            "top_traits": [{"label": k, "count": v} for k, v in top_traits],
        }

    # ── Document activity (live, never persisted on the snapshot) ──────────────

    def _get_recent_document_activity(self, employee_id: int) -> list[dict]:
        """
        Live read of this employee's recent document access log — computed
        fresh on every call rather than frozen at analysis time, so the admin
        always sees current activity even when viewing an older snapshot.
        """
        try:
            since = datetime.now(timezone.utc) - timedelta(
                days=settings.BEHAVIOUR_ANALYSIS_DOC_WINDOW_DAYS
            )
            accesses = self.behavior_repo.list_recent_accesses(employee_id, since, limit=20)
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "Could not fetch document activity for employee %d: %s", employee_id, e
            )
            return []

        return [
            {
                "filename": a.filename,
                "category": a.category,
                "access_source": a.access_source,
                "accessed_at": a.accessed_at.isoformat() if a.accessed_at else None,
            }
            for a in accesses
        ]

    # ── Serialization ──────────────────────────────────────────────────────────

    def _serialize(self, snapshot, status: str) -> dict:
        return {
            "status": status,
            "id": snapshot.id,
            "employee_id": snapshot.employee_id,
            "analyzed_by_employee_id": snapshot.analyzed_by_employee_id,
            "mood": snapshot.mood,
            "personality": snapshot.personality,
            "traits": self._safe_json_list(snapshot.traits),
            "attitude_trend": snapshot.attitude_trend,
            "observations": snapshot.observations,
            "suggested_talking_points": self._safe_json_list(snapshot.suggested_talking_points),
            "confidence": snapshot.confidence,
            "message_count": snapshot.message_count,
            "model": snapshot.model,
            "analyzed_at": snapshot.created_at.isoformat() if snapshot.created_at else None,
        }

    @staticmethod
    def _safe_json_list(raw: Optional[str]) -> list:
        if not raw:
            return []
        try:
            val = json.loads(raw)
            return val if isinstance(val, list) else []
        except (json.JSONDecodeError, ValueError):
            return []