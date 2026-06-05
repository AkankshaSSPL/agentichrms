
# AgenticHRMS — AI-Powered HR Management System

> A production-grade HR Management System with an AI assistant powered by LangChain, GPT-4o-mini, and ChromaDB. Employees and HR teams interact through natural language to manage leave, onboarding, profiles, and company policies.

---

## Features

### AI Assistant (16 Tools)

| Category | Tools |
|---|---|
| **Policy Search** | `search_policies` — RAG search across uploaded HR documents |
| **Employee** | `lookup_employee` |
| **Leave** | `check_leave_balance`, `apply_leave`, `confirm_leave`, `approve_leave`, `reject_leave`, `cancel_leave_request`, `cancel_latest_pending_leave` |
| **Onboarding** | `get_onboarding_checklist`, `mark_task_complete`, `get_onboarding_progress` |
| **Profile** | `request_profile_update` — direct update or HR approval flow |
| **Analytics** | `get_leave_summary`, `get_department_summary` |
| **Notifications** | `send_notification_email` |

### Core Capabilities
- **Face recognition login** + **PIN verification** (2-factor auth)
- **Permission-based RBAC** — `admin`, `hr`, `manager`, `employee` roles with granular permissions
- **Calendar conflict detection** — checks Outlook ICS before saving leave
- **RAG policy search** — ChromaDB + sentence-transformers over uploaded HR documents
- **Profile change approval workflow** — sensitive fields routed to HR for approval
- **Email notifications** — SMTP, triggered on leave events and profile changes
- **Chat history** — sessions with pin, rename, and soft delete

---

## Architecture

```
React + Vite (frontend/)
        │  HTTP /api/*
FastAPI Backend (backend/)
        │
        ├── api/          # Route handlers (auth, chat, leave, admin, ...)
        ├── services/     # Business logic (LeaveService, ApprovalService, ...)
        ├── repositories/ # DB access layer
        ├── core/         # Config, security, permissions
        └── database/     # SQLAlchemy models, migrations (Alembic)
        │
        ├── agent/
        │   ├── agent.py           # LangChain AgentExecutor (cached per user)
        │   ├── tools_registry.py  # All 16 tool implementations
        │   └── state.py
        │
        └── data/
            ├── chroma_db/         # ChromaDB vector store
            └── face_models/       # Face recognition models
```

---

## Project Structure

```
agentichrms/
├── agent/
│   ├── agent.py              # LangChain agent, per-user cache
│   ├── tools_registry.py     # All 16 tool implementations
│   └── state.py
├── backend/
│   ├── api/                  # FastAPI routers
│   │   ├── face_auth.py
│   │   ├── pin_auth.py
│   │   ├── registration.py
│   │   ├── chat.py
│   │   ├── leaves_admin.py
│   │   ├── admin.py
│   │   ├── onboarding.py
│   │   ├── notifications.py
│   │   ├── meetings.py
│   │   ├── approval_router.py
│   │   └── ...
│   ├── core/
│   │   ├── config.py         # Pydantic settings (single source of truth)
│   │   ├── security.py       # JWT, password hashing
│   │   └── permissions.py    # RBAC — role → permission mapping
│   ├── database/
│   │   ├── models/           # SQLAlchemy models (split by domain)
│   │   │   ├── employee.py
│   │   │   ├── leave.py
│   │   │   ├── auth.py
│   │   │   ├── onboarding.py
│   │   │   └── ...
│   │   └── session.py
│   ├── services/             # Business logic layer
│   ├── repositories/         # Database access layer
│   ├── enums/                # LeaveStatus, RoleName, etc.
│   └── main.py               # FastAPI app, router registration
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── components/
│       └── main.jsx
├── alembic/                  # Database migrations
├── data/
│   ├── chroma_db/            # ChromaDB vector store
│   └── face_models/          # Face recognition classifier
├── documents/                # Upload HR policy documents here
├── seed_db.py                # Seed database with sample data
├── requirements.txt
└── .env
```

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL database
- OpenAI API key

### 1. Clone & Install

```bash
git clone https://github.com/AkankshaSSPL/agentichrms.git
cd agentichrms
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Mac/Linux
pip install -r requirements.txt
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
# Database (required)
DATABASE_URL=postgresql://user:password@localhost/agentichrms

# Security (required — minimum 32 characters)
JWT_SECRET=your-secret-key-minimum-32-characters-long

# OpenAI (required)
AI_KEY=sk-your-openai-api-key
AI_MODEL=gpt-4o-mini

# Email (optional)
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
HR_EMAIL=hr@yourcompany.com
ADMIN_EMAIL=admin@yourcompany.com

# Calendar conflict detection (optional)
COMPANY_CALENDAR_ICS_URL=https://outlook.office365.com/owa/calendar/...
```

### 3. Run Database Migrations

```bash
# Run once during setup (NOT on every startup)
alembic upgrade head
```

### 4. Seed Sample Data (optional)

```bash
python seed_db.py
```

### 5. Ingest HR Documents

Place PDF, DOCX, TXT, or MD files in `documents/`, then:

```bash
python ingest_docs.py
```

### 6. Start the Application

```bash
# Terminal 1 — Backend
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

---

## Roles & Permissions

| Permission | employee | manager | hr | admin |
|---|:---:|:---:|:---:|:---:|
| Apply leave | ✅ | ✅ | ✅ | ✅ |
| View all leaves | | ✅ | ✅ | ✅ |
| Approve / Reject leave | | ✅ | ✅ | ✅ |
| View employee list | | ✅ | ✅ | ✅ |
| Create / Update employees | | | ✅ | ✅ |
| Delete employees | | | | ✅ |
| Manage approval requests | | | ✅ | ✅ |
| Change roles | | | | ✅ |
| Manage onboarding | | | ✅ | ✅ |

---

## RAG Pipeline

- **Embedding model**: `all-MiniLM-L6-v2` (local, via sentence-transformers)
- **Vector store**: ChromaDB (persistent, local)
- **Supported formats**: PDF, DOCX, Markdown, TXT
- **Reranker**: `cross-encoder/ms-marco-MiniLM-L-6-v2` (optional)

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `fastapi` + `uvicorn` | REST API backend |
| `langchain-openai` | GPT-4o-mini integration |
| `langchain` | Agent + tool framework |
| `chromadb` | Vector store |
| `sentence-transformers` | Local embeddings |
| `sqlalchemy` + `alembic` | ORM + migrations |
| `pydantic-settings` | Configuration management |
| `passlib[bcrypt]` | Password hashing |
| `python-jose` | JWT tokens |
| `icalendar` + `requests` | Calendar conflict detection |

---

## License

MIT