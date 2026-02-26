"""Analytics tools for HR dashboard."""
import sqlite3
import sys
import os
from .base import hr_tool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import DB_PATH


def _get_conn():
    return sqlite3.connect(DB_PATH)


@hr_tool
def get_leave_summary() -> str:
    """Get a summary of leave usage across the organization grouped by type and status."""
    conn = _get_conn()
    rows = conn.cursor().execute(
        "SELECT leave_type, status, COUNT(*) FROM leaves GROUP BY leave_type, status ORDER BY leave_type"
    ).fetchall()
    conn.close()

    if not rows:
        return "No leave records found."

    result = "Company-wide Leave Summary:\n"
    for l_type, status, count in rows:
        result += f"  {l_type.title()} ({status}): {count} request(s)\n"
    return result


@hr_tool
def get_department_summary() -> str:
    """Get department-wise employee stats including headcount and average tenure."""
    conn = _get_conn()
    rows = conn.cursor().execute(
        "SELECT department, COUNT(*), AVG(JULIANDAY('now') - JULIANDAY(join_date)) FROM employees WHERE status='active' GROUP BY department ORDER BY COUNT(*) DESC"
    ).fetchall()
    conn.close()

    if not rows:
        return "No department data found."

    result = "Department Summary:\n"
    for dept, count, tenure_days in rows:
        avg_years = round(tenure_days / 365, 1) if tenure_days else 0
        result += f"  {dept}: {count} employees, avg tenure {avg_years} years\n"
    return result
