# 🏢 AgenticHRMS — AI-Powered HR Assistant

> A fully agentic HR Management System powered by LangGraph, GPT-4o, and ChromaDB. Ask questions about company policies, look up employees, manage leave, track onboarding, send emails — all through natural language.

---

## ✨ Features

### 🤖 17 AI-Powered Tools

| Category | Tools | What It Does |
|----------|-------|-------------|
| **Policy Search** | `search_policies` | RAG-based search across uploaded HR documents (PDF, DOCX, MD, TXT, Excel, CSV) |
| **Employee** | `lookup_employee`, `count_by_department`, `get_team` | Search employee info, headcount analytics, org structure |
| **Leave** | `check_leave_balance`, `apply_leave`, `get_pending_leaves`, `approve_leave`, `reject_leave` | Full leave lifecycle management |
| **Onboarding** | `get_onboarding_checklist`, `mark_task_complete`, `get_onboarding_progress` | Track new hire onboarding status |
| **Email** | `send_email`, `notify_employee`, `notify_hr` | SMTP email notifications to employees and HR |
| **Analytics** | `get_leave_summary`, `get_department_summary` | Org-wide leave usage and department stats |

### 📄 Smart Document Processing
- **Sub-chunking**: Documents split into ~500-character chunks with 80-char overlap for precise retrieval
- **Multi-format**: PDF, DOCX, Markdown, TXT, Excel, CSV
- **Metadata preservation**: Source file, section headers, page numbers, line ranges
- **ChromaDB vector store** with sentence-transformers embeddings

### 🎨 Dual Frontend
- **Streamlit** (legacy): `app.py` — works out of the box
- **React + Vite** (new): `frontend/` — premium dark theme, 3-column layout, source code viewer with line highlighting

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React / Streamlit)          │
│   Sidebar  │  Chat Panel  │  Source Preview Panel       │
└─────────────────┬───────────────────────────────────────┘
                  │ HTTP / API
┌─────────────────▼───────────────────────────────────────┐
│              FastAPI Backend (backend/api.py)            │
│   /api/chat  /api/upload  /api/ingest  /api/documents   │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│          LangGraph Agent (agent/graph.py)                │
│   SystemPrompt → LLM (GPT-4o-mini) → Tool Router       │
└──────┬──────────┬──────────┬──────────┬─────────────────┘
       │          │          │          │
  ┌────▼───┐ ┌───▼────┐ ┌───▼───┐ ┌───▼────┐
  │ChromaDB│ │SQLite  │ │ SMTP  │ │  More  │
  │  RAG   │ │Employee│ │ Email │ │ Tools  │
  │ Search │ │ Leave  │ │       │ │        │
  └────────┘ └────────┘ └───────┘ └────────┘
```

---

## 📂 Project Structure

```
agentichrms/
├── agent/                  # LangGraph agent
│   ├── graph.py            # Agent workflow, system prompt, tool routing
│   ├── state.py            # Agent state schema
│   └── tools_registry.py   # Registers all 17 tools
├── tools/                  # Tool implementations
│   ├── retrieval.py        # RAG policy search (ChromaDB)
│   ├── employee_tool.py    # Employee lookup, headcount
│   ├── leave_tool.py       # Leave management (apply/approve/reject)
│   ├── onboarding_tool.py  # Onboarding checklist tracking
│   ├── email_tool.py       # SMTP email notifications
│   ├── analytics_tool.py   # Leave & department analytics
│   └── base.py             # Tool decorator
├── backend/                # FastAPI backend
│   └── api.py              # REST API for React frontend
├── frontend/               # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx         # Main React component
│   │   ├── index.css       # Design system (dark theme)
│   │   └── main.jsx        # Entry point
│   ├── index.html
│   ├── vite.config.js      # Vite config with API proxy
│   └── package.json
├── utils/
│   └── document_viewer.py  # Source preview rendering
├── documents/              # Uploaded HR documents
├── data/
│   ├── chroma_db/          # ChromaDB vector store
│   └── hr_database.sqlite  # Employee/leave SQLite DB
├── app.py                  # Streamlit frontend (legacy)
├── config.py               # Environment config
├── ingest_docs.py          # Document ingestion pipeline
├── seed_db.py              # Database seeder (mock data)
├── requirements.txt        # Python dependencies
└── .env                    # API keys and secrets
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+ (for React frontend)
- OpenAI API key

### 1. Clone & Install

```bash
git clone https://github.com/AkankshaSSPL/agentichrms.git
cd agentichrms
python -m venv venv
venv\Scripts\activate          # Windows
source venv/bin/activate       # Mac/Linux
pip install -r requirements.txt
```

### 2. Configure Environment

Create a `.env` file:

```env
AI_KEY=sk-your-openai-api-key
AI_MODEL=gpt-4o-mini
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
```

### 3. Seed Database & Ingest Documents

```bash
python seed_db.py             # Creates SQLite DB with mock employee data
python ingest_docs.py         # Ingests documents into ChromaDB
```

### 4. Run

**Option A — Streamlit (Quick)**
```bash
streamlit run app.py
```
Opens at `http://localhost:8501`

**Option B — React + FastAPI (Recommended)**
```bash
# Terminal 1: Backend
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```
Opens at `http://localhost:3000`

---

## 💬 Demo Queries

| Query | What Happens |
|-------|-------------|
| "What is the maternity leave policy?" | Searches policy docs, quotes exact text with citations |
| "Look up Rahul Sharma" | Returns employee details from database |
| "What is Rahul's leave balance?" | Shows all leave types with remaining days |
| "Apply casual leave for Rahul from 2025-04-01 to 2025-04-03 for personal work" | Creates leave record, sends email notifications |
| "How many employees per department?" | Returns headcount breakdown |
| "Show Amit Kumar's onboarding progress" | Shows checklist with completed/pending tasks |
| "Show all pending leave requests" | Lists all pending requests with IDs |
| "Send email to hr about policy update" | Sends SMTP email to HR |

---

## 🔧 Technical Details

### RAG Pipeline
- **Embedding Model**: `all-MiniLM-L6-v2` (local, via sentence-transformers)
- **Vector Store**: ChromaDB (persistent, local)
- **Chunk Size**: 500 characters with 80-character overlap
- **Retrieval**: Top-8 results (K=8) with cosine similarity
- **Reranker**: `cross-encoder/ms-marco-MiniLM-L-6-v2` (configured, optional)

### Agent Architecture
- **Framework**: LangGraph (StateGraph with tool routing)
- **LLM**: GPT-4o-mini (configurable via `AI_MODEL` env var)
- **Tool Binding**: LangChain tool decorator with automatic schema generation
- **Flow**: `User → Agent → Tool Router → Tool Execution → Agent → Response`

### Database Schema
- **employees**: name, email, department, designation, manager, join_date, status
- **leave_balances**: employee_id, leave_type, days_remaining
- **leaves**: employee_id, leave_type, start/end dates, reason, status
- **onboarding_tasks**: task_name, category
- **employee_onboarding**: employee_id, task_id, status, completed_at

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `langchain-openai` | GPT-4o integration |
| `langgraph` | Agent workflow orchestration |
| `chromadb` | Vector store for document embeddings |
| `sentence-transformers` | Local embedding model |
| `pypdf` | PDF text extraction |
| `python-docx` | DOCX text extraction |
| `fastapi` + `uvicorn` | REST API backend |
| `streamlit` | Legacy frontend |
| `pandas` + `openpyxl` | Excel/CSV processing |

---

## 📄 License

MIT

---

Built with ❤️ using LangGraph, GPT-4o, ChromaDB, React, and FastAPI.
