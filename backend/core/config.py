"""
Application Configuration
Loads environment variables and provides app-wide settings.
Variable names match exactly what is in your .env file.
"""

from pydantic_settings import BaseSettings
from typing import List, Optional
from pathlib import Path


class Settings(BaseSettings):

    # ── Database ───────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql://hrms_user:agentichrms@localhost/agentic_hrms"

    # ── Security & JWT ─────────────────────────────────────────────────────────
    # .env uses JWT_SECRET — we expose it as SECRET_KEY for internal use
    JWT_SECRET: str = "change-this-in-production"
    ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 24  # kept in hours to match .env; converted below

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
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
    ]

    # ── Email (OTP delivery via SMTP — credentials from .env) ─────────────────
    EMAIL_USER: Optional[str] = None
    EMAIL_PASS: Optional[str] = None
    EMAIL_HOST: str = "smtp.gmail.com"
    EMAIL_PORT: int = 587
    SMTP_TIMEOUT: int = 10

    # ── Twilio (optional — set to enable SMS OTP instead of email) ─────────────
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_PHONE_NUMBER: Optional[str] = None

    # ── OpenAI ─────────────────────────────────────────────────────────────────
    # .env exports it as AI_KEY
    AI_KEY: Optional[str] = None
    AI_MODEL: str = "gpt-4o-mini"

    @property
    def OPENAI_API_KEY(self) -> Optional[str]:
        return self.AI_KEY

    # ── Face Recognition ───────────────────────────────────────────────────────
    FACE_CLASSIFIER_PATH: str = "data/face_models/face_classifier.pkl"
    FACE_EMBEDDINGS_PATH: str = "data/face_models/embeddings.npy"
    FACE_LABELS_PATH: str = "data/face_models/labels.npy"
    # Euclidean distance threshold — predictions with distance > this are rejected
    FACE_DISTANCE_THRESHOLD: float = 1.2

    # ── PIN Verification ───────────────────────────────────────────────────────
    PIN_LENGTH: int = 6
    PIN_EXPIRY_MINUTES: int = 5
    PIN_MAX_ATTEMPTS: int = 3

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


# Singleton instance
settings = Settings()


def ensure_directories():
    """Create all required data directories on startup."""
    for d in [settings.DATA_DIR, settings.DOCS_DIR,
              settings.CHROMA_DIR, settings.FACE_MODELS_DIR]:
        d.mkdir(parents=True, exist_ok=True)


ensure_directories()