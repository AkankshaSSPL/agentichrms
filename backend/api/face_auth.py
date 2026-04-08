"""
Face Authentication API Routes

POST /api/auth/face-login           — Face recognition → JWT
POST /api/auth/login-with-pin       — Direct permanent PIN login
POST /api/auth/verify-and-change-pin — Verify current PIN & optionally change it, then login
"""

import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.security import create_access_token, verify_password, get_password_hash
from backend.database.session import SessionLocal
from backend.database.models import Employee, FaceLoginAttempt, PINVerification
from backend.services.face_service import face_service
from backend.services.twilio_service import generate_pin, send_pin_sms

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Schemas ────────────────────────────────────────────────────────────────────

class FaceLoginRequest(BaseModel):
    image_base64: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    employee: dict


class PermanentPinLoginRequest(BaseModel):
    identifier: str   # email or phone
    pin: str


class VerifyAndChangePinRequest(BaseModel):
    identifier: str
    current_pin: str
    new_pin: Optional[str] = None


# ── POST /api/auth/face-login ──────────────────────────────────────────────────

@router.post("/face-login", response_model=TokenResponse)
def face_login(
    payload: FaceLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")

    result = face_service.recognize_face(payload.image_base64)
    if not result["recognized"]:
        db.add(FaceLoginAttempt(
            employee_id=None, success=False,
            confidence_score=result["distance"],
            ip_address=ip, user_agent=ua,
            failure_reason=result["failure_reason"],
        ))
        db.commit()
        raise HTTPException(
            status_code=401,
            detail=result["failure_reason"] or "Face not recognized. Please try again.",
        )

    username = result["username"]
    distance = result["distance"]

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
        db.add(FaceLoginAttempt(
            employee_id=None, success=False,
            confidence_score=distance, ip_address=ip, user_agent=ua,
            failure_reason=f"No active employee with username '{username}'",
        ))
        db.commit()
        raise HTTPException(
            status_code=404,
            detail="Face recognised but account not found. Contact HR.",
        )

    db.add(FaceLoginAttempt(
        employee_id=employee.id, success=True,
        confidence_score=distance, ip_address=ip, user_agent=ua,
    ))
    db.commit()
    logger.info("Face login: employee %s (%s) distance=%.3f", employee.id, employee.name, distance)

    token = create_access_token({
        "sub": str(employee.id),
        "email": employee.email,
        "name": employee.name,
        "department": employee.department,
    })

    return TokenResponse(
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


# ── POST /api/auth/login-with-pin (direct permanent PIN) ───────────────────────

@router.post("/login-with-pin", response_model=TokenResponse)
def login_with_permanent_pin(
    payload: PermanentPinLoginRequest,
    db: Session = Depends(get_db),
):
    identifier = payload.identifier.strip()
    if "@" in identifier:
        employee = db.query(Employee).filter(
            Employee.email == identifier,
            Employee.status == "active",
            Employee.deleted_at.is_(None)
        ).first()
    else:
        phone_clean = ''.join(c for c in identifier if c.isdigit())
        employee = db.query(Employee).filter(
            Employee.phone.like(f"%{phone_clean[-10:]}"),
            Employee.status == "active",
            Employee.deleted_at.is_(None)
        ).first()

    if not employee:
        raise HTTPException(404, "No active account found with that email/phone.")

    if not employee.permanent_pin_hash:
        raise HTTPException(400, "No PIN set for this account. Please contact HR.")

    if not verify_password(payload.pin, employee.permanent_pin_hash):
        raise HTTPException(401, "Incorrect PIN.")

    token = create_access_token({
        "sub": str(employee.id),
        "email": employee.email,
        "name": employee.name,
        "department": employee.department,
    })

    logger.info(f"PIN login: employee {employee.id} ({employee.name})")

    return TokenResponse(
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


# ── POST /api/auth/verify-and-change-pin (verify + optional change) ────────────

@router.post("/verify-and-change-pin", response_model=TokenResponse)
def verify_and_change_pin(
    payload: VerifyAndChangePinRequest,
    db: Session = Depends(get_db),
):
    identifier = payload.identifier.strip()
    if "@" in identifier:
        employee = db.query(Employee).filter(
            Employee.email == identifier,
            Employee.status == "active",
            Employee.deleted_at.is_(None)
        ).first()
    else:
        phone_clean = ''.join(c for c in identifier if c.isdigit())
        employee = db.query(Employee).filter(
            Employee.phone.like(f"%{phone_clean[-10:]}"),
            Employee.status == "active",
            Employee.deleted_at.is_(None)
        ).first()

    if not employee:
        raise HTTPException(404, "No active account found with that email/phone.")

    if not employee.permanent_pin_hash:
        raise HTTPException(400, "No PIN set for this account. Contact HR.")

    if not verify_password(payload.current_pin, employee.permanent_pin_hash):
        raise HTTPException(401, "Incorrect current PIN.")

    # If a new PIN is provided, validate and update
    if payload.new_pin:
        if len(payload.new_pin) != 6 or not payload.new_pin.isdigit():
            raise HTTPException(400, "New PIN must be exactly 6 digits.")
        new_hash = get_password_hash(payload.new_pin)
        employee.permanent_pin_hash = new_hash
        employee.pin_type = 'custom'
        employee.pin_set_at = datetime.utcnow()
        db.commit()
        logger.info(f"PIN changed for employee {employee.id}")

    token = create_access_token({
        "sub": str(employee.id),
        "email": employee.email,
        "name": employee.name,
        "department": employee.department,
    })

    return TokenResponse(
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


# ── GET /api/auth/me (unchanged) ───────────────────────────────────────────────

@router.get("/me")
def get_current_employee(request: Request, db: Session = Depends(get_db)):
    from backend.core.security import verify_token
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = auth.split(" ")[1]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(401, "Invalid token")
    employee_id = int(payload.get("sub"))
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(404, "Employee not found")
    return {
        "id": employee.id,
        "email": employee.email,
        "name": employee.name,
        "pin_type": employee.pin_type,
        "pin_set_at": employee.pin_set_at
    }