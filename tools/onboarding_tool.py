"""Onboarding tools – PostgreSQL version."""
from datetime import datetime
from backend.database.session import SessionLocal
from backend.database.models import Employee, OnboardingTask
from .base import hr_tool


@hr_tool
def get_onboarding_checklist(employee_name: str) -> str:
    """Get the full onboarding checklist and completion status for an employee."""
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.name.ilike(f"%{employee_name}%")).first()
        if not emp:
            return f"Employee '{employee_name}' not found."
        tasks = db.query(OnboardingTask).filter(OnboardingTask.employee_id == emp.id).all()
        if not tasks:
            return f"No onboarding data found for {emp.name}."
        result = f"Onboarding Checklist for {emp.name}:\n"
        for t in tasks:
            marker = "[Done]" if t.is_completed else "[Pending]"
            date_str = f" (completed: {t.completed_at})" if t.completed_at else ""
            result += f"  {marker} {t.task_name}{date_str}\n"
        return result
    except Exception as e:
        return f"Error retrieving onboarding checklist: {str(e)}"
    finally:
        db.close()


@hr_tool
def mark_task_complete(employee_name: str, task_name: str) -> str:
    """Mark a specific onboarding task as completed for an employee."""
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.name.ilike(f"%{employee_name}%")).first()
        if not emp:
            return f"Employee '{employee_name}' not found."
        task = db.query(OnboardingTask).filter(
            OnboardingTask.employee_id == emp.id,
            OnboardingTask.task_name.ilike(f"%{task_name}%")
        ).first()
        if not task:
            return f"Task '{task_name}' not assigned to {emp.name}."
        if task.is_completed:
            return f"Task '{task.task_name}' is already completed."
        task.is_completed = True
        task.completed_at = datetime.utcnow()
        db.commit()
        return f"Task '{task.task_name}' marked as completed for {emp.name}."
    except Exception as e:
        db.rollback()
        return f"Error marking task complete: {str(e)}"
    finally:
        db.close()


@hr_tool
def get_onboarding_progress(employee_name: str) -> str:
    """Get percentage progress of onboarding for an employee."""
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.name.ilike(f"%{employee_name}%")).first()
        if not emp:
            return f"Employee '{employee_name}' not found."
        tasks = db.query(OnboardingTask).filter(OnboardingTask.employee_id == emp.id).all()
        total = len(tasks)
        if total == 0:
            return f"No tasks assigned to {emp.name}."
        completed = sum(1 for t in tasks if t.is_completed)
        percent = int((completed / total) * 100)
        return f"Onboarding Progress for {emp.name}: {percent}% ({completed}/{total} tasks completed)"
    except Exception as e:
        return f"Error retrieving onboarding progress: {str(e)}"
    finally:
        db.close()