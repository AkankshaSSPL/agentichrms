# HANDOFF — Agentic HRMS refactor (read this first)

_Last updated: 2026-06-05. Branch: `develop`._

This document is the single place to resume work from any machine. It records
**where the code stands**, the **decisions made**, the **next task in flight**,
and **how to set up a fresh PC**. The deep design docs live in `codereview/`
(RULES, ARCHITECTURE, STRUCTURAL_REVIEW, EXECUTION) — treat them as a
**pattern reference, NOT a folder-structure mandate** (see Decision 1).

---

## 1. Branch model (git flow)

- **`develop`** = the clean integration base. Branch off it for every change,
  merge back. **This is the branch to work on.** Now pushed to `origin`.
- **`main`** = production (untouched). Open PRs into `main` from `develop` when shipping.
- **`rolebased_demochatbot`** = the original "latest features" branch (archive).
- **`clean`** = an older, tidy snapshot (archive). **`clean` and `rolebased`
  share NO git history** (clean came from a downloaded zip) — never `git merge` them.
- `master` = stale local-only experiment; ignore.

`develop` = `rolebased_demochatbot` (all latest features) **+** re-applied Phase-0
cleanup (dead code removed, single settings source, `.env.example`/`ruff.toml`/CI added).

---

## 2. Decisions already made (don't relitigate)

1. **Stay with the current FLAT / horizontal layout** (`backend/api/` routers,
   `backend/services/`, `backend/repositories/`, `backend/enums/`,
   `backend/notifications/`). **Do NOT** restructure into the docs' vertical
   `backend/modules/<feature>/` — at this scale it's repo-wide churn for ~zero
   gain. Adopt the docs' *patterns* (service layer shared by REST + chatbot,
   enums, structured intents, no committed secrets) **in place**, incrementally,
   feature-by-feature, only when you touch a feature.
2. **Leave the frontend as `.jsx`.** It builds and works. No TS/Tailwind/shadcn
   rewrite until a concrete new screen needs it.
3. The real maintenance cost is **duplication between REST routers and chatbot
   tools** (e.g. leave logic in `backend/api/leaves_admin.py` AND
   `agent/tools_registry.py`). Killing that duplication via a shared service is
   the high-value work — not folder shape.

---

## 3. Where each phase stands (audited from code, not docs)

| Area | State |
|---|---|
| Phase 0 (safety) | ~90% on develop. ✅ PIN hashed at rest, JWT_SECRET required, dead code gone, single settings source, ruff/CI/.env.example added. ❌ remaining: auto-migration still in `backend/main.py:38-52` (`run_migrations()` in lifespan — remove, R16); scripts still at repo root (move to `scripts/`); README still stale; **`alembic/env.py` MISSING**. |
| Phase 1 (foundation) | ~25%. ✅ Enums created **and wired in** (`backend/enums/*`, used by models + 6 api files). ❌ `backend/database/models.py` still a ~600-line monolith; no base repo/service/exceptions; no request-id middleware; no tests. |
| Phase 2 (leave) | **In flight — see §4.** Clean `LeaveService`/`LeaveRepository` exist in `backend/repositories/` but are unwired + had a broken import. Only covers HR-admin side (approve/reject/view), not employee apply/confirm. |
| Phase 3 (notifications) | ~30%. `backend/notifications/{notification_service,notification_templates}.py` built, consumed only by the (unwired) leave service. Live routers still inline notifications. |
| Phase 4 | minimal. `admin.py` + `email_settings.py` still use old `require_role` (vs `require_permission`). |
| Phase 5 (agent runner) | not started. `agent/agent.py` + `agent/tools_registry.py` monolith; executor likely rebuilt per request. |
| Phase 6/7 (frontend) | not started (all `.jsx`). |
| Phase 8 (hardening) | not started. |

---

## 4. NEXT TASK IN FLIGHT — Leave consolidation (the cheap, high-value win)

**Goal:** make HR-admin leave logic (approve / reject / view) live in **one
place** — `backend/repositories/leave_service.py` (`LeaveService`) — called by
**both** the REST router and the chatbot tools. The service is already written
and is *better* than the live code (single `update_leave_status`, validates the
PENDING→done transition, template-driven notifications).

Do this on a branch: `git checkout develop && git checkout -b feat/leave-consolidation`

**Steps (each verified by `python -m compileall backend agent`):**

1. **Fix the broken import** — `backend/repositories/leave_router.py:15` says
   `from backend.services.leave_service import LeaveService` but the service is
   at `backend.repositories.leave_service`. Repoint it.
2. **Restore RBAC parity** — `leave_router.py` uses the OLD
   `require_role([RoleName.HR, RoleName.ADMIN])`. The live `leaves_admin.py`
   already uses `require_permission("leave.view"/"leave.approve"/"leave.reject")`.
   Change `leave_router.py` to use `require_permission(...)` so wiring it in does
   not regress RBAC.
3. **Mount it, retire the old one** — in `backend/main.py`, replace the
   `leaves_admin` import + `include_router(leaves_admin_router, ...)` with the
   leave router from `repositories/leave_router.py`. Then **delete
   `backend/api/leaves_admin.py`** (the new router is a 100% drop-in: same
   `/leaves/*` routes, same response shapes). Confirm the frontend
   (`frontend/src/components/LeaveRequests.jsx`) still gets the same JSON.
4. **Point the chatbot at the service** — in `agent/tools_registry.py`, the
   `approve_leave` (line ~409) and `reject_leave` (line ~452) tools each open
   their own `SessionLocal()`, set `leave.status = "Approved"/"Rejected"` (raw
   strings!), and send their own emails. Replace their bodies with a call to
   `LeaveService(db).approve_leave(leave_id, approved_by=...)` /
   `.reject_leave(leave_id, reason, rejected_by=...)`. This removes the
   duplication AND fixes the raw-string status (service uses the `LeaveStatus`
   enum).
5. **Verify + commit + merge to develop.** Compile-check, then
   `git checkout develop && git merge --no-ff feat/leave-consolidation`.

**Deferred (NOT in this task — bigger):** employee leave **apply/confirm** path.
`LeaveService` has no `request_leave()` yet; `agent/tools_registry.py`
`apply_leave` (line ~174) / `confirm_leave` (line ~303) still own creation +
conflict-detection. Extend the service with a `request_leave(...)` before
consolidating those.

---

## 5. Fresh-PC setup (do this first on the new machine)

> ⚠️ The SSH key used on the previous PC is **machine-local and folder-scoped**
> (`~/.ssh/id_ed25519_sspl` via repo-local `core.sshCommand`). It is NOT on the
> new PC. Either clone over **HTTPS**, or generate a new key and add it to your
> GitHub account.

```bash
# 1. Clone (HTTPS shown; you are a contributor on AkankshaSSPL/agentichrms)
git clone https://github.com/AkankshaSSPL/agentichrms.git
cd agentichrms
git checkout develop

# 2. Python venv (project targets Python 3.11)
python -m venv venv
# Windows:  venv\Scripts\activate     |  *nix: source venv/bin/activate
pip install -r requirements.txt        # HEAVY: torch, dlib, opencv, chromadb — multi-GB, 20-40 min

# 3. Frontend deps
cd frontend && npm install && cd ..

# 4. PostgreSQL — create the role + db the app expects
#    (in psql/pgAdmin as a superuser):
#      CREATE ROLE hrms_user WITH LOGIN PASSWORD 'agentichrms';
#      CREATE DATABASE agentic_hrms OWNER hrms_user;
#      GRANT ALL PRIVILEGES ON DATABASE agentic_hrms TO hrms_user;

# 5. .env  (it is gitignored — never committed)
cp .env.example .env
#   Fill: DATABASE_URL=postgresql://hrms_user:agentichrms@localhost/agentic_hrms
#         JWT_SECRET=<python -c "import secrets; print(secrets.token_urlsafe(48))">
#         AI_KEY=<your OpenAI key — needed for the chatbot to work>
```

### Verify (no DB needed)
```bash
python -m compileall backend agent rag          # syntax check — must exit 0
cd frontend && npm run build && cd ..            # frontend build — must succeed
```

---

## 6. KNOWN BLOCKERS before the backend can actually boot/migrate

1. **`alembic/env.py` is missing** from the repo — `alembic upgrade head` cannot
   run. Options: (a) restore a standard Alembic `env.py` wired to
   `backend.database.session` + the models' `Base.metadata`; or (b) for local dev
   only, create the schema directly with `Base.metadata.create_all(engine)`
   (the models already define `pin_hash`, enums, etc., so a fresh schema is correct).
2. **Auto-migration at startup** (`backend/main.py:run_migrations()` in lifespan)
   should be removed once (1) is sorted — migrations are a deploy step (R16).
3. The **heavy deps must be installed** in the venv before importing
   `backend.main` (it pulls langchain → sentence-transformers → torch, plus
   face_recognition → dlib, opencv).
4. **`AI_KEY` is blank** in dev `.env` — chatbot/agent calls will fail until set.

### Run (after blockers handled)
```bash
# backend
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
# frontend (separate shell)
cd frontend && npm run dev
# seed data (after schema exists):  python scripts/seed_db.py  (currently seed_db.py is at repo root)
```

---

## 7. Deferred Phase-0 cleanup (small, do when convenient)
- Move `seed_db.py`, `seed_meetings.py`, `set_admin_pin.py`, `retrain.py` → `scripts/`.
- Rewrite stale `README.md` (says SQLite/Streamlit; it's Postgres/FastAPI).
- Add `alembic/versions/rename_pin_code_to_pin_hash.py` only if migrating an
  EXISTING db that still has a `pin_code` column (fresh dbs already get `pin_hash`).

---

## 8. Quick reference
- Single settings reader: `backend/core/config.py` (`from backend.core.config import settings`). Root `config.py` shim was deleted.
- Live leave path (to be retired): `backend/api/leaves_admin.py`.
- New leave path (to wire in): `backend/repositories/leave_{service,repository,router}.py`.
- Chatbot tools (monolith): `agent/tools_registry.py`.
- Design docs: `codereview/` (reference only — see Decision 1).
