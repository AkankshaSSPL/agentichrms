"""Leave management tools – PostgreSQL version."""
from datetime import datetime, timedelta
from backend.database.session import SessionLocal
from backend.database.models import Employee, Leave, LeaveBalance
from .base import hr_tool
from .email_tool import _send_smtp_email, _lookup_employee_email


def _count_business_days(start: datetime, end: datetime) -> int:
    """Count business days (Mon-Fri) between two dates, inclusive."""
    total = 0
    current = start
    while current <= end:
        if current.weekday() < 5:
            total += 1
        current += timedelta(days=1)
    return total


@hr_tool
def check_leave_balance(employee_name: str) -> str:
    """Check remaining leave balance for an employee by name."""
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.name.ilike(f"%{employee_name}%")).first()
        if not emp:
            return f"Employee '{employee_name}' not found."
        balances = db.query(LeaveBalance).filter(LeaveBalance.employee_id == emp.id).all()
        if not balances:
            return f"No leave balance record for {emp.name}."
        result = f"Leave Balance for {emp.name}:\n"
        for b in balances:
            result += f"  {b.leave_type.title()}: {b.days_remaining} days remaining\n"
        return result
    except Exception as e:
        return f"Error retrieving leave balance: {str(e)}"
    finally:
        db.close()


@hr_tool
def apply_leave(employee_name: str, leave_type: str, start_date: str, end_date: str, reason: str) -> str:
    """Apply for leave on behalf of an employee. Dates must be YYYY-MM-DD."""
    valid_leave_types = {"casual", "sick", "earned", "maternity", "paternity"}
    if leave_type.lower() not in valid_leave_types:
        return f"Invalid leave type '{leave_type}'. Must be one of: {', '.join(sorted(valid_leave_types))}."
    try:
        d1 = datetime.strptime(start_date, "%Y-%m-%d")
        d2 = datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        return "Invalid date format. Dates must be YYYY-MM-DD."
    if d1 > d2:
        return f"start_date must be on or before end_date."
    if d1.date() < datetime.now().date():
        return f"Cannot apply leave for a past date ({start_date})."

    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.name.ilike(f"%{employee_name}%")).first()
        if not emp:
            return f"Employee '{employee_name}' not found."
        new_leave = Leave(
            employee_id=emp.id,
            leave_type=leave_type.lower(),
            start_date=d1,
            end_date=d2,
            reason=reason,
            status='Pending'
        )
        db.add(new_leave)
        db.commit()
        db.refresh(new_leave)

        notify_lines = []
        if emp.email:
            result = _send_smtp_email(emp.email, f"Leave Application Submitted (ID: {new_leave.id})", f"Your {leave_type} leave from {start_date} to {end_date} has been submitted.")
            if "successfully" in result.lower():
                notify_lines.append("Employee notified.")
        if emp.manager_id:
            mgr = db.query(Employee).filter(Employee.id == emp.manager_id).first()
            if mgr and mgr.email:
                result = _send_smtp_email(mgr.email, f"Leave Request from {emp.name}", f"{emp.name} has applied for {leave_type} leave.\nDates: {start_date} to {end_date}")
                if "successfully" in result.lower():
                    notify_lines.append("Manager notified.")
        notify_status = " ".join(notify_lines) if notify_lines else "No email notifications configured."
        return f"Leave applied for {emp.name} (ID: {new_leave.id}). Status: Pending. {notify_status}"
    except Exception as e:
        db.rollback()
        return f"Error applying leave: {str(e)}"
    finally:
        db.close()


@hr_tool
def get_pending_leaves() -> str:
    """Get all pending leave applications awaiting approval."""
    db = SessionLocal()
    try:
        leaves = db.query(Leave).filter(Leave.status == 'Pending').all()
        if not leaves:
            return "No pending leave requests."
        result = "Pending Leave Requests:\n"
        for l in leaves:
            emp = db.query(Employee).filter(Employee.id == l.employee_id).first()
            result += f"  ID {l.id}: {emp.name} | {l.leave_type} | {l.start_date.date()} to {l.end_date.date()} | Reason: {l.reason}\n"
        return result
    except Exception as e:
        return f"Error retrieving pending leaves: {str(e)}"
    finally:
        db.close()


@hr_tool
def approve_leave(leave_id: int) -> str:
    """Approve a leave request by its ID. Deducts balance and sends email."""
    db = SessionLocal()
    try:
        leave = db.query(Leave).filter(Leave.id == leave_id, Leave.status == 'Pending').first()
        if not leave:
            existing = db.query(Leave).filter(Leave.id == leave_id).first()
            if existing:
                return f"Leave ID {leave_id} cannot be approved — current status is '{existing.status}'. Only Pending leaves can be approved."
            return f"Leave request ID {leave_id} not found."
        emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
        d1 = leave.start_date
        d2 = leave.end_date
        days = _count_business_days(d1, d2)

        balance = db.query(LeaveBalance).filter(
            LeaveBalance.employee_id == emp.id,
            LeaveBalance.leave_type == leave.leave_type
        ).first()
        if not balance:
            return f"No leave balance record for this employee and leave type '{leave.leave_type}'."
        if balance.days_remaining < days:
            return f"Insufficient balance: employee has {balance.days_remaining} day(s) remaining, but this request requires {days} business day(s)."

        leave.status = 'Approved'
        balance.days_remaining -= days
        db.commit()

        if emp.email:
            _send_smtp_email(emp.email, "Leave Approved", f"Your {leave.leave_type} leave from {d1.date()} to {d2.date()} has been approved. {days} business day(s) deducted.")
        return f"Leave ID {leave_id} approved for {emp.name}. {days} business day(s) deducted. Email sent."
    except Exception as e:
        db.rollback()
        return f"Error approving leave: {str(e)}"
    finally:
        db.close()


@hr_tool
def reject_leave(leave_id: int, reason: str) -> str:
    """Reject a leave request by its ID with a reason. Sends email."""
    db = SessionLocal()
    try:
        leave = db.query(Leave).filter(Leave.id == leave_id, Leave.status == 'Pending').first()
        if not leave:
            existing = db.query(Leave).filter(Leave.id == leave_id).first()
            if existing:
                return f"Leave ID {leave_id} cannot be rejected — current status is '{existing.status}'."
            return f"Leave request ID {leave_id} not found."
        emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
        leave.status = 'Rejected'
        leave.rejection_reason = reason
        db.commit()
        if emp.email:
            _send_smtp_email(emp.email, "Leave Rejected", f"Your leave ({leave.start_date.date()} to {leave.end_date.date()}) was rejected.\nReason: {reason}")
        return f"Leave ID {leave_id} rejected for {emp.name}. Email sent."
    except Exception as e:
        db.rollback()
        return f"Error rejecting leave: {str(e)}"
    finally:
        db.close()