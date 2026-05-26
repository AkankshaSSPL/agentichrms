"""
Database Models for Agentic HRMS
Extended with Face Recognition + PIN Verification Support
Normalised RBAC with roles, permissions, role_permissions
"""

from sqlalchemy import Column, Integer, String, DateTime, func, Boolean, ForeignKey, Text, Date, Float, LargeBinary
from sqlalchemy.orm import relationship
from backend.database.session import Base
from datetime import datetime


class BaseModel(Base):
    """Abstract base model with audit timestamps and soft deletes"""
    __abstract__ = True

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


# ──────────────────────────────────────────────────────────────────────────────
# RBAC Tables
# ──────────────────────────────────────────────────────────────────────────────
class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class Permission(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id = Column(Integer, ForeignKey('roles.id', ondelete='CASCADE'), primary_key=True)
    permission_id = Column(Integer, ForeignKey('permissions.id', ondelete='CASCADE'), primary_key=True)


# ──────────────────────────────────────────────────────────────────────────────
# Main Employee Model (now uses role_id foreign key)
# ──────────────────────────────────────────────────────────────────────────────
class Employee(BaseModel):
    """Employee master data - source of truth for HR data"""
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    phone = Column(String, unique=True)
    department = Column(String)
    designation = Column(String)
    manager_id = Column(Integer, ForeignKey('employees.id'), nullable=True)
    join_date = Column(DateTime)
    status = Column(String, default='active')
    employee_code = Column(String, unique=True, nullable=True)

    # PIN and Face columns
    permanent_pin = Column(String(128), nullable=True)
    permanent_pin_hash = Column(String(128), nullable=True)
    pin_type = Column(String(20), default='default')
    pin_set_at = Column(DateTime, nullable=True)

    face_enrolled = Column(Boolean, default=False)
    face_embedding = Column(LargeBinary, nullable=True)
    face_registered = Column(Boolean, default=False)
    face_enrollment_date = Column(DateTime, nullable=True)
    face_samples_count = Column(Integer, default=0)

    # Contact & verification
    phone_country_code = Column(String(10), nullable=True)
    email_verified = Column(Boolean, default=False)
    phone_verified = Column(Boolean, default=False)
    onboarding_completed = Column(Boolean, default=False)
    profile_completed = Column(Boolean, default=False)

    # ── Extended profile fields ──
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(20), nullable=True)
    employment_type = Column(String(50), nullable=True)   # Full-time, Part-time, Contract

    # Address
    address_line1 = Column(String(255), nullable=True)
    address_line2 = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    country = Column(String(100), nullable=True)

    # Emergency contact
    emergency_contact_name = Column(String(100), nullable=True)
    emergency_contact_phone = Column(String(30), nullable=True)
    emergency_contact_relation = Column(String(50), nullable=True)

    # Banking
    bank_name = Column(String(100), nullable=True)
    bank_account_number = Column(String(50), nullable=True)
    bank_branch = Column(String(100), nullable=True)
    base_salary = Column(Float, nullable=True)

    # ── Foreign key to Role (replaces old role string) ──
    role_id = Column(Integer, ForeignKey('roles.id'), nullable=False)

    # ── Relationships ──
    role = relationship("Role")   # access employee.role.name
    face_login_attempts = relationship("FaceLoginAttempt", back_populates="employee")
    pin_verifications = relationship("PINVerification", back_populates="employee")
    leaves = relationship("Leave", back_populates="employee")
    balances = relationship("LeaveBalance", back_populates="employee")
    notifications = relationship("Notification", back_populates="employee", cascade="all, delete-orphan")


# ── All other models (Leave, LeaveBalance, User, ChatSession, etc.) remain unchanged ──
# They are exactly as you had them – no changes needed to those tables.
# I include them below for completeness, but you can keep your existing versions.

class Leave(BaseModel):
    __tablename__ = "leaves"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    leave_type = Column(String, nullable=False)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    status = Column(String, default='Pending')
    reason = Column(Text)
    rejection_reason = Column(Text, nullable=True)
    employee = relationship("Employee", back_populates="leaves")


class LeaveBalance(BaseModel):
    __tablename__ = "leave_balances"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    leave_type = Column(String, nullable=False)
    allocated = Column(Float, nullable=False)
    used = Column(Float, default=0.0)
    employee = relationship("Employee", back_populates="balances")


class User(BaseModel):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default='employee')
    is_active = Column(Boolean, default=True)

    # Add these three lines ↓↓↓
    is_verified = Column(Boolean, default=False)
    face_registered = Column(Boolean, default=False)
    face_login_enabled = Column(Boolean, default=False)

    chat_sessions = relationship("ChatSession", back_populates="user")


class ChatSession(BaseModel):
    __tablename__ = "chat_sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    session_title = Column(String, default='New Chat')
    is_active = Column(Boolean, default=True)
    is_pinned = Column(Boolean, default=False)
    user = relationship("User", back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")


class ChatMessage(BaseModel):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey('chat_sessions.id'), nullable=False)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    session = relationship("ChatSession", back_populates="messages")


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


class FaceLoginAttempt(BaseModel):
    __tablename__ = "face_login_attempts"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=True)
    attempt_time = Column(DateTime, default=datetime.utcnow)
    success = Column(Boolean, nullable=False)
    confidence_score = Column(Float, nullable=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    failure_reason = Column(String(255), nullable=True)
    employee = relationship("Employee", back_populates="face_login_attempts")


class PINVerification(BaseModel):
    __tablename__ = "pin_verifications"
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    pin_code = Column(String(6), nullable=False)
    phone_number = Column(String(20), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    verified = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)
    max_attempts = Column(Integer, default=3)
    pin_type = Column(String(20), default='login')
    employee = relationship("Employee", back_populates="pin_verifications")


class EmailLog(Base):
    """Tracks every system-sent email for admin audit"""
    __tablename__ = "email_logs"

    id = Column(Integer, primary_key=True, index=True)
    recipient = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=False)
    body_preview = Column(Text, nullable=True)       # first 300 chars of body
    status = Column(String(20), default="sent")       # "sent" | "failed"
    error = Column(Text, nullable=True)               # error message if failed
    sent_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    triggered_by = Column(String(100), nullable=True) # "leave_approve" | "role_change" | "test" etc.


class NameChangeRequest(BaseModel):
    """Employee name change requests with optional document upload"""
    __tablename__ = "name_change_requests"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id', ondelete="CASCADE"), nullable=False)
    old_name = Column(String(255), nullable=False)
    new_name = Column(String(255), nullable=False)
    reason = Column(Text, nullable=True)                     # e.g. "Got married"
    status = Column(String(30), default="pending")           # pending | approved | rejected | awaiting_document
    document_provided = Column(Boolean, default=False)
    document_path = Column(String(500), nullable=True)
    document_filename = Column(String(255), nullable=True)
    rejection_reason = Column(Text, nullable=True)
    reviewed_by = Column(Integer, ForeignKey('employees.id'), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    employee = relationship("Employee", foreign_keys=[employee_id])
    reviewer = relationship("Employee", foreign_keys=[reviewed_by])


class Notification(BaseModel):
    __tablename__ = "notifications"
    __table_args__ = {'extend_existing': True}
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id', ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    employee = relationship("Employee", back_populates="notifications")