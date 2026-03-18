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


def _count_business_days(start: datetime, end: datetime) -> int:
    """Count business days (Mon-Fri) between two dates, inclusive."""
    from datetime import timedelta
    # GAP-014 FIX: Use business days instead of raw calendar days
    total = 0
    current = start
    while current <= end:
        if current.weekday() < 5:  # 0=Mon ... 4=Fri
            total += 1
        current += timedelta(days=1)
    return total


@hr_tool
def check_leave_balance(employee_name: str) -> str:
    """Check remaining leave balance for an employee by name."""
    # GAP-024 FIX: Use context manager so connection is always closed
    try:
        with _get_conn() as conn:
            c = conn.cursor()
            row = c.execute(
                "SELECT id, name FROM employees WHERE LOWER(name) LIKE ?",
                (f"%{employee_name.lower()}%",)
            ).fetchone()
            if not row:
                return f"Employee '{employee_name}' not found."

            emp_id, full_name = row
            balances = c.execute(
                "SELECT leave_type, days_remaining FROM leave_balances WHERE employee_id=?",
                (emp_id,)
            ).fetchall()

        if not balances:
            return f"No leave balance record for {full_name}."

        result = f"Leave Balance for {full_name}:\n"
        for l_type, days in balances:
            result += f"  {l_type.title()}: {days} days remaining\n"
        return result
    except Exception as e:
        return f"Error retrieving leave balance: {str(e)}"


@hr_tool
def apply_leave(employee_name: str, leave_type: str, start_date: str, end_date: str, reason: str) -> str:
    """
    Apply for leave on behalf of an employee.
    Dates must be in YYYY-MM-DD format.
    Valid leave types: casual, sick, earned, maternity, paternity.
    """
    # GAP-009 FIX: Validate dates before touching the database
    valid_leave_types = {"casual", "sick", "earned", "maternity", "paternity"}
    if leave_type.lower() not in valid_leave_types:
        return f"Invalid leave type '{leave_type}'. Must be one of: {', '.join(sorted(valid_leave_types))}."

    try:
        d1 = datetime.strptime(start_date, "%Y-%m-%d")
        d2 = datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        return "Invalid date format. Dates must be YYYY-MM-DD (e.g. 2025-07-15)."

    if d1 > d2:
        return f"start_date ({start_date}) must be on or before end_date ({end_date})."

    if d1.date() < datetime.now().date():
        return f"Cannot apply leave for a past date ({start_date})."

    # GAP-024 FIX: Use context manager
    try:
        with _get_conn() as conn:
            c = conn.cursor()
            emp = c.execute(
                "SELECT id, name, email, manager FROM employees WHERE LOWER(name) LIKE ?",
                (f"%{employee_name.lower()}%",)
            ).fetchone()
            if not emp:
                return f"Employee '{employee_name}' not found."

            emp_id, full_name, emp_email, manager_name = emp

            c.execute(
                "INSERT INTO leaves (employee_id, leave_type, start_date, end_date, reason, status) "
                "VALUES (?, ?, ?, ?, ?, 'Pending')",
                (emp_id, leave_type.lower(), start_date, end_date, reason)
            )
            leave_id = c.lastrowid
            conn.commit()

        # GAP-023 FIX: Capture email results and report failures
        notify_lines = []

        if emp_email:
            result = _send_smtp_email(
                emp_email,
                f"Leave Application Submitted (ID: {leave_id})",
                f"Your {leave_type} leave from {start_date} to {end_date} has been submitted.\n"
                f"Reason: {reason}\nStatus: Pending Approval"
            )
            if "successfully" in str(result).lower():
                notify_lines.append("Employee notified.")
            else:
                notify_lines.append(f"Employee email warning: {result}")

        if manager_name:
            mgr_email = _lookup_employee_email(manager_name)
            if mgr_email:
                result = _send_smtp_email(
                    mgr_email,
                    f"Leave Request from {full_name}",
                    f"{full_name} has applied for {leave_type} leave.\n"
                    f"Dates: {start_date} to {end_date}\nReason: {reason}\nLeave ID: {leave_id}"
                )
                if "successfully" in str(result).lower():
                    notify_lines.append("Manager notified.")
                else:
                    notify_lines.append(f"Manager email warning: {result}")

        notify_status = " ".join(notify_lines) if notify_lines else "No email notifications configured."
        return (
            f"Leave applied for {full_name} (ID: {leave_id}). "
            f"Status: Pending. {notify_status}"
        )

    except Exception as e:
        return f"Error applying leave: {str(e)}"


@hr_tool
def get_pending_leaves() -> str:
    """Get all pending leave applications awaiting approval."""
    # GAP-024 FIX: Use context manager
    try:
        with _get_conn() as conn:
            rows = conn.cursor().execute("""
                SELECT l.id, e.name, l.leave_type, l.start_date, l.end_date, l.reason
                FROM leaves l JOIN employees e ON l.employee_id = e.id
                WHERE l.status='Pending'
            """).fetchall()

        if not rows:
            return "No pending leave requests."

        result = "Pending Leave Requests:\n"
        for r in rows:
            result += f"  ID {r[0]}: {r[1]} | {r[2]} | {r[3]} to {r[4]} | Reason: {r[5]}\n"
        return result
    except Exception as e:
        return f"Error retrieving pending leaves: {str(e)}"


@hr_tool
def approve_leave(leave_id: int) -> str:
    """Approve a leave request by its ID. Deducts balance and sends email notification."""
    # GAP-024 FIX: Use context manager
    try:
        with _get_conn() as conn:
            c = conn.cursor()

            # GAP-004 FIX: Only fetch Pending leaves — prevents double-approval
            row = c.execute(
                "SELECT employee_id, leave_type, start_date, end_date FROM leaves WHERE id=? AND status='Pending'",
                (leave_id,)
            ).fetchone()
            if not row:
                # Distinguish "not found" from "wrong status"
                exists = c.execute(
                    "SELECT status FROM leaves WHERE id=?", (leave_id,)
                ).fetchone()
                if exists:
                    return (
                        f"Leave ID {leave_id} cannot be approved — current status is '{exists[0]}'. "
                        f"Only Pending leaves can be approved."
                    )
                return f"Leave request ID {leave_id} not found."

            emp_id, l_type, start, end = row

            d1 = datetime.strptime(start, "%Y-%m-%d")
            d2 = datetime.strptime(end, "%Y-%m-%d")

            # GAP-014 FIX: Business days only
            days = _count_business_days(d1, d2)

            # GAP-005 FIX: Check balance before deducting
            bal_row = c.execute(
                "SELECT days_remaining FROM leave_balances WHERE employee_id=? AND leave_type=?",
                (emp_id, l_type)
            ).fetchone()

            if not bal_row:
                return f"No leave balance record found for this employee and leave type '{l_type}'."

            if bal_row[0] < days:
                return (
                    f"Insufficient balance: employee has {bal_row[0]} day(s) of {l_type} leave remaining, "
                    f"but this request requires {days} business day(s). Cannot approve."
                )

            # All checks passed — update status and deduct atomically
            c.execute("UPDATE leaves SET status='Approved' WHERE id=?", (leave_id,))
            c.execute(
                "UPDATE leave_balances SET days_remaining = days_remaining - ? "
                "WHERE employee_id=? AND leave_type=?",
                (days, emp_id, l_type)
            )
            conn.commit()

            emp_row = c.execute(
                "SELECT name, email FROM employees WHERE id=?", (emp_id,)
            ).fetchone()

        if emp_row:
            name, email = emp_row
            _send_smtp_email(
                email,
                "Leave Approved",
                f"Your {l_type} leave from {start} to {end} has been approved. "
                f"{days} business day(s) deducted from your balance."
            )
            return f"Leave ID {leave_id} approved for {name}. {days} business day(s) deducted. Email sent."

        return f"Leave ID {leave_id} approved. Balance deducted."

    except Exception as e:
        return f"Error approving leave: {str(e)}"


@hr_tool
def reject_leave(leave_id: int, reason: str) -> str:
    """Reject a leave request by its ID with a reason. Sends email notification."""
    # GAP-024 FIX: Use context manager
    try:
        with _get_conn() as conn:
            c = conn.cursor()

            # GAP-047 FIX: Only reject Pending leaves — prevents rejecting already-approved leave
            row = c.execute(
                "SELECT employee_id, start_date, end_date FROM leaves WHERE id=? AND status='Pending'",
                (leave_id,)
            ).fetchone()
            if not row:
                exists = c.execute(
                    "SELECT status FROM leaves WHERE id=?", (leave_id,)
                ).fetchone()
                if exists:
                    return (
                        f"Leave ID {leave_id} cannot be rejected — current status is '{exists[0]}'. "
                        f"Only Pending leaves can be rejected."
                    )
                return f"Leave request ID {leave_id} not found."

            emp_id, start, end = row

            c.execute(
                "UPDATE leaves SET status='Rejected', rejection_reason=? WHERE id=?",
                (reason, leave_id)
            )
            conn.commit()

            emp_row = c.execute(
                "SELECT name, email FROM employees WHERE id=?", (emp_id,)
            ).fetchone()

        if emp_row:
            name, email = emp_row
            _send_smtp_email(
                email,
                "Leave Rejected",
                f"Your leave ({start} to {end}) was rejected.\nReason: {reason}"
            )
            return f"Leave ID {leave_id} rejected for {name}. Email sent."

        return f"Leave ID {leave_id} rejected."

    except Exception as e:
        return f"Error rejecting leave: {str(e)}"