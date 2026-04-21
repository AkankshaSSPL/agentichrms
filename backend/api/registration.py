"""
Registration API Routes – with strict duplicate prevention
"""

import logging
import secrets
import random
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel, EmailStr, validator, Field
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.database.session import SessionLocal
from backend.database.models import Employee, User
from backend.core.security import get_password_hash
from backend.services.face_service import face_service
from backend.services.twilio_service import send_pin_sms
from backend.services.email_service import send_pin_email
from backend.schemas.auth import TokenResponse, FaceLoginRequest, PermanentPinLoginRequest, VerifyAndChangePinRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Registration"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── Request Models ────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    phone: str
    face_images: List[str] = Field(..., min_items=3, max_items=5)

    @validator('name')
    def name_valid(cls, v):
        if len(v.strip()) < 2:
            raise ValueError('Name must be at least 2 characters')
        return v.strip()

    @validator('email')
    def email_lower(cls, v):
        return v.lower().strip()

    @validator('phone')
    def phone_normalise(cls, v):
        # Remove all non-digits
        digits = ''.join(c for c in v if c.isdigit())
        if len(digits) < 10:
            raise ValueError('Phone must have at least 10 digits')
        # Assume India as default country code (+91) if no '+' provided
        if not v.startswith('+'):
            digits = '91' + digits[-10:]   # take last 10 digits with +91 prefix
        else:
            digits = '+' + digits
        return digits

class FirstLoginSetupRequest(BaseModel):
    employee_id: int
    keep_default_pin: bool
    new_pin: Optional[str] = None

    @validator('new_pin')
    def validate_new_pin(cls, v, values):
        if not values.get('keep_default_pin', True) and (not v or len(v) != 6 or not v.isdigit()):
            raise ValueError('New PIN must be exactly 6 digits')
        return v

# ── Helper: generate random 6-digit PIN ───────────────────────────────────────
def generate_permanent_pin() -> str:
    return ''.join(random.choices('0123456789', k=6))

# ── Registration Endpoint ─────────────────────────────────────────────────────
@router.post("/register")
async def register(
    data: RegisterRequest = Body(...),
    db: Session = Depends(get_db)
):
    try:
        logger.info(f"📝 Registration request for {data.email}")

        # 1. Check existing (case‑insensitive, normalised)
        existing_user = db.query(User).filter(User.email == data.email).first()
        if existing_user:
            raise HTTPException(400, "Email already registered")

        existing_employee_by_email = db.query(Employee).filter(Employee.email == data.email).first()
        if existing_employee_by_email:
            raise HTTPException(400, "Email already registered")

        existing_phone = db.query(Employee).filter(Employee.phone == data.phone).first()
        if existing_phone:
            raise HTTPException(400, "Phone number already registered")

        # 2. Create Employee record (set username = email for face login)
        employee = Employee(
            name=data.name,
            email=data.email,
            phone=data.phone,
            username=data.email,          # ← CRITICAL for face recognition
            phone_country_code=data.phone[:3] if data.phone.startswith('+') else '+91',
            status='active',
            email_verified=True,
            phone_verified=True,
            onboarding_completed=False,
            profile_completed=False,
            face_registered=False
        )
        db.add(employee)
        db.commit()
        db.refresh(employee)

        # 3. Enroll face images
        enroll_result = face_service.enroll_faces(employee.id, data.face_images)
        if not enroll_result["success"]:
            db.delete(employee)
            db.commit()
            raise HTTPException(400, f"Face enrollment failed: {enroll_result['error']}")

        # 4. Generate permanent PIN
        default_pin = generate_permanent_pin()
        pin_hash = get_password_hash(default_pin)

        employee.permanent_pin_hash = pin_hash
        employee.pin_type = 'default'
        employee.pin_set_at = datetime.utcnow()
        employee.face_registered = True
        employee.face_samples_count = enroll_result["embeddings_stored"]

        # 5. Create User record
        dummy_hash = get_password_hash(secrets.token_urlsafe(16))
        user = User(
            employee_id=employee.id,
            email=data.email,
            password_hash=dummy_hash,
            is_active=True,
            is_verified=True,
            face_registered=True,
            face_login_enabled=True
        )
        db.add(user)
        db.commit()
        db.refresh(employee)

        # 6. Send PIN via Email and SMS
        email_sent = send_pin_email(data.email, employee.name, default_pin)
        sms_sent = send_pin_sms(data.phone, employee.name, default_pin)

        # 7. Retrain the global face classifier to include the new employee
        face_service.retrain_classifier()

        return {
            "success": True,
            "employee_id": employee.id,
            "user_id": user.id,
            "default_pin": default_pin,
            "message": "Registration successful!",
            "email_sent": email_sent["success"],
            "sms_sent": sms_sent["success"],
            "next_step": "first_login_setup"
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Registration error")
        raise HTTPException(500, str(e))

# ── First‑login PIN setup (unchanged) ─────────────────────────────────────────
@router.post("/first-login-setup")
async def first_login_setup(
    data: FirstLoginSetupRequest,
    db: Session = Depends(get_db)
):
    employee = db.query(Employee).filter(Employee.id == data.employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")

    if data.keep_default_pin:
        employee.pin_type = 'custom'
        employee.pin_set_at = datetime.utcnow()
        db.commit()
        return {"success": True, "message": "Default PIN kept"}
    else:
        if not data.new_pin or len(data.new_pin) != 6:
            raise HTTPException(400, "New PIN must be 6 digits")
        new_hash = get_password_hash(data.new_pin)
        employee.permanent_pin_hash = new_hash
        employee.pin_type = 'custom'
        employee.pin_set_at = datetime.utcnow()
        db.commit()
        return {"success": True, "message": "PIN updated successfully"}