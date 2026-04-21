from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class EmployeeResponse(BaseModel):
    id: int
    name: str
    email: str
    department: Optional[str] = None
    designation: Optional[str] = None

class LeaveBalanceResponse(BaseModel):
    leave_type: str
    days_remaining: int

class OnboardingTaskResponse(BaseModel):
    id: int
    task_name: str
    description: Optional[str]
    is_completed: bool
    due_date: Optional[datetime] = None
    completed_at: Optional[datetime] = None