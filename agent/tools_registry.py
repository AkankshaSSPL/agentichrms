"""
Tool registry for the HR assistant.
Includes ChromaDB-based policy search, employee lookup, leave management,
calendar conflict check, and email notifications.

KEY CHANGES:
- apply_leave now accepts employee_email (passed from logged-in session) so the
  agent never needs to ask the user for their name.
- Meeting conflict check happens BEFORE saving the leave; if conflicts exist the
  leave is still saved as Pending but a warning + options are returned.
- HR notification email is always sent regardless of conflicts.
- ADMIN_EMAIL added to approve_leave and reject_leave notifications.
"""

import chromadb
import logging
from contextlib import contextmanager
from datetime import datetime
from sentence_transformers import SentenceTransformer
from langchain.tools import tool
from backend.core.config import settings
from backend.database.session import SessionLocal
from backend.database.models import Employee, Leave, LeaveBalance, ApprovalRequest
from backend.enums.leave_status import LeaveStatus
from backend.enums.roles import RoleName
from backend.enums.approval_status import ApprovalStatus
import os
from backend.services.email_service import send_email as _send_email
from backend.notifications.notifier import Notifier
from backend.notifications.notification_templates import NotifKey
import requests
from icalendar import Calendar as ICalendar
from datetime import date as date_type

logger = logging.getLogger(__name__)

# ── ChromaDB setup ─────────────────────────────────────────────────────────────
embedding_model = SentenceTransformer(settings.EMBEDDING_MODEL)
client = chromadb.PersistentClient(path=str(settings.CHROMA_DIR))
try:
    collection = client.get_collection(settings.CHROMA_COLLECTION_NAME)
except Exception:
    collection = client.create_collection(settings.CHROMA_COLLECTION_NAME)
    print(
        f"Created empty ChromaDB collection '{settings.CHROMA_COLLECTION_NAME}'. "
        "Please run ingest_docs.py first."
    )


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_employee_by_email(db, email: str):
    """Return Employee row for the logged-in user's email, or None."""
    return db.query(Employee).filter(Employee.email == email).first()


@contextmanager
def get_db():
    """
    Context manager for DB sessions in agent tools.
    Guarantees the session is closed even if the tool raises an exception.

    Usage:
        with get_db() as db:
            emp = db.query(Employee)...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()



def _fetch_ics_meetings(ics_url: str, start: date_type, end: date_type) -> list:
    """
    Fetch the employee's Outlook ICS calendar URL and return any events
    that fall within [start, end]. Returns list of dicts with title/date/time.
    Handles timezone-aware datetimes (e.g. India Standard Time +0530) and
    all-day date-only events correctly.
    """
    try:
        resp = requests.get(ics_url, timeout=10)
        resp.raise_for_status()
        cal = ICalendar.from_ical(resp.content)
        conflicts = []
        for component in cal.walk():
            if component.name != "VEVENT":
                continue
            dtstart = component.get("DTSTART")
            if not dtstart:
                continue
            event_dt = dtstart.dt
            # Case 1: timezone-aware or naive datetime object
            if hasattr(event_dt, "date"):
                event_date = event_dt.date()   # strips timezone, gives local date
                event_time = event_dt.strftime("%I:%M %p")
            # Case 2: plain date (all-day event)
            else:
                event_date = event_dt
                event_time = "All day"
            if start <= event_date <= end:
                conflicts.append({
                    "title": str(component.get("SUMMARY", "Untitled Meeting")),
                    "date": str(event_date),
                    "time": event_time,
                })
        return conflicts
    except Exception as e:
        logger.warning(f"ICS fetch failed: {e}")
        return []


# ── Tools ──────────────────────────────────────────────────────────────────────

@tool
def search_policies(query: str, k: int = 3) -> dict:
    """
    Search company policies, handbooks, and HR documents.
    Use this for any question about rules, benefits, procedures, leave policies,
    remote work, code of conduct, etc.
    """
    query_embedding = embedding_model.encode(query).tolist()
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=k,
        include=["documents", "metadatas", "distances"],
    )

    if not results["documents"] or not results["documents"][0]:
        return {
            "answer": "I couldn't find any relevant policy in the knowledge base.",
            "sources": [],
        }

    context_parts = []
    sources = []
    for i, doc in enumerate(results["documents"][0]):
        metadata = results["metadatas"][0][i]
        source_file = metadata.get("source", "unknown")
        chunk_idx = metadata.get("chunk", i)
        context_parts.append(f"[Source: {source_file}, Chunk {chunk_idx}]\n{doc}")
        sources.append(
            {
                "source_file": source_file,
                "section": f"Chunk {chunk_idx}",
                "content": doc[:500],
            }
        )

    combined_context = "\n\n".join(context_parts)
    answer = f"Based on the following documents:\n\n{combined_context}"
    return {"answer": answer, "sources": sources}


@tool
def lookup_employee(name: str) -> dict:
    """Find employee details by name or email."""
    with get_db() as db:
        emp = db.query(Employee).filter(
            (Employee.name.ilike(f"%{name}%")) | (Employee.email.ilike(f"%{name}%"))
        ).first()
        if not emp:
            return {"answer": f"No employee found matching '{name}'."}
        return {
            "answer": (
                f"Name: {emp.name}\nEmail: {emp.email}\n"
                f"Department: {emp.department}\nDesignation: {emp.designation}\n"
                f"Status: {emp.status}"
            )
        }



@tool
def check_leave_balance(employee_email: str) -> dict:
    """
    Check leave balance for the currently logged-in employee.
    Pass the logged-in user's email — do NOT ask the user for their name.
    """
    with get_db() as db:
        emp = _get_employee_by_email(db, employee_email)
        if not emp:
            return {"answer": f"Employee with email '{employee_email}' not found."}
        balances = db.query(LeaveBalance).filter(LeaveBalance.employee_id == emp.id).all()
        if not balances:
            return {"answer": f"No leave balances found for {emp.name}."}
        lines = [f"{b.leave_type}: {b.allocated - b.used} days remaining ({b.allocated} allocated, {b.used} used)" for b in balances]
        return {"answer": f"Leave balances for {emp.name}:\n" + "\n".join(lines)}



@tool
def apply_leave(
    employee_email: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    reason: str,
) -> dict:
    """
    Step 1 of leave application — checks for calendar conflicts ONLY.
    Does NOT save the leave or send any email yet.

    If conflicts exist → returns conflict=True with meeting list.
      The frontend will show a popup asking the employee to choose:
      Proceed / Reschedule / Cancel.

    If no conflicts → saves leave immediately and emails HR.

    Args:
        employee_email: Email of the logged-in employee (from session).
        leave_type: E.g. "Annual", "Sick", "Casual".
        start_date: YYYY-MM-DD format.
        end_date: YYYY-MM-DD format.
        reason: Short reason for the leave.
    """
    with get_db() as db:
        # 1. Resolve employee
        emp = _get_employee_by_email(db, employee_email)
        if not emp:
            return {
                "answer": (
                    f"No employee account found for email '{employee_email}'. "
                    "Please contact HR."
                )
            }

        # 2. Parse & validate dates
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d").date()
            end = datetime.strptime(end_date, "%Y-%m-%d").date()
        except ValueError:
            return {"answer": "Invalid date format. Please use YYYY-MM-DD."}

        if end < start:
            return {"answer": "End date cannot be before start date."}

        # 3. Calendar conflict check via shared company Outlook ICS — NO save, NO email yet
        conflicting_meetings = []
        company_ics_url = os.getenv("COMPANY_CALENDAR_ICS_URL", "")
        if company_ics_url:
            conflicting_meetings = _fetch_ics_meetings(company_ics_url, start, end)
        else:
            logger.warning("COMPANY_CALENDAR_ICS_URL not set in .env — skipping calendar conflict check")

        # 4a. Conflicts found → return warning, let frontend show popup
        if conflicting_meetings:
            meeting_list = "\n".join(
                [f"  • {m['title']} on {m['date']}" + (f" at {m['time']}" if m.get('time') else "")
                 for m in conflicting_meetings]
            )
            answer = (
                f" **Calendar Conflict Detected**\n\n"
                f"You have the following meetings during {start_date} to {end_date}:\n"
                f"{meeting_list}\n\n"
                "Please choose what you'd like to do."
            )
            return {
                "answer": answer,
                "conflict": True,
                "meetings": conflicting_meetings,
                "pending_leave": {
                    "employee_email": employee_email,
                    "leave_type": leave_type,
                    "start_date": start_date,
                    "end_date": end_date,
                    "reason": reason,
                },
            }

        # 4b. No conflicts → save and email HR immediately
        new_leave = Leave(
            employee_id=emp.id,
            leave_type=leave_type,
            start_date=start,
            end_date=end,
            reason=reason,
            status=LeaveStatus.PENDING,
        )
        db.add(new_leave)
        db.commit()
        db.refresh(new_leave)

        # ── In-app notifications ───────────────────────────────────────────
        date_str = f"{start_date} to {end_date}"
        notifier = Notifier(db)
        notifier.from_template(
            NotifKey.LEAVE_SUBMITTED, emp.id,
            leave_type=leave_type, date_str=date_str,
        )
        notifier.from_template_to_hr(
            NotifKey.LEAVE_SUBMITTED_HR,
            employee_name=emp.name, leave_type=leave_type, date_str=date_str,
        )

        hr_email = getattr(settings, "HR_EMAIL", None)
        if hr_email:
            email_subject = f"Leave Request: {emp.name} ({leave_type}) — {start_date} to {end_date}"
            email_body = f"""
New Leave Request — Action Required
=====================================
Employee  : {emp.name}
Email     : {emp.email}
Department: {emp.department}
Leave Type: {leave_type}
Period    : {start_date} to {end_date}
Reason    : {reason}
Status    : Pending approval
Request ID: {new_leave.id}

Please log in to the HRMS portal to approve or reject this request.
"""
            try:
                _send_email(hr_email, email_subject, email_body)
                email_status = " HR has been notified by email."
            except Exception as exc:
                logger.error(f"Failed to send leave email: {exc}")
                email_status = " Email to HR could not be sent — HR will be notified manually."
        else:
            email_status = " HR email not configured. Please notify HR manually."

        return {
            "answer": f" Leave request submitted successfully (ID: {new_leave.id}). {email_status}",
            "conflict": False,
            "leave_id": new_leave.id,
        }




@tool
def confirm_leave(
    employee_email: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    reason: str,
) -> dict:
    """
    Step 2 — called ONLY when the employee clicked 'Proceed anyway' on the
    conflict popup. Saves the leave and sends the HR email.

    Args:
        employee_email: Email of the logged-in employee.
        leave_type: Same as originally requested.
        start_date: YYYY-MM-DD.
        end_date: YYYY-MM-DD.
        reason: Same as originally requested.
    """
    with get_db() as db:
        emp = _get_employee_by_email(db, employee_email)
        if not emp:
            return {"answer": f"Employee not found for email '{employee_email}'."}

        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()

        new_leave = Leave(
            employee_id=emp.id,
            leave_type=leave_type,
            start_date=start,
            end_date=end,
            reason=reason,
            status=LeaveStatus.PENDING,
        )
        db.add(new_leave)
        db.commit()
        db.refresh(new_leave)

        # ── In-app notifications ───────────────────────────────────────────
        date_str = f"{start_date} to {end_date}"
        notifier = Notifier(db)
        notifier.from_template(
            NotifKey.LEAVE_SUBMITTED, emp.id,
            leave_type=leave_type, date_str=date_str,
        )
        notifier.from_template_to_hr(
            NotifKey.LEAVE_SUBMITTED_HR,
            employee_name=emp.name, leave_type=leave_type, date_str=date_str,
        )

        hr_email = getattr(settings, "HR_EMAIL", None)
        if hr_email:
            email_subject = f"Leave Request: {emp.name} ({leave_type}) — {start_date} to {end_date}"
            email_body = f"""
New Leave Request — Action Required
=====================================
Employee  : {emp.name}
Email     : {emp.email}
Department: {emp.department}
Leave Type: {leave_type}
Period    : {start_date} to {end_date}
Reason    : {reason}
Status    : Pending approval
Request ID: {new_leave.id}

 NOTE: Employee confirmed leave despite having meetings scheduled during this period.

Please log in to the HRMS portal to approve or reject this request.
"""
            try:
                _send_email(hr_email, email_subject, email_body)
                email_status = " HR has been notified by email."
            except Exception as exc:
                logger.error(f"Failed to send leave email: {exc}")
                email_status = " Email to HR could not be sent — HR will be notified manually."
        else:
            email_status = " HR email not configured. Please notify HR manually."

        return {
            "answer": f" Leave request confirmed and submitted (ID: {new_leave.id}). {email_status}",
            "conflict": False,
            "leave_id": new_leave.id,
        }




@tool
def cancel_latest_pending_leave(employee_email: str) -> dict:
    """
    Cancel the most recent Pending leave request for the logged-in employee.
    Use this instead of cancel_leave_request when the employee does not have a leave ID —
    for example, when they click Cancel on the conflict popup.
    """
    with get_db() as db:
        emp = _get_employee_by_email(db, employee_email)
        if not emp:
            return {"answer": f"Employee not found for email '{employee_email}'."}
        leave = (
            db.query(Leave)
            .filter(Leave.employee_id == emp.id, Leave.status == LeaveStatus.PENDING)
            .order_by(Leave.created_at.desc())
            .first()
        )
        if not leave:
            return {"answer": "You have no pending leave requests to cancel."}
        leave_desc = f"{leave.leave_type} leave from {leave.start_date} to {leave.end_date}"
        db.delete(leave)
        db.commit()
        return {"answer": f" Your {leave_desc} has been cancelled. No email has been sent to HR."}



@tool
def approve_leave(leave_id: int) -> dict:
    """Approve a leave request (manager action). Notifies HR and admin."""
    with get_db() as db:
        leave = db.query(Leave).filter(Leave.id == leave_id).first()
        if not leave:
            return {"answer": f"Leave request {leave_id} not found."}
        emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
        if not emp:
            return {"answer": f"Employee not found for leave {leave_id}."}
        leave.status = LeaveStatus.APPROVED
        db.commit()

        # In-app notification to employee
        date_str = f"{leave.start_date.date()} to {leave.end_date.date()}"
        Notifier(db).from_template(
            NotifKey.LEAVE_APPROVED, emp.id,
            leave_type=leave.leave_type, date_str=date_str,
        )

        # Prepare email content
        subject = f"Leave Request Approved: {emp.name} ({leave.leave_type})"
        body = f"""
Leave Request Approved
=======================
Employee  : {emp.name}
Email     : {emp.email}
Leave Type: {leave.leave_type}
Period    : {leave.start_date.date()} to {leave.end_date.date()}
Reason    : {leave.reason}
Request ID: {leave.id}

This leave has been approved.
"""
        # Send to HR and Admin if configured
        hr_email = getattr(settings, "HR_EMAIL", None)
        admin_email = getattr(settings, "ADMIN_EMAIL", None)
        recipients = [e for e in (hr_email, admin_email) if e]
        for recipient in recipients:
            try:
                _send_email(recipient, subject, body)
            except Exception as exc:
                logger.error(f"Failed to send email to {recipient}: {exc}")

        return {"answer": f"Leave request {leave_id} approved. Notifications sent."}



@tool
def reject_leave(leave_id: int, reason: str = "") -> dict:
    """Reject a leave request. Notifies HR and admin."""
    with get_db() as db:
        leave = db.query(Leave).filter(Leave.id == leave_id).first()
        if not leave:
            return {"answer": f"Leave request {leave_id} not found."}
        emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
        if not emp:
            return {"answer": f"Employee not found for leave {leave_id}."}
        leave.status = LeaveStatus.REJECTED
        leave.rejection_reason = reason
        db.commit()

        # In-app notification to employee
        date_str = f"{leave.start_date.date()} to {leave.end_date.date()}"
        Notifier(db).from_template(
            NotifKey.LEAVE_REJECTED, emp.id,
            leave_type=leave.leave_type, date_str=date_str,
            reason=reason or "No reason provided",
        )

        subject = f"Leave Request Rejected: {emp.name} ({leave.leave_type})"
        body = f"""
Leave Request Rejected
=======================
Employee  : {emp.name}
Email     : {emp.email}
Leave Type: {leave.leave_type}
Period    : {leave.start_date.date()} to {leave.end_date.date()}
Reason    : {leave.reason}
Rejection Reason: {reason}
Request ID: {leave.id}
"""
        hr_email = getattr(settings, "HR_EMAIL", None)
        admin_email = getattr(settings, "ADMIN_EMAIL", None)
        recipients = [e for e in (hr_email, admin_email) if e]
        for recipient in recipients:
            try:
                _send_email(recipient, subject, body)
            except Exception as exc:
                logger.error(f"Failed to send email to {recipient}: {exc}")

        return {"answer": f"Leave request {leave_id} rejected. Notifications sent."}



@tool
def cancel_leave_request(leave_id: int) -> dict:
    """Cancel a pending leave request."""
    with get_db() as db:
        leave = db.query(Leave).filter(Leave.id == leave_id).first()
        if not leave:
            return {"answer": f"Leave request {leave_id} not found."}
        if leave.status != LeaveStatus.PENDING:
            return {
                "answer": (
                    f"Leave request {leave_id} is already {leave.status}. "
                    "Cannot cancel."
                )
            }
        db.delete(leave)
        db.commit()
        return {"answer": f"Leave request {leave_id} has been cancelled."}



@tool
def send_notification_email(to: str, subject: str, body: str) -> dict:
    """Send an ad-hoc email notification (HR/admin use)."""
    try:
        _send_email(to, subject, body)
        return {"answer": f"Email sent to {to} with subject '{subject}'."}
    except Exception as exc:
        return {"answer": f"Failed to send email: {str(exc)}"}


@tool
def get_onboarding_checklist(employee_email: str) -> dict:
    """Get onboarding checklist for the logged-in employee."""
    from backend.database.models import OnboardingTask
    with get_db() as db:
        emp = _get_employee_by_email(db, employee_email)
        if not emp:
            return {"answer": f"Employee not found for email '{employee_email}'."}
        tasks = (
            db.query(OnboardingTask)
            .filter(OnboardingTask.employee_id == emp.id)
            .order_by(OnboardingTask.id)
            .all()
        )
        if not tasks:
            return {"answer": f"No onboarding tasks found for {emp.name}."}
        lines = []
        for i, t in enumerate(tasks, 1):
            status_icon = "✅" if t.is_completed else "⬜"
            lines.append(f"{i}. {status_icon} {t.task_name}")
        return {"answer": f"Onboarding checklist for {emp.name}:\n" + "\n".join(lines)}



@tool
def mark_task_complete(employee_email: str, task_name: str) -> dict:
    """Mark an onboarding task as completed for the logged-in employee."""
    from backend.database.models import OnboardingTask
    with get_db() as db:
        emp = _get_employee_by_email(db, employee_email)
        if not emp:
            return {"answer": f"Employee not found for email '{employee_email}'."}
        task = (
            db.query(OnboardingTask)
            .filter(
                OnboardingTask.employee_id == emp.id,
                OnboardingTask.task_name.ilike(f"%{task_name}%"),
            )
            .first()
        )
        if not task:
            return {"answer": f"No onboarding task matching '{task_name}' found for {emp.name}."}
        if task.is_completed:
            return {"answer": f"'{task.task_name}' is already marked as complete."}
        task.is_completed = True
        task.completed_at = datetime.utcnow()
        db.commit()
        return {"answer": f"✅ '{task.task_name}' marked as complete."}



@tool
def get_onboarding_progress(employee_email: str) -> dict:
    """Get onboarding progress for the logged-in employee."""
    from backend.database.models import OnboardingTask
    with get_db() as db:
        emp = _get_employee_by_email(db, employee_email)
        if not emp:
            return {"answer": f"Employee not found for email '{employee_email}'."}
        tasks = db.query(OnboardingTask).filter(OnboardingTask.employee_id == emp.id).all()
        if not tasks:
            return {"answer": f"No onboarding tasks found for {emp.name}."}
        total = len(tasks)
        completed = sum(1 for t in tasks if t.is_completed)
        percent = int((completed / total) * 100)
        return {
            "answer": f"Onboarding progress for {emp.name}: {percent}% ({completed} of {total} tasks completed)."
        }



@tool
def get_leave_summary(department: str = None) -> dict:
    """Get leave summary by department or overall."""
    with get_db() as db:
        query = db.query(Leave)
        if department:
            query = query.join(Employee).filter(Employee.department.ilike(f"%{department}%"))
        leaves = query.all()
        if not leaves:
            scope = f"the {department} department" if department else "all departments"
            return {"answer": f"No leave records found for {scope}."}
        summary = {}
        for leave in leaves:
            status = leave.status.value if hasattr(leave.status, "value") else leave.status
            summary[status] = summary.get(status, 0) + 1
        lines = [f"{status}: {count}" for status, count in sorted(summary.items())]
        scope = f"{department} department" if department else "all departments"
        return {"answer": f"Leave summary for {scope}:\n" + "\n".join(lines)}



@tool
def get_department_summary(department: str = None) -> dict:
    """Get department headcount and key metrics."""
    with get_db() as db:
        from backend.enums.statuses import EmployeeStatus
        query = db.query(Employee).filter(Employee.status == EmployeeStatus.ACTIVE)
        if department:
            query = query.filter(Employee.department.ilike(f"%{department}%"))
        employees = query.all()
        if not employees:
            scope = f"the {department} department" if department else "any department"
            return {"answer": f"No active employees found in {scope}."}
        total = len(employees)
        # Count managers: employees who are someone else's manager
        manager_ids = {e.manager_id for e in employees if e.manager_id}
        managers = sum(1 for e in employees if e.id in manager_ids)
        # Breakdown by department
        dept_counts = {}
        for e in employees:
            dept_counts[e.department or "Unassigned"] = dept_counts.get(e.department or "Unassigned", 0) + 1
        dept_lines = [f"  {dept}: {count}" for dept, count in sorted(dept_counts.items())]
        scope = f"{department} department" if department else "all departments"
        answer = (
            f"Department summary ({scope}):\n"
            f"Total active employees: {total}\n"
            f"Managers: {managers}\n"
            "Breakdown:\n" + "\n".join(dept_lines)
        )
        return {"answer": answer}



# ── Field policy ───────────────────────────────────────────────────────────────
# Fields the employee can update themselves
EMPLOYEE_UPDATABLE = {
    "phone":                      "Phone number",
    "phone_country_code":         "Phone country code",
    "address_line1":              "Address line 1",
    "address_line2":              "Address line 2",
    "city":                       "City",
    "state":                      "State / Province",
    "country":                    "Country",
    "emergency_contact_name":     "Emergency contact name",
    "emergency_contact_phone":    "Emergency contact phone",
    "emergency_contact_relation": "Emergency contact relation",
    "bank_name":                  "Bank name",
    "bank_branch":                "Bank branch",
    "account_holder_name":        "Account holder name",
    "date_of_birth":              "Date of birth",
    "gender":                     "Gender",
}

# Fields that require HR approval to change
HR_APPROVAL_REQUIRED = {
    "name":            "Full name",
    "email":           "Email address",
    "department":      "Department",
    "designation":     "Designation / Job title",
    "manager_id":      "Reporting manager",
    "employment_type": "Employment type",
    "bank_account_number": "Bank account number",
    "base_salary":     "Base salary",
    "status":          "Employment status",
    "role_id":         "Role / Access level",
    "phone_verified":  "Phone verification",
    "email_verified":  "Email verification",
    "profile_completed": "Profile completion flag",
}


@tool
def request_profile_update(employee_email: str, field: str, new_value: str) -> dict:
    """
    Update an employee profile field.
    - If caller is HR/admin → updates DB directly (no approval).
    - If caller is employee and field is employee‑updatable → updates directly.
    - If caller is employee and field requires HR approval → creates ApprovalRequest.
    """
    with get_db() as db:
        from backend.database.models import ApprovalRequest
        emp = _get_employee_by_email(db, employee_email)
        if not emp:
            return {"answer": f"Employee not found for email '{employee_email}'."}

        # Determine caller's role (use the token from the request? Not available here.
        # We'll use the employee making the request – but the tool only knows the target employee.
        # Actually we need the logged‑in user, not the target. This tool is called with the
        # logged‑in employee's email (passed from agent). So emp is the caller.
        # So we can get role from emp.role.
        is_hr = emp.role.name in [RoleName.HR, RoleName.ADMIN] if emp.role else False

        field = field.strip().lower()
        if field == "account_number":
            field = "bank_account_number"

        # Case 1: HR/admin can update any field directly
        if is_hr:
            if not hasattr(emp, field):
                return {"answer": f"Field '{field}' does not exist."}
            # Date handling
            if field == "date_of_birth":
                from datetime import datetime as _dt
                for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d %B %Y"):
                    try:
                        new_value = _dt.strptime(new_value.strip(), fmt).date()
                        break
                    except ValueError:
                        continue
            elif field in ("join_date", "date_of_birth"):
                # handled above
                pass
            elif field == "base_salary":
                try:
                    new_value = float(new_value)
                except:
                    pass
            setattr(emp, field, new_value)
            db.commit()
            field_label = HR_APPROVAL_REQUIRED.get(field, field)
            return {"answer": f"Updated {field_label} to '{new_value}'."}

        # Case 2: Employee updates directly (allowed fields)
        if field in EMPLOYEE_UPDATABLE:
            if not hasattr(emp, field):
                return {"answer": f"Field '{field}' does not exist."}
            old_value = getattr(emp, field)
            if field == "date_of_birth":
                from datetime import datetime as _dt
                for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d %B %Y"):
                    try:
                        new_value = _dt.strptime(new_value.strip(), fmt).date()
                        break
                    except ValueError:
                        continue
            setattr(emp, field, new_value)
            db.commit()
            field_label = EMPLOYEE_UPDATABLE[field]
            return {"answer": f"Done! Your {field_label} has been updated to '{new_value}'."}

        # Case 3: Employee requests HR‑approved field – create ApprovalRequest
        elif field in HR_APPROVAL_REQUIRED:
            existing = db.query(ApprovalRequest).filter(
                ApprovalRequest.employee_id == emp.id,
                ApprovalRequest.field_name == field,
                ApprovalRequest.status == ApprovalStatus.PENDING,
            ).first()
            if existing:
                return {"answer": f"You already have a pending request to change your {HR_APPROVAL_REQUIRED[field]}. Please wait for HR to review it."}

            old_value = getattr(emp, field)
            old_value_str = str(old_value) if old_value is not None else ""

            req = ApprovalRequest(
                employee_id=emp.id,
                requested_by_employee_id=emp.id,
                field_name=field,
                old_value=old_value_str,
                new_value=str(new_value),
                status=ApprovalStatus.PENDING,
            )
            db.add(req)
            db.commit()

            field_label = HR_APPROVAL_REQUIRED[field]
            # Notify HR via Notifier (fan-out to all HR + Admin)
            Notifier(db).to_hr(
                title=f"📋 Profile Change Request – {emp.name}",
                message=(
                    f"{emp.name} requested to change {field_label} "
                    f"from '{old_value_str}' to '{new_value}'. Please review."
                ),
            )
            hr_email = os.getenv("HR_EMAIL", "")
            if hr_email:
                try:
                    _send_email(hr_email, f"Profile Change Request – {emp.name}",
                                f"Employee: {emp.name} ({emp.email})\nField: {field_label}\nCurrent: {old_value_str}\nRequested: {new_value}")
                except Exception as e:
                    logger.warning(f"HR email failed: {e}")
            return {
                "answer": f"Your request to change your {field_label} to '{new_value}' has been sent to HR for approval. You'll be notified once it's reviewed."
            }

        else:
            updatable = ", ".join(EMPLOYEE_UPDATABLE.keys())
            hr_fields = ", ".join(HR_APPROVAL_REQUIRED.keys())
            return {
                "answer": f"I don't recognise '{field}' as a profile field. Fields you can update directly: {updatable}. Fields requiring HR approval: {hr_fields}."
            }




def get_all_tools():
    return [
        search_policies,
        lookup_employee,
        check_leave_balance,
        apply_leave,
        confirm_leave,
        approve_leave,
        reject_leave,
        cancel_leave_request,
        cancel_latest_pending_leave,
        request_profile_update,
        send_notification_email,
        get_onboarding_checklist,
        mark_task_complete,
        get_onboarding_progress,
        get_leave_summary,
        get_department_summary,
    ]