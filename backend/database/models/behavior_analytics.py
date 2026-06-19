"""
Behavioral analytics models — document tagging, access audit log, and private nudges.

Three tables:
  document_tags         — admin-taggable filename → category map
  document_access_logs  — append-only audit of every tagged doc access (chat or viewer)
  behavior_alerts       — now a private nudge ledger (one active nudge per employee+category)

Changes vs 002_add_behavioral_analytics:
  DocumentAccessLog gains access_source String(20) server_default="chat"
  so existing chat rows are automatically backfilled — no data loss.

Changes vs 003_add_access_source:
  BehaviorAlert gains last_filename String, nullable — records the most
  recently accessed document that contributed to this alert's category,
  so HR can see *which* document triggered the signal, not just the category.

Changes vs 004 (Part B):
  - status now uses NudgeStatus (PENDING, DELIVERED, DISMISSED) instead of OPEN/RESOLVED.
  - added delivered_at, dismissed_at, nudge_text.
  - old resolved_at / resolved_by / hr_note remain (unused, but kept for downgrade safety).
"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship

from backend.database.models.base import BaseModel
from backend.enums import BehaviorAlertStatus, DocumentCategory, AccessSource, NudgeStatus


class DocumentTag(BaseModel):
    """Admin-managed map of document filename → category."""
    __tablename__ = "document_tags"

    id       = Column(Integer, primary_key=True, index=True)
    filename = Column(String, unique=True, index=True, nullable=False)
    category = Column(String(30), nullable=False, default=DocumentCategory.GENERAL)


class DocumentAccessLog(BaseModel):
    """
    Append-only audit log of every tagged document access.
    Never soft-deleted or updated — permanent audit trail.

    access_source distinguishes how the document was reached:
      "chat"   — surfaced as a RAG source in an AI chat response
      "viewer" — employee explicitly opened it in the Document Library
    """
    __tablename__ = "document_access_logs"

    id              = Column(Integer, primary_key=True, index=True)
    employee_id     = Column(Integer, ForeignKey("employees.id"), index=True, nullable=False)
    filename        = Column(String, nullable=False)
    category        = Column(String(30), nullable=False)
    chat_session_id = Column(Integer, nullable=True)
    access_source   = Column(
        String(20),
        nullable=False,
        server_default=AccessSource.CHAT,   # backfills all existing chat rows
    )
    accessed_at     = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
        nullable=False,
    )

    __table_args__ = (
        Index(
            "ix_access_logs_employee_category_time",
            "employee_id", "category", "accessed_at",
        ),
    )


class BehaviorAlert(BaseModel):
    """
    Private nudge ledger — one active nudge per (employee, category) at a time.
    Statuses:
      PENDING   - detected, not yet delivered to employee's chat
      DELIVERED - shown in chat (once)
      DISMISSED - employee dismissed or acted upon
    """
    __tablename__ = "behavior_alerts"

    id                      = Column(Integer, primary_key=True, index=True)
    employee_id             = Column(Integer, ForeignKey("employees.id"), index=True, nullable=False)
    category                = Column(String(30), nullable=False)
    last_filename           = Column(String, nullable=True)

    # Nudge ledger fields
    status                  = Column(
        String(20),
        default=NudgeStatus.PENDING,
        index=True,
        nullable=False,
    )
    score                   = Column(Integer, nullable=False)               # count that triggered
    trigger_count           = Column(Integer, default=1, nullable=False)   # number of times threshold was crossed
    window_days             = Column(Integer, nullable=False)              # window used for detection
    first_triggered_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_triggered_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Nudge-specific timestamps
    delivered_at            = Column(DateTime(timezone=True), nullable=True)
    dismissed_at            = Column(DateTime(timezone=True), nullable=True)
    nudge_text              = Column(Text, nullable=True)                  # the composed opener shown to employee

    # Legacy fields (kept for downgrade safety, unused)
    resolved_at             = Column(DateTime(timezone=True), nullable=True)
    resolved_by_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    hr_note                 = Column(Text, nullable=True)

    employee    = relationship("Employee", foreign_keys=[employee_id])
    resolved_by = relationship("Employee", foreign_keys=[resolved_by_employee_id])