# Execution Plan — Admin Behaviour Analysis (Option B, admin-only)

> Builds the **Plain & Simple** flow from `BEHAVIOUR_ANALYSIS_LOGIC_FLOW.md`.
> Branch `ai-analysis`. Status: **approved, not yet implemented.**

## Context

Sir dropped the document-access threshold engine. The new feature: **on demand**, an
admin opens a **simple dashboard**, picks an employee, and the AI **reads that
employee's previous chat messages** and reports their **mood, personality, and other
inferred traits**. Everything is **admin-side only** — nothing is shown to the
employee, no notifications, no emails, no employee nudge. The raw chats are sent to
the model transiently but **never displayed or stored**; only the AI's **summary /
inferred traits** are kept.

**Locked decisions:** engine = AI read of chat history (no counters/thresholds);
audience = **admin only**; trigger = **on-demand (admin clicks "Analyse")**; output =
**summary/insight only** (mood, personality, traits, talking points — no raw quotes);
access is **logged**.

## Verified reality (reuse, don't rebuild)

- **Chat history path:** `Employee` → `User` (`User.employee_id == employee.id`) →
  `ChatSession` (`user_id == user.id`, `deleted_at IS NULL`) → `ChatMessage`
  (`session_id`, `role`, `content`, `created_at` via `BaseModel`). Models in
  `backend/database/models/chat.py`.
- **LLM:** reuse `ChatOpenAI(model=settings.AI_MODEL, api_key=settings.OPENAI_API_KEY)`
  exactly as `agent/agent.py` does. No new provider/config.
- **Admin API pattern:** `backend/api/admin.py` — `require_permission("...")` +
  `get_db`, `payload["sub"]` = caller id; `GET /admin/employees` already returns the
  employee list the dashboard will use.
- **Admin UI pattern:** `frontend/src/components/AdminPanel.jsx` — `tabs` array
  (`:290`) + `{activeTab === '<id>' && <Component/>}` render block (`:350+`); hooks
  read `localStorage['hrms_token']`, base `API='/api'`
  (`frontend/src/hooks/useBehaviorAlerts.js` is the canonical fetch pattern).
- **Permissions:** `backend/core/permissions.py` `ROLE_PERMISSIONS` per role +
  `require_permission`. **Alembic single head = `004_add_last_filename`.**

---

## Data model & migration

**1. `backend/database/models/behaviour_analysis.py`** — new `BehaviourAnalysis`
snapshot (append a row per run → gives the dashboard "last analysed" + history):
- `id`, `employee_id` (FK employees.id, index), `analyzed_by_employee_id` (FK, the
  admin — audit), `mood` (String), `personality` (Text), `traits` (Text — JSON list),
  `attitude_trend` (String), `observations` (Text), `suggested_talking_points` (Text),
  `confidence` (String/Int), `message_count` (Int), `model` (String), `created_at`
  (via `BaseModel`). **No raw chat content stored.**
- Re-export in `backend/database/models/__init__.py` (`__all__`) so `alembic/env.py`
  registers it.

**2. Migration `alembic/versions/005_add_behaviour_analysis.py`** (mirror
`004_add_last_filename.py`): `revision = "005_add_behaviour_analysis"`,
`down_revision = "004_add_last_filename"`; `upgrade()` → `op.create_table("behaviour_analyses", ...)`
with FKs + index on `employee_id`; `downgrade()` drops it. **Author only — do NOT
apply**; `alembic upgrade head` at test time.

## Config (`backend/core/config.py` + `.env.example`)
```python
BEHAVIOUR_ANALYSIS_ENABLED: bool = True       # feature kill-switch
BEHAVIOUR_ANALYSIS_MESSAGE_LIMIT: int = 100    # most-recent messages fed to the model
BEHAVIOUR_ANALYSIS_MIN_MESSAGES: int = 3       # below this → "not enough data"
```

## Permissions (`backend/core/permissions.py`)
Add `"behaviour.analyze"` to **ADMIN only** in `ROLE_PERMISSIONS`. (HR/employees do
not get it — this is admin-only by decision.)

---

## Backend — repository / service / api

**3. `backend/repositories/behaviour_analysis_repository.py`**
- `get_employee_messages(employee_id, limit) -> list[dict]` — join User→ChatSession
  (exclude `deleted_at`)→ChatMessage, order by `ChatMessage.created_at`, take the most
  recent `limit`, return `[{role, content, created_at}]`.
- `save_analysis(**fields) -> BehaviourAnalysis` — insert one snapshot row.
- `get_latest(employee_id) -> BehaviourAnalysis | None` — newest snapshot for detail.
- `list_latest_per_employee() -> list[(BehaviourAnalysis, Employee)]` — for the
  dashboard overview (latest row per employee, join name/email).

**4. `backend/services/behaviour_analysis_service.py`**
- `analyze(employee_id, admin_id) -> dict`:
  - return `{status:"disabled"}` if `not settings.BEHAVIOUR_ANALYSIS_ENABLED`.
  - `msgs = repo.get_employee_messages(employee_id, settings.BEHAVIOUR_ANALYSIS_MESSAGE_LIMIT)`;
    if `len(msgs) < MIN_MESSAGES` → `{status:"insufficient_data"}`.
  - Build a **structured prompt** (organisational-psychologist framing): "Read these
    employee↔assistant messages. Infer **mood, personality, traits, tone/attitude and
    any shift over time**. This is a private signal to start a *human* conversation —
    not a judgement, do not fabricate beyond the text. Return **JSON** with keys
    `mood, personality, traits[], attitude_trend, observations,
    suggested_talking_points[], confidence`."
  - One `ChatOpenAI` call (temp ~0.3), tolerant JSON parse (strip fences / fallback);
    persist via `repo.save_analysis(... analyzed_by_employee_id=admin_id,
    message_count=len(msgs), model=settings.AI_MODEL)`; return the structured dict +
    `analyzed_at`. Wrap in try/except → return `{status:"error"}` (never 500 the UI).
- `get_dashboard() -> list[dict]` — `repo.list_latest_per_employee()` serialized
  (employee name, mood, attitude_trend, confidence, analyzed_at).
- `get_detail(employee_id) -> dict | None` — latest full snapshot.

**5. `backend/api/behaviour_analysis_router.py`** (prefix `/behaviour-analysis`,
admin-only):
- `POST /behaviour-analysis/{employee_id}` → `require_permission("behaviour.analyze")`
  → `analyze(employee_id, int(payload["sub"]))`. **The on-demand trigger.**
- `GET /behaviour-analysis/{employee_id}` → latest stored snapshot (or `null`).
- `GET /behaviour-analysis` → dashboard overview list.
- Register in `backend/main.py` (`app.include_router(..., prefix=API_PREFIX)`).

---

## Frontend — simple admin dashboard (admin-only)

**6. `frontend/src/hooks/useBehaviourAnalysis.js`** (mirror `useBehaviorAlerts.js`):
`runAnalysis(empId)` → `POST /api/behaviour-analysis/{id}`; `getAnalysis(empId)` →
`GET .../{id}`; `loadDashboard()` → `GET /api/behaviour-analysis`. Token from
`localStorage['hrms_token']`.

**7. `frontend/src/components/BehaviourAnalysis.jsx`** — the dashboard:
- left: employee list (reuse `GET /api/admin/employees`) with a "last analysed"
  badge from `loadDashboard()`; each row an **"Analyse"** button.
- right: on click → `runAnalysis` → a **simple card** showing **mood**, **personality**,
  **traits** (chips), **attitude trend**, **observations**, **suggested talking
  points**, **confidence**, and `analyzed_at`. Reuse inline-style + `var(--accent)`
  conventions; a loading state during the LLM call.
- A small disclaimer line: *"AI-inferred from chat history — a prompt to start a human
  conversation, not a judgement."*

**8. `frontend/src/components/AdminPanel.jsx`** — add `{ id: 'behaviour', label:
'Behaviour' }` to the `tabs` array (`:290`) and render `{activeTab === 'behaviour' &&
<BehaviourAnalysis token={token} />}` in the content block (`:350+`).

**Employee side: unchanged. No component, no nudge, no notification anywhere.**

---

## Privacy & guardrails
- **Admin-only** (`behaviour.analyze`, ADMIN role) → 403 otherwise.
- **Summary only**: raw `ChatMessage` content is sent to the model in-memory and
  **never returned to the client or stored** — only inferred traits are persisted.
- Every run records **`analyzed_by_employee_id` + timestamp** (audit of who looked).
- **Probabilistic framing** in the UI; never presented as fact/evidence.
- Feature flag `BEHAVIOUR_ANALYSIS_ENABLED`; message volume capped by config.
- **No notifications / emails / employee-facing output** anywhere in this feature.
- (Housekeeping) the legacy document-threshold **HR alert** path (`_notify_hr`) is
  superseded by this private model — keep it switched off so nothing fires to HR.

## Build order
1. Model + `__init__` re-export → migration `005` (author only).
2. Config keys + `.env.example`; `behaviour.analyze` permission (ADMIN).
3. Repository → service (LLM call + JSON parse) → router → register in `main.py`.
4. Frontend hook → `BehaviourAnalysis.jsx` → AdminPanel tab.

## Verification
**Static:** `python -m compileall backend agent scripts`; ruff; single Alembic head
(`004 → 005`); import `backend.api.behaviour_analysis_router`,
`backend.services.behaviour_analysis_service` with a dummy `DATABASE_URL`.

**Unit** (SQLite harness, `tests/conftest.py`; **monkeypatch the `ChatOpenAI` call** so
no network): seed a User+ChatSession+ChatMessages for an employee → `analyze()` returns
the parsed traits dict and writes one `BehaviourAnalysis` row with
`analyzed_by_employee_id` set; `< MIN_MESSAGES` → `insufficient_data`; non-admin token
on `POST /behaviour-analysis/{id}` → **403**; assert the response/stored row contain
**no** raw message content.

**Manual E2E:** `alembic upgrade head` → `seed_db.py`; log in as **admin** → AdminPanel
→ **Behaviour** tab → pick an employee who has chatted → **Analyse** → see the
mood/personality/traits card. Confirm: the **employee UI shows nothing**, a **non-admin
gets 403**, and the dashboard never shows raw chat lines (only inferred summary).
