import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Base Paths
DEMO_DIR = Path(__file__).parent
DATA_DIR = DEMO_DIR / "data"
DB_PATH = DATA_DIR / "hr_database.sqlite"
CHROMA_DIR = DATA_DIR / "chroma_db"
DOCS_DIR = DEMO_DIR / "documents"

# OpenAI
OPENAI_API_KEY = os.getenv("AI_KEY") or os.getenv("OPENAI_API_KEY")
AGENT_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")

# GAP-012 FIX: Fail loudly at import time if the API key is missing.
# Previously OPENAI_API_KEY silently became None, and the application started
# successfully but crashed with a confusing AuthenticationError on the very
# first user query.
if not OPENAI_API_KEY:
    raise ValueError(
        "Missing OpenAI API key. Set AI_KEY or OPENAI_API_KEY in your .env file.\n"
        "Example: AI_KEY=sk-..."
    )

# Email Settings
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_PASS")
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))

# JWT Authentication
JWT_SECRET = os.getenv("JWT_SECRET")
JWT_EXPIRY_HOURS = int(os.getenv("JWT_EXPIRY_HOURS", "24"))

if not JWT_SECRET:
    raise ValueError(
        "Missing JWT_SECRET. Set JWT_SECRET in your .env file.\n"
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )

# Local RAG Models (configurable via env, with sensible defaults)
LOCAL_EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
LOCAL_RERANK_MODEL = os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")