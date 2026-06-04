from pydantic import BaseModel
from typing import Optional


# ── Requests ──────────────────────────────────────────────────────────────────

class FaceLoginRequest(BaseModel):
    image_base64: str

class PermanentPinLoginRequest(BaseModel):
    identifier: str
    pin: str

class VerifyAndChangePinRequest(BaseModel):
    identifier: str
    current_pin: str
    new_pin: Optional[str] = None

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