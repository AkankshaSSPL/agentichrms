"""
Face Authentication API Routes

POST /api/auth/face-login   — Recognize face → generate PIN → send SMS
POST /api/auth/verify-pin   — Validate PIN → return JWT
"""

import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.security import create_access_token
from backend.database.session import SessionLocal
from backend.database.models import Employee, FaceLoginAttempt, PINVerification
from backend.services.face_service import face_service
from backend.services.twilio_service import generate_pin, send_pin_sms

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Face Authentication"])


# ── DB dependency ──────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Schemas ────────────────────────────────────────────────────────────────────

class FaceLoginRequest(BaseModel):
    image_base64: str       # raw Base64 or data-URL — both accepted


class FaceLoginResponse(BaseModel):
    message: str
    pin_record_id: int
    masked_phone: str       # e.g. ******3210 — shown to user for confirmation


class VerifyPinRequest(BaseModel):
    pin_record_id: int
    pin_code: str


class VerifyPinResponse(BaseModel):
    access_token: str
    token_type: str
    employee: dict


# ── POST /api/auth/face-login ──────────────────────────────────────────────────

@router.post("/face-login", response_model=FaceLoginResponse)
def face_login(
    payload: FaceLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    1. Run MTCNN + InceptionResnetV1 + KNN → get employee username
    2. Look up Employee record in DB
    3. Generate 6-digit PIN, store in pin_verifications
    4. Send PIN via Twilio SMS to employee.phone
    """
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")

    # ── 1. Face Recognition ────────────────────────────────────────────────────
    result = face_service.recognize_face(payload.image_base64)

    if not result["recognized"]:
        # Log the failed attempt
        db.add(FaceLoginAttempt(
            employee_id=None,
            success=False,
            confidence_score=result["distance"],
            ip_address=ip,
            user_agent=ua,
            failure_reason=result["failure_reason"],
        ))
        db.commit()
        raise HTTPException(
            status_code=401,
            detail=result["failure_reason"] or "Face not recognized. Please try again.",
        )

    username = result["username"]
    distance = result["distance"]

    # ── 2. Employee Lookup ─────────────────────────────────────────────────────
    employee = (
        db.query(Employee)
        .filter(
            Employee.username == username,
            Employee.status == "active",
            Employee.deleted_at.is_(None),
        )
        .first()
    )

    if not employee:
        logger.warning("Face recognized as '%s' but no matching employee found.", username)
        db.add(FaceLoginAttempt(
            employee_id=None,
            success=False,
            confidence_score=distance,
            ip_address=ip,
            user_agent=ua,
            failure_reason=f"No active employee with username '{username}'",
        ))
        db.commit()
        raise HTTPException(
            status_code=404,
            detail="Your face was recognized but your account was not found. Please contact HR.",
        )

    if not employee.phone:
        raise HTTPException(
            status_code=400,
            detail="No phone number registered for your account. Please contact HR.",
        )

    # Log successful recognition
    db.add(FaceLoginAttempt(
        employee_id=employee.id,
        success=True,
        confidence_score=distance,
        ip_address=ip,
        user_agent=ua,
        failure_reason=None,
    ))

    # ── 3. Generate PIN & Store ────────────────────────────────────────────────
    pin = generate_pin(length=settings.PIN_LENGTH)
    expires_at = datetime.utcnow() + timedelta(minutes=settings.PIN_EXPIRY_MINUTES)

    # Invalidate any previous unused PINs for this employee
    db.query(PINVerification).filter(
        PINVerification.employee_id == employee.id,
        PINVerification.verified == False,
    ).update({"verified": True})

    pin_record = PINVerification(
        employee_id=employee.id,
        pin_code=pin,
        phone_number=employee.phone,
        expires_at=expires_at,
        verified=False,
        attempts=0,
        max_attempts=settings.PIN_MAX_ATTEMPTS,
    )
    db.add(pin_record)
    db.commit()
    db.refresh(pin_record)

    # ── 4. Send SMS via Twilio ─────────────────────────────────────────────────
    sms_result = send_pin_sms(
        phone_number=employee.phone,
        employee_name=employee.name,
        pin=pin,
    )

    if not sms_result["success"]:
        # Roll back the PIN record so the user can retry
        db.delete(pin_record)
        db.commit()
        logger.error(
            "SMS delivery failed for employee %s: %s",
            employee.id, sms_result["error"]
        )
        raise HTTPException(
            status_code=500,
            detail="Face recognized but SMS could not be sent. Please contact IT support.",
        )

    # Mask phone for frontend display: ******3210
    phone_str = employee.phone
    masked = f"{'*' * max(0, len(phone_str) - 4)}{phone_str[-4:]}"

    logger.info("PIN sent to employee %s (%s)", employee.id, masked)

    return FaceLoginResponse(
        message=f"Face matched! A {settings.PIN_LENGTH}-digit PIN has been sent via SMS.",
        pin_record_id=pin_record.id,
        masked_phone=masked,
    )


# ── POST /api/auth/verify-pin ──────────────────────────────────────────────────

@router.post("/verify-pin", response_model=VerifyPinResponse)
def verify_pin(
    payload: VerifyPinRequest,
    db: Session = Depends(get_db),
):
    """
    1. Look up the PINVerification record
    2. Check expiry and attempt count
    3. Compare the PIN
    4. Return a signed JWT on success
    """
    pin_record = (
        db.query(PINVerification)
        .filter(
            PINVerification.id == payload.pin_record_id,
            PINVerification.verified == False,
        )
        .first()
    )

    if not pin_record:
        raise HTTPException(
            status_code=400,
            detail="PIN session not found or already used. Please go back and try again.",
        )

    if pin_record.is_expired:
        raise HTTPException(
            status_code=400,
            detail="PIN has expired. Please go back and scan your face again.",
        )

    if pin_record.attempts >= pin_record.max_attempts:
        raise HTTPException(
            status_code=400,
            detail="Too many incorrect attempts. Please go back and scan your face again.",
        )

    # Increment attempt BEFORE checking — prevents timing attacks
    pin_record.attempts += 1
    db.commit()

    if pin_record.pin_code != payload.pin_code.strip():
        remaining = pin_record.max_attempts - pin_record.attempts
        raise HTTPException(
            status_code=400,
            detail=f"Incorrect PIN. {remaining} attempt(s) remaining.",
        )

    # ── Success ────────────────────────────────────────────────────────────────
    pin_record.verified = True
    db.commit()

    employee = db.query(Employee).filter(Employee.id == pin_record.employee_id).first()
    if not employee:
        raise HTTPException(status_code=500, detail="Employee record missing. Contact IT.")

    token = create_access_token({
        "sub": str(employee.id),
        "email": employee.email,
        "name": employee.name,
        "department": employee.department,
    })

    logger.info("Login successful for employee %s (%s)", employee.id, employee.name)

    return VerifyPinResponse(
        access_token=token,
        token_type="bearer",
        employee={
            "id": employee.id,
            "name": employee.name,
            "email": employee.email,
            "department": employee.department,
            "designation": employee.designation,
        },
    )