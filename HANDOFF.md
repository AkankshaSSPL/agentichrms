# HANDOFF — Agentic HRMS refactor (read this first)

_Last updated: 2026-06-08. Branch: `develop`._

This document is the single place to resume work from any machine. It records
**where the code stands**, the **decisions made**, the **next task in flight**,
and **how to set up a fresh PC**. The deep design docs live in `codereview/`
(RULES, ARCHITECTURE, STRUCTURAL_REVIEW, EXECUTION) — treat them as a
**pattern reference, NOT a folder-structure mandate** (see Decision 1).

---

## 1. Branch model (git flow)

- **`develop`** = the clean integration base and **the branch to work on**. Branch
  off it for every change, merge back. Pushed to `origin`.
- **`main`** = production (untouched). Open PRs into `main` from `develop` when shipping.
- **`rolebased_demochatbot`** = Suraj's refactor branch. It was **adopted as the
  base** for `develop` (see below); it is now 3 commits behind `develop`.
- **`clean`** = an older, tidy snapshot (archive). Shares NO git history with
  `rolebased` — never `git merge` them.
- `master` = stale local-only experiment; ignore.

**As of 2026-06-08, `develop` = `rolebased_demochatbot` (Suraj's full backend
refactor: models split into a package, service/repository layers, router
restructuring) + our re-applied Phase-0 guardrails.** The integration is on
`develop` (`-s ours` merge that keeps the old Phase-0 history as an ancestor).
`develop` and `rolebased_demochatbot` have diverged again — if Suraj pushes more,
reconcile deliberately.

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
| Phase 0 (safety) | ✅ **Done on develop.** PIN hashed at rest, JWT_SECRET required, dead code gone, single settings source, ruff/CI/.env.example added. Auto-migration **removed** from `backend/main.py`. **`alembic/env.py` AUTHORED** (was missing). Remaining (small): seed scripts still at repo root; drop plaintext `permanent_pin` column. |
| Phase 1 (foundation) | ✅ **Largely done by Suraj.** `backend/database/models/` is now a per-domain package (auth/employee/leave/chat/rbac/workflow/notification). Enums wired in. ❌ still no base repo/service/exception scaffolding, no request-id middleware, no tests. |
| Phase 2 (leave) | ✅ **Done.** `LeaveService`/`LeaveRepository` live in `backend/services/` + `backend/repositories/`, wired via `backend/api/leave_router.py`; old `leaves_admin.py` deleted. HR approve/reject/view consolidated. Employee apply/confirm still lives in `agent/tools_registry.py` (creation path). |
| Phase 3 (notifications) | ⚠️ **NEXT TASK — see §4.** Half-built: `backend/notifications/` templates exist but only cover leave approve/reject; producers are inconsistent and several events emit no in-app notification. Plan approved in `NOTIFICATIONS_RBAC_PLAN.md`. |
| Phase 4 (RBAC) | ⚠️ **Fragile — folded into the §4 task.** Silent JWT fallback on DB error, NULL-role crashes, unguarded endpoints. `email_settings.py` still uses `require_role` vs `require_permission`. |
| Phase 5 (agent runner) | not started. `agent/agent.py` + `agent/tools_registry.py` monolith; executor likely rebuilt per request. |
| Phase 6/7 (frontend) | not started (all `.jsx`). |
| Phase 8 (hardening) | not started. |

---

## 4. NEXT TASK IN FLIGHT — Notifications + RBAC hardening

**Full approved plan: `NOTIFICATIONS_RBAC_PLAN.md` (read it before starting).**

Two problems, one pass. Do it on a branch:
`git checkout develop && git checkout -b feat/notifications-rbac`

**Part 1 — make notifications work cleanly (one unified `Notifier`):**
- Build `backend/notifications/notifier.py` — `to_employee` / `to_hr` (HR+Admin
  fan-out) / `from_template`. Route **every** producer through it.
- Fix the real gaps: leave-apply (`agent/tools_registry.py:270`,`:344`) currently
  emails HR but writes **no in-app notification** → add HR + employee notifications;
  `save_profile` (`backend/services/onboarding_service.py:260`) notifies the
  employee only → add the HR fan-out the `self_chat` path already does.
- Generalize `backend/notifications/notification_templates.py` +
  `notification_service.py` (decouple from the `Leave` type), then retire the two
  ad-hoc `save_notification` variants (`approval_repository.py`, `leave_repository.py`).
- Frontend needs **no change** (`NotificationBell.jsx` already polls correctly).

**Part 2 — fix the critical RBAC fragilities:**
- Remove the silent JWT-fallback-on-DB-error in `backend/core/permissions.py:147`
  and `backend/core/security.py:98` → **fail closed** (503).
- Null-safe every `employee.role.name` access (no 500s on NULL role).
- Guard the wide-open endpoints: `backend/api/onboarding.py` (self-or-HR) and
  `backend/api/docs.py` (require auth).
- Author (do NOT apply) an Alembic migration making `role_id` NOT NULL.

**Deferred (diagnosed, logged in `CLEANUP_LOG.md`):** collapse the 3 guard
patterns into `require_permission`; remove the dead `permissions`/`role_permissions`
tables; consolidate the 3 token-extraction copies.

**Verify:** `python -m compileall backend agent` + ruff on changed files +
grep-gate that no `save_notification(` call sites remain. End-to-end checklist in
the plan doc.

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

1. ✅ **`alembic/env.py` now exists** (authored during integration, wired to
   `settings.DATABASE_URL` + the models-package `Base.metadata`). `alembic upgrade
   head` can run once a DB is reachable. NOTE: migrations have **not** been applied
   here (no DB access) — run `alembic upgrade head` as an explicit deploy step.
2. ✅ **Auto-migration at startup removed** from `backend/main.py` (R16). Migrations
   are a deploy step, not a boot step.
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

## 7. Deferred cleanup (small, do when convenient — also in `CLEANUP_LOG.md`)
- Move `seed_db.py`, `seed_meetings.py`, `set_admin_pin.py`, `retrain.py` → `scripts/`
  (currently print-exempted by name in `ruff.toml`).
- Drop the plaintext `Employee.permanent_pin` column (write-nowhere; PINs live in
  `permanent_pin_hash`).
- Rotate the old secrets (`JWT_SECRET`, DB password, email creds) on the server.

---

## 8. Quick reference
- Single settings reader: `backend/core/config.py` (`from backend.core.config import settings`). Root `config.py` shim was deleted.
- Leave path (live): service `backend/services/leave_service.py`, repo
  `backend/repositories/leave_repository.py`, router `backend/api/leave_router.py`.
  (`leaves_admin.py` was deleted.)
- Models: per-domain package `backend/database/models/` (no monolith).
- Notifications: `backend/notifications/` (+ the new `notifier.py` per §4 plan).
- Chatbot tools (monolith): `agent/tools_registry.py`.
- Cleanup trail: `CLEANUP_LOG.md`. Approved next-task plan: `NOTIFICATIONS_RBAC_PLAN.md`.
- Design docs: `codereview/` (reference only — see Decision 1).
