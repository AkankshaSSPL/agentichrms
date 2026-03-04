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

# Email Settings
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_PASS")
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))

# Local RAG Models (configurable via env, with sensible defaults)
LOCAL_EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
LOCAL_RERANK_MODEL = os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")