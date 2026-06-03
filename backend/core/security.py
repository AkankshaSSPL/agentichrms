"""
JWT Security — token creation, verification, and password hashing
"""

from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext

from backend.core.config import settings

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a signed JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def verify_token(token: str) -> Optional[dict]:
    """
    Verify and decode a JWT token.
    Returns the payload dict on success, or None on failure.
    """
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        return payload
    except JWTError:
        return None


def require_role(allowed_roles: list):
    """
    FastAPI dependency — raises 403 if the token's role is not in allowed_roles.

    Usage:
        @router.get("/admin-only")
        def admin_only(payload=Depends(require_role(["admin"]))):
            ...

        @router.get("/hr-or-admin")
        def hr_view(payload=Depends(require_role(["hr", "admin"]))):
            ...
    """
    from fastapi import Request, HTTPException
    from fastapi.security import HTTPBearer

    def _check(request: Request) -> dict:
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or invalid token")
        token = auth.split(" ", 1)[1]
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        employee_id = payload.get("sub")
        if not employee_id:
            raise HTTPException(status_code=401, detail="Invalid token: missing subject")

        # ── Always read the role fresh from the DB ──────────────────────────
        # This means a role change by admin takes effect immediately on the
        # employee's next API call — no re-login required.
        try:
            from backend.database.session import SessionLocal
            from backend.database.models import Employee
            db = SessionLocal()
            try:
                emp = db.query(Employee).filter(Employee.id == int(employee_id)).first()
                if not emp:
                    raise HTTPException(status_code=401, detail="Employee not found")
                # emp.role is a relationship → Role object with .name
                db_role = emp.role.name if emp.role and hasattr(emp.role, "name") else None
            finally:
                db.close()
        except HTTPException:
            raise
        except Exception:
            # DB unavailable — fall back to JWT role rather than blocking the request
            db_role = payload.get("role")

        if not db_role:
            raise HTTPException(
                status_code=401,
                detail="Your session is outdated. Please log out and log in again to continue."
            )

        if db_role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Required role: {allowed_roles}. Your role: {db_role}"
            )

        # Inject the fresh DB role into the payload so endpoints can read it
        payload["role"] = db_role
        return payload

    return _check