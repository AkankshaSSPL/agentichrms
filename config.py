# Root config.py – re‑export settings from backend.core.config
from backend.core.config import settings

# Re‑export variables that tools, ingest script, and agent expect
DOCS_DIR = settings.DOCS_DIR
CHROMA_DIR = settings.CHROMA_DIR
CHROMA_COLLECTION_NAME = "hr_policies"
LOCAL_EMBEDDING_MODEL = settings.EMBEDDING_MODEL
LOCAL_RERANK_MODEL = settings.RERANK_MODEL
DB_PATH = str(settings.DATA_DIR / "hr_database.sqlite")  # legacy, not used

# Agent expects these
OPENAI_API_KEY = settings.OPENAI_API_KEY
AGENT_MODEL = settings.AI_MODEL

# Email config
EMAIL_USER = settings.EMAIL_USER
EMAIL_PASS = settings.EMAIL_PASS
EMAIL_HOST = settings.EMAIL_HOST
EMAIL_PORT = settings.EMAIL_PORT

HR_EMAIL = getattr(settings, "HR_EMAIL", "akulkarni@sveltoz.com")

SECRET_KEY = 'WvRVUUNfrXG1mBesBboQKylrFJnoRdcu9RI7aldfmdW'