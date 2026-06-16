"""
Behavioral analytics models — document tagging, access audit log, and HR alerts.

Three tables:
  document_tags         — admin-taggable filename → category map
  document_access_logs  — append-only audit of every tagged doc access via chat
  behavior_alerts       — deduped HR alerts raised when windowed access crosses threshold
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
from backend.enums import BehaviorAlertStatus, DocumentCategory


class DocumentTag(BaseModel):
    """Admin-managed map of document filename → category."""
    __tablename__ = "document_tags"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, unique=True, index=True, nullable=False)
    category = Column(String(30), nullable=False, default=DocumentCategory.GENERAL)


class DocumentAccessLog(BaseModel):
    """
    Append-only audit log of every tagged document surfaced in a chat response.
    Never soft-deleted or updated — permanent audit trail.
    """
    __tablename__ = "document_access_logs"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), index=True, nullable=False)
    filename = Column(String, nullable=False)
    category = Column(String(30), nullable=False)
    chat_session_id = Column(Integer, nullable=True)
    accessed_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
        nullable=False,
    )

    __table_args__ = (
        Index("ix_access_logs_employee_category_time", "employee_id", "category", "accessed_at"),
    )


class BehaviorAlert(BaseModel):
    """Deduped HR alert — one open alert per (employee, category) at a time."""
    __tablename__ = "behavior_alerts"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), index=True, nullable=False)
    category = Column(String(30), nullable=False)
    status = Column(String(20), default=BehaviorAlertStatus.OPEN, index=True, nullable=False)
    score = Column(Integer, nullable=False)
    trigger_count = Column(Integer, default=1, nullable=False)
    window_days = Column(Integer, nullable=False)
    first_triggered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_triggered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    hr_note = Column(Text, nullable=True)

    # Relationships
    employee = relationship("Employee", foreign_keys=[employee_id])
    resolved_by = relationship("Employee", foreign_keys=[resolved_by_employee_id])