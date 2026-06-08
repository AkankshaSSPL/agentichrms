# Plan: Make notifications work cleanly + harden roles/permissions

> Status: **approved, not yet implemented.** Authored 2026-06-08 on `develop`.
> This is the next task in flight — see `HANDOFF.md` §4.

## Context

The HRMS notifications are partly broken and the RBAC layer is fragile. Verified
against the actual code on `develop`:

**Why notifications feel broken** — several events that *should* alert someone
create no in-app `Notification` row at all; HR only finds out by email (which may
not be configured). And there are three inconsistent ways notifications get
created, so the system is half-built:
- **Leave applied** (`agent/tools_registry.py:270` `apply_leave`, `:344`
  `confirm_leave`): creates the `Leave`, emails HR, but writes **no** in-app
  notification — neither to HR nor a confirmation to the employee.
- **Profile change requested** via `OnboardingService.save_profile`
  (`backend/services/onboarding_service.py:260`): notifies the **employee only**.
  The parallel `self_chat` path (`:531-540`) correctly fans out to all HR/Admin
  using `ApprovalRepository.get_hr_employees()`. Pure asymmetry — HR misses it.
- Three creation styles: `ApprovalRepository.save_notification(id,title,msg)`
  (`approval_repository.py:124`), `LeaveRepository.save_notification(obj)`
  (`leave_repository.py:61`), and the templated `backend/notifications/` module
  (only `LEAVE_APPROVED`/`LEAVE_REJECTED`, hardcoded to the `Leave` object).

**Why permissions are "hanging by a thin thread":**
- `backend/core/permissions.py:147-150` and `backend/core/security.py:98-100`:
  on **any** exception while reading the role from the DB, the code silently
  **falls back to trusting the JWT `role` claim**. That is an auth-bypass vector
  and it masks real DB errors.
- `role_id` is `nullable=False` in the model (`employee.py:67`) but the migration
  created it `nullable=True` (`alembic/versions/add_rbac_roles.py:72`, with
  `ondelete='SET NULL'`). Employees can have a NULL role; several spots then do
  `employee.role.name` with no null-check (e.g. `onboarding_router.py:183`) →
  `AttributeError` (HTTP 500) instead of a clean 403.
- Unguarded endpoints: `backend/api/onboarding.py` (checklist / task-complete /
  progress) and `backend/api/docs.py` (document listing) have **no auth at all** —
  any caller can read/modify any `employee_id`.

Decisions taken: **(1)** notifications → build one unified `Notifier` and route
every producer through it; **(2)** permissions → fix the critical security holes
now, diagnose the rest.

---

## Part 1 — Notifications: one unified Notifier

### 1a. New `backend/notifications/notifier.py`
Single entry point for all notification persistence + fan-out. A small class
bound to a `Session`:

```python
class Notifier:
    def __init__(self, db: Session): ...
    def to_employee(self, employee_id: int, title: str, message: str) -> None
    def to_hr(self, title: str, message: str) -> None          # fan-out to all HR+Admin
    def from_template(self, key: NotifKey, employee_id: int, **ctx) -> None  # optional
```
- `to_employee` / `to_hr` build `Notification(employee_id, title, message,
  is_read=False)` rows and commit. Wrap writes in try/except + `rollback()` +
  `logger.warning` (mirror current `ApprovalRepository.save_notification`) so a
  notification failure never breaks the main action.
- `to_hr` reuses the HR/Admin query that already exists in
  `ApprovalRepository.get_hr_employees()` (`approval_repository.py:110-122`) —
  move that query into the Notifier (or a shared `queries.py`) so leave/onboarding
  paths can fan out to HR too, not just approvals.

### 1b. Generalize the template module (keep text out of services)
- `backend/notifications/notification_templates.py`: extend `NotifKey` with the
  missing events: `LEAVE_SUBMITTED`, `LEAVE_SUBMITTED_HR`,
  `PROFILE_CHANGE_REQUESTED`, `PROFILE_CHANGE_REQUESTED_HR` (keep existing
  `LEAVE_APPROVED`/`LEAVE_REJECTED`). Templates stay `{title, message,
  email_subject?, email_body?}` with named placeholders.
- `backend/notifications/notification_service.py`: **decouple `build_notification`
  from the `Leave` type** — accept a `context: dict` (e.g. `leave_type`,
  `date_str`, `employee_name`, `field_label`, `new_value`) instead of a `leave`
  object, and `employee_id` explicitly. Existing leave callers pass a context
  built from the `Leave`.

### 1c. Wire every producer through the Notifier
- **`agent/tools_registry.py`** `apply_leave` (after `:280`) and `confirm_leave`
  (after `:354`): add `Notifier(db).to_hr(NotifKey.LEAVE_SUBMITTED_HR ...)` and
  `Notifier(db).to_employee(emp.id, NotifKey.LEAVE_SUBMITTED ...)`. Keep the
  existing HR email.
- **`backend/services/onboarding_service.py`** `save_profile` (`:260`): add the
  HR fan-out that `self_chat` already does — `Notifier(db).to_hr(...)`. Also route
  the existing employee notification + `hr_direct_update` (`:312`) + name-change
  + `self_chat` through the Notifier (replace the inline `approval_repo.save_notification`).
- **`backend/services/approval_service.py`** (`:110`, `:134`): replace
  `repo.save_notification(emp_id, title, msg)` with `Notifier(db).to_employee(...)`.
- **`backend/services/leave_service.py`** (`_notify_approval`/`_notify_rejection`,
  `:132`,`:150`): replace `self.repo.save_notification(build_notification(...))`
  with `Notifier(db).from_template(NotifKey.LEAVE_APPROVED, leave.employee_id, ...)`.

### 1d. Retire the two ad-hoc variants
Remove `ApprovalRepository.save_notification` and `LeaveRepository.save_notification`
once all call sites use the Notifier (grep to confirm none remain). The repos keep
only DB-entity operations; notifications become the Notifier's job exclusively.

Frontend needs **no change** — `NotificationBell.jsx` already polls
`GET /api/notifications/?only_unread=true` every 10s and reads the snake_case keys
the API returns. The gaps are purely missing producers.

---

## Part 2 — Permissions: critical security fixes

### 2a. Fail closed on DB error (remove JWT fallback)
- `backend/core/permissions.py:145-152`: drop the `except Exception: role_name =
  payload.get("role")` fallback. On unexpected error, `logger.exception(...)` and
  raise `HTTPException(503, "Could not verify permissions, try again")`. Keep the
  `except HTTPException: raise`.
- `backend/core/security.py:96-100`: same fix in `require_role`.

### 2b. Null-safe role access
- `backend/api/onboarding_router.py:47` and `:183`: guard `employee.role` /
  `payload.get("role")` for `None` before `.name`/`in` checks — treat missing role
  as 403, not 500. Quick grep for other bare `.role.name` accesses and apply the
  same `emp.role.name if emp.role else None` pattern already used in `admin.py:67`.

### 2c. Guard the open endpoints
- `backend/api/onboarding.py` (all three routes): add a `require_self_or_hr`
  dependency — extract the caller via `verify_token`, allow if
  `caller.sub == employee_id` **or** role in `{hr, admin}`, else 403. (Build it
  from the existing `verify_token`; mirror `notifications.py:get_current_employee`.)
- `backend/api/docs.py` (`/documents`, `/documents/{filename}`): require a valid
  token (any authenticated role) via a small `require_authenticated` dependency.

### 2d. Align `role_id` schema with the model
- Author a new Alembic migration (now possible — `alembic/env.py` exists):
  backfill `NULL` `role_id` → the `employee` role id, then
  `ALTER COLUMN role_id SET NOT NULL` and change the FK from `SET NULL` to
  `RESTRICT`. **Author only — do NOT apply** (no DB access here); note it in
  `CLEANUP_LOG.md` like the pin_hash migration.

---

## Out of scope this pass (diagnosed, logged as follow-ups)
- Collapse the 3 guard patterns (`require_permission` / `require_role` / inline
  checks) into `require_permission` everywhere (`email_settings.py` uses
  `require_role(["admin"])`).
- Remove the dead `permissions` / `role_permissions` tables (RBAC is enforced from
  the in-memory `ROLE_PERMISSIONS` dict, the tables are never read/seeded).
- Consolidate the 3 copies of "extract employee from Bearer token" into one shared
  auth dependency.
- Move root seed scripts into `scripts/`; drop the plaintext `Employee.permanent_pin`
  column. (Already logged in `CLEANUP_LOG.md`.)
All recorded in `CLEANUP_LOG.md`.

---

## Verification (no DB / no run available)
- **Compile + lint**: `python -m py_compile` on every changed file;
  `.venv-tools/Scripts/ruff.exe check` on changed files — keep the baseline count
  from rising (new code must be clean).
- **Import sanity**: with a dummy `DATABASE_URL` set, `python -c "import
  backend.notifications.notifier; import backend.services.leave_service; import
  backend.services.onboarding_service; import backend.api.onboarding"` to confirm
  the Notifier wiring and guards import cleanly (SQLAlchemy `create_engine` is lazy,
  so no DB connection is made).
- **Grep gate**: confirm zero remaining `save_notification(` call sites after 1d.
- **Manual end-to-end (when the app is run later)**:
  1. Employee applies leave via chatbot → HR's bell shows "New Leave Request";
     employee's bell shows "Leave Submitted".
  2. Employee requests a profile change (e.g. phone) → HR's bell shows the request.
  3. HR approves/rejects a leave → employee's bell shows the result.
  4. Call `GET /api/onboarding/1/checklist` with a non-owner non-HR token → 403
     (was 200); with no token → 401.
