"""
Application Configuration
Loads environment variables and provides app-wide settings.
Variable names match exactly what is in your .env file.
"""

import json
from pathlib import Path
from typing import List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):

    # ── Database ───────────────────────────────────────────────────────────────
    # No default — app will refuse to start if DATABASE_URL is missing from .env
    DATABASE_URL: str

    @field_validator("DATABASE_URL")
    @classmethod
    def database_url_must_be_set(cls, v: str) -> str:
        if not v:
            raise ValueError(
                "DATABASE_URL must be set in your .env file. "
                "Example: DATABASE_URL=postgresql://user:password@localhost/dbname"
            )
        return v

    # ── Security & JWT ─────────────────────────────────────────────────────────
    # No default — app will refuse to start if JWT_SECRET is missing from .env
    JWT_SECRET: str
    ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 24

    @field_validator("JWT_SECRET")
    @classmethod
    def jwt_secret_must_be_set(cls, v: str) -> str:
        if not v or len(v) < 32:
            raise ValueError(
                "JWT_SECRET must be set in your .env file and be at least 32 characters. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        return v

    @property
    def SECRET_KEY(self) -> str:
        return self.JWT_SECRET

    @property
    def ACCESS_TOKEN_EXPIRE_MINUTES(self) -> int:
        return self.JWT_EXPIRY_HOURS * 60

    # ── API ────────────────────────────────────────────────────────────────────
    API_V1_PREFIX: str = "/api"
    PROJECT_NAME: str = "Agentic HRMS"
    VERSION: str = "1.0.0"

    # ── CORS ───────────────────────────────────────────────────────────────────
    # Handles all .env formats:
    #   ALLOWED_ORIGINS=["http://localhost:3000","http://localhost:8000"]   ← JSON array
    #   ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000         ← comma-separated
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
    ]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v):
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                try:
                    return json.loads(v)
                except json.JSONDecodeError:
                    pass
            # Comma-separated fallback
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # ── Email ──────────────────────────────────────────────────────────────────
    EMAIL_USER: Optional[str] = None
    EMAIL_PASS: Optional[str] = None
    EMAIL_HOST: str = "smtp.gmail.com"
    EMAIL_PORT: int = 587
    SMTP_TIMEOUT: int = 10
    HR_EMAIL: Optional[str] = None
    ADMIN_EMAIL: Optional[str] = None

    # ── Twilio ─────────────────────────────────────────────────────────────────
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_PHONE_NUMBER: Optional[str] = None

    # ── OpenAI ─────────────────────────────────────────────────────────────────
    AI_KEY: Optional[str] = None
    AI_MODEL: str = "gpt-4o-mini"

    @property
    def OPENAI_API_KEY(self) -> Optional[str]:
        return self.AI_KEY

    # ── Face Recognition ───────────────────────────────────────────────────────
    FACE_CLASSIFIER_PATH: str = "data/face_models/face_classifier.pkl"
    FACE_EMBEDDINGS_PATH: str = "data/face_models/embeddings.npy"
    FACE_LABELS_PATH: str = "data/face_models/labels.npy"
    FACE_DISTANCE_THRESHOLD: float = 1.2

    # ── PIN Verification ───────────────────────────────────────────────────────
    PIN_LENGTH: int = 6
    PIN_EXPIRY_MINUTES: int = 5
    PIN_MAX_ATTEMPTS: int = 3

    # ── Behavioral Analytics ───────────────────────────────────────────────────
    BEHAVIOR_ANALYTICS_ENABLED: bool = True
    BEHAVIOR_WINDOW_DAYS: int = 7
    BEHAVIOR_THRESHOLD_SENSITIVE: int = 3
    BEHAVIOR_THRESHOLD_LEAVE_INTENT: int = 5
    BEHAVIOR_THRESHOLD_EXIT_INTENT: int = 2
    BEHAVIOR_THRESHOLD_GROWTH: int = 4
    BEHAVIOR_THRESHOLD_POSH: int = 2          # NEW
    NUDGE_REPEAT_COOLDOWN_DAYS: int = 14      # NEW
    DOCUMENT_VIEWER_ENABLED: bool = True
    BEHAVIOR_VIEW_COOLDOWN_MINUTES: int = 5
    BEHAVIOUR_ANALYSIS_ENABLED: bool = True
    BEHAVIOUR_ANALYSIS_MESSAGE_LIMIT: int = 30
    BEHAVIOUR_ANALYSIS_MIN_MESSAGES: int = 3
    # GENERAL category is intentionally omitted — never tracked

    # ── RAG Models ─────────────────────────────────────────────────────────────
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"
    RERANK_MODEL: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    # ── Paths ──────────────────────────────────────────────────────────────────
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    DOCS_DIR: Path = DATA_DIR / "docs"
    CHROMA_DIR: Path = DATA_DIR / "chroma_db"
    FACE_MODELS_DIR: Path = DATA_DIR / "face_models"
    CHROMA_COLLECTION_NAME: str = "hr_policies"

    # ── Development ────────────────────────────────────────────────────────────
    DEBUG: bool = True
    RELOAD: bool = True
    MAX_UPLOAD_BYTES: int = 52428800
    ALLOW_SEED: bool = False

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "allow"


# Singleton instance — will raise ValidationError at startup if required secrets missing
settings = Settings()


def ensure_directories():
    """Create all required data directories on startup."""
    for d in [settings.DATA_DIR, settings.DOCS_DIR,
              settings.CHROMA_DIR, settings.FACE_MODELS_DIR]:
        d.mkdir(parents=True, exist_ok=True)


ensure_directories()