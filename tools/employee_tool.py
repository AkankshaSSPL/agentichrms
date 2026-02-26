"""Employee lookup tools."""
import sqlite3
import sys
import os
from .base import hr_tool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import DB_PATH


def _get_conn():
    return sqlite3.connect(DB_PATH)


@hr_tool
def lookup_employee(name: str = None, department: str = None, designation: str = None) -> str:
    """
    Search for employee information by name, department, or designation.
    Returns details including email, manager, join date, and status.
    At least one search parameter must be provided.
    """
    conn = _get_conn()
    c = conn.cursor()
    conditions, params = [], []
    if name:
        conditions.append("LOWER(name) LIKE ?")
        params.append(f"%{name.lower()}%")
    if department:
        conditions.append("LOWER(department) LIKE ?")
        params.append(f"%{department.lower()}%")
    if designation:
        conditions.append("LOWER(designation) LIKE ?")
        params.append(f"%{designation.lower()}%")

    if not conditions:
        conn.close()
        return "Please provide at least one search parameter (name, department, or designation)."

    rows = c.execute(
        f"SELECT name, email, department, designation, manager, join_date, status FROM employees WHERE {' AND '.join(conditions)}",
        params
    ).fetchall()
    conn.close()

    if not rows:
        return "No employees found matching your search."

    result = f"Found {len(rows)} employee(s):\n\n"
    for r in rows:
        result += f"Name: {r[0]}\n"
        result += f"  Role: {r[3]}, {r[2]} Department\n"
        result += f"  Email: {r[1]}\n"
        result += f"  Manager: {r[4] or 'None'}\n"
        result += f"  Joined: {r[5]} | Status: {r[6]}\n\n"
    return result


@hr_tool
def count_by_department() -> str:
    """Get employee count grouped by department."""
    conn = _get_conn()
    rows = conn.cursor().execute(
        "SELECT department, COUNT(*) FROM employees WHERE status='active' GROUP BY department ORDER BY COUNT(*) DESC"
    ).fetchall()
    conn.close()

    total = sum(r[1] for r in rows)
    result = f"Employee count by department (Total: {total}):\n"
    for dept, cnt in rows:
        result += f"  {dept}: {cnt}\n"
    return result


@hr_tool
def get_team(manager_name: str) -> str:
    """Get all direct reports of a specific manager."""
    conn = _get_conn()
    rows = conn.cursor().execute(
        "SELECT name, designation, department, email FROM employees WHERE LOWER(manager) LIKE ? AND status='active'",
        (f"%{manager_name.lower()}%",)
    ).fetchall()
    conn.close()

    if not rows:
        return f"No direct reports found for '{manager_name}'."

    result = f"Team of {manager_name} ({len(rows)} direct reports):\n"
    for r in rows:
        result += f"  {r[0]} - {r[1]}, {r[2]} ({r[3]})\n"
    return result
