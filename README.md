# AgenticHRMS — AI-Powered HR Assistant

A role-based HR Management System with a natural-language chatbot. Ask about
company policies, look up employees, manage leave, and more — through chat or
the React UI. RAG over HR documents (ChromaDB) plus a LangChain agent that calls
backend tools.

> **Refactor in progress.** This codebase is mid-migration to a vertical
> feature-module architecture. The current state and known issues are tracked in
> `CLEANUP_LOG.md`. The architecture review documents (ARCHITECTURE / RULES /
> STRUCTURAL_REVIEW) are kept separately as **reference**; where code and those
> docs disagree, trust the code.

---

## Stack (actual)

| Layer | Tech |
|---|---|
| Backend | FastAPI (`backend/main.py`), routers under `backend/api/` |
| Agent | LangChain `AgentExecutor` (`agent/agent.py`), tools in `agent/tools_registry.py` |
| Database | **PostgreSQL** via SQLAlchemy; migrations via Alembic |
| RAG | ChromaDB + `sentence-transformers` (`all-MiniLM-L6-v2`) |
| Auth | JWT + face recognition + PIN (SMS via Twilio) |
| Frontend | React 19 + Vite (`frontend/`) |
| LLM | OpenAI `gpt-4o-mini` (configurable via `AI_MODEL`) |

There is **no** Streamlit frontend and **no** SQLite database, despite what older
docs claimed.

---

## Agent tools

16 tools are registered in `agent/tools_registry.py`:

| Area | Tools |
|---|---|
| Policy (RAG) | `search_policies` |
| Employee | `lookup_employee`, `request_profile_update` |
| Leave | `check_leave_balance`, `apply_leave`, `confirm_leave`, `cancel_latest_pending_leave`, `approve_leave`, `reject_leave`, `cancel_leave_request` |
| Email | `send_notification_email` |
| Onboarding | `get_onboarding_checklist`*, `mark_task_complete`*, `get_onboarding_progress`* |
| Analytics | `get_leave_summary`*, `get_department_summary`* |

`*` = **stub** — currently returns hardcoded/placeholder data, not real DB results.
To be replaced or descoped during the refactor (do not rely on these).

---

## Project structure (current)

```
agentichrms/
├── backend/
│   ├── main.py             # FastAPI app: middleware, CORS, router mounting
│   ├── api/                # Route handlers (auth, chat, leaves, admin, …)
│   ├── core/               # config (single settings source), security, email
│   ├── database/           # SQLAlchemy models + session
│   ├── schemas/            # Pydantic DTOs (partial)
│   └── services/           # email, face, twilio services
├── agent/
│   ├── agent.py            # LangChain AgentExecutor (live agent)
│   └── tools_registry.py   # All agent tools (monolith — to be split per module)
├── rag/
│   └── ingest_docs.py      # Document → ChromaDB ingestion (run manually)
├── alembic/                # Migrations (NOTE: env.py currently missing — see below)
├── scripts/                # Dev/ops scripts (seed_db, seed_meetings, set_admin_pin, retrain)
├── data/                   # ChromaDB store, face models, docs (gitignored where binary)
├── frontend/               # React + Vite
├── .env.example            # Copy to .env and fill in
└── requirements.txt
```

---

## Quick start

### Prerequisites
- Python 3.11+
- Node.js 18+
- A reachable PostgreSQL database
- OpenAI API key

### 1. Install
```bash
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
```

### 2. Configure
```bash
cp .env.example .env           # then fill in real values
# DATABASE_URL and JWT_SECRET are REQUIRED — the app will not boot without them.
# Generate a JWT secret: python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 3. Migrate the database (deploy step — not run at app startup)
```bash
alembic upgrade head
```
> ⚠️ `alembic/env.py` is currently **missing** from the repo, so migrations
> cannot run until it is restored. Tracked in `CLEANUP_LOG.md`.

### 4. Seed + ingest (optional, dev)
```bash
python scripts/seed_db.py      # seed employees/users (run from repo root)
python rag/ingest_docs.py      # ingest data/docs/* into ChromaDB
```

### 5. Run
```bash
# Backend
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```
Backend: `http://localhost:8000` · Frontend dev server proxies `/api` to it.

---

## Configuration

All settings are read in exactly one place: `backend/core/config.py` (Pydantic
`Settings`). Do not read `os.environ` elsewhere. See `.env.example` for the full
key list. Required (no defaults): `DATABASE_URL`, `JWT_SECRET`.

---

## License

MIT
