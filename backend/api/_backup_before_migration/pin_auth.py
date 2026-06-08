"""
PIN Auth Routes

POST /api/auth/request-pin  — Look up employee by ID/email/phone → send SMS PIN
"""

import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
from typing import Optional
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.database.session import SessionLocal
from backend.database.models import Employee, PINVerification
from backend.services.twilio_service import generate_pin, send_pin_sms
from backend.schemas.auth import TokenResponse, FaceLoginRequest, PermanentPinLoginRequest, VerifyAndChangePinRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["PIN Authentication"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class RequestPinRequest(BaseModel):
    employee_id: Optional[int] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class RequestPinResponse(BaseModel):
    pin_record_id: int
    masked_phone: str
    message: str


@router.post("/request-pin", response_model=RequestPinResponse)
def request_pin(
    payload: RequestPinRequest,
    db: Session = Depends(get_db),
):
    """
    Used by both flows:
      - Face flow: called with employee_id after face-login succeeds
      - PIN-only flow: called with email or phone from the login form

    Generates a 6-digit PIN, stores it, and sends it via Twilio SMS.
    """
    # ── 1. Validate at least one field provided ────────────────────────────────
    if not payload.employee_id and not payload.email and not payload.phone:
        raise HTTPException(
            status_code=422,
            detail="Provide at least one of: employee_id, email, or phone.",
        )

    # ── 2. Look up employee ────────────────────────────────────────────────────
    employee = None

    if payload.employee_id:
        employee = (
            db.query(Employee)
            .filter(
                Employee.id == payload.employee_id,
                Employee.status == "active",
                Employee.deleted_at.is_(None),
            )
            .first()
        )

    if not employee and payload.email:
        employee = (
            db.query(Employee)
            .filter(
                Employee.email == payload.email.strip().lower(),
                Employee.status == "active",
                Employee.deleted_at.is_(None),
            )
            .first()
        )

    if not employee and payload.phone:
        # Normalize: strip spaces and try both with/without +91
        raw = payload.phone.strip()
        employee = (
            db.query(Employee)
            .filter(
                Employee.phone == raw,
                Employee.status == "active",
                Employee.deleted_at.is_(None),
            )
            .first()
        )

    if not employee:
        # Intentionally vague — don't reveal whether email/phone exists
        raise HTTPException(
            status_code=404,
            detail="No active employee found with the provided details.",
        )

    if not employee.phone:
        raise HTTPException(
            status_code=400,
            detail="No phone number on your account. Please contact HR.",
        )

    # ── 3. Invalidate old unused PINs ──────────────────────────────────────────
    db.query(PINVerification).filter(
        PINVerification.employee_id == employee.id,
        PINVerification.verified == False,
    ).update({"verified": True})

    # ── 4. Generate + store PIN ────────────────────────────────────────────────
    pin = generate_pin(length=settings.PIN_LENGTH)
    expires_at = datetime.utcnow() + timedelta(minutes=settings.PIN_EXPIRY_MINUTES)

    pin_record = PINVerification(
        employee_id=employee.id,
        pin_code=pin,
        phone_number=employee.phone,
        expires_at=expires_at,
        verified=False,
        attempts=0,
        max_attempts=settings.PIN_MAX_ATTEMPTS,
        pin_type="login",
    )
    db.add(pin_record)
    db.commit()
    db.refresh(pin_record)

    # ── 5. Send SMS ────────────────────────────────────────────────────────────
    sms_result = send_pin_sms(
        phone_number=employee.phone,
        employee_name=employee.name,
        pin=pin,
    )

    if not sms_result["success"]:
        db.delete(pin_record)
        db.commit()
        logger.error("SMS failed for employee %s: %s", employee.id, sms_result["error"])
        raise HTTPException(
            status_code=500,
            detail="Could not send SMS. Please try again or contact IT support.",
        )

    phone_str = employee.phone
    masked = f"{'*' * max(0, len(phone_str) - 4)}{phone_str[-4:]}"

    logger.info("PIN sent to employee %s (%s)", employee.id, masked)

    return RequestPinResponse(
        pin_record_id=pin_record.id,
        masked_phone=masked,
        message=f"A {settings.PIN_LENGTH}-digit PIN has been sent via SMS.",
    )


# ── Login with permanent PIN ───────────────────────────────────────────────────
class LoginWithPinRequest(BaseModel):
    identifier: str   # email or phone
    pin: str


@router.post("/login-with-pin")
@limiter.limit("10/minute")
def login_with_pin(request: Request, payload: LoginWithPinRequest, db: Session = Depends(get_db)):
    from backend.core.security import create_access_token, verify_password
    from datetime import timedelta

    # Find employee by email or phone
    emp = db.query(Employee).filter(
        ((Employee.email == payload.identifier.strip().lower()) |
         (Employee.phone == payload.identifier.strip())),
        Employee.status == "active",
        Employee.deleted_at.is_(None),
    ).first()
    if not emp:
        raise HTTPException(404, "No active employee found with the provided details.")

    # Verify PIN
    if not emp.permanent_pin_hash:
        raise HTTPException(400, "No PIN set. Please use your default PIN or contact HR.")

    if not verify_password(payload.pin, emp.permanent_pin_hash):
        raise HTTPException(401, "Incorrect PIN.")

    token = create_access_token({
        "sub": str(emp.id),
        "email": emp.email,
        "role": emp.role.name if emp.role else "employee",
    }, expires_delta=timedelta(hours=settings.JWT_EXPIRY_HOURS))

    return {
        "access_token": token,
        "employee": {
            "id": emp.id, "name": emp.name, "email": emp.email,
            "role": emp.role.name if emp.role else "employee",
            "onboarding_completed": emp.onboarding_completed,
        }
    }


# ── Verify current PIN and change to new PIN ──────────────────────────────────
class VerifyAndChangePinRequest(BaseModel):
    identifier: str   # email or phone
    current_pin: str
    new_pin: str


@router.post("/verify-and-change-pin")
@limiter.limit("5/minute")
def verify_and_change_pin(request: Request, payload: VerifyAndChangePinRequest, db: Session = Depends(get_db)):
    from backend.core.security import create_access_token, verify_password, get_password_hash
    from datetime import timedelta

    # Find employee
    emp = db.query(Employee).filter(
        ((Employee.email == payload.identifier.strip().lower()) |
         (Employee.phone == payload.identifier.strip())),
        Employee.status == "active",
        Employee.deleted_at.is_(None),
    ).first()
    if not emp:
        raise HTTPException(404, "No active employee found with the provided details.")

    # Verify current PIN
    if not emp.permanent_pin_hash:
        raise HTTPException(400, "No PIN set on this account.")
    if not verify_password(payload.current_pin, emp.permanent_pin_hash):
        raise HTTPException(401, "Current PIN is incorrect.")

    if len(payload.new_pin) != settings.PIN_LENGTH:
        raise HTTPException(400, f"New PIN must be {settings.PIN_LENGTH} digits.")

    # Set new PIN
    emp.permanent_pin_hash = get_password_hash(payload.new_pin)
    emp.permanent_pin = payload.new_pin  # store plain only if your schema has it
    emp.pin_type = "custom"
    emp.pin_set_at = datetime.utcnow()
    db.commit()

    token = create_access_token({
        "sub": str(emp.id),
        "email": emp.email,
        "role": emp.role.name if emp.role else "employee",
    }, expires_delta=timedelta(hours=settings.JWT_EXPIRY_HOURS))

    logger.info("PIN changed for employee %s", emp.id)
    return {
        "access_token": token,
        "employee": {
            "id": emp.id, "name": emp.name, "email": emp.email,
            "role": emp.role.name if emp.role else "employee",
            "onboarding_completed": emp.onboarding_completed,
        }
    }