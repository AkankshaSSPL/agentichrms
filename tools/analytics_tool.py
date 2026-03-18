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
    # GAP-024 FIX: Use context manager — connection always closed on exception.
    try:
        with _get_conn() as conn:
            rows = conn.cursor().execute(
                "SELECT leave_type, status, COUNT(*) FROM leaves "
                "GROUP BY leave_type, status ORDER BY leave_type"
            ).fetchall()
    except Exception as e:
        return f"Error retrieving leave summary: {str(e)}"

    if not rows:
        return "No leave records found."

    result = "Company-wide Leave Summary:\n"
    for l_type, status, count in rows:
        result += f"  {l_type.title()} ({status}): {count} request(s)\n"
    return result


@hr_tool
def get_department_summary() -> str:
    """Get department-wise employee stats including headcount and average tenure."""
    # GAP-024 FIX: context manager
    try:
        with _get_conn() as conn:
            rows = conn.cursor().execute(
                "SELECT department, COUNT(*), "
                "AVG(CASE WHEN join_date IS NOT NULL AND join_date != '' THEN JULIANDAY('now') - JULIANDAY(join_date) END) "
                "FROM employees WHERE status='active' "
                "GROUP BY department ORDER BY COUNT(*) DESC"
            ).fetchall()
    except Exception as e:
        return f"Error retrieving department summary: {str(e)}"

    if not rows:
        return "No department data found."

    result = "Department Summary:\n"
    for dept, count, tenure_days in rows:
        # GAP-050 FIX: Use `is not None` instead of truthiness check.
        # The old `if tenure_days` treated 0 days and NULL identically (both
        # falsy).  An employee who joined today has tenure_days ≈ 0 which is
        # a valid value; NULL join_date means data is missing.  The explicit
        # None check distinguishes these two cases correctly.
        if tenure_days is not None:
            avg_years = round(tenure_days / 365, 1)
        else:
            avg_years = 0
        result += f"  {dept}: {count} employees, avg tenure {avg_years} years\n"
    return result