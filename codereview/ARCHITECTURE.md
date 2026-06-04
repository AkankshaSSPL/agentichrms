# ARCHITECTURE.md — Target Structure

> The shape the codebase is migrating toward. Companion document to `RULES.md` (the enforceable conventions) and `STRUCTURAL_REVIEW.md` (the analysis + migration plan). When the current code disagrees with this document, the code is wrong — but only the migration plan decides when to fix it.

---

## 1. Guiding principles

1. **One business operation = one implementation.** REST endpoints, agent tools, CLI scripts, background jobs all call the **same service method**. No duplication between the API and the chatbot.
2. **Vertical feature modules over horizontal layers.** The codebase is sliced by *feature* (`leave`, `employee`, `onboarding`), not by *layer* (`controllers`, `services`, `models` as parallel top-level folders).
3. **The chatbot is just another adapter.** A user's "Apply for leave next Monday" routes through the same `LeaveService.request()` that the REST endpoint calls. The agent layer is an *adapter*, not a parallel implementation.
4. **The contract between FE and BE is generated, not hand-maintained.** Pydantic schemas → OpenAPI → TypeScript types. Renaming a backend field breaks the frontend build, not production.
5. **Permissions are data, not code.** RBAC checks resolve from the `RolePermission` table at request time, not from string lists hard-coded in decorators.
6. **Control flow is structured.** The LLM's behaviour is driven by structured tool returns, not by parsing its prose output.

---

## 2. Runtime topology

```
┌────────────────────────────────────────────────────────────────┐
│  React frontend (Vite + TS + Tailwind + shadcn/ui)             │
│  - features/<feature>/{api, hooks, components, schemas}        │
│  - One AuthProvider, one apiClient, one Router                 │
│  - Types generated from OpenAPI                                │
└──────────────────┬─────────────────────────────────────────────┘
                   │ HTTPS (JSON over /api/*)
                   │ Authorization: Bearer <JWT>
┌──────────────────▼─────────────────────────────────────────────┐
│  FastAPI app (backend/main.py)                                 │
│  - Global exception handler                                    │
│  - Request-ID middleware                                       │
│  - CORS                                                        │
│  - Mounts every module's router under /api                     │
└──────────────────┬─────────────────────────────────────────────┘
                   │
   ┌───────────────┼───────────────┬──────────────────────────┐
   │               │               │                          │
   ▼               ▼               ▼                          ▼
modules/      modules/        modules/                   backend/agent/
 leave/        chat/           …other…                     runner.py
  router        router                                   (cached executor)
  service ◄────────────────────────────────────────────────  tools.py
  repository                                                  │
   │                                                         calls
   ▼                                                         service
Postgres                                                       │
                                              ┌────────────────┴──────┐
                                              │   modules/<f>/tools   │
                                              │   (thin wrappers)     │
                                              └───────────────────────┘
                   ▲
                   │
              ChromaDB           SMTP            Outlook ICS
              (RAG store)        (email)         (calendar conflicts)
```

**Both paths into a business operation:**

```
[ React form ]  ──► POST /api/leave/         ──► leave.router  ──►┐
                                                                   ├─► LeaveService.request() ──► LeaveRepository ──► DB
[ Chatbot   ]   ──► "apply leave next Mon"  ──► chat.router   ──►│                                       │
                  └── AgentExecutor ──► leave.tools.apply_leave ──┘                                       └─► event ──► Notifications, Emails
```

There is no second copy of `LeaveService.request()` anywhere in the codebase.

---

## 3. Backend folder structure

```
backend/
├── main.py                         # FastAPI app, lifespan, router mounting only
├── core/
│   ├── config.py                   # Pydantic Settings (the ONLY env reader)
│   ├── security.py                 # JWT, password hashing, permission resolver
│   ├── dependencies.py             # get_db, get_current_employee, require_permission
│   ├── exceptions.py               # NotFoundError, PermissionDeniedError, …
│   ├── middleware.py               # Request-ID, structured logging
│   ├── events.py                   # In-process pub/sub (dispatch / subscribe)
│   ├── email.py                    # Single send_email + EmailLog writer
│   └── base_repository.py          # Generic Repository[T] (optional, for boilerplate)
├── db/
│   ├── session.py                  # engine, SessionLocal, get_db
│   ├── base.py                     # Base, BaseModel (timestamps, soft-delete)
│   └── models/                     # One file per aggregate root, <150 lines each
│       ├── auth.py                 # User, FaceLoginAttempt, PINVerification
│       ├── employee.py             # Employee
│       ├── rbac.py                 # Role, Permission, RolePermission
│       ├── leave.py                # Leave, LeaveBalance, LeaveStatus enum
│       ├── chat.py                 # ChatSession, ChatMessage
│       ├── onboarding.py
│       ├── notification.py
│       ├── meeting.py
│       ├── name_change.py
│       └── audit.py                # EmailLog, AuditLog
├── modules/
│   ├── auth/                       # face_auth + pin_auth + registration
│   │   ├── router.py
│   │   ├── service.py
│   │   ├── repository.py
│   │   ├── schemas.py
│   │   ├── face_service.py         # face enrollment + recognition (already exists)
│   │   ├── pin_service.py          # PIN gen + verify
│   │   └── README.md
│   ├── leave/                      # canonical reference module
│   │   ├── router.py
│   │   ├── service.py
│   │   ├── repository.py
│   │   ├── schemas.py
│   │   ├── tools.py                # agent tools — thin wrappers over service
│   │   ├── events.py               # LeaveApproved, LeaveRejected event types
│   │   └── README.md
│   ├── employees/
│   ├── onboarding/
│   ├── name_change/
│   ├── notifications/              # Cross-cutting; emits notifications + emails
│   │   ├── service.py
│   │   ├── repository.py
│   │   ├── router.py               # for fetching notification list
│   │   ├── subscribers.py          # listens to other modules' events
│   │   └── README.md
│   ├── admin/
│   ├── documents/                  # RAG: ingest + search_policies tool
│   │   ├── router.py               # upload + list endpoints
│   │   ├── service.py
│   │   ├── ingest.py               # rag/ingest_docs.py moved here
│   │   ├── retriever.py            # ChromaDB query + reranker
│   │   └── tools.py                # search_policies tool
│   ├── meetings/                   # ICS calendar integration
│   └── chat/
│       ├── router.py               # POST /chat — thin
│       ├── service.py              # session/history management
│       ├── repository.py
│       └── intent_dispatcher.py    # reads tool-output intent, shapes response
├── agent/
│   ├── runner.py                   # cached AgentExecutor per (employee, session)
│   ├── tool_registry.py            # imports tools from every module
│   ├── prompts/
│   │   ├── main.md                 # system prompt — versionable, diff-able
│   │   └── name_change.md
│   └── README.md
├── services/                       # ONLY cross-feature infra services
│   ├── twilio_service.py           # SMS (used by auth module)
│   └── …
└── tests/
    ├── characterization/           # Phase 1.9 regression net
    ├── modules/
    │   └── leave/
    │       ├── test_service.py
    │       └── test_repository.py
    └── integration/
        └── test_chat_e2e.py
```

### Layer rules (also in RULES.md R1-R5, R10, R17)

| Layer | May import from | May NOT import |
|---|---|---|
| `router.py` | `.schemas`, `.service`, `core.dependencies`, fastapi | `.repository`, `.models`, sqlalchemy |
| `service.py` | `.repository`, `.schemas`, other `service.py`, `core.events`, `core.exceptions` | fastapi, `.router`, raw sqlalchemy |
| `repository.py` | `.models`, sqlalchemy, `db.session` | fastapi, `.service`, `.router` |
| `tools.py` | `.service`, `.schemas`, langchain.tools | `.repository`, `.models`, sqlalchemy, `SessionLocal` |
| `models.py` | sqlalchemy, `db.base` | everything else |
| `schemas.py` | pydantic, `.models` (enums only) | fastapi, sqlalchemy |

### Anatomy of a module (`modules/leave/`)

```python
# schemas.py
class LeaveRequest(BaseModel):
    leave_type: LeaveType
    start_date: date
    end_date: date
    reason: str

class LeaveResponse(BaseModel):
    id: int
    status: LeaveStatus
    employee_id: int
    ...

class LeaveCreated(BaseModel):
    intent: Literal["leave_created"] = "leave_created"
    leave: LeaveResponse

class ConflictDetected(BaseModel):
    intent: Literal["leave_conflict"] = "leave_conflict"
    meetings: list[ConflictingMeeting]
    pending_payload: LeaveRequest

LeaveResult = LeaveCreated | ConflictDetected   # discriminated union
```

```python
# repository.py — the ONLY file with SQL
class LeaveRepository:
    def __init__(self, db: Session): self.db = db
    def get(self, leave_id: int) -> Leave | None: ...
    def list_pending_for_manager(self, manager_id: int) -> list[Leave]: ...
    def create(self, **kw) -> Leave: ...
    def update_status(self, leave: Leave, status: LeaveStatus, **kw) -> None: ...
```

```python
# service.py — the ONLY file with business logic
class LeaveService:
    def __init__(self, repo: LeaveRepository, meetings: MeetingService, events: EventBus):
        self.repo, self.meetings, self.events = repo, meetings, events

    def request(self, employee_id: int, payload: LeaveRequest, *, force: bool=False) -> LeaveResult:
        if not force:
            conflicts = self.meetings.find_conflicts(employee_id, payload.start_date, payload.end_date)
            if conflicts:
                return ConflictDetected(meetings=conflicts, pending_payload=payload)
        leave = self.repo.create(employee_id=employee_id, **payload.model_dump(), status=LeaveStatus.PENDING)
        self.events.dispatch(LeaveRequested(leave_id=leave.id))
        return LeaveCreated(leave=LeaveResponse.model_validate(leave))

    def approve(self, leave_id: int, approver_id: int) -> LeaveResponse:
        leave = self.repo.get(leave_id) or _raise(NotFoundError(f"leave {leave_id} not found"))
        self.repo.update_status(leave, LeaveStatus.APPROVED, approver_id=approver_id)
        self.events.dispatch(LeaveApproved(leave_id=leave.id))
        return LeaveResponse.model_validate(leave)

    # reject() shares _update_status with approve()
```

```python
# router.py — thin
router = APIRouter(prefix="/leave", tags=["Leave"])

@router.post("/", response_model=LeaveResult)
def request_leave(
    payload: LeaveRequest,
    actor=Depends(require_permission("leave.request")),
    service: LeaveService = Depends(get_leave_service),
):
    return service.request(actor.id, payload)

@router.post("/{leave_id}/approve", response_model=LeaveResponse)
def approve(
    leave_id: int,
    actor=Depends(require_permission("leave.approve")),
    service: LeaveService = Depends(get_leave_service),
):
    return service.approve(leave_id, actor.id)
```

```python
# tools.py — agent adapter; thin
@tool
def apply_leave(employee_email: str, leave_type: str, start_date: str, end_date: str, reason: str) -> dict:
    """Apply for leave. Returns structured result with intent for the chat panel."""
    service = get_leave_service()  # uses get_db() under the hood
    employee = get_employee_by_email(employee_email)
    payload = LeaveRequest(leave_type=leave_type, start_date=date.fromisoformat(start_date), ...)
    result = service.request(employee.id, payload, force=False)
    return result.model_dump()
```

The tool returns `{"intent": "leave_conflict", ...}` or `{"intent": "leave_created", ...}`. The chat router reads `intent` from `intermediate_steps` and the frontend dispatches into the intent registry. **No regex on prose anywhere.**

---

## 4. Frontend folder structure

```
frontend/
├── index.html
├── package.json
├── tsconfig.json                   # strict, allowJs (transitional)
├── tailwind.config.ts
├── postcss.config.cjs
├── vite.config.ts
└── src/
    ├── main.tsx                    # mounts <App/>
    ├── app/
    │   ├── App.tsx                 # <AuthProvider><QueryClient><Router/></.../>
    │   ├── router.tsx              # all routes declared here
    │   ├── providers.tsx           # AuthProvider, QueryClient, ThemeProvider
    │   └── errorBoundary.tsx
    ├── lib/
    │   ├── apiClient.ts            # the ONLY axios instance
    │   ├── env.ts                  # import.meta.env validation via zod
    │   └── utils.ts                # cn(), formatters
    ├── components/
    │   └── ui/                     # shadcn primitives — generated, do not hand-edit
    │       ├── button.tsx
    │       ├── dialog.tsx
    │       ├── form.tsx
    │       ├── input.tsx
    │       └── …
    ├── features/                   # mirror backend modules
    │   ├── auth/
    │   │   ├── AuthProvider.tsx    # ONLY file that touches localStorage
    │   │   ├── api.ts
    │   │   ├── schemas.ts
    │   │   ├── routes.tsx
    │   │   └── components/
    │   │       ├── LoginPage.tsx
    │   │       ├── FaceLogin.tsx
    │   │       ├── PinLogin.tsx
    │   │       └── RegisterPage.tsx
    │   ├── leave/
    │   │   ├── api.ts              # typed wrappers over apiClient
    │   │   ├── hooks.ts            # useLeaveBalance, useApplyLeave (React Query)
    │   │   ├── schemas.ts          # zod schemas mirroring Pydantic
    │   │   ├── routes.tsx
    │   │   └── components/
    │   │       ├── LeaveRequestForm.tsx
    │   │       ├── ConflictDialog.tsx
    │   │       └── ApprovalQueue.tsx     # used by HR + admin
    │   ├── chat/
    │   │   ├── api.ts
    │   │   ├── hooks.ts
    │   │   ├── intentHandlers.ts   # Record<IntentType, (payload, ctx) => ReactNode>
    │   │   ├── routes.tsx
    │   │   └── components/
    │   │       ├── ChatPanel.tsx
    │   │       ├── SessionSidebar.tsx
    │   │       └── MessageBubble.tsx
    │   ├── employees/
    │   ├── onboarding/
    │   ├── notifications/
    │   ├── name_change/
    │   ├── admin/
    │   └── hr/                     # composes leave/ + employees/ widgets
    ├── hooks/
    │   ├── useAuth.ts              # re-exports from AuthProvider
    │   └── useTheme.ts
    ├── types/
    │   └── api.d.ts                # GENERATED by openapi-typescript — do not edit
    └── styles/
        └── globals.css             # @tailwind base/components/utilities + CSS vars
```

### Feature folder anatomy (`features/leave/`)

```ts
// schemas.ts — zod for forms; types still come from generated api.d.ts
import { z } from "zod";
export const leaveRequestSchema = z.object({
  leave_type: z.enum(["casual", "sick", "annual"]),
  start_date: z.string().date(),
  end_date: z.string().date(),
  reason: z.string().min(3),
});
export type LeaveRequestForm = z.infer<typeof leaveRequestSchema>;
```

```ts
// api.ts — thin
import { api } from "@/lib/apiClient";
import type { paths } from "@/types/api";

type LeaveBody = paths["/api/leave/"]["post"]["requestBody"]["content"]["application/json"];
type LeaveResult = paths["/api/leave/"]["post"]["responses"]["200"]["content"]["application/json"];

export const leaveApi = {
  request: (body: LeaveBody) => api.post<LeaveResult>("/leave/", body),
  approve: (id: number) => api.post(`/leave/${id}/approve`),
  pending: () => api.get("/leave/pending"),
};
```

```ts
// hooks.ts — React Query
export const useApplyLeave = () =>
  useMutation({ mutationFn: leaveApi.request });

export const usePendingLeaves = () =>
  useQuery({ queryKey: ["leave", "pending"], queryFn: leaveApi.pending });
```

```tsx
// components/LeaveRequestForm.tsx
const form = useForm<LeaveRequestForm>({ resolver: zodResolver(leaveRequestSchema) });
const apply = useApplyLeave();

const onSubmit = async (data: LeaveRequestForm) => {
  const result = await apply.mutateAsync(data);
  if (result.intent === "leave_conflict") setConflictDialog(result);
  else toast({ title: "Leave submitted" });
};

return (
  <Form {...form}>
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <FormField control={form.control} name="leave_type" render={({ field }) => (
        <FormItem><FormLabel>Type</FormLabel><Select {...field}>…</Select><FormMessage /></FormItem>
      )} />
      …
      <Button type="submit" disabled={apply.isPending}>Submit</Button>
    </form>
  </Form>
);
```

No inline styles. No raw fetch. No localStorage. No hand-written types.

---

## 5. The agent runner

```
                          ┌──────────────────────────┐
   POST /api/chat ───────►│ chat.router (thin)       │
                          └──────────┬───────────────┘
                                     │ session_id, employee
                          ┌──────────▼───────────────┐
                          │ agent.runner.get_executor│  ◄── LRU cache by (employee_id, session_id)
                          │  (cached, 30-min TTL)    │      Builds once, reused per session
                          └──────────┬───────────────┘
                                     │ executor.invoke({input, chat_history})
                          ┌──────────▼───────────────┐
                          │ LangChain AgentExecutor  │
                          │  - prompt: prompts/main.md│
                          │  - tools: tool_registry  │
                          │  - LLM:  ChatOpenAI       │
                          └──────────┬───────────────┘
                                     │
                          ┌──────────▼───────────────┐
                          │ Tool dispatch            │
                          │ (e.g. apply_leave)       │
                          └──────────┬───────────────┘
                                     │  service.request(…)
                          ┌──────────▼───────────────┐
                          │ LeaveService             │
                          └──────────┬───────────────┘
                                     │  repo + events
                          ┌──────────▼───────────────┐
                          │ Repository → DB          │
                          │  + EventBus → subscribers│
                          │    (NotificationService) │
                          └──────────────────────────┘

Result: structured dict
  {"answer": "...", "intent": "leave_conflict", "intent_payload": {...}}

                          ┌──────────────────────────┐
       Chat router        │ intent_dispatcher.shape() │
       reads tool's       │   • picks the right       │
       intermediate_steps │     ChatResponse shape    │
                          │   • never regex on prose  │
                          └──────────┬───────────────┘
                                     │ JSON
                          ┌──────────▼───────────────┐
                          │ React intentHandlers     │
                          │   handlers[intent](payload)│
                          └──────────────────────────┘
```

**Key properties:**
- `build_agent()` is **not** called per request. One executor per session, cached.
- System prompts live in `backend/agent/prompts/*.md` — versionable, diffable.
- Every tool returns `{answer, intent, intent_payload}`. The chat router never regex-parses the LLM's prose.
- The agent's view of the world is exactly the service layer's view. Anything the user can do via REST, the agent can do — and vice versa.

---

## 6. The contract between FE and BE

```
backend/modules/leave/schemas.py   (Pydantic)
              │
              ▼
   FastAPI generates /openapi.json
              │
              ▼
   openapi-typescript → frontend/src/types/api.d.ts   (TypeScript)
              │
              ▼
   features/leave/api.ts (thin) + hooks.ts (React Query)
              │
              ▼
   features/leave/components/LeaveRequestForm.tsx
```

A backend field rename:
1. Author edits `schemas.py`.
2. CI regenerates `api.d.ts`.
3. Frontend compile breaks at every usage site.
4. PR cannot merge until both ends are consistent.

This is the only mechanism that prevents type drift between FE and BE. It is **not optional** (R20).

---

## 7. Events and cross-cutting concerns

Notifications, email, and audit logging are **subscribers**, not direct callers. Services dispatch events; subscribers listen.

```python
# modules/leave/service.py
self.events.dispatch(LeaveApproved(leave_id=leave.id, approver_id=approver_id))

# modules/notifications/subscribers.py
@subscribe(LeaveApproved)
def notify_on_leave_approved(event: LeaveApproved):
    emp = employee_service.get_employee_for_leave(event.leave_id)
    notification_service.create_for_employee(emp.id, "Leave approved", "...")
    email_service.send(emp.email, subject="...", body="...", triggered_by="leave.approved")

# core/audit.py
@subscribe(LeaveApproved)
def audit_leave_approved(event: LeaveApproved):
    audit_repo.write(actor_id=event.approver_id, action="leave.approve", target_id=event.leave_id)
```

**Why events:** the leave module doesn't import the notification module, the email module, or the audit module. Each cross-cutting concern is added by writing a subscriber — no changes to the producer.

**Implementation:** simple in-process pub/sub in `backend/core/events.py` — `dispatch(event)` + `@subscribe(EventType)` decorator. No message broker. Subscribers run synchronously inside the same DB transaction (or after commit, depending on the event type).

---

## 8. Permissions

```
employees
   │
   ▼
role_id ──► roles ──► role_permissions ──► permissions
                            (join table)         │
                                                 ▼
                                       e.g. "leave.approve"
```

- `require_permission("leave.approve")` resolves the actor's role_id → joins through `role_permissions` → checks for the permission row.
- Result is **cached per request** (not per token) — role/permission changes take effect at next request, not at next login.
- Permission seed catalogue (extensible):

| Permission | Default roles |
|---|---|
| `leave.request` | employee, hr, admin |
| `leave.approve` | hr, admin |
| `leave.reject` | hr, admin |
| `employee.read.self` | employee, hr, admin |
| `employee.read.any` | hr, admin |
| `employee.update.self` | employee, hr, admin |
| `employee.update.any` | hr, admin |
| `name_change.request` | employee, hr, admin |
| `name_change.review` | hr, admin |
| `onboarding.read.self` | employee, hr, admin |
| `onboarding.read.any` | hr, admin |
| `document.search` | employee, hr, admin |
| `document.upload` | hr, admin |
| `admin.role.update` | admin |
| `admin.email.read` | admin |

Adding a new permission = (a) seed row in a migration, (b) `Depends(require_permission(...))` in the router. No code changes elsewhere.

---

## 9. Database migrations

```
alembic/
├── env.py
└── versions/
    ├── 0001_baseline.py                          # squashed initial schema
    ├── 0002_add_status_enums.py
    ├── 0003_normalize_user_employee.py
    ├── 0004_hash_pin_column.py
    ├── 0005_seed_permissions.py
    ├── 0006_add_audit_log_table.py
    └── …
```

- Sequentially numbered prefix for human readability; alembic revision IDs underneath.
- One feature per migration.
- Every migration has a working `downgrade()` (R12).
- Migrations run as a **deploy step**, never at app startup (R16).
- Data backfills happen inside the same migration as the schema change (R34).

---

## 10. Configuration

One settings object. One env reader. One source of truth.

```python
# backend/core/config.py — the only file that reads os.environ
class Settings(BaseSettings):
    DATABASE_URL: str               # no default — required
    JWT_SECRET: str                 # no default — required
    AI_KEY: str                     # no default — required
    EMAIL_PASS: str                 # no default — required
    HR_EMAIL: str                   # no default — required
    
    EMAIL_HOST: str = "smtp.gmail.com"   # safe defaults OK
    EMAIL_PORT: int = 587
    JWT_EXPIRY_HOURS: int = 24
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()
```

`.env.example` ships in the repo, listing every required key with blank values.

---

## 11. Testing topology

```
tests/
├── characterization/         # captured BEFORE the refactor; freeze current behaviour
│   ├── test_apply_leave_current.py
│   ├── test_name_change_intent_current.py
│   └── test_login_pin_current.py
├── modules/
│   └── leave/
│       ├── test_service.py   # unit (mocked repo)
│       ├── test_repository.py # integration (real DB, transactional rollback)
│       └── test_tools.py     # agent tool wrapper
├── integration/
│   ├── test_leave_e2e.py     # FastAPI TestClient through real DB
│   └── test_chat_e2e.py
└── conftest.py               # shared fixtures: db, client, factory_boy factories
```

- Characterization tests are the regression net during refactor.
- Unit tests cover service.py + repository.py (≥80% per R15).
- Integration tests prove REST + agent paths produce identical state (Phase 2 verification).

---

## 12. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Backend module | snake_case singular | `modules/leave/`, `modules/employee/` |
| Frontend feature folder | snake_case mirror of backend | `features/leave/`, `features/employee/` |
| Permission | `feature.action[.scope]` | `leave.approve`, `employee.update.self` |
| Event class | PascalCase past-tense | `LeaveApproved`, `EmployeeCreated` |
| Migration slug | `verb_noun` describing the change | `add_leave_status_enum`, `rename_pin_code_to_pin_hash` |
| API endpoint | RESTful, plural resource | `POST /api/leave/`, `GET /api/employees/{id}` |
| Intent type | `feature.action_or_state` | `leave_conflict`, `name_change_submitted` |
| Enum value | snake_case string | `LeaveStatus.PENDING = "pending"` |
| React component file | PascalCase `.tsx` | `LeaveRequestForm.tsx`, `ConflictDialog.tsx` |
| Hook file | camelCase `.ts`, plural | `hooks.ts` exports `useApplyLeave`, `usePendingLeaves` |

---

## 13. Where things go (cheat sheet)

| If you are adding… | Put it in… |
|---|---|
| A new HR feature | `backend/modules/<feature>/` + `frontend/src/features/<feature>/` |
| A new agent tool | `backend/modules/<feature>/tools.py` (thin wrapper) |
| A new permission | seed migration + `Depends(require_permission(...))` |
| A new email type | `EmailLog` triggered_by tag + service-emitted event + subscriber |
| A new database table | `backend/db/models/<feature>.py` + migration |
| A new UI primitive | `npx shadcn add <component>` → `components/ui/` |
| A new env variable | `backend/core/config.py` Settings + `.env.example` |
| A new system prompt | `backend/agent/prompts/<name>.md` |
| A new intent | `intentHandlers.ts` (FE) + tool returns `{intent, intent_payload}` (BE) |
| A new chart/dashboard | `features/<feature>/components/` |
| A migration | `alembic revision -m "verb_noun"` with explicit `downgrade()` |

---

## 14. What stays the same

These pieces of the current code are **architecturally correct** and survive the migration unchanged:

| Existing artefact | Why it stays |
|---|---|
| `backend/core/security.py:16-50` (JWT, password hashing) | Clean separation; just gains `require_permission` alongside `verify_token` |
| `backend/core/config.py:47-61` (`field_validator` for `ALLOWED_ORIGINS`) | Template for any future list/dict-typed setting |
| `backend/services/face_service.py`, `twilio_service.py` | Reasonable service-layer templates; moved into `modules/auth/` |
| `backend/core/email.py:14` (`send_email` + `EmailLog`) | Single email surface — kept; duplicate in `services/email_service.py` deleted |
| `backend/api/chat.py:83-111` (structured `intermediate_steps` conflict detection) | The right pattern for every intent — generalized in `modules/chat/intent_dispatcher.py` |
| `alembic/versions/add_rbac_roles.py` (idempotent `ON CONFLICT` seed) | Template for future seed migrations |
| `frontend/src/index.css:5-57` (CSS variable design tokens) | Maps directly into Tailwind's CSS-variable theme; no rewrite needed |
| `frontend/vite.config.js:8-13` (dev `/api` proxy to `127.0.0.1:8000`) | Correct; kept verbatim |

---

## 15. What is being removed

| Removed | Replaced by |
|---|---|
| `config.py` (root shim) | `backend.core.config.settings` only |
| `agent/agent.py` | `backend/agent/runner.py` (cached executor) |
| `agent/graph.py` (LangGraph) | Nothing — single agent implementation |
| `agent/tools_registry.py` (monolith) | `backend/agent/tool_registry.py` (imports from each module) |
| `tools/` (dead folder at repo root) | Each tool lives in `modules/<feature>/tools.py` |
| `backend/database/models.py` (278-line monolith) | `backend/db/models/<feature>.py` (one per aggregate) |
| `frontend/src/App.jsx` (865 lines) | `app/App.tsx` + router + feature folders |
| Per-component CSS files (`Login.css`, `Register.css`) | Tailwind classes |
| `require_role(["hr","admin"])` string lists | `require_permission("dotted.action")` |
| `NAME_CHANGE_INTENT:{...}` regex on LLM prose | `submit_name_change_request` tool returning `{intent: "name_change_submitted"}` |
| 87 inline `fetch()` calls | One `apiClient` |
| 300+ inline `style={{...}}` objects | Tailwind classes |
| 8 ad-hoc modal implementations | shadcn `<Dialog>` |
| Hand-rolled form validation | `react-hook-form` + `zod` |
| Conditional-render routing (`view === 'chat' ? ... : ...`) | React Router |
| Hardcoded statuses (`"Pending"`, `"Approved"`) | Python enums + TypeScript union types |
| Auto-migration in app startup | Explicit deploy step |
| Committed secrets in `config.py` | Required (no-default) env vars |

---

## 16. Quick visual: a feature, end to end

```
User clicks "Apply leave" in React
        │
        ▼
features/leave/components/LeaveRequestForm.tsx
   useForm(zodResolver(leaveRequestSchema))
   useApplyLeave()
        │
        ▼
features/leave/api.ts → apiClient.post("/leave/", body)
        │
        ▼  (axios)  Authorization: Bearer <jwt>
        │
═══════════════════════════════════ wire ═══════════════════════════════════
        │
        ▼
backend/main.py mounts router at /api
        │
        ▼
modules/leave/router.py
   parses LeaveRequest DTO
   Depends(require_permission("leave.request"))
   calls LeaveService.request()
        │
        ▼
modules/leave/service.py
   asks MeetingService for conflicts
   calls LeaveRepository.create() if none
   dispatches LeaveRequested event
        │
        ├──► modules/leave/repository.py → INSERT INTO leaves (...)
        │
        └──► core/events.py dispatches to subscribers:
                ├─ notifications/subscribers.py → NotificationService.create_for_role("hr", ...)
                ├─ notifications/subscribers.py → email send + EmailLog write
                └─ core/audit.py            → audit_log INSERT

returns LeaveResult (LeaveCreated | ConflictDetected)
        │
═══════════════════════════════════ wire ═══════════════════════════════════
        │
        ▼
LeaveResponse arrives in api.ts (typed via generated api.d.ts)
        │
        ▼
useApplyLeave() resolves; component checks `result.intent`
        │
        ├── "leave_created"   → toast.success
        └── "leave_conflict"  → <ConflictDialog meetings=... />

If the user instead typed "Apply for sick leave next Monday" in the chatbot:

Chat panel → POST /api/chat/  (with session_id)
        │
        ▼
modules/chat/router.py
   gets cached executor from agent/runner.py
        │
        ▼
AgentExecutor decides → calls leave.tools.apply_leave
        │
        ▼
tools.py → LeaveService.request()   ← THE SAME METHOD AS THE REST PATH

returns {answer, intent, intent_payload}
        │
        ▼
chat router relays the structured result to the React intentHandlers
React renders ConflictDialog (if intent === "leave_conflict")
```

**One business rule. One service method. Two adapters. Zero duplication.**

That is the architecture.

---

## Companion documents

- **`STRUCTURAL_REVIEW.md`** — full code-backed analysis + 9-phase migration plan + decision points.
- **`RULES.md`** — the enforceable rule book (R1-R36). CI-checked.
- **This file** — the target shape. The "why" lives in the review; the "what to do" lives in the rules; this is "what it looks like when we're done."
