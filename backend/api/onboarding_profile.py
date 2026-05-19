"""
Onboarding Profile API
POST /api/onboarding-profile/chat   — AI chat for collecting profile data
POST /api/onboarding-profile/save   — Save extracted profile fields
GET  /api/onboarding-profile/me     — Get current employee's profile
"""

import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime

from backend.database.session import SessionLocal
from backend.database.models import Employee
from backend.core.security import verify_token
from backend.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/onboarding-profile", tags=["Onboarding Profile"])


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


# ── Chat endpoint ─────────────────────────────────────────────────────────────
class OnboardingChatRequest(BaseModel):
    message: str
    history: Optional[List[dict]] = []
    resume_text: Optional[str] = None   # extracted text from uploaded resume


SYSTEM_PROMPT = """You are a friendly HR onboarding assistant. Your job is to collect the employee's profile information through natural conversation.

Fields to collect (collect them conversationally, one topic at a time):
1. Department (e.g. Engineering, Marketing, Finance, HR, Sales, Operations)
2. Designation / Job Title
3. Date of Joining (format: YYYY-MM-DD)
4. Employment Type (Full-time, Part-time, Contract, Intern)
5. Date of Birth (format: YYYY-MM-DD)
6. Gender (Male, Female, Other)
7. Address Line 1
8. Address Line 2 (optional)
9. City
10. State/Province
11. Country
12. Emergency Contact Name
13. Emergency Contact Phone
14. Emergency Contact Relation (e.g. Father, Spouse, Friend)
15. Bank Name
16. Account Holder Name
17. Account Number
18. Bank Branch
19. Base Salary (number only)

RULES:
- Be warm, friendly and conversational. Never list all fields at once.
- Ask 1-2 related questions at a time (e.g. ask name + department together, then address fields together).
- Accept natural language and infer the correct value (e.g. "I joined last Monday" → compute date).
- If a resume is provided, extract all fields you can from it and ask the user to confirm or fill gaps.
- When you have collected ALL required fields (all except optional ones), say exactly: "PROFILE_COMPLETE" on its own line, followed by a JSON block with all collected fields like this:

PROFILE_COMPLETE
```json
{
  "department": "...",
  "designation": "...",
  "join_date": "YYYY-MM-DD",
  "employment_type": "...",
  "date_of_birth": "YYYY-MM-DD",
  "gender": "...",
  "address_line1": "...",
  "address_line2": "...",
  "city": "...",
  "state": "...",
  "country": "...",
  "emergency_contact_name": "...",
  "emergency_contact_phone": "...",
  "emergency_contact_relation": "...",
  "bank_name": "...",
  "account_holder_name": "...",
  "account_number": "...",
  "bank_branch": "...",
  "base_salary": 0
}
```

- Skip optional fields (address_line2) if the user says they don't have them.
- If the user uploads a resume, say which fields you extracted and which still need confirmation.
- Keep responses concise and friendly. Use emojis sparingly.
"""


@router.post("/chat")
async def onboarding_chat(
    req: OnboardingChatRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    employee = get_current_employee(request, db)

    # Build messages for Claude API
    messages = []

    # Add history
    for msg in req.history:
        if msg.get("role") in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})

    # Current user message — include resume text if provided
    user_content = req.message
    if req.resume_text:
        user_content = f"[Resume uploaded]\n\nExtracted resume text:\n{req.resume_text}\n\nUser message: {req.message}"

    messages.append({"role": "user", "content": user_content})

    # Call OpenAI API
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.AI_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.AI_MODEL,
                    "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
                    "temperature": 0.4,
                    "max_tokens": 1024,
                },
            )
            data = response.json()
    except Exception as e:
        logger.error("OpenAI API error: %s", e)
        raise HTTPException(500, f"AI service error: {str(e)}")

    if "error" in data:
        raise HTTPException(500, data["error"].get("message", "AI error"))

    reply = data["choices"][0]["message"]["content"] if data.get("choices") else ""

    # Check if profile is complete
    profile_complete = "PROFILE_COMPLETE" in reply
    extracted = None

    if profile_complete:
        try:
            import re
            json_match = re.search(r"```json\s*([\s\S]+?)\s*```", reply)
            if json_match:
                extracted = json.loads(json_match.group(1))
        except Exception as e:
            logger.warning("Failed to parse profile JSON: %s", e)

    return JSONResponse({
        "reply": reply,
        "profile_complete": profile_complete,
        "extracted_profile": extracted,
    })


# ── Save profile endpoint ─────────────────────────────────────────────────────
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


def _parse_date(val: Optional[str]):
    if not val:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    return None


@router.post("/save")
def save_profile(
    req: ProfileSaveRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    employee = get_current_employee(request, db)

    # Map all fields
    if req.department:           employee.department = req.department
    if req.designation:          employee.designation = req.designation
    if req.join_date:            employee.join_date = _parse_date(req.join_date)
    if req.employment_type:      employee.employment_type = req.employment_type
    if req.date_of_birth:        employee.date_of_birth = _parse_date(req.date_of_birth)
    if req.gender:               employee.gender = req.gender
    if req.address_line1:        employee.address_line1 = req.address_line1
    if req.address_line2:        employee.address_line2 = req.address_line2
    if req.city:                 employee.city = req.city
    if req.state:                employee.state = req.state
    if req.country:              employee.country = req.country
    if req.emergency_contact_name:     employee.emergency_contact_name = req.emergency_contact_name
    if req.emergency_contact_phone:    employee.emergency_contact_phone = req.emergency_contact_phone
    if req.emergency_contact_relation: employee.emergency_contact_relation = req.emergency_contact_relation
    if req.bank_name:            employee.bank_name = req.bank_name
    if req.account_holder_name:  employee.account_holder_name = req.account_holder_name
    if req.account_number:       employee.account_number = req.account_number
    if req.bank_branch:          employee.bank_branch = req.bank_branch
    if req.base_salary is not None: employee.base_salary = req.base_salary

    employee.onboarding_completed = True
    employee.profile_completed = True
    db.commit()

    return {"message": "Profile saved successfully", "onboarding_completed": True}


# ── Get my profile ────────────────────────────────────────────────────────────
@router.get("/me")
def get_my_profile(request: Request, db: Session = Depends(get_db)):
    emp = get_current_employee(request, db)
    return {
        "id": emp.id,
        "name": emp.name,
        "email": emp.email,
        "phone": emp.phone,
        "department": emp.department,
        "designation": emp.designation,
        "join_date": emp.join_date.isoformat() if emp.join_date else None,
        "employment_type": getattr(emp, "employment_type", None),
        "date_of_birth": emp.date_of_birth.isoformat() if emp.date_of_birth else None,
        "gender": getattr(emp, "gender", None),
        "address_line1": getattr(emp, "address_line1", None),
        "address_line2": getattr(emp, "address_line2", None),
        "city": getattr(emp, "city", None),
        "state": getattr(emp, "state", None),
        "country": getattr(emp, "country", None),
        "emergency_contact_name": getattr(emp, "emergency_contact_name", None),
        "emergency_contact_phone": getattr(emp, "emergency_contact_phone", None),
        "emergency_contact_relation": getattr(emp, "emergency_contact_relation", None),
        "bank_name": getattr(emp, "bank_name", None),
        "account_holder_name": getattr(emp, "account_holder_name", None),
        "account_number": getattr(emp, "account_number", None),
        "bank_branch": getattr(emp, "bank_branch", None),
        "base_salary": getattr(emp, "base_salary", None),
        "onboarding_completed": emp.onboarding_completed,
        "profile_completed": emp.profile_completed,
    }