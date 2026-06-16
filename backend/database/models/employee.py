"""Employee model — master HR data, face recognition, PIN, profile fields."""

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
)
from sqlalchemy.orm import relationship

from backend.database.models.base import BaseModel
from backend.enums import EmployeeStatus, PinType


class Employee(BaseModel):
    """Employee master data — source of truth for HR data."""
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    phone = Column(String, unique=True)
    department = Column(String)
    designation = Column(String)
    manager_id = Column(Integer, ForeignKey('employees.id'), nullable=True)
    join_date = Column(DateTime)
    status = Column(String, default=EmployeeStatus.ACTIVE)
    employee_code = Column(String, unique=True, nullable=True)

    # PIN — never store plaintext
    permanent_pin_hash = Column(String(128), nullable=True)
    pin_type = Column(String(20), default=PinType.DEFAULT)
    pin_set_at = Column(DateTime, nullable=True)

    # Face recognition
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

    # Extended profile
    date_of_birth = Column(Date, nullable=True)
    gender = Column(String(20), nullable=True)
    employment_type = Column(String(50), nullable=True)

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

    # RBAC
    role_id = Column(Integer, ForeignKey('roles.id'), nullable=False)
    role = relationship("Role")

    # Relationships
    face_login_attempts = relationship("FaceLoginAttempt", back_populates="employee")
    pin_verifications = relationship("PINVerification", back_populates="employee")
    leaves = relationship("Leave", back_populates="employee")
    balances = relationship("LeaveBalance", back_populates="employee")
    notifications = relationship("Notification", back_populates="employee", cascade="all, delete-orphan")
    approval_requests = relationship("ApprovalRequest", foreign_keys="ApprovalRequest.employee_id", back_populates="employee")
    approval_requests_made = relationship("ApprovalRequest", foreign_keys="ApprovalRequest.requested_by_employee_id", back_populates="requested_by")
    approval_requests_resolved = relationship("ApprovalRequest", foreign_keys="ApprovalRequest.resolved_by_employee_id", back_populates="resolved_by")