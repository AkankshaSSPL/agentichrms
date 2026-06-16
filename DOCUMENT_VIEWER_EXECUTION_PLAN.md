# Execution Plan — Document Viewer + Behavioral Analytics Wiring (HRMS)

> Companion to `BEHAVIORAL_ANALYTICS_ARCHITECTURE.md` and
> `BEHAVIORAL_ANALYTICS_EXECUTION_PLAN.md`. Hyper-detailed, end-to-end build steps.
> Status: **approved, not yet implemented.** Build on `behaviour-doc` (already cut
> from the updated `develop`, which contains the implemented chat-side analytics).

## Context

The chat-side behavioral analytics is **already implemented and merged** on this
branch (commit `5f9d41d`): tagged documents surfaced as RAG "sources" in the AI
chat are logged to `document_access_logs`, windowed per category, and raise deduped
`behavior_alerts` to HR (bell + email + HR → Signals tab).

**The gap:** employees can only reach documents as chat snippets — there is **no
document viewer**. So the analytics only "sees" reading intent that happens to flow
through chat. This plan adds an **employee-facing document viewer** (browse + open
full documents) and **wires every document open into the same analytics pipeline**,
so an employee repeatedly opening a `SENSITIVE` / `EXIT_INTENT` / etc. document
trips the **same** thresholds and raises the **same** HR alert — no second analytics
stack, no duplicate models.

**Decisions locked for this build:**
- **Rendering:** inline raw file serving — a new endpoint streams the file with the
  correct content-type; the browser renders PDF natively and shows md/txt inline.
- **Visibility:** the viewer lists **all** ingested documents, including
  `SENSITIVE`-tagged ones (required for the headline "repeatedly views the sensitive
  doc" signal to fire).
- **View trigger:** **one access log per open**, guarded by a per-(employee, file)
  **cooldown** so rapid re-opens don't spam the log / trip thresholds artificially.
  Each access log records an **`access_source`** (`chat` | `viewer`) for audit; the
  counts **combine** with chat accesses toward one per-category threshold.

---

## Verified reality that shapes this plan (reuse, don't rebuild)

- **`record_access(employee_id, sources: list[dict], session_id=None)`**
  (`backend/services/behavior_service.py:41`) already dedupes by `source_file`/
  `source`, looks up the tag, logs via `repo.log_access`, and calls `_evaluate`.
  The viewer reuses this exact pipeline through a thin sibling, `record_view`.
- **`BehaviorRepository.count_access_in_window(employee_id, category, since)`**
  (`backend/repositories/behavior_repository.py:72`) counts **all** rows for
  emp+category in the window → chat + viewer accesses **automatically combine**
  toward the same threshold. No alerting/notification changes needed.
- **`BehaviorRepository.log_access(...)`** (`:53`) and `DocumentAccessLog`
  (`backend/database/models/behavior_analytics.py:35`) — extended with one new
  column (`access_source`); everything downstream (`_evaluate`, `get_open_alert`,
  `create_alert`, `_notify_hr`, HR Signals UI) is untouched.
- **Docs API** (`backend/api/docs.py`): `GET /documents` lists unique filenames from
  ChromaDB `source` metadata; `GET /documents/{filename}` checks existence in
  `settings.DOCS_DIR`. **No content-serving endpoint exists** → we add `/raw` + a
  view-logging endpoint here.
- **Document files** live in `settings.DOCS_DIR` = `data/docs/` (PDF, md, txt, docx).
  Filenames are the analytics identity (`document_tags.filename`).
- **`require_authenticated`** (`backend/core/permissions.py:180`) gates any
  logged-in employee — correct for viewer + view-log endpoints (no new permission;
  documents are employee-visible, only the **analytics** is HR-only and already
  wired).
- **Frontend**: state-based view switch in `frontend/src/App.jsx:50` (`view` =
  `chat|admin|profile|...`); hooks read `localStorage['hrms_token']`, base `API='/api'`
  (`frontend/src/hooks/useBehaviorAlerts.js` is the canonical fetch+action pattern);
  sidebar lives in `frontend/src/components/SessionSidebar.jsx`.
- **Router registration**: `backend/main.py:95` already mounts `docs_router` under
  `/api`; extending `docs.py` needs **no** `main.py` change.
- **Alembic** single head is `002_add_behavioral_analytics`; new migration chains
  `down_revision = "002_add_behavioral_analytics"`.

---

## Data model & enums

**1. `backend/enums/access_source.py`** — `class AccessSource(str, Enum)`:
`CHAT = "chat"`, `VIEWER = "viewer"`. Mirror `backend/enums/document_category.py`
(match its value-casing convention). Re-export in `backend/enums/__init__.py`
(import + `__all__`).

**2. `backend/database/models/behavior_analytics.py`** — add **one column** to
`DocumentAccessLog`:
```python
access_source = Column(String(20), nullable=False, server_default="chat")
```
No other model changes. `document_tags` and `behavior_alerts` are unchanged. The
log stays **append-only** (the audit guarantee holds).

**3. Migration `alembic/versions/003_add_access_source.py`** (mirror
`002_add_behavioral_analytics.py`): `down_revision = "002_add_behavioral_analytics"`;
`upgrade()` → `op.add_column("document_access_logs", sa.Column("access_source",
sa.String(20), nullable=False, server_default="chat"))`; `downgrade()` →
`op.drop_column(...)`. The `server_default="chat"` backfills existing rows as chat
accesses. **Author only — do NOT apply**; run `alembic upgrade head` at test time.

---

## Config — tunable thresholds (`backend/core/config.py`)

Add to `Settings` (mirror the existing `BEHAVIOR_*` block at `:120`, all with
defaults):
```python
DOCUMENT_VIEWER_ENABLED: bool = True          # kill-switch for the viewer surface
BEHAVIOR_VIEW_COOLDOWN_MINUTES: int = 30      # per (employee, file) de-spam window
```
Add the same keys (commented) to `.env.example`.

---

## Backend — repository / service / api

**4. `backend/repositories/behavior_repository.py`**
- `log_access(...)` — add `access_source: str = "chat"` param; set it on the
  `DocumentAccessLog(...)`. Existing chat call keeps working via the default.
- New `recent_view_exists(employee_id, filename, since: datetime) -> bool` — returns
  True if a `DocumentAccessLog` with `access_source == "viewer"`,
  `employee_id == ...`, `filename == ...`, `accessed_at >= since` exists. Used for
  the cooldown.

**5. `backend/services/behavior_service.py`**
- In `record_access`, pass `access_source="chat"` into `repo.log_access(...)`
  (explicit; behavior unchanged).
- New public entry point **`record_view(self, employee_id, filename, session_id=None)`**
  (the viewer's hook — sibling of `record_access`):
  - early-return if `not settings.BEHAVIOR_ANALYTICS_ENABLED`.
  - `category = self.repo.get_category_for(filename)`; if `None` → return (untagged
    docs are **viewable but not tracked**).
  - **cooldown:** `since = utcnow() - timedelta(minutes=settings.BEHAVIOR_VIEW_COOLDOWN_MINUTES)`;
    if `repo.recent_view_exists(employee_id, filename, since)` → return (don't log
    a duplicate open).
  - else `repo.log_access(employee_id, filename, category, session_id,
    access_source="viewer")` then `self._evaluate(employee_id, category)` — the
    **same** evaluation/alert/notify path as chat.
  - **wrap the whole body in `try/except` → `logger.warning`** (never break a view).

**6. `backend/api/docs.py`** — add two endpoints (keep `require_authenticated`; add
`get_db` import):
- **`GET /documents/{filename}/raw`** → `Depends(require_authenticated)` →
  - **path-traversal guard:** `safe = os.path.basename(filename)`; reject if
    `safe != filename` or contains `..`/separators; resolve `path = Path(settings.DOCS_DIR)/safe`;
    confirm `path.resolve()` is inside `Path(settings.DOCS_DIR).resolve()` and
    `path.exists()`, else `404`.
  - return `FileResponse(path, media_type=<by extension>, filename=safe)` —
    `application/pdf` for `.pdf`, `text/markdown` for `.md`, `text/plain` for `.txt`,
    `application/vnd.openxmlformats-officedocument.wordprocessingml.document` for
    `.docx` (fallback `application/octet-stream`).
- **`POST /documents/{filename}/view`** → `Depends(require_authenticated)` +
  `db: Session = Depends(get_db)` →
  - `employee_id = int(payload["sub"])`; **non-fatal** call:
    ```python
    try:
        from backend.services.behavior_service import BehaviorService
        BehaviorService(db).record_view(employee_id, filename, session_id=None)
    except Exception as e:
        print(f"view analytics skipped: {e}")
    return {"ok": True}
    ```
  - This is the analytics wiring point — viewing a tagged doc enough times within
    the window raises the existing HR alert.

No `main.py` change (docs_router already mounted at `:95`). No new permission —
documents are employee-visible; the `/behavior/*` analytics endpoints stay HR/Admin.

---

## Frontend (employee-facing viewer; HR Signals UI already exists)

**7. `frontend/src/hooks/useDocuments.js`** (mirror `hooks/useBehaviorAlerts.js`:
`API='/api'`, `getToken()` from `localStorage['hrms_token']`):
- `loadDocuments()` → `GET /api/documents` → `{documents:[{filename}]}`.
- `openRaw(filename)` → `fetch('/api/documents/<enc>/raw', {Authorization: Bearer})`
  → `res.blob()` → `URL.createObjectURL(blob)` (the **Authorization header** is why
  we fetch-to-blob instead of putting the URL straight in an `<iframe src>`).
- `logView(filename)` → `POST /api/documents/<enc>/view` (fire-and-forget).

**8. `frontend/src/components/DocumentViewer.jsx`** — modal overlay (reuse the
HRPanel modal style: `var(--bg-secondary)`, `var(--border)`, rounded, `boxShadow`):
- on open: `openRaw(filename)` → render by extension — `.pdf` in an
  `<iframe>/<object data=blobUrl type="application/pdf">`; `.md`/`.txt` fetched as
  text into a styled `<pre>` (or simple markdown render); `.docx` → "download to
  view" link (browsers can't render docx inline) using the blob URL.
- on open: call `logView(filename)` **once** (this is the trigger that feeds
  analytics). Revoke the object URL on close.

**9. `frontend/src/components/DocumentLibrary.jsx`** — employee document list:
- on mount `loadDocuments()`; render each as a card (file-type icon by extension,
  filename) reusing the source-card / inline-`var(--accent)` styling already in
  `App.jsx`. Click → open `DocumentViewer`.

**10. `frontend/src/App.jsx` + `SessionSidebar.jsx`** — surface the library:
- add `'documents'` as a `view` value (`App.jsx:50`); render
  `{view === 'documents' && <DocumentLibrary />}` alongside the chat/admin blocks,
  with a back-to-chat control.
- add a **"📄 Documents"** nav button in `SessionSidebar.jsx` (near the existing
  "Knowledge base · {docCount} docs" status line) that calls `setView('documents')`.
  The employee side shows **no** analytics — viewing looks like an ordinary library.

---

## Privacy & guardrails (carry over from the architecture doc)

- `/documents/{filename}/raw` serves **only** files inside `settings.DOCS_DIR`
  (basename + resolved-path containment check) — no path traversal.
- Store **only metadata** (filename, category, employee, timestamp, `access_source`,
  optional session) — never document content.
- **Untagged docs are viewable but never tracked** (`get_category_for` → None).
- **No alert on a single open** — only when the windowed count (chat + viewer)
  crosses the category threshold; **cooldown** stops rapid re-open inflation.
- `document_access_logs` stays **append-only**; `access_source` makes chat vs viewer
  auditable without changing counts.
- Viewer/view-log endpoints require auth; all `/behavior/*` endpoints remain
  HR/Admin-only. Thresholds, cooldown, and enable flags are env-configurable.

---

## Build order (each step compiles before the next)
1. `enums/access_source.py` + re-export → `DocumentAccessLog.access_source` column.
2. Config (`DOCUMENT_VIEWER_ENABLED`, `BEHAVIOR_VIEW_COOLDOWN_MINUTES`) + `.env.example`.
3. Migration `003_add_access_source.py` (author only).
4. Repository: `log_access(access_source=...)` + `recent_view_exists`.
5. Service: `record_view` + thread `access_source="chat"` through `record_access`.
6. `docs.py`: `/raw` (path-guarded) + `/view` (non-fatal analytics hook).
7. Frontend: `useDocuments` → `DocumentViewer` → `DocumentLibrary` → `App.jsx`
   view + `SessionSidebar` nav.

---

## Verification

**Static (no DB needed):** `python -m compileall backend agent scripts`; ruff on
changed files; confirm Alembic still has a **single head** (`002 → 003` linear);
`python -c "import backend.api.docs; import backend.services.behavior_service"` with
a dummy `DATABASE_URL`.

**Unit (existing SQLite harness, `tests/conftest.py`):** add
`tests/test_document_viewer_analytics.py` — seed a `document_tags` row (SENSITIVE,
threshold 2); call `BehaviorService.record_view` twice (spaced beyond cooldown, or
cooldown=0) → assert one `BehaviorAlert(OPEN)` with `access_source="viewer"` rows;
a second `record_view` **inside** the cooldown logs **no** new row; a chat
`record_access` + a viewer `record_view` for the same category **combine** to cross
the threshold.

**Manual E2E (run the app):**
1. `alembic upgrade head` → `python scripts/seed_db.py` →
   `python scripts/seed_document_tags.py`; set `BEHAVIOR_THRESHOLD_SENSITIVE=2`,
   `BEHAVIOR_VIEW_COOLDOWN_MINUTES=0`.
2. As an **employee**, open **Documents**, open a `SENSITIVE`-tagged doc → it renders
   inline; confirm a `document_access_logs` row with `access_source="viewer"`.
3. Open it again (≥ threshold) → confirm a `behavior_alerts` row; as **HR** see the
   bell + email and the alert in **HR → Signals**; **Resolve** it.
4. Re-trigger → the open alert **updates** (not duplicates). Re-open within a
   non-zero cooldown → **no** new log row.
5. Confirm `GET /api/documents/..%2f..%2fsecret/raw` (traversal) → **404/400**, an
   **untagged** doc is viewable but logs **nothing**, and the employee UI shows **no**
   trace of analytics.
```
