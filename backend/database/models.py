"""
Database Models for Agentic HRMS
Extended with Face Recognition + PIN Verification Support
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
    date_of_birth = Column(DateTime, nullable=True)
    onboarding_completed = Column(Boolean, default=False)
    profile_completed = Column(Boolean, default=False)

    email_verified = Column(Boolean, default=False)
    email_verified_at = Column(DateTime, nullable=True)

    phone_verified = Column(Boolean, default=False)
    phone_verified_at = Column(DateTime, nullable=True)
    phone_country_code = Column(String(5), default='+91')

    username = Column(String(100), unique=True, nullable=True, index=True)
    face_embedding = Column(LargeBinary, nullable=True)
    face_registered = Column(Boolean, default=False)
    face_enrollment_date = Column(DateTime, nullable=True)

    permanent_pin_hash = Column(String(255), nullable=True)
    pin_type = Column(String(20), default='default')
    pin_set_at = Column(DateTime, nullable=True)
    face_samples_count = Column(Integer, default=0)

    manager = relationship("Employee", remote_side=[id], backref="subordinates")
    user = relationship("User", back_populates="employee", uselist=False)
    leave_balances = relationship("LeaveBalance", back_populates="employee")
    leaves = relationship("Leave", back_populates="employee")
    face_login_attempts = relationship("FaceLoginAttempt", back_populates="employee")
    pin_verifications = relationship("PINVerification", back_populates="employee")
    onboarding_tasks = relationship("OnboardingTask", back_populates="employee")


class User(BaseModel):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)

    is_verified = Column(Boolean, default=False)
    is_approved = Column(Boolean, default=True)

    face_registered = Column(Boolean, default=False)
    face_login_enabled = Column(Boolean, default=False)

    two_factor_enabled = Column(Boolean, default=False)

    last_login = Column(DateTime, nullable=True)
    last_login_ip = Column(String(45), nullable=True)
    failed_login_attempts = Column(Integer, default=0)
    account_locked = Column(Boolean, default=False)
    locked_until = Column(DateTime, nullable=True)
    preferred_login_method = Column(String(20), default='password')

    employee = relationship("Employee", back_populates="user")
    chat_sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")


class RegistrationToken(BaseModel):
    __tablename__ = "registration_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    token = Column(String(255), unique=True, nullable=False, index=True)
    token_type = Column(String(50), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    used_at = Column(DateTime, nullable=True)


class LeaveBalance(BaseModel):
    __tablename__ = "leave_balances"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    leave_type = Column(String, nullable=False)
    days_remaining = Column(Integer, nullable=False)

    employee = relationship("Employee", back_populates="leave_balances")


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


class OnboardingTask(BaseModel):
    __tablename__ = "onboarding_tasks"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    task_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    is_completed = Column(Boolean, default=False)
    due_date = Column(Date, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    employee = relationship("Employee", back_populates="onboarding_tasks")


class Meeting(BaseModel):
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    meeting_date = Column(DateTime, nullable=False)
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    organizer_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    attendees = Column(Text)


class ChatSession(BaseModel):
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    title = Column(String)
    is_pinned = Column(Boolean, default=False)   # ✅ Added for pinning

    user = relationship("User", back_populates="chat_sessions")
    messages = relationship(
        "ChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",   # ✅ When session is deleted, delete its messages
        passive_deletes=True            # ✅ Rely on database cascade
    )


class ChatMessage(BaseModel):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(
        Integer,
        ForeignKey('chat_sessions.id', ondelete="CASCADE"),  # ✅ Database-level cascade
        nullable=False
    )
    role = Column(String, nullable=False)
    content = Column(Text)
    tool_calls = Column(Text)

    session = relationship("ChatSession", back_populates="messages")


class AuditLog(BaseModel):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    table_name = Column(String, nullable=False)
    record_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    old_data = Column(Text)
    new_data = Column(Text)
    changed_by = Column(Integer, ForeignKey('users.id'), nullable=True)


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

    @property
    def is_expired(self):
        return datetime.utcnow() > self.expires_at

    @property
    def is_valid(self):
        return (
            not self.verified and
            not self.is_expired and
            self.attempts < self.max_attempts
        )