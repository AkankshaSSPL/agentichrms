from pydantic import BaseModel, validator
from typing import Optional


# ── Requests ──────────────────────────────────────────────────────────────────

class FaceLoginRequest(BaseModel):
    image_base64: str

class PermanentPinLoginRequest(BaseModel):
    identifier: str
    pin: str

    @validator("pin")
    def pin_digits_only(cls, v):
        if not v.isdigit():
            raise ValueError("PIN must contain digits only")
        if len(v) != 6:
            raise ValueError("PIN must be exactly 6 digits")
        return v

class VerifyAndChangePinRequest(BaseModel):
    identifier: str
    current_pin: str
    new_pin: Optional[str] = None

    @validator("current_pin")
    def current_pin_digits(cls, v):
        if not v.isdigit():
            raise ValueError("PIN must contain digits only")
        if len(v) != 6:
            raise ValueError("PIN must be exactly 6 digits")
        return v

    @validator("new_pin")
    def new_pin_digits(cls, v):
        if v is not None:
            if not v.isdigit():
                raise ValueError("PIN must contain digits only")
            if len(v) != 6:
                raise ValueError("PIN must be exactly 6 digits")
        return v

class DetectFacesRequest(BaseModel):
    image_base64: str


# ── Responses ─────────────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    """
    Safe auth response — never include pin_hash, permanent_pin_hash,
    password_hash, or any credential fields in the employee dict.
    """
    access_token: str
    token_type: str = "bearer"
    employee_id: int
    name: str
    email: str
    role: str