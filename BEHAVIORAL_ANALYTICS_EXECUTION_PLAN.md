# Execution Plan — Document Behavioral Analytics (HRMS)

> Companion to `BEHAVIORAL_ANALYTICS_ARCHITECTURE.md`. Hyper-detailed, end-to-end
> build steps. Status: **approved, not yet implemented.** Build on a branch off
> `validations`: `git checkout -b feat/behavioral-analytics`.

## Context

The architecture doc proposes a silent layer that watches how employees engage HR
documents, detects repeated-access patterns per category, and quietly alerts HR
(in-app bell + email) so HR can start a human conversation. No document content is
read; only access metadata.

**Verified reality that shapes this plan (differs from the doc's assumptions):**
- There is **no document library/viewer**. Documents live in ChromaDB and reach
  employees **only as RAG "sources" in the AI chat**. `POST /api/chat/`
  (`backend/api/chat.py:53`) computes `sources = result.get("sources", [])`
  (`:100`) — each `{source_file, section, content}` — with `employee` already in
  scope (`:55`). **This is the access-logging hook point.**
- Documents are identified by **filename only** (`source_file`, from the ChromaDB
  `source` metadata). No category tagging exists → we add a seeded,
  admin-taggable **`document_tags`** table.
- All supporting infra exists and is reused: `Notifier.to_hr` / `from_template_to_hr`
  (`backend/notifications/notifier.py`), the notification bell (no change),
  per-domain models package + `BaseModel` (`backend/database/models/`),
  repository/service pattern (`backend/repositories/`, `backend/services/`),
  enums package, `require_permission` + `payload["sub"]`
  (`backend/core/permissions.py`), email via `send_email` + `render_template`
  (`backend/core/email.py`, `backend/core/render_template.py`), Alembic with single
  head **`001_rename_pin_code`**, and the HRPanel tab pattern
  (`frontend/src/components/HRPanel.jsx`).

---

## Data model & enums

**1. `backend/enums/document_category.py`** — `class DocumentCategory(str, Enum)`:
`SENSITIVE, LEAVE_INTENT, EXIT_INTENT, GROWTH, GENERAL`. Mirror `enums/roles.py`.
**`backend/enums/behavior_alert_status.py`** — `BehaviorAlertStatus(str,Enum)`:
`OPEN, RESOLVED`. Re-export both in `backend/enums/__init__.py` (+ `__all__`).

**2. `backend/database/models/behavior_analytics.py`** (mirror `models/employee.py`
+ `BaseModel` from `models/base.py`). Three models:
- `DocumentTag(BaseModel)` — `__tablename__="document_tags"`: `id`,
  `filename` (String, unique, index, not null), `category` (String(30), not null,
  default `DocumentCategory.GENERAL`). The admin-taggable map.
- `DocumentAccessLog(BaseModel)` — `"document_access_logs"`: `id`,
  `employee_id` (FK employees.id, index, not null), `filename` (String, not null),
  `category` (String(30), not null), `chat_session_id` (Int, nullable),
  `accessed_at` (DateTime tz, server_default now, index). **Append-only audit** —
  never soft-deleted/updated. Composite index `(employee_id, category, accessed_at)`
  for the window query.
- `BehaviorAlert(BaseModel)` — `"behavior_alerts"`: `id`, `employee_id` (FK, index),
  `category` (String(30)), `status` (String(20), default `OPEN`, index),
  `score` (Int), `trigger_count` (Int), `window_days` (Int),
  `first_triggered_at` / `last_triggered_at` (DateTime),
  `resolved_at` (DateTime, nullable), `resolved_by_employee_id` (FK, nullable),
  `hr_note` (Text, nullable). Relationship `employee = relationship("Employee")`.

Re-export all three in `backend/database/models/__init__.py` (+ `__all__`) so
`alembic/env.py` (which imports `backend.database.models`) registers the tables.

---

## Config — tunable thresholds (`backend/core/config.py`)

Add to `Settings` (mirror existing `PIN_LENGTH` etc., all with defaults so nothing
breaks; "tunable without code" guardrail):
```python
BEHAVIOR_ANALYTICS_ENABLED: bool = True
BEHAVIOR_WINDOW_DAYS: int = 7
BEHAVIOR_ALERT_EMAIL_ENABLED: bool = True
BEHAVIOR_THRESHOLD_SENSITIVE: int = 3
BEHAVIOR_THRESHOLD_LEAVE_INTENT: int = 5
BEHAVIOR_THRESHOLD_EXIT_INTENT: int = 2
BEHAVIOR_THRESHOLD_GROWTH: int = 4
# GENERAL: not tracked (no threshold)
```
Add the same keys (commented) to `.env.example`.

---

## Backend — repository / service / notifications / api

**3. `backend/repositories/behavior_repository.py`** (mirror
`repositories/approval_repository.py`): `__init__(self, db)`; methods:
- `get_category_for(filename) -> str | None` (from `document_tags`)
- `list_tags()`, `upsert_tag(filename, category)`
- `log_access(employee_id, filename, category, session_id) -> DocumentAccessLog`
  (`db.add` + `commit`)
- `count_access_in_window(employee_id, category, since: datetime) -> int`
- `get_open_alert(employee_id, category) -> BehaviorAlert | None`
- `create_alert(...)`, `update_alert(alert, **fields)`
- `list_alerts(status) -> list[(BehaviorAlert, Employee)]` (join Employee for
  name/email)
- `get_alert(id)`, `resolve_alert(alert, resolved_by_id, note)`

**4. `backend/services/behavior_service.py`** (mirror `services/leave_service.py` /
`approval_service.py`): `__init__(self, db)` → `self.repo`, `self.db`.
- `THRESHOLDS` helper: `{SENSITIVE: settings.BEHAVIOR_THRESHOLD_SENSITIVE, ...}`;
  `GENERAL` omitted (untracked).
- **`record_access(self, employee_id, sources: list[dict], session_id) -> None`** —
  the entry point called from chat:
  - early-return if `not settings.BEHAVIOR_ANALYTICS_ENABLED`.
  - **dedupe** `sources` by `source_file` (one answer cites many chunks → count as
    one access per document per response).
  - for each unique filename: `category = repo.get_category_for(filename)` (skip if
    no tag — only tagged docs are tracked); `repo.log_access(...)` (always log
    tagged accesses for the audit trail); then `self._evaluate(employee_id, category)`.
  - **Wrap the whole body in `try/except` → `logger.warning`** so it can NEVER
    break the chat response.
- `_evaluate(employee_id, category)`: skip if category has no threshold; `since =
  utcnow() - timedelta(days=settings.BEHAVIOR_WINDOW_DAYS)`; `count =
  repo.count_access_in_window(...)`; if `count >= threshold`: `existing =
  repo.get_open_alert(...)`; if existing → `update_alert` (bump `trigger_count`,
  `last_triggered_at`, `score`); else `create_alert(status=OPEN, score=count, ...)`
  **and** `self._notify_hr(employee, category, count)`.
- `_notify_hr(...)`: in-app via
  `Notifier(self.db).from_template_to_hr(NotifKey.BEHAVIOR_ALERT_HR, employee_name=..., category=...)`;
  email (if `BEHAVIOR_ALERT_EMAIL_ENABLED`) — render `behavior_alert.html` and
  `send_email(to=hr.email, subject=..., html=..., triggered_by="behavior_alert", db=self.db)`
  for each HR/Admin (reuse `Notifier._get_hr_employees` pattern, or add
  `repo.get_hr_employees()`). All email wrapped in try/except.
- `list_alerts(status)` → serialized dicts (`id, employee_name, employee_email,
  category, score, status, trigger_count, window_days, last_triggered_at, hr_note`).
- `resolve_alert(alert_id, hr_id, note)` → validate, `repo.resolve_alert(...)`.
- `list_tags()`, `set_tag(filename, category)` for the admin tagging endpoints.

**5. Notifications** — `backend/notifications/notification_templates.py`: add
`NotifKey.BEHAVIOR_ALERT_HR` + template `{title: "Document Activity Signal",
message: "{employee_name} shows repeated interest in {category} documents. Review
in HR → Signals."}`. `backend/core/templates/behavior_alert.html` — new Jinja2
email mirroring `core/templates/leave_approved.html` (vars: `employee_name`,
`category`, `count`, `window_days`). The **notification bell needs no change**.

**6. `backend/api/behavior_router.py`** (mirror `api/leave_router.py`):
`router = APIRouter(prefix="/behavior", tags=["Behavioral Analytics"])`, `get_db`.
- `GET /behavior/alerts?status=open|resolved|all` →
  `Depends(require_permission("behavior.view"))` → `BehaviorService(db).list_alerts(status)`
- `PATCH /behavior/alerts/{id}/resolve` (body `{hr_note?}`) →
  `require_permission("behavior.view")` → `resolve_alert(id, int(payload["sub"]), note)`
- `GET /behavior/tags` + `PUT /behavior/tags` (body `{filename, category}`) →
  `require_permission("behavior.manage")` (admin tagging)
- `GET /behavior/documents` → join ChromaDB doc list (reuse `docs.py` ChromaDB
  read) with `document_tags` so the admin UI shows each doc's current category.
Register in `backend/main.py`: import + `app.include_router(behavior_router, prefix="/api")`.

**7. Permissions** (`backend/core/permissions.py`): add `"behavior.view"` to
`ROLE_PERMISSIONS[HR]` and `[ADMIN]`; add `"behavior.manage"` to `[ADMIN]` only.

**8. Chat hook** (`backend/api/chat.py`) — after messages are saved (`:141`),
before `return` (`:143`), add a **non-fatal** call:
```python
try:
    from backend.services.behavior_service import BehaviorService
    BehaviorService(db).record_access(employee.id, sources, payload.session_id)
except Exception as e:
    print(f"behavior analytics skipped: {e}")
```

**9. Migration** `alembic/versions/<id>_add_behavioral_analytics.py` (mirror
`make_role_id_not_null.py`): `down_revision = "001_rename_pin_code"`;
`op.create_table` for `document_tags`, `document_access_logs`, `behavior_alerts`
with FKs to `employees.id`, the unique on `document_tags.filename`, and the
composite index on access logs; `downgrade` drops all three. **Author only — do
NOT apply**; run `alembic upgrade head` at test time.

**10. Seed tags** `scripts/seed_document_tags.py` (mirror `scripts/seed_db.py`
structure): a `DEFAULT_DOCUMENT_CATEGORIES = {"<filename>": DocumentCategory.X}`
dict (filled from the real docs in `data/docs/`), idempotently upserted into
`document_tags`. Admin can re-tag later via `PUT /behavior/tags`.

---

## Frontend (HR-facing only; employee side stays silent)

**11. `frontend/src/hooks/useBehaviorAlerts.js`** (mirror `hooks/useChatSessions.js`):
token from `localStorage.getItem('hrms_token')`; `loadAlerts(status)` → `GET
/api/behavior/alerts`; `resolveAlert(id, note)` → `PATCH /api/behavior/alerts/{id}/resolve`.

**12. `frontend/src/components/BehaviorAlerts.jsx`** — the Signals list. **Copy the
`NameChangeRequests`/`ApprovalRequests` component pattern inside
`HRPanel.jsx`** (fetch on mount, status filter pills, card with employee avatar +
category badge + trigger count + `statusBadge` + a "Resolve" `actionBtn` with the
note modal). Reuse the inline-style + CSS-var conventions (`var(--accent)`,
`statusBadge`, `actionBtn`).

**13. `frontend/src/components/HRPanel.jsx`** — add `{ id: 'signals', label:
'Signals' }` to the `TABS` array (`:684`) and render `{activeTab === 'signals' &&
<BehaviorAlerts token={token} onAlert={addAlert} />}` in the content block (`:742`).

**14. (Admin, optional but include) Document tagging UI** — a small section in
`AdminPanel.jsx` listing `GET /behavior/documents` with a category `<select>` that
`PUT /behavior/tags`. If time-boxed, ship tagging via the seed script + API first
and add this UI last.

---

## Privacy & guardrails (enforce from the doc)
- Store **only metadata** (filename, category, employee, timestamp) — never the
  `content` field from sources.
- **No alert on a single access** — only when the windowed count crosses the
  category threshold.
- All `/behavior/*` endpoints are HR/Admin-only (`require_permission`) → 403 otherwise.
- **Duplicate alerts updated, not recreated** (`get_open_alert`).
- `document_access_logs` is **append-only** (no update/soft-delete) — permanent audit.
- Thresholds + enable flags are env-configurable; start high, tune down.

---

## Build order (each step compiles before the next)
1. Enums → models → `models/__init__.py` re-export.
2. Config thresholds + `.env.example`.
3. Migration (author) + `seed_document_tags.py`.
4. Repository → Service → notification template + email template.
5. `behavior_router.py` + permissions + register in `main.py`.
6. Chat hook in `chat.py` (non-fatal).
7. Frontend hook → `BehaviorAlerts.jsx` → HRPanel tab → (optional) admin tagging.

---

## Verification

**Static (no DB needed):** `python -m compileall backend agent scripts`;
ruff on changed files; confirm Alembic still has a **single head** (parse
`alembic/versions/`); `python -c "import backend.api.behavior_router; import
backend.services.behavior_service"` with a dummy `DATABASE_URL`.

**Unit (uses the existing SQLite test harness, `tests/conftest.py`):** add
`tests/test_behavior_analytics.py` — seed a `document_tags` row (SENSITIVE,
threshold 3), insert 3 access logs in-window for one employee via the service,
assert one `BehaviorAlert(OPEN)` is created; a 4th access updates (not duplicates)
it; out-of-window accesses don't trigger.

**Manual E2E (run the app):**
1. `alembic upgrade head` (fresh DB) → `python scripts/seed_db.py` →
   `python scripts/seed_document_tags.py`; set `BEHAVIOR_THRESHOLD_SENSITIVE=2`.
2. As an **employee**, ask the chatbot questions that retrieve a SENSITIVE-tagged
   doc twice → confirm `document_access_logs` rows + a `behavior_alerts` row.
3. As **HR**, see the bell notification + email, open **HR → Signals**, view the
   alert, click **Resolve** (it moves to resolved, audit kept).
4. Re-trigger → the open alert updates rather than duplicating.
5. Confirm a **non-HR** GET `/api/behavior/alerts` returns **403**, and that the
   employee UI shows **no trace** of the analytics.
