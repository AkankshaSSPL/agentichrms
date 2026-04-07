"""
Registration API Routes
Step-by-step implementation
"""

from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel, EmailStr, validator
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import secrets
import logging

from backend.database.session import SessionLocal
from backend.database.models import Employee, User, RegistrationToken, PINVerification
from backend.core.security import get_password_hash, create_access_token
from backend.services.twilio_service import generate_pin, send_pin_sms

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Registration"])


# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Pydantic Models
class RegisterRequest(BaseModel):
    """Registration request"""
    name: str
    email: EmailStr
    password: str
    phone: str
    
    @validator('name')
    def validate_name(cls, v):
        if len(v) < 2:
            raise ValueError('Name must be at least 2 characters')
        return v.strip()
    
    @validator('password')
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters')
        return v
    
    @validator('phone')
    def validate_phone(cls, v):
        # Remove spaces, dashes
        clean = ''.join(c for c in v if c.isdigit())
        if len(clean) < 10:
            raise ValueError('Phone number must be at least 10 digits')
        return clean


@router.post("/register")
async def register(
    data: RegisterRequest = Body(...),
    db: Session = Depends(get_db)
):
    """
    Step 1: Register new user
    Creates Employee + User records
    Sends email verification token (logged for now, not sent via email)
    """
    try:
        logger.info(f"📝 Registration request for {data.email}")
        
        # Check if email already exists
        existing_user = db.query(User).filter(User.email == data.email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Check if phone already exists
        existing_phone = db.query(Employee).filter(Employee.phone == data.phone).first()
        if existing_phone:
            raise HTTPException(status_code=400, detail="Phone number already registered")
        
        # Create Employee record
        employee = Employee(
            name=data.name,
            email=data.email,
            phone=data.phone,
            phone_country_code='+91',
            status='pending_verification',
            email_verified=False,
            phone_verified=False,
            face_registered=False,
            onboarding_completed=False,
            profile_completed=False
        )
        db.add(employee)
        db.flush()
        
        # Create User record
        password_hash = get_password_hash(data.password)
        user = User(
            employee_id=employee.id,
            email=data.email,
            password_hash=password_hash,
            is_active=False,  # Will be True after email verification
            is_verified=False,
            face_registered=False,
            face_login_enabled=False
        )
        db.add(user)
        db.flush()
        
        # Generate email verification token
        verification_token = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(hours=24)
        
        reg_token = RegistrationToken(
            user_id=user.id,
            token=verification_token,
            token_type='email_verification',
            expires_at=expires_at
        )
        db.add(reg_token)
        db.commit()
        
        # Log verification link (in production, send via email)
        verification_link = f"http://localhost:5173/verify-email?token={verification_token}"
        logger.info(f"📧 Verification link: {verification_link}")
        
        return {
            "success": True,
            "message": "Registration successful! Please check your email to verify your account.",
            "user_id": user.id,
            "email": data.email,
            "verification_token": verification_token,  # Remove in production
            "next_step": "verify_email"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Registration error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify-email")
async def verify_email(
    token: str = Body(..., embed=True),
    db: Session = Depends(get_db)
):
    """
    Step 2: Verify email
    Activates account and sends phone verification PIN
    """
    try:
        logger.info(f"📧 Email verification attempt")
        
        # Find token
        token_record = db.query(RegistrationToken).filter(
            RegistrationToken.token == token,
            RegistrationToken.token_type == 'email_verification',
            RegistrationToken.used == False
        ).first()
        
        if not token_record:
            raise HTTPException(status_code=400, detail="Invalid or expired verification token")
        
        # Check expiration
        if datetime.utcnow() > token_record.expires_at:
            raise HTTPException(status_code=400, detail="Verification token expired")
        
        # Get user and employee
        user = db.query(User).filter(User.id == token_record.user_id).first()
        employee = db.query(Employee).filter(Employee.id == user.employee_id).first()
        
        # Mark as verified
        user.is_verified = True
        user.is_active = True
        employee.email_verified = True
        employee.email_verified_at = datetime.utcnow()
        employee.status = 'active'
        
        token_record.used = True
        token_record.used_at = datetime.utcnow()
        
        db.commit()
        
        logger.info(f"✅ Email verified: {user.email}")
        
        # Send phone verification PIN
        pin_code = generate_pin(length=6)
        expires_at = datetime.utcnow() + timedelta(minutes=5)
        
        pin_record = PINVerification(
            employee_id=employee.id,
            pin_code=pin_code,
            phone_number=employee.phone,
            pin_type='phone_verification',
            expires_at=expires_at
        )
        db.add(pin_record)
        db.commit()
        
        # Send SMS
        message = f"Hello {employee.name}! Your HRMS phone verification code is: {pin_code}. Valid for 5 minutes."
        sms_result = send_pin_sms(employee.phone, employee.name, pin_code)
        
        logger.info(f"📱 PIN sent to {employee.phone}: {pin_code}")  # Log for testing
        
        return {
            "success": True,
            "message": f"Email verified! PIN sent to ****{employee.phone[-4:]}",
            "user_id": user.id,
            "phone_last_digits": employee.phone[-4:],
            "pin_for_testing": pin_code,  # Remove in production
            "next_step": "verify_phone"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Email verification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify-phone")
async def verify_phone(
    user_id: int = Body(...),
    pin_code: str = Body(...),
    db: Session = Depends(get_db)
):
    """
    Step 3: Verify phone with PIN
    Completes registration and returns login token
    """
    try:
        logger.info(f"📱 Phone verification for user {user_id}")
        
        # Get user and employee
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        employee = db.query(Employee).filter(Employee.id == user.employee_id).first()
        
        # Find PIN record
        pin_record = db.query(PINVerification).filter(
            PINVerification.employee_id == employee.id,
            PINVerification.pin_type == 'phone_verification',
            PINVerification.verified == False
        ).order_by(PINVerification.created_at.desc()).first()
        
        if not pin_record:
            raise HTTPException(status_code=400, detail="No pending phone verification")
        
        # Check expiration
        if datetime.utcnow() > pin_record.expires_at:
            raise HTTPException(status_code=400, detail="PIN expired")
        
        # Check max attempts
        if pin_record.attempts >= pin_record.max_attempts:
            raise HTTPException(status_code=400, detail="Too many failed attempts")
        
        # Increment attempts
        pin_record.attempts += 1
        db.commit()
        
        # Verify PIN
        if pin_record.pin_code != pin_code:
            remaining = pin_record.max_attempts - pin_record.attempts
            raise HTTPException(status_code=401, detail=f"Incorrect PIN. {remaining} attempts remaining")
        
        # Mark verified
        pin_record.verified = True
        employee.phone_verified = True
        employee.phone_verified_at = datetime.utcnow()
        employee.profile_completed = True
        
        db.commit()
        
        logger.info(f"✅ Phone verified: {employee.phone}")
        
        # Generate login token
        access_token = create_access_token(
            data={
                "sub": user.email,
                "user_id": user.id,
                "employee_id": employee.id,
                "name": employee.name
            }
        )
        
        return {
            "success": True,
            "message": "Registration complete! You're now logged in.",
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "employee_id": employee.id,
                "name": employee.name,
                "email": employee.email,
                "phone_verified": True,
                "face_registered": False
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Phone verification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))