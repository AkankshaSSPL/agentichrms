"""Onboarding tools."""
import sqlite3
import sys
import os
from .base import hr_tool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import DB_PATH


def _get_conn():
    return sqlite3.connect(DB_PATH)


@hr_tool
def get_onboarding_checklist(employee_name: str) -> str:
    """Get the full onboarding checklist and completion status for an employee."""
    conn = _get_conn()
    row = conn.cursor().execute(
        "SELECT id, name FROM employees WHERE LOWER(name) LIKE ?",
        (f"%{employee_name.lower()}%",)
    ).fetchone()
    if not row:
        conn.close()
        return f"Employee '{employee_name}' not found."

    emp_id, name = row
    tasks = conn.cursor().execute("""
        SELECT t.task_name, t.category, eo.status, eo.completed_at
        FROM employee_onboarding eo
        JOIN onboarding_tasks t ON eo.task_id = t.id
        WHERE eo.employee_id = ?
        ORDER BY t.id
    """, (emp_id,)).fetchall()
    conn.close()

    if not tasks:
        return f"No onboarding data found for {name}."

    result = f"Onboarding Checklist for {name}:\n"
    for t_name, category, status, comp_at in tasks:
        marker = "[Done]" if status == 'Completed' else "[Pending]"
        date_str = f" (completed: {comp_at})" if comp_at else ""
        result += f"  {marker} [{category}] {t_name}{date_str}\n"
    return result


@hr_tool
def mark_task_complete(employee_name: str, task_name: str) -> str:
    """Mark a specific onboarding task as completed for an employee."""
    conn = _get_conn()
    c = conn.cursor()

    emp = c.execute(
        "SELECT id, name FROM employees WHERE LOWER(name) LIKE ?",
        (f"%{employee_name.lower()}%",)
    ).fetchone()
    if not emp:
        conn.close()
        return f"Employee '{employee_name}' not found."
    emp_id, name = emp

    task = c.execute(
        "SELECT id FROM onboarding_tasks WHERE LOWER(task_name) LIKE ?",
        (f"%{task_name.lower()}%",)
    ).fetchone()
    if not task:
        conn.close()
        return f"Task '{task_name}' not defined in system."
    task_id = task[0]

    c.execute("""
        UPDATE employee_onboarding
        SET status='Completed', completed_at=DATE('now')
        WHERE employee_id=? AND task_id=?
    """, (emp_id, task_id))

    if c.rowcount == 0:
        conn.close()
        return f"Task not assigned to {name}."

    conn.commit()
    conn.close()
    return f"Task '{task_name}' marked as completed for {name}."


@hr_tool
def get_onboarding_progress(employee_name: str) -> str:
    """Get percentage progress of onboarding for an employee."""
    conn = _get_conn()
    row = conn.cursor().execute(
        "SELECT id, name FROM employees WHERE LOWER(name) LIKE ?",
        (f"%{employee_name.lower()}%",)
    ).fetchone()
    if not row:
        conn.close()
        return f"Employee '{employee_name}' not found."
    emp_id, name = row

    stats = conn.cursor().execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed
        FROM employee_onboarding WHERE employee_id=?
    """, (emp_id,)).fetchone()
    conn.close()

    total, completed = stats
    if total == 0:
        return f"No tasks assigned to {name}."

    percent = int((completed / total) * 100)
    return f"Onboarding Progress for {name}: {percent}% ({completed}/{total} tasks completed)"
