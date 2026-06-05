"""
Onboarding Service — all business logic for profile collection, AI chat, and field saving.
No direct DB access — delegates to OnboardingRepository.
"""

import logging
import json
import re
import base64
import io
from datetime import datetime
from typing import Optional
import httpx
from fastapi import HTTPException
from pypdf import PdfReader
from sqlalchemy.orm import Session

from backend.database.models import Employee
from backend.enums import ChatRole
from backend.core.config import settings
from backend.repositories.onboarding_repository import OnboardingRepository
from backend.repositories.approval_repository import ApprovalRepository

logger = logging.getLogger(__name__)

# ── Field config ──────────────────────────────────────────────────────────────

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
    "bank_account_number": "Bank Account Number",
    "bank_branch": "Bank Branch",
    "base_salary": "Base Salary (optional)",
}

OPTIONAL_COLUMNS = {"address_line2", "base_salary"}

EMPLOYEE_EDITABLE_FIELDS = {
    "gender", "date_of_birth",
    "address_line1", "address_line2", "city", "state", "country",
    "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation",
}

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

# ── Helpers ───────────────────────────────────────────────────────────────────

def apply_fields(employee: Employee, fields: dict, db: Session) -> None:
    """Apply a dict of field→value to an employee, with type coercion."""
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


def _parse_tags(answer: str, employee: Employee, db: Session) -> tuple[str, Optional[dict], bool]:
    """Extract and process PARTIAL_SAVE and PROFILE_DATA tags from AI response."""
    for m in re.finditer(r"<PARTIAL_SAVE>(.*?)</PARTIAL_SAVE>", answer, re.DOTALL):
        try:
            apply_fields(employee, json.loads(m.group(1).strip()), db)
        except Exception as e:
            logger.warning("Partial save failed: %s", e)
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
                apply_fields(employee, profile_data, db)
            employee.onboarding_completed = True
            employee.profile_completed = True
            db.commit()
        except Exception as e:
            logger.error("Profile parse failed: %s", e)

    return answer, profile_data, profile_complete


async def _call_openai(messages: list, max_tokens: int = 1024) -> str:
    """Call OpenAI chat completions and return the text response."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.AI_KEY}", "Content-Type": "application/json"},
                json={"model": settings.AI_MODEL, "temperature": 0.3, "max_tokens": max_tokens, "messages": messages},
            )
            data = response.json()
    except Exception as e:
        logger.error("OpenAI error: %s", e)
        raise HTTPException(500, f"AI service error: {e}")

    if "error" in data:
        raise HTTPException(500, data["error"].get("message", "AI error"))

    return data["choices"][0]["message"]["content"]


def _detect_name_change(message: str, history: list, current_name: str) -> Optional[str]:
    """Extract a new name from HR message if present. Returns None if no change."""
    m1 = re.search(
        r"(?:change|update|rename|set)\s+(?:the\s+)?name\s+(?:to|as)\s+([A-Z][a-zA-Z ]{1,40}?)(?:\.|,|$|\n)",
        message, re.IGNORECASE
    )
    if m1:
        candidate = m1.group(1).strip().rstrip(".,;")
        if 2 <= len(candidate) <= 50:
            return candidate

    m2 = re.search(
        r"new\s+name\s*[:\s]+([A-Z][a-zA-Z ]{1,40}?)(?:\.|,|$|\n)",
        message, re.IGNORECASE
    )
    if m2:
        candidate = m2.group(1).strip().rstrip(".,;")
        if 2 <= len(candidate) <= 50:
            return candidate

    if history:
        last_bot = next(
            (h["content"] for h in reversed(history) if h.get("role") == ChatRole.ASSISTANT), ""
        )
        if any(kw in last_bot.lower() for kw in ["new name", "what name", "change to", "rename to"]):
            candidate = message.strip().rstrip(".,;")
            if re.match(r"^[A-Z][a-zA-Z ]{1,40}$", candidate):
                return candidate

    return None


# ── Service class ─────────────────────────────────────────────────────────────

class OnboardingService:

    def __init__(self, db: Session):
        self.repo = OnboardingRepository(db)
        self.db = db

    def get_profile_columns(self, employee: Employee) -> dict:
        return self.repo.get_columns(employee, SKIP_COLUMNS)

    def get_pending_employees(self) -> list[dict]:
        emps = self.repo.get_pending_onboarding()
        return [
            {
                "id": e.id, "name": e.name, "email": e.email,
                "department": e.department, "designation": e.designation,
                "role": e.role.name if e.role else None,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in emps
        ]

    def get_profile(self, employee: Employee) -> dict:
        profile = self.get_profile_columns(employee)
        return {
            "id": employee.id, "name": employee.name,
            "email": employee.email, "phone": employee.phone,
            "role": employee.role.name if employee.role else None,
            "onboarding_completed": employee.onboarding_completed,
            "profile_completed": employee.profile_completed,
            **{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in profile.items()},
        }

    def save_profile(self, employee: Employee, fields: dict, requested_by_id: Optional[int] = None) -> dict:
        approval_repo = ApprovalRepository(self.db)
        requester_id = requested_by_id or employee.id

        directly_saved = []
        pending_approval = []
        skipped = []

        for field, value in fields.items():
            if value is None:
                continue

            if field in EMPLOYEE_EDITABLE_FIELDS:
                apply_fields(employee, {field: value}, self.db)
                directly_saved.append(field)

            elif field in HR_APPROVAL_REQUIRED:
                old_value = getattr(employee, field, None)
                if str(old_value or "").strip() == str(value).strip():
                    skipped.append(field)
                    continue
                apr = approval_repo.create_request(
                    employee_id=employee.id,
                    requested_by_employee_id=requester_id,
                    field_name=field,
                    old_value=old_value,
                    new_value=value,
                )
                approval_repo.save_notification(
                    employee.id,
                    title="Profile Change Requested",
                    message=(
                        f"Your request to update '{HR_APPROVAL_REQUIRED[field]}' "
                        f"to '{value}' has been submitted to HR for approval."
                    ),
                )
                pending_approval.append({
                    "field": field,
                    "label": HR_APPROVAL_REQUIRED[field],
                    "request_id": apr.id,
                })
            else:
                skipped.append(field)

        if directly_saved:
            all_editable_filled = all(
                getattr(employee, f, None) not in (None, "")
                for f in EMPLOYEE_EDITABLE_FIELDS
            )
            if all_editable_filled:
                employee.onboarding_completed = True
                employee.profile_completed = True
                self.db.commit()

        return {
            "message": "Profile update processed.",
            "directly_saved": directly_saved,
            "pending_approval": pending_approval,
            "skipped": skipped,
            "onboarding_completed": employee.onboarding_completed,
        }

    def hr_direct_update(self, employee: Employee, fields: dict) -> dict:
        date_fields = {"join_date", "date_of_birth"}
        for key, val in fields.items():
            if not hasattr(employee, key):
                continue
            if key in date_fields and val:
                try:
                    parsed = datetime.strptime(val, "%Y-%m-%d").date()
                    setattr(employee, key, parsed)
                except Exception:
                    pass
            elif key == "base_salary" and val:
                try:
                    setattr(employee, key, float(val))
                except Exception:
                    pass
            else:
                setattr(employee, key, val)
        self.repo.save_notification(
            employee.id,
            title="Profile Updated by HR",
            message=f"HR has updated: {', '.join(fields.keys())}. Please review your profile.",
        )
        self.db.commit()
        return {"message": "Profile updated", "updated_fields": list(fields.keys())}

    def build_hr_system_prompt(self, employee: Employee) -> str:
        profile = self.get_profile_columns(employee)
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
- Only confirm and proceed once HR has explicitly given the NEW name.
- Never say "I'll update the name to [current name]" — only update when a DIFFERENT new name is clearly provided.

CONVERSATION RULES:
1. Ask for MISSING fields only. Never re-ask filled ones.
2. Ask 1-2 related things at a time — never dump everything at once.
3. Accept natural language and infer values ("joined in Jan 2024" → 2024-01-01).
4. After each group of answers, immediately output a save tag (invisible to user):
   <PARTIAL_SAVE>{{"field": "value"}}</PARTIAL_SAVE>
5. When ALL required fields collected, output at end of your message:
   <PROFILE_DATA>{json_template}</PROFILE_DATA>
   Only include newly collected values (leave others as empty string "").
6. If all required fields were already filled, say so warmly and output <PROFILE_DATA>{{}}</PROFILE_DATA>.
"""

    def build_self_edit_prompt(self, employee: Employee) -> str:
        profile = self.get_profile_columns(employee)
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

    async def hr_chat(self, employee: Employee, message: str, history: list, resume_text: Optional[str] = None) -> dict:
        system_prompt = self.build_hr_system_prompt(employee)
        messages = [{"role": ChatRole.SYSTEM, "content": system_prompt}]
        for msg in history:
            if msg.get("role") in (ChatRole.USER, ChatRole.ASSISTANT):
                messages.append({"role": msg["role"], "content": msg["content"]})
        user_content = f"[Resume uploaded]\n\nResume:\n{resume_text}\n\nMessage: {message}" if resume_text else message
        messages.append({"role": ChatRole.USER, "content": user_content})

        answer = await _call_openai(messages, max_tokens=1024)
        answer, profile_data, profile_complete = _parse_tags(answer, employee, self.db)

        name_changed = False
        new_name = _detect_name_change(message, history, employee.name)
        stop_words = {"name", "the", "their", "her", "his", "to", "please", "update", "change"}
        if (new_name
                and new_name.lower() not in stop_words
                and new_name.strip().lower() != employee.name.strip().lower()):
            old_name = employee.name
            employee.name = new_name
            self.db.commit()
            name_changed = True
            logger.info("HR updated name: %s -> %s (emp %s)", old_name, new_name, employee.id)
            self.repo.save_notification(
                employee.id,
                title="Name Updated by HR",
                message=f"Your name has been updated from {old_name} to {new_name} by HR.",
            )

        return {
            "reply": answer,
            "extracted_profile": profile_data,
            "profile_complete": profile_complete,
            "name_changed": name_changed,
            "new_name": new_name,
        }

    # ── THE FIXED self_chat METHOD ──────────────────────────────────────────
    async def self_chat(self, employee: Employee, message: str, history: list, resume_text: Optional[str] = None) -> dict:
        # Step 1: Pre-process – detect HR‑approval fields WITHOUT a new value
        msg_lower = message.lower().strip()
        hr_fields_map = {v.lower(): k for k, v in HR_APPROVAL_REQUIRED.items()}
        field_detected = None
        for field_label, field_key in hr_fields_map.items():
            if field_label in msg_lower or field_key in msg_lower:
                field_detected = field_key
                break

        # If a restricted field is mentioned, check if the message contains a new value
        if field_detected:
            # Extract potential new value – look for quoted text or after "to"
            new_val_match = re.search(r'(?:to|as|:=|->)\s*["\']?([^"\'\n]{2,50})["\']?', message, re.IGNORECASE)
            if not new_val_match:
                # Also try catching after the field name like "change name to John"
                new_val_match = re.search(rf'{field_detected}\s+(?:to|as)\s+([A-Za-z0-9\s]+?)(?:\.|$|\n)', message, re.IGNORECASE)
            if not new_val_match:
                # No new value provided – ask for it immediately
                label = HR_APPROVAL_REQUIRED[field_detected]
                return {
                    "reply": f"Sure! What would you like to change your {label} to?",
                    "profile_complete": False,
                    "approval_requests": []
                }

        # Step 2: If we reach here, either the field is not restricted, or a new value was provided.
        # Build the AI prompt with instruction to emit approval tag.
        system_prompt = self.build_self_edit_prompt(employee)
        approval_instruction = (
            "\n\nAPPROVAL REQUEST HANDLING (CRITICAL):\n"
            "If the employee asks to change a field that requires HR approval (name, email, department, designation, employment_type, bank_account_number, base_salary) AND they have provided a specific new value, you MUST:\n"
            "1. Tell them the request has been submitted to HR for approval.\n"
            "2. Emit this tag at the very END of your reply (never visible to user):\n"
            '   <APPROVAL_REQUEST>{"field": "field_name", "new_value": "requested value"}</APPROVAL_REQUEST>\n'
            "Do NOT say 'contact HR' or 'requires approval' – say 'Your request has been submitted to HR'.\n"
            "If the employee has not provided a new value, ask for it first."
        )

        messages = [{"role": ChatRole.SYSTEM, "content": system_prompt + approval_instruction}]
        for msg in history:
            if msg.get("role") in (ChatRole.USER, ChatRole.ASSISTANT):
                messages.append({"role": msg["role"], "content": msg["content"]})
        user_content = f"[Resume text]\n{resume_text}\n\nMessage: {message}" if resume_text else message
        messages.append({"role": ChatRole.USER, "content": user_content})

        answer = await _call_openai(messages, max_tokens=800)

        # ── Direct-save fields (employee‑updatable) ──────────────────────────
        for m in re.finditer(r"<PARTIAL_SAVE>(.*?)</PARTIAL_SAVE>", answer, re.DOTALL):
            try:
                raw = json.loads(m.group(1).strip())
                allowed = {k: v for k, v in raw.items() if k in EMPLOYEE_EDITABLE_FIELDS}
                apply_fields(employee, allowed, self.db)
            except Exception as e:
                logger.warning("Self partial save failed: %s", e)
        answer = re.sub(r"<PARTIAL_SAVE>.*?</PARTIAL_SAVE>", "", answer, flags=re.DOTALL).strip()

        # ── HR approval request tags ─────────────────────────────────────────
        approval_requests_created = []
        approval_repo = ApprovalRepository(self.db)
        for m in re.finditer(r"<APPROVAL_REQUEST>(.*?)</APPROVAL_REQUEST>", answer, re.DOTALL):
            try:
                data = json.loads(m.group(1).strip())
                field = data.get("field")
                new_value = data.get("new_value")
                if not field or not new_value or field not in HR_APPROVAL_REQUIRED:
                    continue
                old_value = getattr(employee, field, None)
                if str(old_value or "").strip() == str(new_value).strip():
                    continue
                apr = approval_repo.create_request(
                    employee_id=employee.id,
                    requested_by_employee_id=employee.id,
                    field_name=field,
                    old_value=old_value,
                    new_value=new_value,
                )
                # Notify employee
                approval_repo.save_notification(
                    employee.id,
                    title="Profile Change Requested",
                    message=(
                        f"Your request to update '{HR_APPROVAL_REQUIRED[field]}' "
                        f"to '{new_value}' has been submitted to HR for approval."
                    ),
                )
                # Notify all HR/Admin staff in-app
                for hr in approval_repo.get_hr_employees():
                    approval_repo.save_notification(
                        hr.id,
                        title="Profile Update Request",
                        message=(
                            f"{employee.name} has requested to update "
                            f"'{HR_APPROVAL_REQUIRED[field]}' to '{new_value}'. "
                            f"Please review in the Approval Requests section."
                        ),
                    )
                # Email HR
                try:
                    from backend.core.email import send_email
                    from backend.core.config import settings as _settings
                    hr_email = getattr(_settings, "HR_EMAIL", None)
                    if hr_email:
                        send_email(
                            to=hr_email,
                            subject=f"Profile Update Request — {employee.name}",
                            body=(
                                f"{employee.name} has requested to update "
                                f"'{HR_APPROVAL_REQUIRED[field]}' to '{new_value}'.\n\n"
                                f"Please log in to HRMS and review the Approval Requests section."
                            ),
                            triggered_by="self_chat_approval",
                            db=self.db,
                        )
                except Exception as e:
                    logger.warning("HR email notification failed: %s", e)

                approval_requests_created.append({
                    "field": field,
                    "label": HR_APPROVAL_REQUIRED[field],
                    "request_id": apr.id,
                })
            except Exception as e:
                logger.warning("Approval request tag parse failed: %s", e)
        answer = re.sub(r"<APPROVAL_REQUEST>.*?</APPROVAL_REQUEST>", "", answer, flags=re.DOTALL).strip()

        # ── Profile complete tag ─────────────────────────────────────────────
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
                    apply_fields(employee, allowed, self.db)
            except Exception as e:
                logger.error("Self profile parse failed: %s", e)

        return {
            "reply": answer,
            "profile_complete": profile_complete,
            "approval_requests": approval_requests_created,
        }

    @staticmethod
    async def extract_resume_text(pdf_base64: str) -> str:
        try:
            pdf_bytes = base64.b64decode(pdf_base64)
            reader = PdfReader(io.BytesIO(pdf_bytes))
            text = ""
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
            return text[:8000]
        except Exception as e:
            logger.error("PDF extraction failed: %s", e)
            return ""