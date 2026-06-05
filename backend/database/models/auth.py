"""Auth models — FaceLoginAttempt, PINVerification."""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, Float, Text, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.database.models.base import BaseModel
from backend.enums import PinType


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
    pin_hash = Column(String(128), nullable=False)  # bcrypt hash — never store plaintext
    phone_number = Column(String(20), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    verified = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)
    max_attempts = Column(Integer, default=3)
    pin_type = Column(String(20), default=PinType.LOGIN)
    employee = relationship("Employee", back_populates="pin_verifications")