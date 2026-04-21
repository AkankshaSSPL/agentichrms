"""Employee lookup tools – PostgreSQL version."""
from backend.database.session import SessionLocal
from backend.database.models import Employee
from .base import hr_tool


@hr_tool
def lookup_employee(name: str = None, department: str = None, designation: str = None) -> str:
    """Search for employee information by name, department, or designation."""
    db = SessionLocal()
    try:
        query = db.query(Employee).filter(Employee.status == 'active')
        if name:
            query = query.filter(Employee.name.ilike(f"%{name}%"))
        if department:
            query = query.filter(Employee.department.ilike(f"%{department}%"))
        if designation:
            query = query.filter(Employee.designation.ilike(f"%{designation}%"))
        employees = query.all()
    except Exception as e:
        return f"Error looking up employee: {str(e)}"
    finally:
        db.close()

    if not employees:
        return "No employees found matching your search."

    result = f"Found {len(employees)} employee(s):\n\n"
    for e in employees:
        result += (
            f"Name: {e.name}\n"
            f"  Role: {e.designation or 'N/A'}, {e.department or 'N/A'} Department\n"
            f"  Email: {e.email}\n"
            f"  Manager: {e.manager_id or 'None'}\n"
            f"  Joined: {e.join_date} | Status: {e.status}\n\n"
        )
    return result


@hr_tool
def count_by_department() -> str:
    """Get employee count grouped by department."""
    db = SessionLocal()
    try:
        from sqlalchemy import func
        rows = db.query(Employee.department, func.count(Employee.id)).filter(
            Employee.status == 'active'
        ).group_by(Employee.department).order_by(func.count(Employee.id).desc()).all()
    except Exception as e:
        return f"Error retrieving department counts: {str(e)}"
    finally:
        db.close()

    total = sum(r[1] for r in rows)
    result = f"Employee count by department (Total: {total}):\n"
    for dept, cnt in rows:
        result += f"  {dept or 'N/A'}: {cnt}\n"
    return result


@hr_tool
def get_team(manager_name: str) -> str:
    """Get all direct reports of a specific manager."""
    db = SessionLocal()
    try:
        manager = db.query(Employee).filter(Employee.name.ilike(f"%{manager_name}%")).first()
        if not manager:
            return f"Manager '{manager_name}' not found."
        team = db.query(Employee).filter(Employee.manager_id == manager.id).all()
    except Exception as e:
        return f"Error retrieving team: {str(e)}"
    finally:
        db.close()

    if not team:
        return f"No direct reports found for '{manager.name}'."

    result = f"Team of {manager.name} ({len(team)} direct reports):\n"
    for e in team:
        result += f"  {e.name} - {e.designation or 'N/A'}, {e.department or 'N/A'} ({e.email})\n"
    return result