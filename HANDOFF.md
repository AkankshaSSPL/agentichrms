# HANDOFF — Agentic HRMS refactor (read this first)

_Last updated: 2026-06-08 (session end). Active branch: `notification_rbac`._

This document is the single place to resume work from any machine. It records
**where the code stands**, the **decisions made**, the **next task in flight**,
and **how to set up a fresh PC**. The deep design docs live in `codereview/`
(RULES, ARCHITECTURE, STRUCTURAL_REVIEW, EXECUTION) — treat them as a
**pattern reference, NOT a folder-structure mandate** (see Decision 1).

---

## ⏯ RESUME HERE — where we stopped (2026-06-08)

**The notifications + RBAC work is implemented and cleaned. It has NOT been run /
tested yet. End-to-end testing is the next action.**

- **`develop`** = integrated trunk (Suraj's refactor + our Phase-0 guardrails +
  the approved `NOTIFICATIONS_RBAC_PLAN.md` and refreshed handoff).
- **`notification_rbac`** = `develop` + Suraj's implementation of the plan
  (commit `5bc96b8` "implemented the notifications, just need to test once") +
  **our cleanup commit `0ba0cb5`**. This is the branch to test on. Merge into
  `develop` only once E2E passes.

**What `0ba0cb5` (our cleanup) did** (full detail in `CLEANUP_LOG.md`): re-removed
`run_migrations()` from `main.py` (no startup migrations); deleted committed junk
(`backend/api/_backup_before_migration/`, `test.db`, `tests/test.db`,
`registration_error.txt`); deleted the dead unwired `backend/api/onboarding_profile.py`;
**linearized the migration chain** (re-pointed `001_rename_pin_code` onto
`9f3e1a2b4c5d`, deleted redundant `dc375aac3cda` + the `64697194c11e` merge →
single linear head `001_rename_pin_code`).

**Verified statically only** (no DB/runtime in the work session): `backend`+`agent`
compile; migration chain is one linear head (parsed). **NOT yet verified:** app
actually boots (e.g. is `slowapi` installed?), `alembic upgrade head` runs on
Postgres, notification flows + `tests/test_critical_paths.py` pass.

**To resume → run E2E (the only blockers left are setup):**
1. `pip install -r requirements.txt`  (slowapi was added this branch)
2. `.env` must have `DATABASE_URL` + `JWT_SECRET` (app refuses to boot without them).
3. **Fresh DB**, then `alembic upgrade head` (migrations no longer auto-run).
   ⚠️ If a DB was already stamped at the deleted `dc375aac3cda`, use a fresh DB
   or `alembic stamp`. `python scripts/seed_db.py` to seed.
4. `python -m uvicorn backend.main:app --reload --port 8000` + `cd frontend && npm run dev`.
5. Walk the 3 flows: (a) employee applies leave via chatbot → HR bell + employee
   confirmation; (b) employee requests profile change → HR bell; (c) HR
   approves/rejects leave → employee bell. Also run `pytest`.

**Pre-merge checklist before `notification_rbac` → `develop`:** E2E passes ·
`alembic upgrade head` clean on fresh DB · decide if the big frontend rewrite
(App.jsx → hooks/components) rides along or is reviewed separately.

**Repo/push:** `github.com/AkankshaSSPL/agentichrms`, push via the `GuneshSSPL`
gh account, commits authored as `Gunesh Kulkarni <gkulkarni@sveltoz.com>`.

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
| Phase 3 (notifications) | ✅ **Implemented on `notification_rbac`, pending E2E.** Unified `backend/notifications/notifier.py` (`to_employee`/`to_hr` fan-out/`from_template`); producers wired (leave-apply now notifies HR + employee; `save_profile` fans out to HR). Needs end-to-end verification — see ⏯ RESUME HERE. |
| Phase 4 (RBAC) | ✅ **Hardened on `notification_rbac`, pending E2E.** `permissions.py` + `security.py` now **fail closed** (503) instead of trusting the JWT on DB error; null-safe role access; `onboarding.py`/`docs.py` guarded; `make_role_id_not_null` migration added. Deferred: collapse 3 guard patterns; drop dead `permissions`/`role_permissions` tables. |
| Phase 5 (agent runner) | not started. `agent/agent.py` + `agent/tools_registry.py` monolith; executor likely rebuilt per request. |
| Phase 6/7 (frontend) | not started (all `.jsx`). |
| Phase 8 (hardening) | not started. |

---

## 4. NEXT TASK IN FLIGHT — End-to-end test of notifications + RBAC

The notifications + RBAC plan (`NOTIFICATIONS_RBAC_PLAN.md`) is **implemented**
(Suraj, commit `5bc96b8`) and **cleaned** (our commit `0ba0cb5`) on the
`notification_rbac` branch. The remaining work is to **run it end-to-end and
verify**, then merge to `develop`. Exact steps + pre-merge checklist are in the
**⏯ RESUME HERE** block at the top of this file.

What's already done on `notification_rbac` vs the plan: unified `Notifier` ✅,
leave-apply + `save_profile` HR notifications ✅, RBAC fail-closed ✅, guarded
endpoints ✅, `make_role_id_not_null` migration ✅. Deferred (diagnosed, in
`CLEANUP_LOG.md`): collapse the 3 guard patterns into `require_permission`; drop
the dead `permissions`/`role_permissions` tables; consolidate token extraction.

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
