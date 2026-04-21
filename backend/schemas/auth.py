from pydantic import BaseModel
from typing import Optional

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    employee: dict

class FaceLoginRequest(BaseModel):
    image_base64: str

class PermanentPinLoginRequest(BaseModel):
    identifier: str
    pin: str

class VerifyAndChangePinRequest(BaseModel):
    identifier: str
    current_pin: str
    new_pin: Optional[str] = None