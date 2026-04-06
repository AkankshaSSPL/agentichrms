"""
Database Models for Agentic HRMS
Extended with Face Recognition + PIN Verification Support
"""

from sqlalchemy import Column, Integer, String, DateTime, func, Boolean, ForeignKey, Text, Float, LargeBinary
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
    
    # 🆕 Face Recognition Fields
    username = Column(String(100), unique=True, nullable=True, index=True)  # Maps to face classifier
    face_embedding = Column(LargeBinary, nullable=True)  # Serialized 128-D numpy array
    face_registered = Column(Boolean, default=False)
    face_enrollment_date = Column(DateTime, nullable=True)
    
    # 🆕 Phone Verification Fields (for PIN)
    phone_verified = Column(Boolean, default=False)
    phone_verified_at = Column(DateTime, nullable=True)
    phone_country_code = Column(String(5), default='+1')
    
    # Relationships
    manager = relationship("Employee", remote_side=[id], backref="subordinates")
    user = relationship("User", back_populates="employee", uselist=False)
    leave_balances = relationship("LeaveBalance", back_populates="employee")
    leaves = relationship("Leave", back_populates="employee")
    onboarding_tasks = relationship("EmployeeOnboarding", back_populates="employee")
    face_login_attempts = relationship("FaceLoginAttempt", back_populates="employee")
    pin_verifications = relationship("PINVerification", back_populates="employee")


class User(BaseModel):
    """Authentication & App Access"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    face_registered = Column(Boolean, default=False)  # Triggers Twilio OTP onboarding flow
    is_active = Column(Boolean, default=True)
    
    # Relationships
    employee = relationship("Employee", back_populates="user")
    chat_sessions = relationship("ChatSession", back_populates="user")


class LeaveBalance(BaseModel):
    """Leave balances for employees"""
    __tablename__ = "leave_balances"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    leave_type = Column(String, nullable=False)
    days_remaining = Column(Integer, nullable=False)
    
    # Relationships
    employee = relationship("Employee", back_populates="leave_balances")


class Leave(BaseModel):
    """Leave applications"""
    __tablename__ = "leaves"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    leave_type = Column(String, nullable=False)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    status = Column(String, default='Pending')  # Pending, Approved, Rejected
    reason = Column(Text)
    rejection_reason = Column(Text, nullable=True)
    
    # Relationships
    employee = relationship("Employee", back_populates="leaves")


class OnboardingTask(BaseModel):
    """Master checklist catalog for onboarding"""
    __tablename__ = "onboarding_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_name = Column(String, nullable=False)
    category = Column(String)
    description = Column(Text)
    is_mandatory = Column(Boolean, default=True)
    
    # Relationships
    employee_tasks = relationship("EmployeeOnboarding", back_populates="task")


class EmployeeOnboarding(BaseModel):
    """Individual employee onboarding progress"""
    __tablename__ = "employee_onboarding"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    task_id = Column(Integer, ForeignKey('onboarding_tasks.id'), nullable=False)
    status = Column(String, default='Pending')  # Pending, Completed
    completed_at = Column(DateTime, nullable=True)
    
    # Relationships
    employee = relationship("Employee", back_populates="onboarding_tasks")
    task = relationship("OnboardingTask", back_populates="employee_tasks")


class Meeting(BaseModel):
    """Meetings for conflict checking"""
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    meeting_date = Column(DateTime, nullable=False)
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    organizer_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    attendees = Column(Text)  # JSON array of employee_ids


class ChatSession(BaseModel):
    """Groups LangGraph state by conversation"""
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    title = Column(String)
    
    # Relationships
    user = relationship("User", back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session")


class ChatMessage(BaseModel):
    """Persistent state for LangGraph Agent"""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey('chat_sessions.id'), nullable=False)
    role = Column(String, nullable=False)  # 'user', 'assistant', 'tool'
    content = Column(Text)
    tool_calls = Column(Text)  # JSONB in PostgreSQL
    
    # Relationships
    session = relationship("ChatSession", back_populates="messages")


class AuditLog(BaseModel):
    """Universal audit logging"""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    table_name = Column(String, nullable=False)
    record_id = Column(String, nullable=False)
    action = Column(String, nullable=False)  # INSERT, UPDATE, SOFT_DELETE, HARD_DELETE
    old_data = Column(Text)  # JSONB
    new_data = Column(Text)  # JSONB
    changed_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    # No updated_at - immutable


# 🆕 FACE RECOGNITION TABLES

class FaceLoginAttempt(BaseModel):
    """Track all face login attempts for security and analytics"""
    __tablename__ = "face_login_attempts"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=True)
    attempt_time = Column(DateTime, default=datetime.utcnow)
    success = Column(Boolean, nullable=False)
    confidence_score = Column(Float, nullable=True)
    ip_address = Column(String(45), nullable=True)  # IPv6 support
    user_agent = Column(Text, nullable=True)
    failure_reason = Column(String(255), nullable=True)
    
    # Relationships
    employee = relationship("Employee", back_populates="face_login_attempts")


class PINVerification(BaseModel):
    """Temporary PIN storage for SMS verification"""
    __tablename__ = "pin_verifications"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    pin_code = Column(String(6), nullable=False)
    phone_number = Column(String(20), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    verified = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)
    max_attempts = Column(Integer, default=3)
    
    # Relationships
    employee = relationship("Employee", back_populates="pin_verifications")
    
    @property
    def is_expired(self):
        """Check if PIN has expired"""
        return datetime.utcnow() > self.expires_at
    
    @property
    def is_valid(self):
        """Check if PIN is still valid for verification"""
        return (
            not self.verified and 
            not self.is_expired and 
            self.attempts < self.max_attempts
        )