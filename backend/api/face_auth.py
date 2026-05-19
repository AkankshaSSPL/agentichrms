"""
Face Authentication API Routes

POST /api/auth/face-login           — Face recognition → JWT
POST /api/auth/login-with-pin       — Direct permanent PIN login
POST /api/auth/verify-and-change-pin — Verify current PIN & optionally change it, then login
POST /api/auth/detect-faces         — Return number of faces in an image (for registration validation)
"""

import logging
import base64
from io import BytesIO
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from PIL import Image
from sqlalchemy import func

from backend.core.config import settings
from backend.core.security import create_access_token, verify_password, get_password_hash
from backend.database.session import SessionLocal
from backend.database.models import Employee, FaceLoginAttempt, PINVerification
from backend.services.face_service import face_service
from backend.services.twilio_service import generate_pin, send_pin_sms
from backend.schemas.auth import TokenResponse, FaceLoginRequest, PermanentPinLoginRequest, VerifyAndChangePinRequest, DetectFacesRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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
            Employee.email == username,
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

    # Get role name — fall back to 'employee' if role not set
    role_name = employee.role.name if (employee.role_id and employee.role) else "employee"

    token = create_access_token({
        "sub": str(employee.id),
        "email": employee.email,
        "name": employee.name,
        "department": employee.department,
        "role": role_name,
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
            "role": role_name,
        },
    )


@router.post("/login-with-pin", response_model=TokenResponse)
def login_with_permanent_pin(
    payload: PermanentPinLoginRequest,
    db: Session = Depends(get_db),
):
    identifier = payload.identifier.strip().lower()  # force lower case and trim
    logger.info(f"Login attempt with identifier: '{identifier}'")

    # Try email match (case‑insensitive)
    employee = db.query(Employee).filter(
        func.lower(Employee.email) == identifier,
        Employee.status == "active",
        Employee.deleted_at.is_(None)
    ).first()

    # If not found by email, try phone (but keep original phone matching)
    if not employee and "@" not in identifier:
        phone_clean = ''.join(c for c in identifier if c.isdigit())
        employee = db.query(Employee).filter(
            Employee.phone.like(f"%{phone_clean[-10:]}"),
            Employee.status == "active",
            Employee.deleted_at.is_(None)
        ).first()

    if not employee:
        logger.warning(f"No active employee found for identifier: '{identifier}'")
        raise HTTPException(404, "No active account found with that email/phone.")

    if not employee.permanent_pin_hash:
        logger.warning(f"No PIN set for {employee.email}")
        raise HTTPException(400, "No PIN set for this account. Please contact HR.")

    # Verify PIN
    if not verify_password(payload.pin, employee.permanent_pin_hash):
        logger.warning(f"Incorrect PIN for {employee.email}")
        raise HTTPException(401, "Incorrect PIN.")

    # Safe role retrieval
    role_name = employee.role.name if employee.role else "employee"

    token = create_access_token({
        "sub": str(employee.id),
        "email": employee.email,
        "name": employee.name,
        "department": employee.department,
        "role": role_name,
    })

    logger.info(f"PIN login success: {employee.email} (role: {role_name})")

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        employee={
            "id": employee.id,
            "name": employee.name,
            "email": employee.email,
            "department": employee.department,
            "designation": employee.designation,
            "role": role_name,
        },
    )

# ── POST /api/auth/detect-faces (for registration validation) ─────────────────

@router.post("/detect-faces")
def detect_faces(payload: DetectFacesRequest):
    """
    Detect faces and return count + bounding boxes of the largest face.
    """
    try:
        if "," in payload.image_base64:
            image_base64 = payload.image_base64.split(",", 1)[1]
        else:
            image_base64 = payload.image_base64
        img_bytes = base64.b64decode(image_base64)
        pil_img = Image.open(BytesIO(img_bytes)).convert("RGB")
        
        face_service._load_models()
        boxes, probs = face_service._mtcnn.detect(pil_img)
        if boxes is None:
            return {"face_count": 0, "boxes": [], "primary_box": None}
        
        # Convert numpy arrays to lists
        boxes_list = boxes.tolist()
        # Find largest face by area
        areas = [(box[2] - box[0]) * (box[3] - box[1]) for box in boxes_list]
        primary_idx = areas.index(max(areas))
        primary_box = boxes_list[primary_idx]
        
        return {
            "face_count": len(boxes_list),
            "boxes": boxes_list,
            "primary_box": primary_box
        }
    except Exception as e:
        logger.error(f"Face detection error: {e}")
        return {"face_count": 0, "boxes": [], "primary_box": None, "error": str(e)}


# ── GET /api/auth/me ───────────────────────────────────────────────────────────

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