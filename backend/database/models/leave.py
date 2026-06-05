"""Leave models — Leave, LeaveBalance."""

from sqlalchemy import Column, Integer, String, DateTime, Float, Text, ForeignKey
from sqlalchemy.orm import relationship
from backend.database.models.base import BaseModel
from backend.enums import LeaveStatus


class Leave(BaseModel):
    __tablename__ = "leaves"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    leave_type = Column(String, nullable=False)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    status = Column(String, default=LeaveStatus.PENDING)
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