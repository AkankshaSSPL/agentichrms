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

from backend.database.session import SessionLocal
from backend.database.models import Employee
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

    return f"""You are a friendly HR onboarding assistant for {employee.name}.

ALREADY FILLED — DO NOT ASK FOR THESE:
{filled_lines}

REQUIRED FIELDS YOU MUST COLLECT:
{required_lines}

OPTIONAL FIELDS (ask but accept skip):
{optional_lines}

RULES:
1. Only ask for MISSING fields. Never re-ask already-filled ones.
2. Ask 1-2 related fields at a time. Never dump all questions at once.
3. Accept natural language — infer correct values (e.g. "I joined in January 2024" → 2024-01-01).
4. If resume is provided, extract everything you can and confirm gaps.
5. Be warm, concise, encouraging. Use the employee's first name sometimes.
6. After collecting a group of answers, output a partial save tag immediately:
   <PARTIAL_SAVE>{{"field": "value"}}</PARTIAL_SAVE>
7. When ALL required fields are collected (optional can be skipped), output at end of message:
   <PROFILE_DATA>{json_template}</PROFILE_DATA>
   with only newly collected values filled in (leave others as empty string "").
8. If all required fields were already filled, say so and output <PROFILE_DATA>{{}}</PROFILE_DATA>.
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
                # fallback: just try the first 10 chars as YYYY-MM-DD
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


# ── PDF Resume Extraction ─────────────────────────────────────────────────────
class ResumeExtractRequest(BaseModel):
    pdf_base64: str
    filename: Optional[str] = "resume.pdf"


@router.post("/extract-resume")
async def extract_resume(payload: ResumeExtractRequest, request: Request, db: Session = Depends(get_db)):
    """Decode base64 PDF and extract plain text using pypdf."""
    get_current_employee(request, db)  # auth check only
    try:
        pdf_bytes = base64.b64decode(payload.pdf_base64)
        text = ""
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            try:
                import PyPDF2
                reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
                text = "\n".join(page.extract_text() or "" for page in reader.pages)
            except ImportError:
                logger.error("pypdf not installed")
                return {"text": "", "error": "pypdf not installed. Run: pip install pypdf --break-system-packages"}
        text = text.strip()[:8000]
        logger.info("Extracted %d chars from %s", len(text), payload.filename)
        return {"text": text, "chars": len(text)}
    except Exception as e:
        logger.error("PDF extraction error: %s", e)
        return {"text": "", "error": str(e)}


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
def get_my_profile(request: Request, db: Session = Depends(get_db)):
    emp = get_current_employee(request, db)
    profile = get_profile_columns(emp)
    return {
        "id": emp.id, "name": emp.name, "email": emp.email, "phone": emp.phone,
        "role": emp.role.name if emp.role else None,
        "onboarding_completed": emp.onboarding_completed,
        "profile_completed": emp.profile_completed,
        **{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in profile.items()},
    }