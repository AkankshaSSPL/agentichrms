"""
Onboarding API Routes
- GET    /api/onboarding/{employee_id}/checklist
- POST   /api/onboarding/{employee_id}/task/{task_id}/complete
- GET    /api/onboarding/{employee_id}/progress
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from backend.core.security import verify_token
from backend.database.models import Employee, OnboardingTask
from backend.database.session import get_db
from backend.enums import RoleName

router = APIRouter(prefix="/onboarding", tags=["Onboarding"])



def _require_self_or_hr(employee_id: int, request: Request, db: Session) -> None:
    """Allow access only if caller is the employee themselves or an HR/Admin user."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    payload = verify_token(auth.split(" ", 1)[1])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    caller_id = int(payload.get("sub", 0))
    # Allow if accessing own data
    if caller_id == employee_id:
        return
    # Allow if HR or Admin — read role fresh from DB
    caller = db.query(Employee).filter(Employee.id == caller_id).first()
    if not caller:
        raise HTTPException(status_code=401, detail="Caller not found")
    role = caller.role.name if caller.role else None
    if role not in (RoleName.HR, RoleName.ADMIN):
        raise HTTPException(status_code=403, detail="Access denied: you can only view your own onboarding data.")

@router.get("/{employee_id}/checklist")
def get_checklist(employee_id: int, request: Request, db: Session = Depends(get_db)):
    """Get all onboarding tasks for an employee."""
    _require_self_or_hr(employee_id, request, db)
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    tasks = db.query(OnboardingTask).filter(OnboardingTask.employee_id == employee_id).all()
    checklist = [
        {
            "id": task.id,
            "task_name": task.task_name,
            "description": task.description,
            "is_completed": task.is_completed,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        }
        for task in tasks
    ]
    return {
        "employee_id": employee_id,
        "employee_name": employee.name,
        "checklist": checklist,
        "total_tasks": len(checklist)
    }

@router.post("/{employee_id}/task/{task_id}/complete")
def complete_task(employee_id: int, task_id: int, request: Request, db: Session = Depends(get_db)):
    """Mark a task as completed."""
    _require_self_or_hr(employee_id, request, db)
    task = db.query(OnboardingTask).filter(
        OnboardingTask.id == task_id,
        OnboardingTask.employee_id == employee_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found for this employee")

    if task.is_completed:
        return {
            "message": "Task already completed",
            "task_id": task_id,
            "already_completed": True,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None
        }

    task.is_completed = True
    task.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(task)

    return {
        "message": "Task marked complete",
        "task_id": task_id,
        "completed_at": task.completed_at.isoformat(),
        "task": {
            "id": task.id,
            "task_name": task.task_name,
            "description": task.description,
            "is_completed": True,
            "completed_at": task.completed_at.isoformat()
        }
    }

@router.get("/{employee_id}/progress")
def get_progress(employee_id: int, request: Request, db: Session = Depends(get_db)):
    """Get onboarding progress percentage."""
    _require_self_or_hr(employee_id, request, db)
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    tasks = db.query(OnboardingTask).filter(OnboardingTask.employee_id == employee_id).all()
    total = len(tasks)
    if total == 0:
        return {
            "employee_id": employee_id,
            "employee_name": employee.name,
            "progress_percentage": 0,
            "completed_tasks": 0,
            "total_tasks": 0,
            "message": "No onboarding tasks assigned yet"
        }

    completed = sum(1 for t in tasks if t.is_completed)
    percentage = (completed / total) * 100
    return {
        "employee_id": employee_id,
        "employee_name": employee.name,
        "progress_percentage": round(percentage, 1),
        "completed_tasks": completed,
        "total_tasks": total,
        "remaining_tasks": total - completed
    }