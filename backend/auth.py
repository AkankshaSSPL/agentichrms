"""Authentication utilities: password hashing (bcrypt) and JWT tokens.

All auth-related logic is centralised here so that api.py stays lean.

SECURITY NOTES:
  - Plaintext passwords are NEVER stored or logged anywhere.
  - Passwords are hashed with bcrypt before being written to the database.
  - On login, only the hash is retrieved; bcrypt.checkpw compares the
    submitted password against the stored hash in constant time.
"""
import os
import re
import sys
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import jwt  # PyJWT
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

# ── Project imports ───────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
from config import DB_PATH, JWT_SECRET, JWT_EXPIRY_HOURS


# ── Password validation ──────────────────────────────────────────────────────
# Enforced on the backend regardless of frontend checks (frontend validation
# can be bypassed, so the backend is the source of truth).

def validate_password(password: str) -> str | None:
    """Validate password strength.

    Rules:
      - Minimum 8 characters
      - At least one uppercase letter (A-Z)
      - At least one lowercase letter (a-z)
      - At least one digit (0-9)
      - At least one special character (!@#$%^&* etc.)

    Returns None if valid, or a descriptive error message string if invalid.
    """
    if len(password) < 8:
        return "Password must be at least 8 characters long."
    if not re.search(r"[A-Z]", password):
        return "Password must contain at least one uppercase letter."
    if not re.search(r"[a-z]", password):
        return "Password must contain at least one lowercase letter."
    if not re.search(r"[0-9]", password):
        return "Password must contain at least one number."
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':""\\|,.<>/?~`]", password):
        return "Password must contain at least one special character (e.g., !@#$%^&*)."
    return None  # All checks passed


# ── Password hashing (bcrypt) ─────────────────────────────────────────────────
# How bcrypt works:
#   1. hash_password() generates a random 16-byte salt via bcrypt.gensalt(),
#      then computes a one-way hash of (salt + plaintext). The output string
#      embeds both the salt and the hash, e.g.:
#        $2b$12$<22-char-salt><31-char-hash>
#   2. verify_password() extracts the salt from the stored hash, re-hashes
#      the submitted plaintext with that same salt, and performs a
#      constant-time comparison (to prevent timing attacks).
#   3. Because the hash is one-way, the original password can NEVER be
#      recovered from the stored hash.


def hash_password(plain: str) -> str:
    """Return a bcrypt hash of the plaintext password.
    The plaintext is NEVER stored or logged — only the resulting hash is kept.
    """
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Check a plaintext password against its bcrypt hash.

    Internally, bcrypt.checkpw:
      1. Extracts the salt from the stored 'hashed' string.
      2. Hashes the submitted 'plain' password with that same salt.
      3. Compares the two hashes using a constant-time function
         (safe against timing side-channel attacks).
    Returns True if the password matches, False otherwise.
    """
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ── JWT tokens ────────────────────────────────────────────────────────────────
ALGORITHM = "HS256"


def create_access_token(data: dict) -> str:
    """Create a signed JWT with an expiry claim."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and verify a JWT. Raises HTTPException 401 on failure."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. Please log in again.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )


# ── FastAPI dependency ────────────────────────────────────────────────────────
# tokenUrl is only used for OpenAPI docs; the actual login endpoint is /api/login
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """FastAPI dependency: extracts and validates the JWT, then fetches the user
    from the database. Returns a dict with user fields (id, name, email, …).

    Usage in an endpoint:
        @app.post("/api/chat")
        def chat(req: ChatRequest, current_user: dict = Depends(get_current_user)):
            ...
    """
    payload = decode_access_token(token)
    user_email: str | None = payload.get("sub")
    if user_email is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing user information.",
        )

    # Look up the user in the database
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT id, name, email, phone, department, employee_id FROM users WHERE email = ?",
        (user_email,),
    ).fetchone()
    conn.close()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists.",
        )

    return dict(row)


# ── Users table auto-creation ─────────────────────────────────────────────────
# Called once when this module is imported, so the table exists even if
# seed_db.py has not been run.

def _ensure_users_table():
    """Create the users table if it does not already exist."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            email         TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            phone         TEXT,
            department    TEXT,
            employee_id   INTEGER,
            face_image    TEXT,
            created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id)
        )
    """)
    conn.commit()
    conn.close()


_ensure_users_table()
