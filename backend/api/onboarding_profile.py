"""
Onboarding Profile API – fully dynamic, no hardcoded fields.
The AI is told which columns exist in the DB and which are currently empty
for this employee. It decides what to ask and saves field-by-field as it goes.
"""

import logging
import json
import re
import base64
import io
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect
from pydantic import BaseModel
from typing import Optional, List, Any
import httpx
from pypdf import PdfReader

from backend.database.session import SessionLocal
from backend.database.models import Employee, NameChangeRequest, Notification, Role
from backend.core.security import verify_token
from backend.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/onboarding-profile", tags=["Onboarding Profile"])

# ── Columns to NEVER ask about
SKIP_COLUMNS = {
    "id", "name", "email", "phone", "phone_country_code",
    "permanent_pin", "permanent_pin_hash", "pin_type", "pin_set_at",
    "face_enrolled", "face_embedding", "face_registered",
    "face_enrollment_date", "face_samples_count",
    "email_verified", "phone_verified",
    "onboarding_completed", "profile_completed",
    "role_id", "manager_id", "employee_code",
    "status", "created_at", "updated_at", "deleted_at",
}

COLUMN_LABELS = {
    "department": "Department",
    "designation": "Job Title / Designation",
    "join_date": "Date of Joining (YYYY-MM-DD)",
    "employment_type": "Employment Type (Full-time / Part-time / Contract)",
    "date_of_birth": "Date of Birth (YYYY-MM-DD)",
    "gender": "Gender (Male / Female / Other)",
    "address_line1": "Address Line 1",
    "address_line2": "Address Line 2 (optional)",
    "city": "City",
    "state": "State / Province",
    "country": "Country",
    "emergency_contact_name": "Emergency Contact Name",
    "emergency_contact_phone": "Emergency Contact Phone",
    "emergency_contact_relation": "Emergency Contact Relation",
    "bank_name": "Bank Name",
    "account_holder_name": "Account Holder Name",
    "account_number": "Bank Account Number",
    "bank_branch": "Bank Branch",
    "base_salary": "Base Salary (optional)",
}

OPTIONAL_COLUMNS = {"address_line2", "base_salary"}

# Keywords for name change detection (kept for fallback)
NAME_CHANGE_KEYWORDS = [
    "change my name", "update my name", "new name", "got married",
    "i got married", "after marriage", "legal name", "name change",
    "married name", "changed my name", "my name is now", "rename me"
]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_employee(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload:
        raise HTTPException(401, "Invalid token")
    emp = db.query(Employee).filter(Employee.id == int(payload["sub"])).first()
    if not emp:
        raise HTTPException(404, "Employee not found")
    return emp


def get_profile_columns(employee: Employee) -> dict:
    mapper = sa_inspect(Employee)
    result = {}
    for col in mapper.columns:
        name = col.key
        if name in SKIP_COLUMNS:
            continue
        val = getattr(employee, name, None)
        result[name] = val
    return result


def build_dynamic_system_prompt(employee: Employee) -> str:
    profile = get_profile_columns(employee)

    filled = {k: v for k, v in profile.items() if v is not None and str(v).strip() not in ("", "None")}
    missing_required = [k for k, v in profile.items() if (v is None or str(v).strip() in ("", "None")) and k not in OPTIONAL_COLUMNS]
    missing_optional = [k for k, v in profile.items() if (v is None or str(v).strip() in ("", "None")) and k in OPTIONAL_COLUMNS]

    filled_lines = "\n".join(f"  - {COLUMN_LABELS.get(k,k)}: {v}" for k, v in filled.items()) or "  (none yet)"
    required_lines = "\n".join(f"  - {k}: {COLUMN_LABELS.get(k,k)}" for k in missing_required) or "  (all filled!)"
    optional_lines = "\n".join(f"  - {k}: {COLUMN_LABELS.get(k,k)}" for k in missing_optional) or "  (none)"

    all_fields = list(profile.keys())
    json_template = "{" + ", ".join(f'"{k}": ""' for k in all_fields) + "}"

    first_name = employee.name.split()[0] if employee.name else employee.name

    return f"""You are a warm, friendly HR onboarding assistant helping {first_name} set up their profile.

ALREADY FILLED — NEVER ask for these again:
{filled_lines}

REQUIRED FIELDS STILL NEEDED:
{required_lines}

OPTIONAL FIELDS (ask casually, accept if they skip):
{optional_lines}

NAME CHANGE HANDLING (CRITICAL):
- If the user mentions getting married, changing their name, or a legal name update:
  1. Ask for their new full name in a natural way (e.g. "What would you like your new name to be?")
  2. Ask for the reason if not already stated (marriage / legal / correction)
  3. Confirm: "I've submitted your name-change request to HR for approval. You can upload a marriage certificate later."
  4. Then continue with remaining profile fields.
  5. NEVER skip to profile fields without acknowledging the name change first.
  6. The system will automatically create the request record — you don't need to do anything special.

PERSONALITY & TONE RULES:
- Talk like a helpful colleague, not a form. Be casual, warm, encouraging.
- Use {first_name}'s name occasionally but not every message.
- Keep messages short — 2-4 sentences max unless confirming multiple things.
- Never use bullet points or numbered lists in your replies.
- Never start a message with "Great!" or "Sure!" — vary your acknowledgements.
- When someone gives you info, acknowledge it naturally in 1 sentence then move on.

RESUME HANDLING (CRITICAL):
- If a resume is provided, silently extract everything you can. DO NOT show the user a list of what you extracted.
- Instead, just say something like: "Thanks! I've pulled a few things from your resume. Let me just confirm a couple of details..."
- Then ask ONLY about the 1-2 most important missing fields, naturally in conversation.
- Never show a bullet-point summary of extracted data to the user. Ever.

CONVERSATION RULES:
1. Ask for MISSING fields only. Never re-ask filled ones.
2. Ask 1-2 related things at a time — never dump everything at once.
3. Accept natural language and infer values ("joined in Jan 2024" → 2024-01-01).
4. After each group of answers, immediately output a save tag (invisible to user):
   <PARTIAL_SAVE>{{"field": "value"}}</PARTIAL_SAVE>
5. When ALL required fields collected (optional can be skipped), output at end of your message:
   <PROFILE_DATA>{json_template}</PROFILE_DATA>
   Only include newly collected values (leave others as empty string "").
6. If all required fields were already filled, say so warmly and output <PROFILE_DATA>{{}}</PROFILE_DATA>.
"""


def _detect_and_create_name_change(employee: Employee, new_name: str, reason: str, db) -> str | None:
    """
    Creates a NameChangeRequest record and notifies HR.
    Returns a confirmation string if created, else None.
    """
    if not new_name or new_name.strip() == employee.name:
        return None

    # Create the request using the correct field names (old_name, new_name)
    ncr = NameChangeRequest(
        employee_id=employee.id,
        old_name=employee.name,
        new_name=new_name.strip(),
        reason=reason or "marriage",
        document_provided=False,
        status="pending",
    )
    db.add(ncr)
    db.flush()

    # Notify HR via database notifications
    try:
        hr_roles = db.query(Role).filter(Role.name.in_(["hr", "admin"])).all()
        hr_ids = [r.id for r in hr_roles]
        hr_emps = db.query(Employee).filter(Employee.role_id.in_(hr_ids)).all()
        for hr in hr_emps:
            db.add(Notification(
                employee_id=hr.id,
                title="📝 Name Change Request",
                message=f"{employee.name} has requested a name change to '{new_name}'. No document provided yet.",
                is_read=False,
            ))
    except Exception as e:
        logger.warning("HR notify failed: %s", e)

    db.commit()

    # Optional: send email to HR
    try:
        from backend.core.email import send_email
        import os
        hr_email = os.getenv("HR_EMAIL", "")
        if hr_email:
            send_email(
                to=hr_email,
                subject=f"Name Change Request — {employee.name}",
                body=(
                    f"Employee: {employee.name} ({employee.email})\n"
                    f"Requested name: {new_name}\n"
                    f"Reason: {reason or 'marriage'}\n"
                    f"Document: NOT provided yet.\n\n"
                    f"Review in HR Dashboard → Name Change Requests tab."
                ),
                triggered_by="name_change_request",
            )
    except Exception as e:
        logger.warning("HR email failed: %s", e)

    return (
        f"Your name-change request to '{new_name}' has been submitted to HR for approval. "
        f"You'll be notified once they review it. "
        f"You can also upload a supporting document (e.g. marriage certificate) later from your profile."
    )


def apply_fields_to_employee(employee: Employee, fields: dict, db: Session):
    date_fields = {"join_date", "date_of_birth"}
    for key, val in fields.items():
        if not val or str(val).strip() in ("", "None"):
            continue
        if not hasattr(employee, key):
            continue
        if key in date_fields:
            for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%B %d, %Y", "%d %B %Y", "%Y-%m-%dT%H:%M:%S"):
                try:
                    parsed = datetime.strptime(str(val).strip()[:10], fmt[:len(str(val).strip()[:10])])
                    setattr(employee, key, parsed.date() if key == "date_of_birth" else parsed)
                    break
                except ValueError:
                    continue
            else:
                try:
                    setattr(employee, key, datetime.strptime(str(val).strip()[:10], "%Y-%m-%d"))
                except Exception:
                    pass
        elif key == "base_salary":
            try:
                setattr(employee, key, float(str(val).replace(",", "")))
            except (ValueError, TypeError):
                pass
        else:
            setattr(employee, key, str(val).strip())
    db.commit()


class OnboardingChatRequest(BaseModel):
    message: str
    history: Optional[List[dict]] = []
    resume_text: Optional[str] = None


@router.post("/chat")
async def onboarding_chat(
    payload: OnboardingChatRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    employee = get_current_employee(request, db)
    system_prompt = build_dynamic_system_prompt(employee)

    messages = [{"role": "system", "content": system_prompt}]
    for msg in payload.history:
        if msg.get("role") in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})

    user_content = payload.message
    if payload.resume_text:
        user_content = f"[Resume uploaded]\n\nResume:\n{payload.resume_text}\n\nMessage: {payload.message}"
    messages.append({"role": "user", "content": user_content})

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.AI_KEY}", "Content-Type": "application/json"},
                json={"model": settings.AI_MODEL, "temperature": 0.3, "max_tokens": 1024, "messages": messages},
            )
            data = response.json()
    except Exception as e:
        logger.error("OpenAI error: %s", e)
        raise HTTPException(500, f"AI service error: {e}")

    if "error" in data:
        raise HTTPException(500, data["error"].get("message", "AI error"))

    answer = data["choices"][0]["message"]["content"]

    # Partial save
    for m in re.finditer(r"<PARTIAL_SAVE>(.*?)</PARTIAL_SAVE>", answer, re.DOTALL):
        try:
            apply_fields_to_employee(employee, json.loads(m.group(1).strip()), db)
        except Exception as e:
            logger.warning("Partial save failed: %s", e)
    answer = re.sub(r"<PARTIAL_SAVE>.*?</PARTIAL_SAVE>", "", answer, flags=re.DOTALL).strip()

    # ── Name change detection (reliable extraction from AI's confirmation) ──
    try:
        # Look for phrases that indicate a name change request was submitted
        confirmation_phrases = [
            "submitted your name-change request",
            "submitted your name change request",
            "name-change request to hr",
            "name change request to hr",
            "submitted to hr for approval"
        ]
        if any(phrase in answer.lower() for phrase in confirmation_phrases):
            # Try to extract the new name from the AI's answer
            # Patterns: "to 'Nikita'", "to Nikita", "to 'Nikita'", "to Nikita"
            patterns = [
                r"to ['\"]?([A-Za-z]+(?:\s+[A-Za-z]+)*)['\"]?",
                r"name-change request to (['\"]?)([A-Za-z]+(?:\s+[A-Za-z]+)*)\1",
                r"change your name to (['\"]?)([A-Za-z]+(?:\s+[A-Za-z]+)*)\1",
            ]
            new_name = None
            for pat in patterns:
                m = re.search(pat, answer, re.IGNORECASE)
                if m:
                    # The name may be in group 1 or group 2 depending on pattern
                    candidate = m.group(1) if len(m.groups()) == 1 else m.group(2)
                    candidate = candidate.strip()
                    # Remove any stray quotes
                    candidate = candidate.strip("'\"")
                    if candidate and candidate.lower() != employee.name.lower():
                        new_name = candidate
                        break
            
            if new_name:
                # Check for duplicate pending request
                existing = db.query(NameChangeRequest).filter(
                    NameChangeRequest.employee_id == employee.id,
                    NameChangeRequest.status.in_(["pending", "awaiting_document"])
                ).first()
                if not existing:
                    # Extract reason from user messages
                    all_user_msgs = [h["content"] for h in (payload.history or []) if h.get("role") == "user"]
                    all_user_msgs.append(payload.message)
                    reason = "marriage"
                    for msg in all_user_msgs:
                        for kw in ["marriage", "married", "legal", "correction", "divorce"]:
                            if kw in msg.lower():
                                reason = kw
                                break
                        if reason != "marriage":
                            break
                    confirm_msg = _detect_and_create_name_change(employee, new_name, reason, db)
                    if confirm_msg and confirm_msg not in answer:
                        answer = answer + "\n\n" + confirm_msg
                    logger.info("Name change request created from AI confirmation: %s → %s", employee.name, new_name)
    except Exception as e:
        logger.warning("Name change detection error: %s", e)

    # Full profile complete
    profile_data = None
    profile_complete = False
    pm = re.search(r"<PROFILE_DATA>(.*?)</PROFILE_DATA>", answer, re.DOTALL)
    if pm:
        try:
            raw = pm.group(1).strip()
            profile_data = json.loads(raw) if raw and raw != "{}" else {}
            profile_complete = True
            answer = re.sub(r"<PROFILE_DATA>.*?</PROFILE_DATA>", "", answer, flags=re.DOTALL).strip()
            if profile_data:
                apply_fields_to_employee(employee, profile_data, db)
            employee.onboarding_completed = True
            employee.profile_completed = True
            db.commit()
        except Exception as e:
            logger.error("Profile parse failed: %s", e)

    return {"reply": answer, "extracted_profile": profile_data, "profile_complete": profile_complete}


# ── Resume text extraction endpoint ─────────────────────────────────────────
@router.post("/extract-resume")
async def extract_resume_text(request: Request):
    try:
        data = await request.json()
        pdf_base64 = data.get("pdf_base64")
        if not pdf_base64:
            return {"text": ""}
        pdf_bytes = base64.b64decode(pdf_base64)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        return {"text": text[:8000]}
    except Exception as e:
        logger.error(f"PDF extraction failed: {e}")
        return {"text": ""}


# ── HR can fill profile on behalf of employee ─────────────────────────────
class OnboardingChatForRequest(BaseModel):
    employee_id: int
    message: str
    history: Optional[List[dict]] = []
    resume_text: Optional[str] = None


@router.post("/chat-for")
async def onboarding_chat_for_hr(
    payload: OnboardingChatForRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """HR endpoint to fill profile for another employee."""
    # Verify caller is HR or admin
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    caller_payload = verify_token(auth.split(" ")[1])
    if not caller_payload or caller_payload.get("role") not in ("hr", "admin"):
        raise HTTPException(403, "Only HR or admin can fill profiles for other employees")

    # Get target employee
    target_employee = db.query(Employee).filter(Employee.id == payload.employee_id).first()
    if not target_employee:
        raise HTTPException(404, "Employee not found")

    system_prompt = build_dynamic_system_prompt(target_employee)

    messages = [{"role": "system", "content": system_prompt}]
    for msg in payload.history:
        if msg.get("role") in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})

    user_content = payload.message
    if payload.resume_text:
        user_content = f"[Resume uploaded]\n\nResume:\n{payload.resume_text}\n\nMessage: {payload.message}"
    messages.append({"role": "user", "content": user_content})

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.AI_KEY}", "Content-Type": "application/json"},
                json={"model": settings.AI_MODEL, "temperature": 0.3, "max_tokens": 1024, "messages": messages},
            )
            data = response.json()
    except Exception as e:
        logger.error("OpenAI error: %s", e)
        raise HTTPException(500, f"AI service error: {e}")

    if "error" in data:
        raise HTTPException(500, data["error"].get("message", "AI error"))

    answer = data["choices"][0]["message"]["content"]

    # Partial save
    for m in re.finditer(r"<PARTIAL_SAVE>(.*?)</PARTIAL_SAVE>", answer, re.DOTALL):
        try:
            apply_fields_to_employee(target_employee, json.loads(m.group(1).strip()), db)
        except Exception as e:
            logger.warning("Partial save failed: %s", e)
    answer = re.sub(r"<PARTIAL_SAVE>.*?</PARTIAL_SAVE>", "", answer, flags=re.DOTALL).strip()

    # Full profile complete
    profile_data = None
    profile_complete = False
    pm = re.search(r"<PROFILE_DATA>(.*?)</PROFILE_DATA>", answer, re.DOTALL)
    if pm:
        try:
            raw = pm.group(1).strip()
            profile_data = json.loads(raw) if raw and raw != "{}" else {}
            profile_complete = True
            answer = re.sub(r"<PROFILE_DATA>.*?</PROFILE_DATA>", "", answer, flags=re.DOTALL).strip()
            if profile_data:
                apply_fields_to_employee(target_employee, profile_data, db)
            target_employee.onboarding_completed = True
            target_employee.profile_completed = True
            db.commit()
        except Exception as e:
            logger.error("Profile parse failed: %s", e)

    return {"reply": answer, "extracted_profile": profile_data, "profile_complete": profile_complete}


class ProfileSaveRequest(BaseModel):
    department: Optional[str] = None
    designation: Optional[str] = None
    join_date: Optional[str] = None
    employment_type: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    emergency_contact_relation: Optional[str] = None
    bank_name: Optional[str] = None
    account_holder_name: Optional[str] = None
    account_number: Optional[str] = None
    bank_branch: Optional[str] = None
    base_salary: Optional[float] = None


@router.post("/save")
async def save_profile(payload: ProfileSaveRequest, request: Request, db: Session = Depends(get_db)):
    employee = get_current_employee(request, db)
    apply_fields_to_employee(employee, {k: v for k, v in payload.dict().items() if v is not None}, db)
    employee.onboarding_completed = True
    employee.profile_completed = True
    db.commit()
    return {"message": "Profile saved", "onboarding_completed": True}


@router.get("/me")
def get_my_profile(request: Request, employee_id: Optional[int] = None, db: Session = Depends(get_db)):
    """
    Returns profile for the logged-in employee.
    HR/admin can pass ?employee_id=N to read any employee's profile.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    from backend.core.security import verify_token as _vt
    payload = _vt(auth.split(" ")[1])
    if not payload:
        raise HTTPException(401, "Invalid token")

    # If employee_id provided, caller must be hr or admin
    if employee_id:
        caller_role = payload.get("role", "employee")
        if caller_role not in ("hr", "admin"):
            raise HTTPException(403, "Only HR or admin can view other employees' profiles")
        emp = db.query(Employee).filter(Employee.id == employee_id).first()
        if not emp:
            raise HTTPException(404, "Employee not found")
    else:
        emp = db.query(Employee).filter(Employee.id == int(payload["sub"])).first()
        if not emp:
            raise HTTPException(404, "Employee not found")

    profile = get_profile_columns(emp)
    return {
        "id": emp.id, "name": emp.name, "email": emp.email, "phone": emp.phone,
        "role": emp.role.name if emp.role else None,
        "onboarding_completed": emp.onboarding_completed,
        "profile_completed": emp.profile_completed,
        **{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in profile.items()},
    }


# ── Endpoint for HR to get pending name change requests ──────────────────────
@router.get("/name-change-requests")
def get_name_change_requests(
    request: Request,
    db: Session = Depends(get_db),
):
    """Return all name change requests (for HR/admin panel)"""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    payload = verify_token(auth.split(" ")[1])
    if not payload or payload.get("role") not in ("admin", "hr"):
        raise HTTPException(403, "Only HR or admin can view name change requests")
    requests = db.query(NameChangeRequest).order_by(NameChangeRequest.created_at.desc()).all()
    result = []
    for req in requests:
        emp = db.query(Employee).filter(Employee.id == req.employee_id).first()
        result.append({
            "id": req.id,
            "employee_id": req.employee_id,
            "employee_name": emp.name if emp else "",
            "employee_email": emp.email if emp else "",
            "current_name": req.old_name,
            "requested_name": req.new_name,
            "reason": req.reason,
            "status": req.status,
            "document_provided": req.document_provided,
            "created_at": req.created_at.isoformat() if req.created_at else None,
        })
    return result