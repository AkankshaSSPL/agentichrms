"""Workflow models — ApprovalRequest, Meeting, OnboardingTask, SystemSetting, EmailLog."""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from backend.database.models.base import BaseModel
from backend.database.session import Base
from backend.enums import ApprovalStatus, EmailLogStatus


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    requested_by_employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    field_name = Column(String(100), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=False)
    status = Column(String(20), default=ApprovalStatus.PENDING)
    reason = Column(Text, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by_employee_id = Column(Integer, ForeignKey('employees.id'), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    employee = relationship("Employee", foreign_keys=[employee_id], back_populates="approval_requests")
    requested_by = relationship("Employee", foreign_keys=[requested_by_employee_id], back_populates="approval_requests_made")
    resolved_by = relationship("Employee", foreign_keys=[resolved_by_employee_id], back_populates="approval_requests_resolved")


class Meeting(BaseModel):
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    meeting_date = Column(DateTime, nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    organizer_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    attendees = Column(Text)


class OnboardingTask(BaseModel):
    __tablename__ = "onboarding_tasks"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    task_name = Column(String, nullable=False)
    description = Column(Text)
    is_completed = Column(Boolean, default=False)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)


class EmailLog(Base):
    """Tracks every system-sent email for admin audit."""
    __tablename__ = "email_logs"

    id = Column(Integer, primary_key=True, index=True)
    recipient = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=False)
    body_preview = Column(Text, nullable=True)
    status = Column(String(20), default=EmailLogStatus.SENT)
    error = Column(Text, nullable=True)
    sent_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    triggered_by = Column(String(100), nullable=True)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String(100), primary_key=True, index=True)
    value = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)