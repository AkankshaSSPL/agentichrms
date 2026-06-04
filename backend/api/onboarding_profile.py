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
from backend.database.models import Employee, Notification, Role, ApprovalRequest
from backend.core.security import verify_token
from backend.enums import RoleName, ApprovalStatus
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

# ── Fields an employee can edit themselves
EMPLOYEE_EDITABLE_FIELDS = {
    "gender", "date_of_birth",
    "address_line1", "address_line2", "city", "state", "country",
    "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation",
}

# Fields requiring HR approval (from tools_registry, duplicated here to avoid circular import)
HR_APPROVAL_REQUIRED = {
    "name": "Full name",
    "email": "Email address",
    "department": "Department",
    "designation": "Designation / Job title",
    "manager_id": "Reporting manager",
    "employment_type": "Employment type",
    "bank_account_number": "Bank account number",
    "base_salary": "Base salary",
    "status": "Employment status",
    "role_id": "Role / Access level",
    "phone_verified": "Phone verification",
    "email_verified": "Email verification",
    "profile_completed": "Profile completion flag",
}

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

HR AUTHORITY (CRITICAL):
- You are assisting HR, not the employee. HR has FULL authority over ALL fields including name, department, salary, and designation.
- If HR says "update the name", "change the name", or "rename" WITHOUT providing the new name — you MUST ask: "What should the new name be?"
- Only confirm and proceed once HR has explicitly given the NEW name (e.g. "change name to Riya" or you asked and they replied with the name).
- Never say "I'll update the name to [current name]" — that makes no sense. Only update when a DIFFERENT new name is clearly provided.
- HR can change any field at any time. Never refuse or redirect HR away from any field.

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

    # ── Name change: HR can directly update employee name ────────────────────
    name_changed = False
    new_name = None

    # Pattern 1: "change/update/rename name to X" in the message
    m1 = re.search(
        r"(?:change|update|rename|set)\s+(?:the\s+)?name\s+(?:to|as)\s+([A-Z][a-zA-Z ]{1,40}?)(?:\.|,|$|\n)",
        payload.message, re.IGNORECASE
    )
    if m1:
        candidate = m1.group(1).strip().rstrip(".,;")
        if 2 <= len(candidate) <= 50:
            new_name = candidate

    # Pattern 2: "new name: X" or "new name is X"
    if not new_name:
        m2 = re.search(
            r"new\s+name\s*[:\s]+([A-Z][a-zA-Z ]{1,40}?)(?:\.|,|$|\n)",
            payload.message, re.IGNORECASE
        )
        if m2:
            candidate = m2.group(1).strip().rstrip(".,;")
            if 2 <= len(candidate) <= 50:
                new_name = candidate

    # Pattern 3: plain name reply after bot asked for the new name
    if not new_name and payload.history:
        last_bot = next(
            (h["content"] for h in reversed(payload.history) if h.get("role") == "assistant"), ""
        )
        if any(kw in last_bot.lower() for kw in ["new name", "what name", "change to", "rename to"]):
            candidate = payload.message.strip().rstrip(".,;")
            if re.match(r"^[A-Z][a-zA-Z ]{1,40}$", candidate):
                new_name = candidate

    # Reject if new_name is the same as current name or a stop word
    stop_words = {"name", "the", "their", "her", "his", "to", "please", "update", "change"}
    if (new_name
            and new_name.lower() not in stop_words
            and new_name.strip().lower() != employee.name.strip().lower()):
        old_name = employee.name
        employee.name = new_name
        db.commit()
        name_changed = True
        logger.info("HR updated name: %s -> %s (emp %s)", old_name, new_name, employee.id)
        try:
            db.add(Notification(
                employee_id=employee.id,
                title="Name Updated by HR",
                message=f"Your name has been updated from {old_name} to {new_name} by HR.",
                is_read=False,
                created_at=datetime.utcnow(),
            ))
            db.commit()
        except Exception as ne:
            logger.warning("Name change notify failed: %s", ne)
            db.rollback()

    return {
        "reply": answer,
        "extracted_profile": profile_data,
        "profile_complete": profile_complete,
        "name_changed": name_changed,
        "new_name": new_name,
    }

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
    if not caller_payload or caller_payload.get("role") not in (RoleName.HR, RoleName.ADMIN):
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
    # Only allow employee-editable fields — reject anything else silently
    raw = {k: v for k, v in payload.dict().items() if v is not None}
    allowed = {k: v for k, v in raw.items() if k in EMPLOYEE_EDITABLE_FIELDS}
    if not allowed:
        return {"message": "No editable fields provided", "onboarding_completed": employee.onboarding_completed}
    apply_fields_to_employee(employee, allowed, db)
    employee.onboarding_completed = True
    employee.profile_completed = True
    db.commit()
    return {"message": "Profile saved", "onboarding_completed": True}

# ── Employee self-service chat ────────────────────────────────────
class SelfChatRequest(BaseModel):
    message: str
    history: Optional[List[dict]] = []
    resume_text: Optional[str] = None

def build_self_edit_prompt(employee: Employee) -> str:
    """System prompt scoped strictly to employee-editable fields."""
    profile = get_profile_columns(employee)
    editable = {k: profile.get(k) for k in EMPLOYEE_EDITABLE_FIELDS}
    filled = {k: v for k, v in editable.items() if v is not None and str(v).strip() not in ("", "None")}
    missing = [k for k in EMPLOYEE_EDITABLE_FIELDS if k not in filled]

    filled_lines = "\n".join(f"  - {COLUMN_LABELS.get(k,k)}: {v}" for k, v in filled.items()) or "  (none yet)"
    missing_lines = "\n".join(f"  - {COLUMN_LABELS.get(k,k)}" for k in missing) or "  (all filled)"

    all_fields = list(EMPLOYEE_EDITABLE_FIELDS)
    json_template = "{" + ", ".join(f'"{k}": ""' for k in all_fields) + "}"

    return f"""You are a friendly assistant helping {employee.name} update their personal profile.

IMPORTANT: You can ONLY update personal details. You cannot change name, email, department, designation, salary, or any work-related fields — those require HR approval.

ALREADY FILLED (do not ask again):
{filled_lines}

FIELDS YOU CAN HELP UPDATE:
{missing_lines}

RULES:
1. Only discuss the allowed fields above. If asked to change name, department, designation, salary or any work field, politely say "That requires HR approval — please contact your HR team."
2. Ask 1-2 questions at a time conversationally.
3. After collecting answers, save with: <PARTIAL_SAVE>{{"field": "value"}}</PARTIAL_SAVE>
4. When done, output: <PROFILE_DATA>{json_template}</PROFILE_DATA>
5. Be warm and concise.
"""

@router.post("/chat-self")
async def employee_self_chat(
    payload: SelfChatRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Employee updates only their own personal/contact fields — no work fields."""
    employee = get_current_employee(request, db)
    system_prompt = build_self_edit_prompt(employee)

    messages = [{"role": "system", "content": system_prompt}]
    for msg in payload.history:
        if msg.get("role") in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})

    user_content = payload.message
    if payload.resume_text:
        user_content = f"[Resume text]\n{payload.resume_text}\n\nMessage: {payload.message}"
    messages.append({"role": "user", "content": user_content})

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.AI_KEY}", "Content-Type": "application/json"},
                json={"model": settings.AI_MODEL, "temperature": 0.3, "max_tokens": 800, "messages": messages},
            )
            data = response.json()
    except Exception as e:
        raise HTTPException(500, f"AI error: {e}")

    if "error" in data:
        raise HTTPException(500, data["error"].get("message", "AI error"))

    answer = data["choices"][0]["message"]["content"]

    # Partial save — enforce whitelist
    for m in re.finditer(r"<PARTIAL_SAVE>(.*?)</PARTIAL_SAVE>", answer, re.DOTALL):
        try:
            raw = json.loads(m.group(1).strip())
            allowed = {k: v for k, v in raw.items() if k in EMPLOYEE_EDITABLE_FIELDS}
            apply_fields_to_employee(employee, allowed, db)
        except Exception as e:
            logger.warning("Self partial save failed: %s", e)
    answer = re.sub(r"<PARTIAL_SAVE>.*?</PARTIAL_SAVE>", "", answer, flags=re.DOTALL).strip()

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
                allowed = {k: v for k, v in profile_data.items() if k in EMPLOYEE_EDITABLE_FIELDS}
                apply_fields_to_employee(employee, allowed, db)
        except Exception as e:
            logger.error("Self profile parse failed: %s", e)

    return {"reply": answer, "profile_complete": profile_complete}

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
        if caller_role not in (RoleName.HR, RoleName.ADMIN):
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

# ── Approval Request endpoints (HR only) ──────────────────────────────────────
class ApproveRejectPayload(BaseModel):
    notes: Optional[str] = None

@router.get("/approval-requests/pending")
def get_pending_approval_requests(request: Request, db: Session = Depends(get_db)):
    """HR/admin: get all pending profile change requests."""
    employee = get_current_employee(request, db)
    if employee.role.name not in [RoleName.HR, RoleName.ADMIN]:
        raise HTTPException(403, "Only HR/Admin can view pending requests")

    requests = db.query(ApprovalRequest).filter(ApprovalRequest.status == ApprovalStatus.PENDING).order_by(ApprovalRequest.created_at.desc()).all()
    result = []
    for req in requests:
        emp = db.query(Employee).get(req.employee_id)
        if not emp:
            continue
        result.append({
            "id": req.id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "field_name": req.field_name,
            "field_label": HR_APPROVAL_REQUIRED.get(req.field_name, req.field_name),
            "old_value": req.old_value,
            "new_value": req.new_value,
            "created_at": req.created_at.isoformat(),
        })
    return result

@router.post("/approval-requests/{request_id}/approve")
def approve_approval_request(
    request_id: int,
    payload: ApproveRejectPayload,
    request: Request,
    db: Session = Depends(get_db)
):
    employee = get_current_employee(request, db)
    if employee.role.name not in [RoleName.HR, RoleName.ADMIN]:
        raise HTTPException(403, "Only HR/Admin can approve requests")

    approval_req = db.query(ApprovalRequest).filter(ApprovalRequest.id == request_id).first()
    if not approval_req:
        raise HTTPException(404, "Request not found")
    if approval_req.status != "pending":
        raise HTTPException(400, f"Request already {approval_req.status}")

    target_emp = db.query(Employee).get(approval_req.employee_id)
    if not target_emp:
        raise HTTPException(404, "Employee not found")

    # Apply the change
    field = approval_req.field_name
    new_val = approval_req.new_value
    if hasattr(target_emp, field):
        # Date fields
        if field in ("join_date", "date_of_birth"):
            from datetime import datetime as dt
            for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d %B %Y"):
                try:
                    parsed = dt.strptime(new_val, fmt)
                    if field == "date_of_birth":
                        setattr(target_emp, field, parsed.date())
                    else:
                        setattr(target_emp, field, parsed)
                    break
                except ValueError:
                    continue
        elif field == "base_salary":
            try:
                setattr(target_emp, field, float(new_val))
            except ValueError:
                pass
        else:
            setattr(target_emp, field, new_val)

    approval_req.status = ApprovalStatus.APPROVED
    approval_req.resolved_at = datetime.utcnow()
    approval_req.resolved_by_employee_id = employee.id
    approval_req.reason = payload.notes
    db.commit()

    # Notify employee
    db.add(Notification(
        employee_id=target_emp.id,
        title="Profile change approved",
        message=f"Your request to change {HR_APPROVAL_REQUIRED.get(field, field)} to '{new_val}' has been approved by {employee.name}.",
        is_read=False,
    ))
    db.commit()

    return {"message": "Request approved and changes applied"}

@router.post("/approval-requests/{request_id}/reject")
def reject_approval_request(
    request_id: int,
    payload: ApproveRejectPayload,
    request: Request,
    db: Session = Depends(get_db)
):
    employee = get_current_employee(request, db)
    if employee.role.name not in [RoleName.HR, RoleName.ADMIN]:
        raise HTTPException(403, "Only HR/Admin can reject requests")

    approval_req = db.query(ApprovalRequest).filter(ApprovalRequest.id == request_id).first()
    if not approval_req:
        raise HTTPException(404, "Request not found")
    if approval_req.status != "pending":
        raise HTTPException(400, f"Request already {approval_req.status}")

    approval_req.status = ApprovalStatus.REJECTED
    approval_req.resolved_at = datetime.utcnow()
    approval_req.resolved_by_employee_id = employee.id
    approval_req.reason = payload.notes
    db.commit()

    db.add(Notification(
        employee_id=approval_req.employee_id,
        title="Profile change rejected",
        message=f"Your request to change {HR_APPROVAL_REQUIRED.get(approval_req.field_name, approval_req.field_name)} was rejected by {employee.name}. Reason: {payload.notes or 'No reason provided'}",
        is_read=False,
    ))
    db.commit()

    return {"message": "Request rejected"}

# ── HR direct update endpoint (no approval) ───────────────────────────────────
class HRDirectUpdateRequest(BaseModel):
    fields: dict

@router.patch("/employee/{employee_id}/profile")
def hr_direct_update(
    employee_id: int,
    payload: HRDirectUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """HR/admin can directly update any profile field of any employee."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    caller_payload = verify_token(auth.split(" ")[1])
    if not caller_payload or caller_payload.get("role") not in (RoleName.HR, RoleName.ADMIN):
        raise HTTPException(403, "Only HR or admin can update profiles")

    target = db.query(Employee).filter(Employee.id == employee_id).first()
    if not target:
        raise HTTPException(404, "Employee not found")

    date_fields = {"join_date", "date_of_birth"}
    for key, val in payload.fields.items():
        if not hasattr(target, key):
            continue
        if key in date_fields and val:
            try:
                parsed = datetime.strptime(val, "%Y-%m-%d").date()
                setattr(target, key, parsed)
            except Exception:
                pass
        elif key == "base_salary" and val:
            try:
                setattr(target, key, float(val))
            except Exception:
                pass
        else:
            setattr(target, key, val)

    # Notify employee
    db.add(Notification(
        employee_id=target.id,
        title="Profile Updated by HR",
        message=f"HR has updated: {', '.join(payload.fields.keys())}. Please review your profile.",
        is_read=False,
    ))
    db.commit()
    return {"message": "Profile updated", "updated_fields": list(payload.fields.keys())}