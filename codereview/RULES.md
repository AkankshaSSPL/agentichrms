# RULES.md — Non-Negotiables

> Strict, enforceable rules for the Agentic HRMS codebase. Every rule is **CI-enforced** wherever possible. Violations block merges. This file is the pocket reference; the full reasoning lives in `STRUCTURAL_REVIEW.md`. The target structure these rules describe lives in `ARCHITECTURE.md`.

**How to use this file:** PR authors check their diff against it before requesting review. Reviewers cite rule numbers (e.g. "R3 violation: SQL in service.py:42"). CI fails on numbered violations.

---

## R0 — Meta-rules

- **R0.1** No rule is "fixable later." If you cannot follow a rule, the work is not ready to merge.
- **R0.2** If a rule blocks legitimate work, open an issue to amend the rule. Do not silently violate it.
- **R0.3** Generated files (`api.d.ts`, alembic versions, lockfiles) are exempt from style rules but follow drift rules (R20, R12).

---

## Section 1 — Backend layer discipline

### R1 — Routers are thin

A router function does **only** three things, in this order:

1. Parse the request via a Pydantic DTO (typed by `response_model=`).
2. Call **exactly one** service method.
3. Return a Pydantic DTO.

**Forbidden inside `modules/*/router.py`:**
- `db.query(...)`, `db.add(...)`, `db.commit(...)`
- `SessionLocal(...)`
- `_send_email(...)`, SMTP imports
- `re.search(...)`, `re.match(...)`, `json.loads(...)` on agent output
- `Notification(...)`, `Leave(...)`, any model constructor
- Inline imports (`from backend.database.models import X` mid-function)

**Good:**
```python
@router.post("/", response_model=LeaveResponse)
def request_leave(
    payload: LeaveRequest,
    employee=Depends(get_current_employee),
    service: LeaveService = Depends(get_leave_service),
):
    return service.request(employee.id, payload)
```

**Bad:** any router function longer than ~10 lines, or that touches the DB.

**Enforcement:** AST lint (`scripts/lint/router_purity.py`) walks `modules/*/router.py` and flags forbidden node types.

---

### R2 — Services are the only business logic surface

Every business operation has **one** implementation, in `modules/<feature>/service.py`. Both REST routers **and** agent tools call that service.

If a business rule appears in two places, one of them is wrong.

**Forbidden:**
- Duplicating a service method's logic inside a tool or a router
- Bypassing the service by calling the repository directly from a router or tool

**Enforcement:** code review + service test coverage gate (R15).

---

### R3 — Repositories own all SQL

The **only** files allowed to `import sqlalchemy` (or use `db.query`) are:
- `modules/<feature>/repository.py`
- `modules/<feature>/models.py`
- `backend/db/**`

Services receive a repository via constructor / `Depends`. Services never write SQL.

**Good:**
```python
# modules/leave/repository.py
class LeaveRepository:
    def __init__(self, db: Session): self.db = db
    def get(self, leave_id: int) -> Leave | None:
        return self.db.query(Leave).filter(Leave.id == leave_id).first()
```
```python
# modules/leave/service.py
class LeaveService:
    def __init__(self, repo: LeaveRepository): self.repo = repo
    def approve(self, leave_id: int): 
        leave = self.repo.get(leave_id) or raise NotFoundError(...)
        ...
```

**Enforcement:** AST lint blocks `from sqlalchemy` and `.query(`, `.add(`, `.commit(` outside the allowed files.

---

### R4 — No `SessionLocal()` outside `get_db()` or repository wiring

Agent tools, background tasks, and scripts use `get_db()` via dependency injection or explicit context managers — never `SessionLocal()` raw.

**Forbidden in any file under `backend/modules/*/tools.py`:**
```python
db = SessionLocal()   # ← BLOCKED
try: ...
finally: db.close()
```

**Enforcement:** grep CI step.

---

### R5 — Models split per domain

- No file under `backend/db/models/` is **> 150 lines**.
- One aggregate root per file (`leave.py`, `employee.py`, `rbac.py`, …).
- One file per file's worth of work: `models.py` monolith is forbidden.

**Enforcement:** `wc -l` check in CI.

---

### R6 — Pydantic DTOs are mandatory

- Every request body and every response is a Pydantic model declared in `modules/<feature>/schemas.py`.
- Every endpoint declares `response_model=`.
- Endpoint return type is never `dict`, `Any`, or untyped.

**Forbidden:**
```python
@router.post("/")
def create(payload: dict): return {"ok": True}   # ← BLOCKED
```

**Enforcement:** CI script introspects FastAPI routes and fails on missing `response_model`.

---

### R7 — Enums for all status fields

No string literals for state machines. Define an enum once; use it everywhere.

**Forbidden:**
```python
leave.status = "Pending"        # ← BLOCKED
if leave.status == "approved":  # ← BLOCKED (also note casing drift)
```

**Required:**
```python
class LeaveStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"

leave.status = LeaveStatus.PENDING
if leave.status is LeaveStatus.APPROVED: ...
```

**Catalogue (mandatory enums):** `LeaveStatus`, `LeaveType`, `NameChangeStatus`, `PinType`, `EmploymentType`, `NotificationKind`, `Role` (when seeded), `Gender`.

**Enforcement:** grep CI step bans the literal strings `"Pending"`, `"Approved"`, `"Rejected"`, `"pending"`, `"approved"`, `"rejected"` in `backend/` (except in migrations and the enum definitions themselves).

---

### R8 — No secrets with defaults

Settings that hold secrets **must not** have a default value. The app refuses to boot if any are unset in non-dev environments.

**Required without defaults:**
- `JWT_SECRET`
- `DATABASE_URL`
- `EMAIL_PASS`
- `AI_KEY` (OpenAI key)
- `HR_EMAIL`, `ADMIN_EMAIL`
- `TWILIO_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID`

**Forbidden:**
```python
JWT_SECRET: str = "change-this-in-production"   # ← BLOCKED
SECRET_KEY = 'WvRVUUNfrXG1mBesBboQKylrFJnoRdcu9RI7aldfmdW'  # ← BLOCKED (committed secret)
HR_EMAIL: str = "akulkarni@sveltoz.com"         # ← BLOCKED (personal default)
```

**Required:**
```python
JWT_SECRET: str   # no default; pydantic will raise on missing
```

**Enforcement:** `gitleaks` pre-commit + CI; settings validator + startup assertion in non-dev environments.

---

### R9 — RBAC via permissions, not role-name strings

All protected endpoints use `Depends(require_permission("dotted.action"))`. The resolver hits `RolePermission` at request time.

**Forbidden:**
```python
@router.post("/approve")
def approve(payload=Depends(require_role(["hr", "admin"]))):   # ← BLOCKED
```

**Required:**
```python
@router.post("/approve")
def approve(actor=Depends(require_permission("leave.approve"))):
```

**Permission naming:** `<feature>.<action>[.<scope>]`. Examples: `leave.approve`, `employee.update.self`, `employee.update.any`, `admin.role.update`.

**Enforcement:** `require_role` emits a `DeprecationWarning`; removed entirely by end of Phase 2. Grep CI step counts `require_role` usages and fails when count > previous-commit.

---

### R10 — Agent tools call services, never the DB

Files under `backend/modules/*/tools.py` may import:
- `..service`
- `..schemas`
- Pure stdlib
- `langchain.tools` (for the `@tool` decorator)

They may **not** import:
- `..repository`
- `..models`
- `sqlalchemy`
- `backend.db.session.SessionLocal`

**Good:**
```python
# modules/leave/tools.py
from langchain.tools import tool
from .service import get_leave_service

@tool
def apply_leave(employee_email: str, leave_type: str, start_date: str, end_date: str, reason: str) -> dict:
    """Apply for leave; checks calendar conflicts."""
    service = get_leave_service()
    result = service.request(employee_email=employee_email, ...)
    return result.model_dump()
```

**Enforcement:** AST lint on `modules/*/tools.py`.

---

### R11 — LLM control flow uses structured tool outputs only

The agent's behaviour is driven by structured tool return dicts, **never** by parsing the LLM's prose output.

**Forbidden:**
```python
# in chat router
nc_match = re.search(r'NAME_CHANGE_INTENT:\s*(\{.*?\})', answer)   # ← BLOCKED
```

**Required pattern:** every tool returns
```python
{
  "answer": str,                          # what the LLM should say to the user
  "intent": Optional[str],                # e.g. "leave_conflict", "name_change_submitted"
  "intent_payload": Optional[dict],       # structured data for the frontend
}
```
The chat router reads `intent` from `intermediate_steps`, never from the answer string.

**Enforcement:** ban `re.search`/`re.match` on `result["output"]` or `answer` strings inside `backend/modules/chat/`.

---

### R12 — Migrations are reversible and feature-named

- Migration slugs describe the change: `add_leave_status_enum`, `rename_pin_code_to_pin_hash`. **Never** `sync_models`.
- Every migration has a working `downgrade()`. CI runs `alembic downgrade -1 && alembic upgrade head` on every PR with a migration.
- Migrations run as a **deploy step**, not at app startup.

**Forbidden:**
- `backend/main.py` calling `alembic upgrade head` in lifespan (currently at `main.py:34-42`).
- Migration filenames matching `*sync_models*` going forward.

**Enforcement:** lint `backend/main.py`; CI round-trip job.

---

### R13 — No `print()` in app code

Use `logging.getLogger(__name__)`. Use `logger.info / warning / error / exception`. Production logs are JSON.

**Forbidden:**
```python
print(f"Chat error: {e}")           # ← BLOCKED
print("⚠️ HR notify failed")        # ← BLOCKED
```

**Required:**
```python
logger = logging.getLogger(__name__)
logger.exception("Chat failed", extra={"request_id": request_id})
```

**Exemption:** files under `scripts/` may use `print` for human-readable script output.

**Enforcement:** ruff rule `T201` (`flake8-print`).

---

### R14 — No bare `except Exception` in app code

Catch typed exceptions. Let unknown errors propagate to the global handler.

**Forbidden:**
```python
try: ...
except Exception as e:   # ← BLOCKED
    print(f"Failed: {e}")
    pass
```

**Required:**
```python
try: ...
except NotFoundError:
    raise HTTPException(404, "...")
except ValidationError as e:
    raise HTTPException(422, str(e))
```

For genuinely uncategorized exceptions at a boundary, log and re-raise — do not silently swallow.

**Enforcement:** ruff rule `BLE001` (`flake8-blind-except`).

---

### R15 — Every service method has tests

Minimum, per public service method:
- One happy-path test.
- One authorization-failure test (where applicable).
- One validation-failure test (where applicable).

Coverage gate: **≥ 80%** on `modules/<feature>/service.py` and `modules/<feature>/repository.py`.

**Enforcement:** `pytest --cov` gate in CI; per-module coverage report.

---

### R16 — Migrations run as a deploy step, not at app startup

`backend/main.py` must not call `command.upgrade(...)`. Migrations are explicit: `alembic upgrade head` in deploy scripts.

**Enforcement:** grep `backend/main.py` for `alembic` imports; fail on any.

---

### R17 — No `os.getenv` outside `backend/core/config.py`

The Pydantic `Settings` object is the **only** env reader. Every other module imports `from backend.core.config import settings`.

**Forbidden anywhere except `core/config.py`:**
```python
import os
host = os.getenv("EMAIL_HOST")   # ← BLOCKED
```

**Required:**
```python
from backend.core.config import settings
host = settings.EMAIL_HOST
```

**Enforcement:** grep CI step.

---

### R18 — PIN is hashed at rest

`PINVerification.pin_code` is renamed to `pin_hash` and stored hashed (bcrypt or argon2 via `passlib`). Comparison is constant-time.

**Forbidden:**
- Plaintext PIN in any DB column.
- Returning a PIN value in any API response (the registration endpoint must stop returning `default_pin`).

**Enforcement:** schema lint + grep CI step for response models containing `pin`/`PIN` outside of hashed-flavour names.

---

## Section 2 — Frontend rules

### R19 — TypeScript strict mode

- `tsconfig.json` ships `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noImplicitAny": true`.
- No `any`. No `// @ts-ignore`. `as unknown as Foo` is a code smell — get it reviewed.

**Enforcement:** `tsc --noEmit` in CI; `@typescript-eslint/no-explicit-any` as error.

---

### R20 — API types generated, not hand-written

`src/types/api.d.ts` is generated from `http://localhost:8000/openapi.json` via `openapi-typescript`.

- Pre-commit hook regenerates the file.
- CI re-runs the generator and **fails on diff**.
- Hand-edits forbidden.

**Forbidden:**
```ts
// src/features/leave/types.ts
export interface LeaveRequest { ... }   // ← hand-written backend type — BLOCKED
```

**Required:**
```ts
import type { paths } from "@/types/api";
type LeaveRequest = paths["/api/leave/"]["post"]["requestBody"]["content"]["application/json"];
```

**Enforcement:** CI diff check.

---

### R21 — One API client

Every backend call goes through `src/lib/apiClient.ts` — an axios instance with:
- Base URL from `import.meta.env.VITE_API_URL`.
- Request interceptor that injects `Authorization` from `AuthProvider`.
- Response interceptor that handles 401 → `AuthProvider.logout()`.

**Forbidden anywhere except `src/lib/apiClient.ts`:**
- `fetch(...)`
- `import axios from "axios"`

**Required:**
```ts
import { api } from "@/lib/apiClient";
const leaves = await api.get<LeaveResponse[]>("/leave/pending");
```

**Enforcement:** ESLint `no-restricted-imports` for `axios`; custom rule banning `fetch` outside `lib/`.

---

### R22 — No `localStorage` outside `AuthProvider`

Token and employee live in **one** React Context (`features/auth/AuthProvider.tsx`). That file is the only place that reads or writes `localStorage`.

Cross-tab consistency is maintained via the `storage` event listener inside the provider.

**Forbidden anywhere else:**
```tsx
localStorage.getItem("hrms_token")   // ← BLOCKED
localStorage.setItem("theme", "dark") // ← BLOCKED (move into a ThemeProvider)
```

**Enforcement:** ESLint `no-restricted-globals` for `localStorage` with `allow: ['features/auth/']`.

---

### R23 — No inline `style={{...}}` for static layout or colour

Tailwind classes only. Inline `style` is permitted **only** when the value is a runtime-computed expression (e.g. `style={{ width: `${progress}%` }}`).

**Forbidden:**
```tsx
<button style={{ padding: '10px', background: 'var(--accent)', borderRadius: 8 }}>
  Click
</button>
```

**Required:**
```tsx
<Button className="px-3 py-2 rounded-md">Click</Button>
```

**Allowed exception:**
```tsx
<div style={{ width: `${progressPercent}%` }} />   // dynamic, OK
```

**Enforcement:** custom ESLint rule that allows `style={...}` only when the value is not a static object literal.

---

### R24 — shadcn/ui primitives required for common widgets

These widgets must come from `src/components/ui/` (shadcn-generated):
- Button, Dialog, Sheet, Input, Label, Form, Card, Toast/Sonner, DropdownMenu, Tabs, Select, Textarea, Tooltip, Alert, Skeleton, Switch, Checkbox, RadioGroup.

**Forbidden:**
- Raw `<button>` in feature code (in `components/ui/` itself, fine).
- Custom modals built with `position: fixed; inset: 0; zIndex: 99999` — use `<Dialog>` or `<Sheet>`.
- Custom dropdowns — use `<DropdownMenu>`.

**Enforcement:** ESLint rule restricting bare HTML elements in `features/**/*.tsx` to those wrapped by `components/ui/`.

---

### R25 — Forms use `react-hook-form` + `zod`

- Every form is `useForm({ resolver: zodResolver(schema) })`.
- The zod schema mirrors the backend Pydantic schema (kept in sync via R20-generated types; zod schema lives in `features/<feature>/schemas.ts`).
- All inputs are wrapped by the shadcn `<FormField>` so labels, errors, and aria are wired automatically.

**Forbidden:**
```tsx
const [email, setEmail] = useState("");
if (!email) setError("Email required");   // ← hand-rolled — BLOCKED
```

**Required:**
```tsx
const form = useForm({ resolver: zodResolver(leaveSchema) });
<Form {...form}>
  <FormField control={form.control} name="reason" render={({ field }) => (
    <FormItem><FormLabel>Reason</FormLabel><Input {...field} /><FormMessage /></FormItem>
  )} />
</Form>
```

**Enforcement:** code review + presence of `useForm` in any file containing `<form>`.

---

### R26 — Routing via a real router

Use `react-router` (or TanStack Router). Routes declared in `src/app/router.tsx`. Auth gates via `<RequireAuth>` and `<RequirePermission permission="...">` wrappers.

**Forbidden:**
```tsx
{view === 'admin' ? <Admin /> : view === 'chat' ? <Chat /> : <Profile />}   // ← BLOCKED
```

**Required:**
```tsx
<Route path="/admin" element={<RequirePermission permission="admin.dashboard"><Admin /></RequirePermission>} />
```

**Enforcement:** ESLint rule banning `view ===` / `screen ===` style routing patterns.

---

### R27 — Feature folders mirror backend modules

For every `backend/modules/<feature>/` there is exactly one `frontend/src/features/<feature>/`. Same name, same boundaries.

```
frontend/src/features/leave/
├── api.ts          # thin wrappers over apiClient (returns generated types)
├── hooks.ts        # useLeaveBalance, useApplyLeave (React Query)
├── schemas.ts      # zod schemas for forms
├── components/     # feature-specific UI
└── routes.tsx      # the feature's routes (mounted in app/router.tsx)
```

**Enforcement:** convention + directory-name lint script.

---

### R28 — Intent handlers in a registry

The chat panel reads a `Record<IntentType, IntentHandler>` map. Adding a new intent is a one-file change (`features/chat/intentHandlers.ts`) plus the corresponding backend tool return.

**Forbidden in `ChatPanel.tsx`:**
```tsx
if (data.conflict) setConflictPopup(...);             // ← BLOCKED
if (data.name_change_request) setNameChangePopup(...); // ← BLOCKED
```

**Required:**
```tsx
const handler = intentHandlers[data.intent];
if (handler) handler(data.intent_payload, ctx);
```

The `IntentType` union must be exhaustive — TypeScript's `never` check enforces it.

**Enforcement:** code review + exhaustiveness check via `assertNever(intent)`.

---

## Section 3 — Process rules

### R29 — Definition-of-Done gate per module

A module-refactor PR cannot merge until **every** box is checked:

- [ ] Router file has zero of: `db.query`, `_send_email`, `re.search`, `re.match`, `SessionLocal`, model constructors.
- [ ] Repository file holds the only SQLAlchemy queries for the module.
- [ ] Service file is the only place that imports the repository.
- [ ] Agent tool (if any) imports only the service.
- [ ] Every endpoint declares `response_model`.
- [ ] No `os.getenv` outside `backend/core/config.py`.
- [ ] No `print()`; no bare `except Exception`.
- [ ] Status fields use enums.
- [ ] RBAC uses `Depends(require_permission("..."))`.
- [ ] Characterization tests still pass.
- [ ] New unit tests: ≥80% coverage on `service.py` and `repository.py`.
- [ ] Migration (if any) is reversible — `downgrade` runs cleanly in CI.
- [ ] `npm run gen:types` regenerates without diff.
- [ ] Module README block written.

---

### R30 — One feature per PR

- PR title is the feature name (`feat(leave): extract LeaveService`).
- Description references the module path.
- No "sync models" PRs. No "various fixes" PRs.
- If a refactor touches more than one module, split it.

---

### R31 — Characterization tests before refactor

Before touching the live behaviour of any module, capture pytest tests that pin the **current** behaviour. Refactor is green only when those tests still pass.

Required characterization tests (already listed in `STRUCTURAL_REVIEW.md` Phase 1.9):
- `apply_leave` / `confirm_leave` (success, conflict, validation errors).
- `approve_leave` / `reject_leave` (status change + email).
- Chat `NAME_CHANGE_INTENT` flow (LLM emits sentinel → row created + notification sent).
- `/api/auth/login-with-pin`.

---

### R32 — Structured logging mandatory

- `logger = logging.getLogger(__name__)` at module top.
- Production formatter: JSON.
- Request-ID middleware (`backend/core/middleware.py`) injects a UUID `request_id` per request.
- Chat router propagates `request_id` to agent tools via executor metadata.
- Every log line carries `request_id` and `actor_id` where applicable.

**Forbidden:**
```python
print(f"Approved leave {leave_id}")   # ← BLOCKED (R13)
logger.info(f"Approved leave {leave_id}")  # weak — no structure
```

**Required:**
```python
logger.info("leave.approved", extra={"leave_id": leave_id, "approver_id": actor.id, "request_id": request_id})
```

---

### R33 — No mixed JS/TS in the refactored frontend

- Once Phase 5 of the migration starts, **no new `.jsx` files**.
- `allowJs: true` is set in `tsconfig.json` only as a transition aid.
- Every new file is `.tsx` or `.ts`.
- Removed `.jsx` files do not return.

---

### R34 — Migrations are atomic

- One migration per feature change.
- A migration adds OR alters OR drops — but it does one logical thing.
- Data backfills happen in the same migration as the schema change, in a single transaction (use `op.execute(...)` after `op.add_column(...)`).
- No "drop column and migrate data" split across two migrations.

---

### R35 — Dependencies are pinned and reviewed

- `requirements.txt` and `package.json` versions are pinned.
- New dependencies require justification in the PR description.
- Security audit (`pip-audit`, `npm audit`) runs in CI.

---

### R36 — README per module

Every `backend/modules/<feature>/` and `frontend/src/features/<feature>/` has a `README.md` covering:
- Purpose (one sentence).
- Public service methods + their permissions.
- Agent tools (if any).
- Events emitted / subscribed.
- Migration history note (links to alembic revision IDs).

---

## Quick-reference: file/import allowlist

| File pattern | May import from |
|---|---|
| `modules/<f>/router.py` | `.schemas`, `.service`, `backend.core.dependencies`, FastAPI |
| `modules/<f>/service.py` | `.repository`, `.schemas`, `..<other>/service`, `backend.core.exceptions`, `backend.core.events` |
| `modules/<f>/repository.py` | `.models`, `sqlalchemy`, `backend.db.session` |
| `modules/<f>/tools.py` | `.service`, `.schemas`, `langchain.tools` |
| `modules/<f>/models.py` | `sqlalchemy`, `backend.db.base` |
| `modules/<f>/schemas.py` | `pydantic`, `.models` (enums only) |
| `backend/agent/runner.py` | `backend.agent.tool_registry`, `langchain.*`, `backend.core.config` |
| `backend/agent/tool_registry.py` | `modules.<f>.tools` (all) |
| `frontend/src/lib/apiClient.ts` | `axios`, `@/features/auth` (for token) |
| `frontend/src/features/<f>/api.ts` | `@/lib/apiClient`, `@/types/api` |
| `frontend/src/features/<f>/components/*.tsx` | `@/components/ui/*`, `@/features/<f>/{api,hooks,schemas}`, react/router/query |

Anything not on this list is forbidden unless added via PR amending this table.

---

## When in doubt

If a rule conflicts with a real task, **stop and amend the rule via PR**. Do not silently violate. Rules drift when exceptions become routine.

The single test of every rule: *"if we follow this religiously for 6 months, will the codebase be better or worse?"* If better, the rule stays.
