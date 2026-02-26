"""Leave management tools."""
import sqlite3
from datetime import datetime
import sys
import os
from .base import hr_tool
from .email_tool import _send_smtp_email, _lookup_employee_email

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import DB_PATH


def _get_conn():
    return sqlite3.connect(DB_PATH)


@hr_tool
def check_leave_balance(employee_name: str) -> str:
    """Check remaining leave balance for an employee by name."""
    conn = _get_conn()
    c = conn.cursor()
    row = c.execute(
        "SELECT id, name FROM employees WHERE LOWER(name) LIKE ?",
        (f"%{employee_name.lower()}%",)
    ).fetchone()
    if not row:
        conn.close()
        return f"Employee '{employee_name}' not found."

    emp_id, full_name = row
    balances = c.execute(
        "SELECT leave_type, days_remaining FROM leave_balances WHERE employee_id=?",
        (emp_id,)
    ).fetchall()
    conn.close()

    if not balances:
        return f"No leave balance record for {full_name}."

    result = f"Leave Balance for {full_name}:\n"
    for l_type, days in balances:
        result += f"  {l_type.title()}: {days} days remaining\n"
    return result


@hr_tool
def apply_leave(employee_name: str, leave_type: str, start_date: str, end_date: str, reason: str) -> str:
    """
    Apply for leave on behalf of an employee.
    Dates must be in YYYY-MM-DD format.
    Valid leave types: casual, sick, earned, maternity, paternity.
    """
    conn = _get_conn()
    c = conn.cursor()

    emp = c.execute(
        "SELECT id, name, email, manager FROM employees WHERE LOWER(name) LIKE ?",
        (f"%{employee_name.lower()}%",)
    ).fetchone()
    if not emp:
        conn.close()
        return f"Employee '{employee_name}' not found."

    emp_id, full_name, emp_email, manager_name = emp

    try:
        c.execute(
            "INSERT INTO leaves (employee_id, leave_type, start_date, end_date, reason, status) VALUES (?, ?, ?, ?, ?, 'Pending')",
            (emp_id, leave_type.lower(), start_date, end_date, reason)
        )
        leave_id = c.lastrowid
        conn.commit()
        conn.close()

        # Send email notification to the employee
        if emp_email:
            _send_smtp_email(
                emp_email,
                f"Leave Application Submitted (ID: {leave_id})",
                f"Your {leave_type} leave from {start_date} to {end_date} has been submitted.\nReason: {reason}\nStatus: Pending Approval"
            )

        # Notify manager
        if manager_name:
            mgr_email = _lookup_employee_email(manager_name)
            if mgr_email:
                _send_smtp_email(
                    mgr_email,
                    f"Leave Request from {full_name}",
                    f"{full_name} has applied for {leave_type} leave.\nDates: {start_date} to {end_date}\nReason: {reason}\nLeave ID: {leave_id}"
                )

        return f"Leave applied for {full_name} (ID: {leave_id}). Status: Pending. Notifications sent."

    except Exception as e:
        conn.close()
        return f"Error applying leave: {str(e)}"


@hr_tool
def get_pending_leaves() -> str:
    """Get all pending leave applications awaiting approval."""
    conn = _get_conn()
    rows = conn.cursor().execute("""
        SELECT l.id, e.name, l.leave_type, l.start_date, l.end_date, l.reason
        FROM leaves l JOIN employees e ON l.employee_id = e.id
        WHERE l.status='Pending'
    """).fetchall()
    conn.close()

    if not rows:
        return "No pending leave requests."

    result = "Pending Leave Requests:\n"
    for r in rows:
        result += f"  ID {r[0]}: {r[1]} | {r[2]} | {r[3]} to {r[4]} | Reason: {r[5]}\n"
    return result


@hr_tool
def approve_leave(leave_id: int) -> str:
    """Approve a leave request by its ID. Deducts balance and sends email notification."""
    conn = _get_conn()
    c = conn.cursor()

    row = c.execute(
        "SELECT employee_id, leave_type, start_date, end_date FROM leaves WHERE id=?",
        (leave_id,)
    ).fetchone()
    if not row:
        conn.close()
        return f"Leave request ID {leave_id} not found."

    emp_id, l_type, start, end = row

    c.execute("UPDATE leaves SET status='Approved' WHERE id=?", (leave_id,))

    d1 = datetime.strptime(start, "%Y-%m-%d")
    d2 = datetime.strptime(end, "%Y-%m-%d")
    days = (d2 - d1).days + 1

    c.execute(
        "UPDATE leave_balances SET days_remaining = days_remaining - ? WHERE employee_id=? AND leave_type=?",
        (days, emp_id, l_type)
    )
    conn.commit()

    emp_row = c.execute("SELECT name, email FROM employees WHERE id=?", (emp_id,)).fetchone()
    conn.close()

    if emp_row:
        name, email = emp_row
        _send_smtp_email(email, "Leave Approved", f"Your {l_type} leave from {start} to {end} has been approved.")
        return f"Leave ID {leave_id} approved for {name}. {days} day(s) deducted. Email sent."

    return f"Leave ID {leave_id} approved. Balance deducted."


@hr_tool
def reject_leave(leave_id: int, reason: str) -> str:
    """Reject a leave request by its ID with a reason. Sends email notification."""
    conn = _get_conn()
    c = conn.cursor()

    row = c.execute(
        "SELECT employee_id, start_date, end_date FROM leaves WHERE id=?",
        (leave_id,)
    ).fetchone()
    if not row:
        conn.close()
        return f"Leave request ID {leave_id} not found."

    emp_id, start, end = row

    c.execute("UPDATE leaves SET status='Rejected', rejection_reason=? WHERE id=?", (reason, leave_id))
    conn.commit()

    emp_row = c.execute("SELECT name, email FROM employees WHERE id=?", (emp_id,)).fetchone()
    conn.close()

    if emp_row:
        name, email = emp_row
        _send_smtp_email(email, "Leave Rejected", f"Your leave ({start} to {end}) was rejected.\nReason: {reason}")
        return f"Leave ID {leave_id} rejected for {name}. Email sent."

    return f"Leave ID {leave_id} rejected."
