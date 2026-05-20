"""
Employee Registration API Routes

POST /api/auth/register   — Register a new employee (assigns default 'employee' role,
                            stores face embeddings, retrains classifier, sends Twilio SMS PIN)
"""

import logging
import traceback
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List

from backend.database.session import SessionLocal
from backend.database.models import Employee, Role, PINVerification
from backend.core.config import settings
from backend.core.security import get_password_hash
from backend.services.face_service import face_service
from backend.services.twilio_service import generate_pin, send_pin_sms

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Registration"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class EmployeeRegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    phone: str = Field(..., description="Phone in E.164 format, e.g. +919876543210")
    face_images: List[str] = Field(..., min_length=3, description="Base64-encoded JPEG frames")
    department: Optional[str] = None
    designation: Optional[str] = None


def _mask(phone: str) -> str:
    return f"{'*' * max(0, len(phone) - 4)}{phone[-4:]}"


def _friendly_integrity_error(exc: IntegrityError) -> str:
    msg = str(exc.orig).lower()
    if "employees_email" in msg or '"email"' in msg or "key (email)" in msg:
        return "This email address is already registered. Please log in or use a different email."
    if "employees_phone" in msg or '"phone"' in msg or "key (phone)" in msg:
        return "This phone number is already registered. Please use a different phone number."
    return "An account with these details already exists. Please check your information."


@router.post("/register")
def register_employee(
    payload: EmployeeRegisterRequest,
    db: Session = Depends(get_db),
):
    try:
        return _do_register(payload, db)
    except HTTPException:
        raise
    except IntegrityError as exc:
        db.rollback()
        logger.error("IntegrityError: %s", exc)
        raise HTTPException(status_code=400, detail=_friendly_integrity_error(exc))
    except Exception as exc:
        db.rollback()
        logger.error("Registration error:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(exc)}")


def _do_register(payload: EmployeeRegisterRequest, db: Session):
    # 1. Explicit duplicate checks
    if db.query(Employee).filter(Employee.email == payload.email).first():
        raise HTTPException(400, "This email address is already registered. Please log in or use a different email.")

    if db.query(Employee).filter(Employee.phone == payload.phone).first():
        raise HTTPException(400, "This phone number is already registered. Please use a different phone number.")

    # 2. Default role
    default_role = db.query(Role).filter(Role.name == "employee").first()
    if not default_role:
        default_role = Role(name="employee", description="Basic employee access")
        db.add(default_role)
        db.commit()
        db.refresh(default_role)

    # 3. Generate PIN & create employee
    pin = generate_pin(length=settings.PIN_LENGTH)
    new_employee = Employee(
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        department=payload.department,
        designation=payload.designation,
        role_id=default_role.id,
        status="active",
        permanent_pin_hash=get_password_hash(pin),
        pin_type="sms",
        created_at=datetime.utcnow(),
    )
    db.add(new_employee)
    try:
        db.commit()
        db.refresh(new_employee)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(400, _friendly_integrity_error(exc))

    # 4. Enrol face
    try:
        enrol_result = face_service.enroll_faces(
            employee_id=new_employee.id,
            images_base64=payload.face_images,
        )
        if not enrol_result.get("success"):
            db.delete(new_employee)
            db.commit()
            raise HTTPException(422, enrol_result.get("error", "Face enrolment failed. Please retake your photos."))
    except HTTPException:
        raise
    except Exception as exc:
        db.delete(new_employee)
        db.commit()
        raise HTTPException(500, f"Face enrolment failed: {str(exc)}")

    # 5. Retrain (non-fatal)
    try:
        face_service.retrain_classifier()
    except Exception as exc:
        logger.error("Classifier retrain failed (non-fatal): %s", exc)

    # 6. PIN record
    expires_at = datetime.utcnow() + timedelta(minutes=settings.PIN_EXPIRY_MINUTES)
    pin_record = PINVerification(
        employee_id=new_employee.id,
        pin_code=pin,
        phone_number=new_employee.phone,
        expires_at=expires_at,
        verified=False,
        attempts=0,
        max_attempts=settings.PIN_MAX_ATTEMPTS,
        pin_type="registration",
    )
    db.add(pin_record)
    db.commit()
    db.refresh(pin_record)

    # 7. Send SMS (non-fatal)
    sms_result = send_pin_sms(phone_number=new_employee.phone, employee_name=new_employee.name, pin=pin)
    if not sms_result["success"]:
        logger.error("SMS failed for %s: %s", new_employee.id, sms_result["error"])

    return {
        "message": "Registration successful!" if sms_result["success"] else "Registered! SMS could not be sent — use the PIN shown below to log in.",
        "employee_id": new_employee.id,
        "email": new_employee.email,
        "role": "employee",
        "pin_record_id": pin_record.id,
        "masked_phone": _mask(new_employee.phone),
        "sms_sent": sms_result["success"],
        "default_pin": pin,
    }