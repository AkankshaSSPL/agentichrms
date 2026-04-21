"""Analytics tools for HR dashboard – PostgreSQL version."""
from backend.database.session import SessionLocal
from backend.database.models import Employee, Leave
from .base import hr_tool


@hr_tool
def get_leave_summary() -> str:
    """Get a summary of leave usage across the organization grouped by type and status."""
    db = SessionLocal()
    try:
        from sqlalchemy import func
        rows = db.query(
            Leave.leave_type,
            Leave.status,
            func.count(Leave.id)
        ).group_by(Leave.leave_type, Leave.status).order_by(Leave.leave_type).all()
    except Exception as e:
        return f"Error retrieving leave summary: {str(e)}"
    finally:
        db.close()

    if not rows:
        return "No leave records found."

    result = "Company-wide Leave Summary:\n"
    for l_type, status, count in rows:
        result += f"  {l_type.title()} ({status}): {count} request(s)\n"
    return result


@hr_tool
def get_department_summary() -> str:
    """Get department-wise employee stats including headcount and average tenure."""
    db = SessionLocal()
    try:
        from sqlalchemy import func
        from datetime import date
        today = date.today()
        rows = db.query(
            Employee.department,
            func.count(Employee.id),
            func.avg(func.julianday(today) - func.julianday(Employee.join_date))
        ).filter(Employee.status == 'active').group_by(Employee.department).order_by(func.count(Employee.id).desc()).all()
    except Exception as e:
        return f"Error retrieving department summary: {str(e)}"
    finally:
        db.close()

    if not rows:
        return "No department data found."

    result = "Department Summary:\n"
    for dept, count, tenure_days in rows:
        if tenure_days is not None:
            avg_years = round(tenure_days / 365, 1)
        else:
            avg_years = 0
        result += f"  {dept}: {count} employees, avg tenure {avg_years} years\n"
    return result