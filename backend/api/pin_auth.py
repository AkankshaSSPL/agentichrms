"""
PIN Auth Routes

POST /api/auth/request-pin  — Look up employee by ID/email/phone → send SMS PIN
"""

import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.database.session import SessionLocal
from backend.database.models import Employee, PINVerification
from backend.services.twilio_service import generate_pin, send_pin_sms

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