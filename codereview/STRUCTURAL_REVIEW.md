# Agentic HRMS — Structural Review, Non-Negotiables, and Migration Plan

> Status: REVIEW DOCUMENT. This plan is a deliverable for the project maintainer. It is **not** authorization to begin editing the project under review. Every claim here is backed by file:line citations from a code audit; nothing is assumption.

---

## Context

**Project under review:** `/home/gunesh/Development/sspl_REVIEW/akanksha/agentichrms-rolebased_demochatbot` — an HRMS chatbot (FastAPI + Postgres + SQLAlchemy + Alembic backend; React 19 + Vite frontend, no TypeScript, no Tailwind; LangChain `AgentExecutor` orchestrating ChromaDB RAG + leave/employee/onboarding tools; JWT + face-recognition + PIN auth).

**Why this document exists:** The project works as a small demo. It will not survive the planned expansion ("everything a proper HRMS does, but in chat format") without a structural reset. The code has the *skeleton* of a layered architecture (`api/`, `services/`, `schemas/`, `database/`) but the discipline is not enforced — routers contain business logic, agent tools bypass services and hit the DB directly, two agent implementations diverge silently, secrets are committed, and the frontend is a flat ad-hoc tree with 87 inline `fetch` calls.

**Intended outcome:** A maintainer following this plan ends up with (a) a vertical-feature-module backend where every business operation has exactly one implementation (called by both REST and the chatbot), (b) a typed, feature-folder frontend on Tailwind + shadcn/ui, and (c) a strict rule set + CI gates that prevent regression. The plan also names the open product/security decisions that block execution.

---

## Section A — Deep Analysis (code-backed)

Citations are file:line. Every "wrong" claim was verified by reading the file.

### A1. Backend

#### A1.1 What is RIGHT (keep these patterns)

- **Pydantic Settings with field validators.** `backend/core/config.py:47-61` parses `ALLOWED_ORIGINS` from either JSON or comma-separated env values cleanly. Good pattern; the rest of the codebase should follow.
- **Schemas folder exists and is partly used.** `backend/schemas/auth.py:1-23`, `backend/schemas/chat.py:1-15` show the team understands DTOs. The pattern just isn't enforced everywhere.
- **Alembic is wired and runs at startup.** `backend/main.py:34-42` calls `command.upgrade(alembic_cfg, "head")` inside `run_migrations()`. Wrong place to run it (see A1.2) but the infrastructure exists.
- **Face/PIN/JWT are properly separated into services.** `backend/services/face_service.py`, `backend/services/twilio_service.py`, and `backend/core/security.py:16-50` (`get_password_hash`, `verify_password`, `create_access_token`, `verify_token`) are the cleanest modules in the repo. These are the template the rest of the project should follow.
- **RBAC schema exists.** `backend/database/models.py:25-47` defines `Role`, `Permission`, `RolePermission` tables. The data model is correct; it's just not queried (see A1.2).
- **CORS, prefixes, and lifespan are correctly wired.** `backend/main.py:54-93` mounts every router under `/api` via a single constant and uses an `asynccontextmanager` lifespan.
- **`add_rbac_roles.py` migration is well-written.** `alembic/versions/add_rbac_roles.py` has idempotent checks (`IF NOT EXISTS`) and `ON CONFLICT` upserts for seed rows. Use this migration as the template for future ones.

#### A1.2 What is WRONG

- **Secrets committed to the repo.** `config.py:23` ships a literal `SECRET_KEY = 'WvRVUUNfrXG1mBesBboQKylrFJnoRdcu9RI7aldfmdW'`. `backend/core/config.py:20` defaults `JWT_SECRET = "change-this-in-production"`. `backend/core/config.py:17` defaults `DATABASE_URL` to credentials in code. `config.py:22` hardcodes `HR_EMAIL` to a personal address. If any of these are the live signing key, every session is forgeable.
- **`PINVerification.pin_code` stored plaintext.** `backend/database/models.py:225` — `pin_code = Column(String(6), nullable=False)`. Compare to `Employee.permanent_pin_hash` (`models.py:70`) which is correctly hashed. The transient PIN should be hashed too, or never persisted.
- **PIN leaked in registration response.** `backend/api/registration.py:168` returns `default_pin` in the API response body.
- **`chat.py` is doing 5+ unrelated jobs.** `backend/api/chat.py:52-199` — within one endpoint: token verification, chat-history DB query, agent invocation, conflict detection via `intermediate_steps` parsing (lines 83-111), `NAME_CHANGE_INTENT` regex parsing of LLM prose (lines 114-187), inline `NameChangeRequest` row creation (lines 123-133), HR/admin notification fan-out via inline `join Role` query (lines 138-149), employee notification creation (lines 156-163), regex strip of the sentinel from the answer (line 169), fallback answer (lines 190-192). Five distinct `try/except Exception` blocks with three `print()` statements inside (lines 151, 165, 186).
- **Routers do business logic everywhere.** `backend/api/leaves_admin.py:101-127` builds notification rows and email bodies inline. `backend/api/admin.py:74-80` sends role-change emails from the endpoint with bare `except`. `backend/api/registration.py:117-156` does face enrollment → classifier retraining → SMS dispatch in one request handler.
- **`backend/services/` only holds three services** (`email_service.py`, `face_service.py`, `twilio_service.py`). No `NotificationService`, `LeaveService`, `OnboardingService`, `NameChangeService`. The work exists; it just lives inside routers and agent tools.
- **`models.py` is a 278-line monolith.** `backend/database/models.py` mixes 14 tables and 5 concerns on `Employee` alone (auth credentials, profile, face biometrics, banking, emergency contact). `Employee.role_id` is nullable (`models.py:111`).
- **`User` and `Employee` tables overlap.** `models.py:149-163` — `User` has `role` (string), `face_registered`, `face_login_enabled`; `Employee` has `role_id` (FK), `face_enrolled`, `face_registered`. Two sources of truth.
- **All statuses are hardcoded strings.** `"Pending"`, `"Approved"`, `"Rejected"` in `tools_registry.py:260, 419, 462`; `"pending"` again in `chat.py:129` and `models.py:258`. No enum, no constraint, easy to typo (`leaves_admin.py:108` has a leading-space `" Leave Approved"` notification title).
- **Permission/RolePermission tables are never queried.** `backend/core/security.py:52-90` (`require_role`) reads the role string from the JWT claim and string-matches against an allowlist. The `RolePermission` join is never performed at auth-check time. The RBAC schema is cargo-cult.
- **Migration history is drift evidence.** `alembic/versions/` has 8 files including three named "sync_models" (`0a1c40ff2581`, `349faee636ca`, `74130856f829`, `10afa46b8d8a` — that's four overlapping migrations). `revises` chain is not auditable.
- **Auto-migration on app startup.** `backend/main.py:34-42` catches all migration exceptions and logs a warning, so a broken migration silently degrades the app instead of refusing to boot.
- **`config.py` at repo root is a shim.** It re-exports `backend/core/config.py` because `agent/`, `rag/`, and `tools/` import from the root. Two sources of truth for the same settings.
- **23× bare `except Exception`** across `backend/api/chat.py:93,150,164,185,197`, `backend/api/registration.py:72,128,136`, `backend/api/admin.py:80`, `backend/core/email.py:46,66`, `backend/main.py:41,118`, and others.
- **11× `print()` in app code** (not scripts) — same files, plus `backend/core/email.py:30,49,67`.
- **Inline imports to dodge circulars.** `backend/api/chat.py:136` imports `Role` mid-function.
- **Config leaks.** `backend/services/email_service.py:13,20-23` reads `os.getenv(...)` directly instead of going through `settings`.
- **DTO discipline broken.** `backend/api/admin.py:27-36`, `backend/api/leaves_admin.py:77-84`, `backend/api/chat.py:37-50` define their own request/response models inline instead of using `backend/schemas/`. `backend/schemas/user.py` is empty.
- **No `response_model` on most endpoints.** Without it, OpenAPI degrades to `any`, breaking any future FE type generation.

### A2. Frontend

#### A2.1 What is RIGHT

- **Vite dev-server proxy is correctly configured.** `frontend/vite.config.js:8-13` forwards `/api` → `127.0.0.1:8000`. Good.
- **CSS variable system in `index.css`.** The 878-line stylesheet at `frontend/src/index.css:5-57` declares ~25 design tokens and switches them under `body.theme-dark`. This is the one piece worth preserving — it maps cleanly onto Tailwind's CSS-variable theme.
- **DOMPurify is in use.** `frontend/src/App.jsx:843` sanitises rendered HTML in the preview panel. Don't lose this when refactoring.
- **`Login.css` / `Register.css`** are at least the *idea* of per-component styles, even if 10 other components ignored the pattern.

#### A2.2 What is WRONG

- **`App.jsx` is 865 lines doing everything.** `frontend/src/App.jsx` handles routing (via conditional render, no router), auth state, sessions CRUD, chat, conflict popup, name-change popup, voice recognition, theme toggle, preview panel rendering. The conditional-routing block at `App.jsx:719-806` is the worst single block.
- **No router library.** Routing is `view === 'admin' ? ... : view === 'chat' ? ... : ...` (`App.jsx:719`). Adding a new screen requires editing this ternary.
- **No centralized API client.** 87 inline `fetch()` calls across the codebase, each manually building `headers: { Authorization: Bearer ${localStorage.getItem('hrms_token')} }`. Examples: `App.jsx:155`, `LeaveRequests.jsx:17-19`, `Register.jsx:16`, `OnboardingChat.jsx:9`, `ProfileView.jsx:8`.
- **API base URL declared four different ways.** `App.jsx:13` `'/api'`; `Register.jsx:16` `import.meta.env.VITE_API_URL || 'http://localhost:8000'`; `OnboardingChat.jsx:9` hardcoded `'http://localhost:8000/api'`; `ProfileView.jsx:8` env-with-fallback. Inconsistent.
- **No state management.** Just `useState` everywhere. JWT and employee live in `localStorage` and are re-read on every mount (`App.jsx:51-54`). Cross-tab consistency is broken; logout in one tab does not propagate.
- **No TypeScript, no PropTypes, no Zod.** Zero type safety. 7 components receive an `employee` prop with no shape validation. API responses (`data.conflict`, `data.name_change_request`, `data.answer`) are assumed without checks.
- **No UI primitives exist.** No `Button`, `Modal`, `Card`, `Input`, `Form` components. Buttons are inline `<button style={{...}}>` with hardcoded colours (`App.jsx:541` and 30+ places). Modals are vanilla `<div style={{ position: 'fixed', inset: 0, zIndex: 99999 }}>` (`App.jsx:513-547`, 8+ instances).
- **300+ inline `style={{}}` objects.** Hardcoded colour values like `rgba(248,113,113,0.3)` in `App.jsx:514-546` bypass the CSS-variable system entirely.
- **Flat `components/` directory.** 12 component files at `frontend/src/components/*.jsx` — `AdminPanel`, `HRPanel`, `Dashboard`, `LeaveRequests`, `OnboardingChat`, `Login`, `Register`, `NotificationBell`, etc., all peers. No domain grouping.
- **Hand-rolled forms only.** No `react-hook-form`, no `formik`, no `zod`. Validation is `if (!form.name || !form.email) setError("...")` (`Register.jsx:101-103`).
- **Intent handling is inline conditionals.** `App.jsx:365-376` does `if (data.conflict === true) { setConflictPopup(...) }` and `if (data.name_change_request) { setNameChangePopup(...) }`. Adding a third intent requires editing the chat handler again.
- **Accessibility is absent.** No `aria-*` anywhere. Modals lack `role="dialog"` / `aria-modal="true"`. Form inputs use `placeholder` instead of `<label>`.
- **`localStorage.getItem('hrms_token')` is the single source of auth truth.** No abstraction, no event bus, no refresh path. Token expiry is handled by reactively logging out on a 401 (`App.jsx:362`).

### A3. Agent / RAG layer

#### A3.1 What is RIGHT

- **Conflict-detection protocol is robust.** `backend/api/chat.py:83-111` reads `intermediate_steps` and inspects the structured `conflict` flag on the tool's observation dict — it does **not** rely on the LLM emitting `CONFLICT_DETECTED` as prose. The system-prompt sentinel (`agent/agent.py:42`) is belt-and-braces, not load-bearing. This is the correct pattern for every other intent.
- **RAG configuration is internally consistent.** Ingest (`rag/ingest_docs.py:32-35`) and query (`agent/tools_registry.py:93-129`) both use `chunk_size=500`, embedding model `all-MiniLM-L6-v2`, and collection name `hr_policies`. The earlier bug where ingest wrote to one collection and the tool read from another is fixed.
- **Embedding model is loaded once, at module import.** `agent/tools_registry.py:32` caches `SentenceTransformer` at module scope — no per-request reload.

#### A3.2 What is WRONG

- **Two agent implementations, one used.** `agent/agent.py` (LangChain `AgentExecutor`) is the live path imported by `backend/api/chat.py:10`. `agent/graph.py` (LangGraph) is 215 lines with its own system prompt and is imported by nothing reachable from `backend/main.py`. README advertises LangGraph.
- **Five of fifteen agent tools are stubs.** `agent/tools_registry.py:524-558` — `get_onboarding_checklist`, `mark_task_complete`, `get_onboarding_progress`, `get_leave_summary`, `get_department_summary` return hardcoded strings (e.g. always `"Onboarding progress: 50% (2 of 4 tasks completed)"`). The LLM advertises them as working.
- **`apply_leave` and `confirm_leave` are ~95% duplicate.** `agent/tools_registry.py:173-299` vs `302-377` — same args, same date parsing, same `Leave` row creation, same HR email. Only difference: the conflict check.
- **`approve_leave` and `reject_leave` are ~90% duplicate.** `tools_registry.py:408-448` vs `451-489`. Same session pattern, same email-recipients block, same body template.
- **Every tool opens `SessionLocal()` directly.** Eight tools (`tools_registry.py:135, 159, 198, 321, 387, 411, 454, 495`) each have their own `db = SessionLocal(); try: ... finally: db.close()` block. No transactional abstraction.
- **`build_agent()` runs on every chat request.** `backend/api/chat.py:69-72` constructs a new `ChatOpenAI` client, new `ChatPromptTemplate`, new `create_openai_tools_agent`, new `AgentExecutor` for each POST. `get_all_tools()` is called twice per request (`agent/agent.py:82-83`).
- **`NAME_CHANGE_INTENT` protocol is fragile.** `agent/agent.py:62` instructs the LLM to emit `NAME_CHANGE_INTENT:{...json...}` inline; `backend/api/chat.py:114` regex-matches it from the answer string. Any whitespace variation, model paraphrase, or scratchpad bleed breaks it. Compare to the structured conflict path — the same problem already has a known solution.
- **System prompts are inline f-strings.** `agent/agent.py:22-65` is a 65-line string with `RULE 1`–`RULE 8` embedded. Not diff-friendly, not versionable, not testable.
- **Reranker model is configured but never called.** `backend/core/config.py:98` declares `RERANK_MODEL` and `tools/retrieval.py` (the dead folder) instantiates it; the live `search_policies` tool returns raw top-k.
- **`tools/` folder at repo root is dead code.** Nine files in `/tools/*.py` mirror live tools but are imported by nothing reachable from `backend/main.py` (only `test_retrieval.py` references one of them).

### A4. Cross-cutting

- **README is stale.** Claims SQLite (code uses Postgres — `backend/core/config.py:17`), claims `app.py` Streamlit frontend (does not exist), claims "17 tools" (15 exist; 5 are stubs), shows `ingest_docs.py` at root (it's under `rag/`).
- **`project_tree.txt` (97KB) is checked in.** Pure noise.
- **Dev/ops scripts at repo root.** `seed_db.py`, `seed_meetings.py`, `set_admin_pin.py`, `retrain.py`, `test_retrieval.py` are peers of application code. Belong under `scripts/`.
- **`.env` not committed but no `.env.example` exists.** New contributor has to guess required keys.

---

## Section B — Non-Negotiables (the rule book)

These are CI-enforced (lint, AST checks, generated-type drift) wherever possible — not aspirational. Each rule names the lint rule or check that enforces it.

### B1. Backend rules

1. **Routers are thin.** A router function may only: (a) parse the request via a Pydantic DTO, (b) call exactly one service method, (c) shape the response via a Pydantic `response_model`. No `db.query()`, no SMTP calls, no regex on agent output, no notification creation. *Enforcement: AST lint that flags `db.query`, `_send_email`, `re.search` calls inside files under `modules/*/router.py`.*
2. **Services are the only business-logic surface.** Both REST routers and agent tools call the service. The same operation has exactly one implementation. *Enforcement: code review + service test coverage gate.*
3. **Repositories own all SQL.** No `db.query(...)` outside `modules/*/repository.py`. Services receive a repository via constructor or dependency. *Enforcement: AST lint blocks `from sqlalchemy` imports outside `repository.py`, `models.py`, and `db/`.*
4. **No `SessionLocal()` calls outside `get_db()` or repository construction.** Agent tools never open sessions; they call services. *Enforcement: grep CI step.*
5. **Models split per domain.** No `models.py` file >150 lines. One file per aggregate root. *Enforcement: file-length lint.*
6. **Pydantic DTOs mandatory.** Every request body, every response. Every endpoint declares `response_model=`. No `dict` in/out. *Enforcement: FastAPI route metadata check in CI.*
7. **Enums for all statuses.** No string literals like `"Pending"`, `"Approved"`, `"pending"`. Use `LeaveStatus(str, Enum)`, `NameChangeStatus(str, Enum)`, etc. *Enforcement: grep CI step for forbidden literals.*
8. **No secrets with defaults.** `JWT_SECRET`, `DATABASE_URL`, `EMAIL_PASS`, `AI_KEY`, `HR_EMAIL`, `ADMIN_EMAIL` — required, no fallback. App refuses to boot if any are missing in non-dev environments. *Enforcement: settings validator + startup assertion.*
9. **RBAC via permissions, not role names.** All protected endpoints use `Depends(require_permission("dotted.action"))`. Permission resolver hits `RolePermission` table. *Enforcement: `require_role` becomes a deprecation warning, then removed.*
10. **Agent tools call services, never the DB.** *Enforcement: AST lint blocks `SessionLocal`, `db.query`, `db.add`, `db.commit` inside `modules/*/tools.py`.*
11. **LLM control flow uses structured tool outputs.** No regex on LLM prose. Intents are tool calls; tool returns include `intent: "..."` keys consumed by the chat router. *Enforcement: code-review rule + ban `re.search`/`re.match` on `result["output"]` strings in chat router.*
12. **Migrations are reversible and feature-named.** Every migration has a meaningful slug (no more "sync_models") and a working `downgrade()`. *Enforcement: alembic test runs `downgrade` then `upgrade` on PR.*
13. **No `print()` in app code.** Use `logging.getLogger(__name__)`. *Enforcement: ruff rule `T201`.*
14. **No bare `except Exception` in app code.** Catch typed exceptions; let unknown errors surface to the global handler. *Enforcement: ruff rule `BLE001`.*
15. **Every service method has tests.** Minimum one happy-path test + one authorization-failure test per public method. *Enforcement: coverage gate at module level (≥80% on `service.py`, `repository.py`).*
16. **Migrations run as a deploy step, not at app startup.** `backend/main.py` must not call `alembic upgrade head`. *Enforcement: lint that file.*
17. **No `os.getenv` outside `backend/core/config.py`.** Settings is the only env reader. *Enforcement: grep CI step.*
18. **PIN is hashed at rest.** `PINVerification.pin_code` becomes `pin_hash`. Constant-time comparison only. *Enforcement: column rename in migration + service-layer assertion.*

### B2. Frontend rules

19. **TypeScript strict mode.** No `any`. `tsconfig.json` ships `"strict": true`, `"noUncheckedIndexedAccess": true`. *Enforcement: `tsc --noEmit` in CI.*
20. **API types generated, not hand-written.** `openapi-typescript` regenerates `src/types/api.d.ts` from `http://localhost:8000/openapi.json` as a pre-commit hook + CI check. Drift fails the build. *Enforcement: CI re-runs generator and fails on diff.*
21. **One API client.** Every backend call goes through `src/lib/apiClient.ts` (axios instance + 401 interceptor + base URL from env). No raw `fetch()` outside that file. *Enforcement: ESLint custom rule banning `fetch` and `axios` imports outside `lib/apiClient.ts`.*
22. **No `localStorage` outside `AuthProvider`.** Token and employee live in one context. *Enforcement: ESLint `no-restricted-globals` for `localStorage` outside `features/auth/`.*
23. **No inline `style={{...}}` for layout or colour.** Tailwind classes only. Inline style is allowed *only* for runtime-computed values (e.g. dynamic width based on progress). *Enforcement: ESLint custom rule that allows inline style only when the value is not a string literal.*
24. **shadcn/ui primitives required for buttons, dialogs, inputs, forms, dropdowns, toasts.** No raw `<button>`, no `position: fixed; inset: 0` modals. *Enforcement: ESLint rule restricting bare HTML elements in feature folders to wrappers from `components/ui/`.*
25. **Forms use `react-hook-form` + `zod`.** Zod schema mirrors the backend Pydantic schema. *Enforcement: code review + a shared "Form" wrapper from `components/ui/form.tsx`.*
26. **Routing via `react-router` (or TanStack Router).** No conditional-render routing. *Enforcement: ESLint rule banning `view ===` patterns; routes declared in `app/routes.tsx`.*
27. **Feature folder mirrors backend module.** A backend `modules/leave/` is matched by `features/leave/` on the frontend. *Enforcement: directory-name lint or convention doc.*
28. **Intent handlers in a registry.** Chat panel reads a `Record<IntentType, IntentHandler>` map; adding a new intent is a one-file change. *Enforcement: code review + type-level exhaustiveness check on intent union.*

### B3. Process rules

29. **Definition-of-done per module (B1 + B2 gate).** A module is done when: (i) no `db.query` outside its repository, (ii) no `os.getenv` outside settings, (iii) router has no business logic (AST lint passes), (iv) agent tool imports only the service, (v) generated FE types include the module's schemas, (vi) characterization tests pass (see Section C), (vii) docs README block updated.
30. **One feature per PR.** No "sync models" PRs. PR title is the feature name; description references the module path.
31. **Characterization tests before refactor.** Capture the current behaviour of `apply_leave`, `confirm_leave`, the chat name-change flow, and the leave approval emails as pytest tests *before* touching the code. Refactor is green only when those tests still pass.
32. **Structured logging.** `logging.getLogger(__name__).info(..., extra={"request_id": ...})`. JSON formatter. Request-ID middleware injects a UUID into every request; the chat router propagates it to agent tools as part of the executor's metadata. *Enforcement: middleware in `backend/core/middleware.py`.*
33. **No mixed JS/TS in the new frontend.** Once Phase 5 starts, no new `.jsx` files. `allowJs: true` is permitted during transition; new files are `.tsx`/`.ts` only.

---

## Section C — Migration Plan (step by step)

### Phase 0 — Safety (1 week)

Stop the bleeding. Nothing else proceeds until this is done.

- **0.1 Rotate every committed secret.** Generate a new `JWT_SECRET`, new DB password, new `EMAIL_PASS`. Update `.env` on every environment. Add `.env.example` listing the keys (values blank). Strip `SECRET_KEY = '...'` from `config.py:23`. Remove the `"change-this-in-production"` default from `backend/core/config.py:20`.
- **0.2 Hash existing PINs at rest.**
  - Rename `PINVerification.pin_code` → `pin_hash` in `backend/database/models.py:225`.
  - Decide: (a) hash-on-next-use migration (existing transient PINs invalidated as they expire), or (b) one-shot invalidation forcing all users to request a new PIN. Default recommendation: **(b)** — transient PINs already have a 5-minute expiry, so the user impact is bounded.
  - Stop returning `default_pin` from `backend/api/registration.py:168`.
- **0.3 Move `alembic upgrade head` out of `backend/main.py:34-42`.** Migrations are a deploy step (`alembic upgrade head` run separately). Delete `run_migrations()` from the lifespan.
- **0.4 Delete dead code.**
  - `tools/` (the whole folder at repo root) — verified unreferenced by the live path.
  - `agent/graph.py` — verified unreferenced.
  - `project_tree.txt`.
  - `test_retrieval.py` (only consumer of `tools/retrieval.py`).
- **0.5 Move dev scripts.** `seed_db.py`, `seed_meetings.py`, `set_admin_pin.py`, `retrain.py` → `scripts/`. Update README.
- **0.6 Delete the root `config.py` shim.** Any module that imports from it switches to `from backend.core.config import settings`. There is exactly one settings object.
- **0.7 README rewrite.** Postgres (not SQLite). Remove the Streamlit/`app.py` claim. Document the 15 (10 real, 5 stub) tools honestly. Document the dev/run commands accurately.
- **0.8 CI baseline.** Add ruff (with `T201`, `BLE001`, `E`, `F`, `I`), mypy (strict on `backend/core/`), and a "no committed secrets" gitleaks step. CI is allowed to fail on the old code initially — but every new commit must keep CI green.

**Exit criteria:** no secrets in the repo; no dead code; CI runs; PIN column hashed; auto-migration removed.

### Phase 1 — Foundation (1 week)

Lay the rails everyone else will run on.

- **1.1 Split `backend/database/models.py`** into per-domain files under `backend/db/models/`:
  - `auth.py` — `User`, `FaceLoginAttempt`, `PINVerification`
  - `employee.py` — `Employee` (keep biometric and banking sub-tables stubbed for follow-up split)
  - `rbac.py` — `Role`, `Permission`, `RolePermission`
  - `leave.py` — `Leave`, `LeaveBalance`, `LeaveStatus` enum
  - `chat.py` — `ChatSession`, `ChatMessage`
  - `onboarding.py` — `OnboardingTask`
  - `notification.py` — `Notification`
  - `meeting.py` — `Meeting`
  - `name_change.py` — `NameChangeRequest`, `NameChangeStatus` enum
  - `audit.py` — `EmailLog`
- **1.2 Decide `User` vs `Employee`.** Recommended: `Employee` is canonical; `User` collapses into a `users` table that holds only `username` + `password_hash` + `employee_id` (FK). Face/role/verification flags move to `Employee`. Migration deprecates the duplicate columns on `User`. Mark `User.role` removal as a blocker before Phase 4.
- **1.3 Introduce enums.** `LeaveStatus`, `NameChangeStatus`, `LeaveType`, `PinType`, `EmploymentType`. Add Alembic migration converting string columns to enum constraints.
- **1.4 Alembic baseline squash.** Squash the 8 existing migrations to a single `0001_baseline.py` reflecting current state, then write `0002_add_enums.py` and `0003_normalize_user_employee.py` as the first new-era migrations. (Squashing **before** the feature refactors keeps the diffs reviewable.)
- **1.5 Introduce `backend/db/base.py`** with `Base`, `BaseModel` (timestamps + soft-delete), `get_db()` dependency. Delete the duplicate `Base` in models.
- **1.6 Introduce service/repository scaffolds.** `backend/core/base_repository.py` (generic `Repository[T]` with `get`, `list`, `create`, `update`, `soft_delete`). `backend/core/base_service.py` (constructor takes repo + optional dependencies). `backend/core/exceptions.py` (`NotFoundError`, `PermissionDeniedError`, `ConflictError`, `ValidationError`).
- **1.7 Global exception handler.** `backend/main.py` registers one handler per typed exception, mapping to HTTP 404/403/409/422.
- **1.8 Request-ID middleware + structured logging.** `backend/core/middleware.py`. Every log line carries `request_id`.
- **1.9 Characterization tests.** Pytest tests against the *current* behaviour of: `apply_leave`/`confirm_leave` (success, conflict, validation errors), `approve_leave`/`reject_leave` emails, the chat `NAME_CHANGE_INTENT` regex flow (capture the prose the LLM emits, assert the row is created and the notification is sent), `/api/auth/login-with-pin`. These are the regression net for Phases 2-3.

**Exit criteria:** all models split; enums in place; Alembic squashed; base classes in place; characterization tests green against current code.

### Phase 2 — Reference module: `leave/` (1 week)

This is the canonical template. Every other module copies its shape.

- **2.1 Create `backend/modules/leave/`** with: `router.py`, `schemas.py`, `service.py`, `repository.py`, `tools.py`, `__init__.py`.
- **2.2 Move models.** `Leave`, `LeaveBalance`, `LeaveStatus` move into `backend/modules/leave/models.py` (re-exported from `backend/db/models/leave.py` if necessary, or just live in the module — pick one).
- **2.3 Build `LeaveRepository`** with `get_by_id`, `list_pending_for_manager`, `create`, `update_status`, `delete_pending_for_employee`. All SQLAlchemy queries live here.
- **2.4 Build `LeaveService`** with one public method per business operation:
  - `request_leave(employee_id, payload) -> LeaveResult` — replaces both `apply_leave` and `confirm_leave`. Conflict check is a parameter (`force=True` skips it). Returns a discriminated-union result (`LeaveCreated | ConflictDetected`).
  - `approve(leave_id, approver_id)` and `reject(leave_id, approver_id, reason)` — share a `_update_status` private helper to kill the 90% duplication.
  - `check_balance(employee_id)`.
- **2.5 Router.** Three endpoints (`POST /api/leave/`, `POST /api/leave/{id}/approve`, `POST /api/leave/{id}/reject`). Each is 5-10 lines. `response_model=LeaveResponse`.
- **2.6 RBAC in this module.** Approve/reject endpoints use `Depends(require_permission("leave.approve"))`. The `Permission` resolver hits `RolePermission`. Seed `leave.request`, `leave.approve`, `leave.reject` permissions in a migration; map to `employee`, `hr`/`admin`, `hr`/`admin` respectively. (RBAC is folded in **here**, not deferred to a later phase — every router we touch gets the new permission check on the same edit.)
- **2.7 Agent tool.** `backend/modules/leave/tools.py` exposes `apply_leave_tool` and `confirm_leave_tool` (thin wrappers calling `LeaveService.request_leave(force=False)` and `force=True` respectively). No `SessionLocal()`, no email logic, no row creation in the tool.
- **2.8 Characterization tests still pass.** This is the gate.
- **2.9 Update agent registry.** `backend/agent/tool_registry.py` (new file) imports tools from each module, replacing the monolith `agent/tools_registry.py`.

**Exit criteria:** leave operations have one implementation; REST and chatbot both call it; old `tools_registry.py` `apply_leave`/`confirm_leave` deleted; permission table actually queried at request time.

### Phase 3 — Notifications (cross-cutting prerequisite, 3 days)

Notifications are inlined in `chat.py`, `leaves_admin.py`, and `admin.py`. They are a precondition for Phase 4 — extract them first.

- **3.1 `backend/modules/notifications/` with service + repository.**
- **3.2 `NotificationService.create_for_employee(employee_id, title, message)`** and `create_for_role(role_name, title, message)` (the latter replaces the inline `db.query(Employee).join(Role).filter(Role.name.in_(["hr","admin"]))` pattern from `chat.py:138`).
- **3.3 Email and notification fan-out.** When a leave is approved, the leave service emits a `LeaveApproved` event. A subscriber (`backend/modules/notifications/subscribers.py`) listens and creates both the notification row and the email. Decouples leave logic from notification logic. Simple in-process pub/sub via a `dispatch()` helper — no message broker.
- **3.4 Refactor `leaves_admin.py`** to call `LeaveService.approve(...)` which emits the event. Remove inline notification + email code from the router.

**Exit criteria:** zero `Notification(...)` constructor calls outside `notifications/service.py`.

### Phase 4 — Remaining modules (~2-3 weeks)

Risk: this is the longest phase and the easiest to under-scope. Each module gets its own PR. Order is dependency-driven, not alphabetical.

- **4.1 `auth/`** — face_auth + pin_auth + registration. Service extracts face enrollment + retraining + SMS dispatch from `registration.py:117-156`. The endpoint becomes ~10 lines.
- **4.2 `employees/`** — replace `lookup_employee` tool, profile read/write, name-change. **Replace `NAME_CHANGE_INTENT` regex** in `chat.py` with a real `submit_name_change_request` agent tool. Delete the regex block in `chat.py:114-187`.
- **4.3 `onboarding/`** — replace the 5 stub tools with real DB-backed implementations. Decide product scope: if "what should onboarding progress actually measure?" is unanswered, **descope** the tools (mark them as "ask HR" instead of returning fake data). Do not ship stubs as if they were real.
- **4.4 `documents/` (RAG)** — `rag/ingest_docs.py` + `search_policies` move into `backend/modules/documents/`. Wire the reranker model that's already configured (`backend/core/config.py:98`).
- **4.5 `admin/`** — role updates, email logs viewer, email-settings.
- **4.6 `meetings/`** — calendar integration; `_fetch_ics_meetings` moves into `MeetingsService`.
- **4.7 `chat/`** — the last to refactor. By the time we touch it, every intent it handles is already a service call. The router becomes: parse → call agent → return. Conflict detection stays (it's already structured). Name-change regex is gone (replaced by a real tool in 4.2).

**Exit criteria per module:** Definition-of-done gate (B29) passes.

### Phase 5 — Agent runner consolidation (3 days)

- **5.1 Single `backend/agent/runner.py`.** Cached `AgentExecutor` per (employee_id, session_id). LRU cache keyed by employee+session; TTL 30 min. Eliminates the per-request rebuild from `chat.py:69`.
- **5.2 Move system prompts to files.** `backend/agent/prompts/main.md`, `backend/agent/prompts/name_change.md`. Loaded at startup, hot-reloadable in dev.
- **5.3 Delete `agent/agent.py` and `agent/graph.py`.** Replaced by `backend/agent/runner.py`.
- **5.4 Delete `agent/tools_registry.py`.** Tools now live per module; `backend/agent/tool_registry.py` imports them.
- **5.5 Structured tool returns are mandatory.** Every tool returns `{"answer": str, "intent": Optional[str], "intent_payload": Optional[dict]}`. The chat router reads `intent` from `intermediate_steps`, never from the answer string.

**Exit criteria:** no LangGraph; one executor per session; no regex on LLM prose anywhere; prompts in files.

### Phase 6 — Frontend foundation (1 week, can run in parallel with Phase 2)

- **6.1 Adopt TypeScript.** Add `tsconfig.json` with `strict: true`, `allowJs: true` (transitional). Rename `main.jsx` → `main.tsx`. New files are `.tsx`/`.ts`.
- **6.2 Adopt Tailwind.** `npm i -D tailwindcss postcss autoprefixer`. `tailwind.config.ts` maps the existing CSS variables (`frontend/src/index.css:5-57`) to Tailwind's theme tokens — keep the dark-mode toggle working via `darkMode: 'class'` and `body.theme-dark`.
- **6.3 Initialize shadcn/ui.** `npx shadcn@latest init`. Add base primitives: `Button`, `Dialog`, `Input`, `Label`, `Form`, `Card`, `Toast`, `DropdownMenu`, `Tabs`, `Select`, `Textarea`. They land in `frontend/src/components/ui/`.
- **6.4 Generate API types.** `openapi-typescript http://localhost:8000/openapi.json -o src/types/api.d.ts`. Add `npm run gen:types` script and a pre-commit hook.
- **6.5 `src/lib/apiClient.ts`.** Axios instance with base URL from `import.meta.env.VITE_API_URL`, request interceptor injecting `Authorization`, response interceptor for 401 → AuthProvider logout. Every backend call goes through it.
- **6.6 `src/features/auth/AuthProvider.tsx`.** React Context wrapping the token + employee + login/logout. localStorage access is limited to this file. Cross-tab sync via `storage` event listener.
- **6.7 React Router.** `src/app/router.tsx` declares routes (`/login`, `/chat`, `/admin`, `/hr`, `/profile`, `/onboarding`). Replaces the conditional rendering in `App.jsx:719-806`.
- **6.8 React Query.** Server state for sessions, notifications, leave lists. Eliminates the 15-second polling in `LeaveRequests.jsx:32`.
- **6.9 Feature folder skeleton.** `src/features/leave/`, `src/features/employee/`, `src/features/chat/`, `src/features/auth/`, `src/features/onboarding/`, `src/features/admin/`, `src/features/notifications/`. Empty for now — populated in Phase 7.

**Exit criteria:** TS compiles; Tailwind classes work; shadcn primitives render; apiClient is the only network surface; AuthProvider is the only localStorage reader; types regenerate cleanly.

### Phase 7 — Feature-by-feature frontend rewrite (~2-3 weeks)

Each feature is ported in the same order as the backend modules. One feature per PR.

- **7.1 `auth/`** — Login + Register rewritten with shadcn + react-hook-form + zod. Face/PIN flows preserved.
- **7.2 `leave/`** — leave request form (with conflict popup as a `<Dialog>`), HR approval list. React Query for the list. The conflict popup becomes `features/leave/components/ConflictDialog.tsx`.
- **7.3 `chat/`** — chat panel + sidebar + sessions list + intent registry.
  - **Intent registry:** `features/chat/intentHandlers.ts` exports `const handlers: Record<IntentType, (payload, ctx) => ReactNode>` covering `leave_conflict`, `name_change`, future intents. The chat panel dispatches into the registry. Adding a fourth intent is a one-file change.
- **7.4 `notifications/`** — bell + dropdown via shadcn `DropdownMenu`. React Query for unread count.
- **7.5 `employee/profile/`** — read + AI-driven edits.
- **7.6 `onboarding/`** — resume upload + AI profile completion. Use the shadcn `Form` wrapper.
- **7.7 `admin/`** — tabs, role updates, email logs. Use shadcn `Tabs`.
- **7.8 `hr/`** — leave approvals (reusing the `leave/` components).
- **7.9 Delete `App.jsx`** when all features are ported. The new `src/app/App.tsx` is just `<AuthProvider><QueryClient><RouterProvider /></QueryClient></AuthProvider>`.
- **7.10 Delete the flat `frontend/src/components/*.jsx` files** as each is replaced by its feature-folder equivalent.

**Exit criteria per feature:** no inline `style={{...}}` (other than dynamic computed values); no raw `fetch`; no `localStorage` outside `AuthProvider`; uses generated types; lints clean.

### Phase 8 — Hardening (1 week)

- **8.1 Audit log.** Every state-changing operation writes to `audit_log` (who, what, when, before, after). Implemented as an event subscriber in `backend/core/audit.py` listening to events emitted by services.
- **8.2 Observability.** Structured JSON logs in production. Optional OpenTelemetry tracing — at minimum, request-ID propagation from FE → BE → agent tool already exists from Phase 1.
- **8.3 Accessibility pass.** All shadcn primitives already have ARIA; verify modal focus traps, keyboard nav, form-label associations.
- **8.4 React error boundary.** Top-level boundary in `src/app/App.tsx` reports to a logger.
- **8.5 OpenAPI docs polish.** Tag every endpoint, add summaries, generate the redoc page. The FE type generator depends on the OpenAPI quality, so this is not cosmetic.
- **8.6 Final CI gates enabled.** Every rule in Section B is now CI-blocking.

---

## Section D — Definition-of-Done per module (gate)

A module-refactor PR cannot merge until **every** box is checked:

- [ ] Router file has zero of: `db.query`, `_send_email`, `re.search`, `re.match`, `SessionLocal`, `Notification(...)` constructors.
- [ ] Repository file holds the only SQLAlchemy queries for the module.
- [ ] Service file is the only place that imports the repository.
- [ ] Agent tool (if any) imports only the service.
- [ ] Every endpoint declares `response_model`.
- [ ] No `os.getenv` outside `backend/core/config.py`.
- [ ] No `print()`; no bare `except Exception`.
- [ ] Status fields use enums.
- [ ] RBAC uses `Depends(require_permission("..."))`.
- [ ] Characterization tests captured in Phase 1.9 still pass.
- [ ] New unit tests: ≥80% coverage on `service.py` and `repository.py`.
- [ ] Migration (if any) is reversible — `downgrade` runs cleanly in CI.
- [ ] `npm run gen:types` regenerates without diff.
- [ ] README block for the module written.

---

## Section E — Verification

End-to-end smoke that proves the refactor is alive at each phase:

- **Phase 0 verification:** `git log -p config.py backend/core/config.py | grep -E "(SECRET_KEY|JWT_SECRET).*=.*['\"]"` returns no matches. App starts only if `.env` provides every required key. `gitleaks` CI step passes.
- **Phase 1 verification:** `alembic downgrade base && alembic upgrade head` round-trips cleanly. Characterization tests pass. `wc -l backend/db/models/*.py` shows no file >150 lines.
- **Phase 2 verification:** A leave request submitted via REST (`POST /api/leave/`) and a leave request submitted via chat ("Apply for sick leave next Monday") produce identical DB rows and identical emails. Single grep `grep -rn "SessionLocal\|db\.query" backend/modules/leave/router.py backend/modules/leave/tools.py` returns zero hits.
- **Phase 3 verification:** `grep -rn "Notification(" backend/ | grep -v modules/notifications/` returns zero hits.
- **Phase 4 verification (per module):** Definition-of-done checklist passes for that module. `grep -rn "NAME_CHANGE_INTENT" backend/` returns zero hits after 4.2.
- **Phase 5 verification:** `grep -rn "build_agent\|AgentExecutor" backend/api/` returns zero hits. Chat latency measured before/after — should drop by the cost of the LLM-client constructor + prompt build (typically 100-300ms).
- **Phase 6 verification:** `frontend/` builds with `tsc --noEmit` clean. `npm run gen:types` produces a non-empty `api.d.ts`. `apiClient.get('/api/health')` returns 200 from a shadcn `<Button>` click.
- **Phase 7 verification (per feature):** `grep -rn "fetch(\|localStorage" frontend/src/features/<feature>/` returns zero hits. Visual diff against the old UI is product-equivalent.
- **Phase 8 verification:** A leave approval emits one audit row, one notification row, one email log row — all correlated by the same request ID.

---

## Section F — Open decisions (the maintainer must answer before execution)

These are product/security decisions, not architecture. The plan cannot make them.

1. **PIN data migration strategy** — invalidate all transient PINs (recommended) or rehash on next use? Affects Phase 0.2.
2. **`User` table fate** — collapse into `Employee` + lightweight `users` (recommended) or keep both? Affects Phase 1.2.
3. **Onboarding stub tools** — descope (mark as "ask HR") or build real DB-backed implementations? Affects Phase 4.3 timeline.
4. **Agent executor caching key** — per (employee, session) or per (employee)? Affects Phase 5.1 memory profile.
5. **Permission seed catalogue** — needs to be enumerated up front. Recommended starting set: `leave.request`, `leave.approve`, `leave.reject`, `employee.read.any`, `employee.update.self`, `employee.update.any`, `name_change.request`, `name_change.review`, `onboarding.read.self`, `onboarding.read.any`, `document.search`, `document.upload`, `admin.role.update`, `admin.email.read`. Owner: whoever owns the security model.
6. **Frontend route public/private split** — affects whether `/login` is a route or a guard redirect. Default: it's a route, with `<RequireAuth>` wrapping everything else.

---

## Section G — Critical files referenced by this plan

Backend:
- `backend/main.py` (lifespan + router mounting + global exception handler)
- `backend/api/chat.py` (the 5-concerns endpoint, refactored in 4.7)
- `backend/api/leaves_admin.py` (inline notification/email, refactored in 3.4)
- `backend/api/registration.py` (face + retrain + SMS in one handler, refactored in 4.1)
- `backend/api/admin.py` (inline email, refactored in 4.5)
- `backend/database/models.py` (split in 1.1)
- `backend/database/session.py` (becomes `backend/db/session.py`)
- `backend/core/config.py` (single settings source after 0.6)
- `backend/core/security.py` (`require_role` deprecated, `require_permission` added in 2.6)
- `backend/services/email_service.py` / `face_service.py` / `twilio_service.py` (kept as service-layer templates)
- `config.py` (root — deleted in 0.6)
- `agent/agent.py` (deleted in 5.3)
- `agent/graph.py` (deleted in 0.4)
- `agent/tools_registry.py` (deleted in 5.4)
- `rag/ingest_docs.py` (moved into `backend/modules/documents/` in 4.4)
- `tools/` (deleted in 0.4)
- `alembic/versions/` (squashed in 1.4)

Frontend:
- `frontend/src/App.jsx` (deleted in 7.9)
- `frontend/src/components/*.jsx` (all 12 files deleted as features port)
- `frontend/src/index.css` (CSS variables migrate to Tailwind theme in 6.2)
- `frontend/vite.config.js` (kept — proxy is correct)
- `frontend/package.json` (gains Tailwind, shadcn deps, react-router, react-query, react-hook-form, zod, axios, openapi-typescript)

---

## Reusable patterns to keep (with paths)

- **`backend/core/security.py:36-50`** `verify_token` is correct — keep, but wrap with `require_permission` in 2.6.
- **`backend/core/email.py:14`** `send_email(to, subject, body, *, triggered_by, db)` already writes to `EmailLog`. Use this as the only email surface; delete the duplicate in `backend/services/email_service.py`.
- **`backend/services/face_service.py`** — clean service module. Template for new services.
- **`backend/services/twilio_service.py`** — same.
- **`alembic/versions/add_rbac_roles.py`** — idempotent seed migration with `ON CONFLICT`. Template for future seed migrations.
- **`backend/api/chat.py:83-111`** — the structured `intermediate_steps` conflict-detection pattern. Reused for every future intent in Phase 5.5.
- **`backend/core/config.py:47-61`** — `field_validator` pattern for env parsing. Reused for any new list/dict settings.
- **`frontend/src/index.css:5-57`** — CSS variable design tokens. Mapped into Tailwind theme in 6.2 rather than rewritten.
- **`frontend/vite.config.js:8-13`** — dev proxy. Keep verbatim.

---

## Estimated timeline

| Phase | Duration | Risk |
|---|---|---|
| 0. Safety | 1 wk | Low (but blocking) |
| 1. Foundation | 1 wk | Medium (the `User`/`Employee` decision is the hinge) |
| 2. Leave template | 1 wk | Low (one module, well-scoped) |
| 3. Notifications | 3 d | Low |
| 4. Remaining modules | 2-3 wk | **HIGHEST** — six unevenly-sized modules, easiest to overrun |
| 5. Agent runner | 3 d | Low |
| 6. FE foundation | 1 wk (parallel with 2) | Low |
| 7. FE rewrite | 2-3 wk | Medium |
| 8. Hardening | 1 wk | Low |

**Total: ~9-11 weeks** of focused work for one engineer; ~5-7 weeks with a backend + frontend pair running 2 and 6 in parallel.

Phase 4 is where this plan is most likely to fail. Mitigation: split it into six separate PRs *before* starting, with onboarding stubs descoped in writing (Section F item 3), and notifications shipped first (Phase 3 as written).
