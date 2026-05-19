"""
Employee Registration API Routes

POST /api/auth/register   — Register a new employee (assigns default 'employee' role,
                            stores face embeddings, retrains classifier, sends Twilio SMS PIN)
"""

import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
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


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register_employee(
    payload: EmployeeRegisterRequest,
    db: Session = Depends(get_db),
):
    import traceback as _tb
    try:
        return _register_employee_inner(payload, db)
    except Exception as e:
        _tb.print_exc()
        raise


def _register_employee_inner(payload, db):
    # 1. Duplicate email/phone check
    existing = db.query(Employee).filter(Employee.email == payload.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered."
        )
    existing_phone = db.query(Employee).filter(Employee.phone == payload.phone).first()
    if existing_phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number already registered."
        )

    # 2. Default role
    default_role = db.query(Role).filter(Role.name == "employee").first()
    if not default_role:
        default_role = Role(name="employee", description="Basic employee access")
        db.add(default_role)
        db.commit()
        db.refresh(default_role)
        logger.warning("Role 'employee' was missing; created automatically.")

    # 3. Generate the PIN
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
    db.commit()
    db.refresh(new_employee)
    logger.info("Employee row created: id=%s email=%s", new_employee.id, new_employee.email)

    # 4. Enrol face embeddings
    try:
        enrol_result = face_service.enroll_faces(
            employee_id=new_employee.id,
            images_base64=payload.face_images,
        )
        if not enrol_result.get("success"):
            db.delete(new_employee)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=enrol_result.get("error", "Face enrolment failed. Please retake photos."),
            )
        logger.info(
            "Face enrolled for employee %s — %d embeddings stored",
            new_employee.id,
            enrol_result.get("embeddings_stored", 0),
        )
    except HTTPException:
        raise
    except Exception as exc:
        db.delete(new_employee)
        db.commit()
        logger.error("Face enrolment exception for %s: %s", new_employee.email, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Face enrolment error: {exc}",
        )

    # 5. Retrain classifier
    try:
        face_service.retrain_classifier()
        logger.info("Classifier retrained after registering %s", new_employee.email)
    except Exception as exc:
        logger.error("Classifier retrain failed (non-fatal): %s", exc)

    # 6. Store PIN verification record
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

    # 7. Send SMS
    sms_result = send_pin_sms(
        phone_number=new_employee.phone,
        employee_name=new_employee.name,
        pin=pin,
    )

    # Helper to mask phone
    def _mask(phone: str) -> str:
        return f"{'*' * max(0, len(phone) - 4)}{phone[-4:]}"

    if not sms_result["success"]:
        logger.error("SMS failed for employee %s: %s", new_employee.id, sms_result["error"])
        return {
            "message": "Registered but SMS could not be sent. Please contact IT.",
            "employee_id": new_employee.id,
            "email": new_employee.email,
            "role": "employee",
            "pin_record_id": pin_record.id,
            "masked_phone": _mask(new_employee.phone),
            "sms_sent": False,
            "default_pin": pin,          # ← ADDED
        }

    logger.info(
        "Registration complete: %s — PIN SMS sent to %s",
        new_employee.email,
        _mask(new_employee.phone),
    )

    return {
        "message": "Registration successful. Please verify your phone to complete setup.",
        "employee_id": new_employee.id,
        "email": new_employee.email,
        "role": "employee",
        "pin_record_id": pin_record.id,
        "masked_phone": _mask(new_employee.phone),
        "sms_sent": True,
        "default_pin": pin,              # ← ADDED
    }