# HR Assistant — Agentic Demo (V2)

An enterprise-grade HR assistant powered by **LangGraph**, **OpenAI**, and **ChromaDB**. Features a ReAct agent loop with 17 auto-discovered tools, multi-format document ingestion (PDF/Excel/CSV/Markdown), SMTP email notifications, and a Streamlit UI.

---

## Prerequisites

- **Python 3.10+**
- **OpenAI API Key** (GPT-4o-mini or any compatible model)
- **Gmail App Password** (optional, for email notifications)

---

## Quick Start

### 1. Create Virtual Environment

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment

Copy `.env.example` or create `.env` in the `Demo/` root:

```env
# Required
AI_KEY=sk-your-openai-api-key-here
AI_MODEL=gpt-4o-mini

# Optional — Email Notifications
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-gmail-app-password
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587

# Optional — Custom RAG Models
EMBEDDING_MODEL=all-MiniLM-L6-v2
RERANK_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2
```

> **Note:** For Gmail, you need an [App Password](https://support.google.com/accounts/answer/185833), not your regular password. If email is not configured, the system will gracefully skip email notifications.

### 4. Seed the Database

```bash
python seed_db.py
```

This creates `data/hr_database.sqlite` with:
- 20 employees across 5 departments
- 100 leave balance records (5 types × 20 employees)
- 3 sample leave requests
- 14 onboarding tasks with 42 assignments

### 5. Ingest Documents

```bash
python ingest_docs.py
```

This processes all files in `documents/` and creates the ChromaDB vector store at `data/chroma_db/`.

Supported formats: **PDF**, **Excel (.xlsx/.xls)**, **CSV**, **Markdown (.md)**

### 6. Run the Application

```bash
streamlit run app.py
```

The app will be available at `http://localhost:8501`.

---

## Project Structure

```
Demo/
├── app.py                    # Streamlit UI
├── config.py                 # Environment-driven configuration
├── seed_db.py                # Database schema + sample data
├── ingest_docs.py            # Multi-format document ingestion
├── requirements.txt          # Python dependencies
├── .env                      # API keys and settings
│
├── agent/
│   ├── graph.py              # LangGraph ReAct agent
│   ├── state.py              # Agent state definition
│   └── tools_registry.py     # Auto-discovery tool scanner
│
├── tools/
│   ├── base.py               # @hr_tool decorator
│   ├── employee_tool.py      # Employee lookup (3 tools)
│   ├── leave_tool.py         # Leave management (5 tools)
│   ├── onboarding_tool.py    # Onboarding tracking (3 tools)
│   ├── analytics_tool.py     # HR analytics (2 tools)
│   ├── email_tool.py         # SMTP email (3 tools)
│   └── policy_search_tool.py # RAG policy search (1 tool)
│
├── documents/                # HR policy documents
│   ├── employee_handbook.md
│   ├── leave_policy.md
│   ├── onboarding_guide.md
│   └── wfh_policy.md
│
└── data/                     # Generated at runtime
    ├── hr_database.sqlite
    └── chroma_db/
```

---

## Features

### Agentic Reasoning (LangGraph)
The system uses a ReAct (Reason → Act → Observe → Repeat) loop. The agent can chain multiple tools in a single conversation turn — for example, looking up an employee, applying leave, and sending an email notification all in one request.

### 17 Auto-Discovered Tools
Tools are automatically registered by scanning the `tools/` directory. To add a new tool:

```python
# tools/my_tool.py
from .base import hr_tool

@hr_tool
def my_function(param: str) -> str:
    """Description shown to the LLM."""
    return "result"
```

No registration code needed — restart the app and it's available.

### Multi-Format Document Ingestion
Upload documents through the sidebar or place them in `documents/`. Supported:
- **PDF** — page-by-page extraction via `pypdf`
- **Excel** — sheet-by-sheet via `openpyxl`
- **CSV** — full table via `pandas`
- **Markdown** — header-based chunking with line numbers

### RAG with Citations
Policy queries return source document, section name, and line numbers:
```
Source: leave_policy.md (Lines 15-32)
Section: Maternity Leave
```

### HR Guardrails
The agent only answers HR-related queries. Non-HR questions (coding, math, weather) are politely declined.

### Email Notifications
Leave applications trigger automatic SMTP emails to both the employee and their manager. Approvals and rejections also send notifications.

---

## Available Tools

| Category | Tool | Description |
|----------|------|-------------|
| **Employee** | `lookup_employee` | Search by name, department, or designation |
| | `count_by_department` | Headcount per department |
| | `get_team` | Direct reports of a manager |
| **Leave** | `check_leave_balance` | Remaining days per leave type |
| | `apply_leave` | Submit leave request + email |
| | `get_pending_leaves` | All unapproved requests |
| | `approve_leave` | Approve + deduct balance + email |
| | `reject_leave` | Reject with reason + email |
| **Onboarding** | `get_onboarding_checklist` | Full task list with status |
| | `mark_task_complete` | Complete an onboarding task |
| | `get_onboarding_progress` | Percentage completion |
| **Analytics** | `get_leave_summary` | Company-wide leave breakdown |
| | `get_department_summary` | Dept stats + avg tenure |
| **Email** | `send_email` | Direct SMTP send |
| | `notify_employee` | Lookup email + send |
| | `notify_hr` | Send to HR inbox |
| **RAG** | `search_policies` | Vector search + reranking with citations |

---

## Example Queries

```
"How many employees are in Engineering?"
"Check leave balance for Rahul Sharma"
"Apply casual leave for Amit Kumar from 2025-03-01 to 2025-03-03 for family function"
"What is the maternity leave policy?"
"Show onboarding progress for Riya Saxena"
"Who reports to Priya Patel?"
"Show all pending leave requests"
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Agent Framework | LangGraph |
| LLM | OpenAI GPT-4o-mini |
| Embeddings | all-MiniLM-L6-v2 (local) |
| Reranking | ms-marco-MiniLM-L-6-v2 (local) |
| Vector Store | ChromaDB |
| Database | SQLite |
| UI | Streamlit |
| Email | SMTP (Gmail) |
| PDF | pypdf |
| Excel/CSV | pandas + openpyxl |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `No module named 'langgraph'` | Run `pip install -r requirements.txt` |
| `Collection hr_docs_v2 not found` | Run `python ingest_docs.py` |
| `Employee not found` | Run `python seed_db.py` to create the database |
| Email not sending | Check `EMAIL_USER` and `EMAIL_PASS` in `.env`. Use Gmail App Password. |
| Slow first response | Normal — embedding and reranking models load on first query (~10s) |
