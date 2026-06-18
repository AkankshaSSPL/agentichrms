# Execution Plan — Private AI Behavioral Nudges (HRMS, `ai-analysis` branch)

> Successor to `DOCUMENT_VIEWER_EXECUTION_PLAN.md`. Build on `ai-analysis` (cut from
> `develop` @ `2273bfb`, which already contains the implemented viewer + analytics).
> Status: **approved, not yet implemented.**

## Context

After the demo, leadership changed the requirement: **the behavioral signal must be
completely private — no HR notifications, no emails, no HR dashboard.** Instead, the
**AI itself** does what HR used to do: it analyzes the employee's document-access
patterns and, **inside that employee's own chat**, gently and supportively raises the
relevant topic (e.g. "looks like you may want to raise a POSH complaint", "want help
applying for leave?"). Nothing ever leaves to HR.

This inverts only the **output**: detection (chat + viewer access logging, windowed
per-category thresholds) is already built and stays. We **rip out the HR-facing
output** (bell/email/Signals dashboard) and replace it with an **employee-private,
AI-delivered nudge** covering **all** tracked categories — POSH/harassment is just
one use case.

## What already exists on this branch (reuse — do not rebuild)

- Detection core: `DocumentAccessLog` + `access_source` (`chat`|`viewer`),
  `record_access` / `record_view` with cooldown, `_evaluate`, `count_access_in_window`
  combining chat+viewer (`backend/services/behavior_service.py`,
  `backend/repositories/behavior_repository.py`). Migrations 002–004.
- Viewer surface: `/documents`, `/documents/{f}/raw`, `/documents/{f}/view`
  (`backend/api/docs.py`); `DocumentLibrary.jsx`, `DocumentViewer.jsx`,
  `useDocuments.js`.
- `DocumentCategory` (`backend/enums/document_category.py`): `SENSITIVE`,
  `LEAVE_INTENT`, `EXIT_INTENT`, `GROWTH`, `GENERAL` (with `.label`).
- Agent: LangChain openai-tools agent, `gpt-4o-mini`, **templated** system prompt,
  cached per `(employee_email, today)` (`agent/agent.py:build_agent`); invoked in
  `backend/api/chat.py` returning `ChatResponse{answer, sources, steps}`. Reusable
  employee-action tools: `apply_leave`, `confirm_leave`, `check_leave_balance`
  (`agent/tools_registry.py`).
- **No POSH/grievance model exists** — and per decision (2) we do **not** build one;
  the AI gives guidance and helps the employee self-initiate.

---

## Part A — Remove all HR-facing output (private-by-default)

Delete / strip (inventory with file refs):
- **Service** (`backend/services/behavior_service.py`): remove `_notify_hr` and its
  call in `_evaluate`; remove `list_alerts`, `resolve_alert`,
  `get_analytics_summary`; drop the `Notifier` / `send_email` / `render_template`
  imports.
- **Notifications**: remove `NotifKey.BEHAVIOR_ALERT_HR` + its template entry
  (`backend/notifications/notification_templates.py`); delete
  `backend/core/templates/behavior_alert.html`. Leave `Notifier` /
  `_get_hr_employees` intact (other features use them); remove
  `BehaviorRepository.get_hr_employees` (only `_notify_hr` used it).
- **Router** (`backend/api/behavior_router.py`): remove `/behavior/alerts`,
  `/behavior/alerts/{id}/resolve`, `/behavior/analytics/summary`. **Keep** the admin
  tag endpoints (`/behavior/tags`, `/behavior/documents`) — tagging is internal
  config, not HR signalling.
- **Permissions** (`backend/core/permissions.py`): remove `behavior.view` from HR +
  ADMIN; keep `behavior.manage` (ADMIN only, for tagging).
- **Frontend**: delete `components/BehaviorAlerts.jsx`, `components/AnalyticsOverview.jsx`,
  `hooks/useBehaviorAlerts.js`; in `components/HRPanel.jsx` remove the import, the
  `{ id: 'signals' }` tab, and its render block.
- **Config** (`backend/core/config.py` + `.env.example`): remove
  `BEHAVIOR_ALERT_EMAIL_ENABLED`.

---

## Part B — Repurpose detection → private "nudge" ledger

The existing `behavior_alerts` table becomes the **nudge ledger** (one active nudge
per employee+category). No second table.

- **Enum** `backend/enums/nudge_status.py` — `NudgeStatus(str, Enum)`: `PENDING`
  (detected, not shown), `DELIVERED` (shown in chat), `DISMISSED` (employee closed /
  acted). Re-export in `backend/enums/__init__.py`.
- **Category** (`backend/enums/document_category.py`): **add `POSH = "POSH"`** (label
  "Workplace Conduct / POSH") so harassment is a first-class signal, not buried in
  `SENSITIVE`. Add `.label`. (All other categories already exist and are covered by
  the playbook below.)
- **Model** (`backend/database/models/behavior_analytics.py`, `BehaviorAlert`):
  reinterpret `status` via `NudgeStatus` (default `PENDING`); add `delivered_at`,
  `dismissed_at` (DateTime, nullable) and `nudge_text` (Text, nullable, the composed
  opener). Legacy `resolved_*` / `hr_note` columns stay nullable + unused (dropped in
  the migration's downgrade-safe path).
- **Migration** `alembic/versions/005_nudge_ledger.py` (down_revision = `004...`):
  add the three columns, set `status` server_default `'PENDING'`. **Author only — do
  not apply.**
- **Config** additions: `BEHAVIOR_THRESHOLD_POSH: int = 2`,
  `NUDGE_REPEAT_COOLDOWN_DAYS: int = 14` (don't re-nudge same category within N days),
  reuse `BEHAVIOR_ANALYTICS_ENABLED` as the master switch.

**Repository** (`backend/repositories/behavior_repository.py`) — rename/replace the
HR-alert methods with nudge methods:
- `get_active_nudge(employee_id, category)` (status PENDING or DELIVERED, within
  cooldown) — replaces `get_open_alert`.
- `create_nudge(employee_id, category, score, window_days, nudge_text)` (status
  PENDING) — replaces `create_alert`.
- `list_pending_nudges(employee_id)` → PENDING nudges, priority-ordered.
- `mark_delivered(nudge)`, `mark_dismissed(nudge)`.
- `recent_nudge_exists(employee_id, category, since)` for the re-nudge throttle.

**Service** (`backend/services/behavior_service.py`):
- `_evaluate(...)`: on threshold crossing, instead of `_notify_hr`, call
  `_raise_nudge(employee_id, category, count, filename)` → skip if
  `recent_nudge_exists` within `NUDGE_REPEAT_COOLDOWN_DAYS` or an active nudge
  exists; else `repo.create_nudge(... nudge_text=compose_nudge(category, ...))`.
- `get_pending_nudges(employee_id) -> list[dict]` (category, nudge_text, id) — for
  chat delivery.
- `mark_nudge_delivered(nudge_id)`, `dismiss_nudge(nudge_id, employee_id)`.

---

## Part C — The Nudge Playbook (all categories / use cases)

A single mapping `NUDGE_PLAYBOOK: dict[DocumentCategory, Nudge]` in the service —
each entry = `{opener, agent_instruction, action}`. Priority order
`POSH > EXIT_INTENT > LEAVE_INTENT > GROWTH` (one nudge at a time). `GENERAL` never
nudges.

| Category | Private opener (pre-seeded) | Agent follow-up instruction | Action (guidance + employee-initiated) |
|---|---|---|---|
| **POSH** | "I noticed you've been looking into our conduct/harassment policies. If you ever want to raise a concern — including a POSH complaint — I can privately walk you through the process whenever you're ready." | If the employee engages, explain the POSH process + Internal Committee confidentially, offer to help them draft/organize their account. **Never** auto-file or route to HR. | Guidance only; employee chooses to act. |
| **EXIT_INTENT** | "Just checking in — if anything about your role or growth is on your mind, I'm here to help, confidentially." | Offer a supportive conversation, surface internal growth/mobility options; if they want, help them think through next steps. No escalation. | Guidance + (optional) point to growth resources. |
| **LEAVE_INTENT** | "I've seen you reviewing leave / WFH policies. Want me to check your balance or help you apply for leave?" | If yes → call `check_leave_balance` / `apply_leave` (existing tools). | **Real action via existing tools.** |
| **GROWTH** | "Looks like you're exploring development resources. Want suggestions on learning paths or growth opportunities?" | Offer learning paths / mentorship ideas; conversational. | Guidance. |

`compose_nudge(category, filename)` returns the templated opener (deterministic +
testable); the **interactive** follow-up is handled by the LLM via the injected
instruction (Part D). Tone rules (supportive, private, non-accusatory, no "we are
monitoring you") live in the playbook + the injected system text.

---

## Part D — Delivery: **Both** pre-seeded opener + agent awareness

**1. Agent awareness (follow-up turns)** — `backend/api/chat.py`: before
`executor.invoke`, fetch `BehaviorService(db).get_pending_nudges(employee.id)`; if
any, build a private system instruction (top-priority nudge's `agent_instruction` +
tone rules) and **prepend a `SystemMessage` into `lc_history`** passed to
`executor.invoke`. This avoids touching the **cached** prompt in `build_agent`
(cache is keyed by `(email, day)` — baking per-turn text there would poison it). No
`agent.py` change required.

**2. Pre-seeded opener (visible message)** — new **employee-facing** endpoints in the
chat router (`require_authenticated`, not HR):
- `GET /api/chat/pending-nudge` → returns the top-priority PENDING nudge's
  `nudge_text` + `id`, inserts it as an `assistant` `ChatMessage` in the employee's
  most-recent session, and marks it `DELIVERED` (so it shows **once**). Returns
  `{}` when none.
- `POST /api/chat/nudge/{id}/dismiss` → `mark_dismissed` (employee-owned only).

**3. Frontend** (`frontend/src/App.jsx` + a small `hooks/useNudges.js`): on chat
mount (after the current session loads), call `GET /api/chat/pending-nudge`; if a
message returns, render it as an ordinary **assistant** bubble (reuses existing chat
rendering — no bell, no banner) with a subtle "dismiss" affordance →
`POST /nudge/{id}/dismiss`. The employee's reply then flows through normal chat,
where the injected system instruction (D.1) lets the AI continue supportively.

Net effect: the employee opens chat → sees one warm, private assistant message →
replies → the AI helps (real action for leave; guidance for POSH/exit/growth). HR
sees nothing, anywhere.

---

## Part E — Seed gaps (so every category can actually fire)

`scripts/seed_document_tags.py`: `EXIT_INTENT` and the new `POSH` have **no tagged
doc** today. Add two short policy docs to `data/docs/` and tag them (or retag
existing): `anti_harassment_policy.md` → `POSH`; `exit_resignation_policy.md` →
`EXIT_INTENT`. Re-tag `code_of_conduct.txt` from `GENERAL` → `POSH` if a separate
doc isn't desired. Idempotent upsert as today.

---

## Privacy & guardrails
- **Zero outbound**: no email, no HR bell, no HR-visible alert/dashboard endpoints.
  Add a test asserting `Notifier`/`send_email` are **never** called by the behavior
  path.
- Access logs + nudges are **employee-private**; only the employee's own chat and
  their own nudge endpoints touch them.
- **One nudge at a time**, priority-ordered; **re-nudge throttle**
  (`NUDGE_REPEAT_COOLDOWN_DAYS`) prevents nagging; opener shown **once** (DELIVERED).
- Detection unchanged: no nudge on a single access; thresholds + cooldowns
  env-tunable; `access_source` audit preserved; logs append-only.
- POSH/exit nudges are **guidance only** — the AI never files or escalates anything
  without the employee doing it themselves.

---

## Build order (each step compiles before the next)
1. `enums/nudge_status.py` + `DocumentCategory.POSH` + re-exports.
2. Model: `BehaviorAlert` nudge fields; migration `005_nudge_ledger.py` (author only).
3. Config: add `BEHAVIOR_THRESHOLD_POSH`, `NUDGE_REPEAT_COOLDOWN_DAYS`; remove
   `BEHAVIOR_ALERT_EMAIL_ENABLED`.
4. Repository: nudge methods (replace HR-alert methods).
5. Service: remove `_notify_hr`/HR queries; add `NUDGE_PLAYBOOK`, `_raise_nudge`,
   `compose_nudge`, `get_pending_nudges`, deliver/dismiss.
6. Notifications/router/permissions/templates cleanup (Part A).
7. `chat.py`: SystemMessage injection + `/chat/pending-nudge` + `/chat/nudge/{id}/dismiss`.
8. Frontend: delete HR components + Signals tab; add `useNudges` + chat-mount opener.
9. Seed docs/tags (Part E).
10. Tests.

---

## Verification

**Static:** `python -m compileall backend agent scripts`; ruff on changed files;
single Alembic head (`004 → 005` linear); import `backend.api.chat`,
`backend.services.behavior_service`, `backend.api.behavior_router` with a dummy
`DATABASE_URL`; grep-confirm no `behavior_alert.html` / `BEHAVIOR_ALERT_HR` /
`_notify_hr` references remain.

**Unit** (extend `tests/test_document_viewer_analytics.py`, reuse SQLite harness):
- Rewrite the old "alert → HR notify" tests: crossing a threshold now creates a
  **PENDING nudge** and calls **no** `Notifier`/`send_email` (assert with a mock/spy).
- `get_pending_nudges` returns the composed opener; `pending-nudge` marks it
  `DELIVERED` and won't return it twice; `dismiss` sets `DISMISSED`.
- Re-nudge throttle: a delivered/dismissed nudge in-window blocks a new one.
- Priority: with POSH + LEAVE_INTENT pending, POSH is served first.

**Manual E2E:** `alembic upgrade head` → `seed_db.py` → `seed_document_tags.py`; set
`BEHAVIOR_THRESHOLD_POSH=2`. As an **employee**, open a POSH-tagged doc twice in the
viewer → next time you open chat, a single private assistant message offers POSH
help; reply "yes" → AI explains the process (no HR routing). Repeat for
`LEAVE_INTENT` → AI calls `apply_leave`. Confirm: **no** email sent, **no** HR bell,
HRPanel has **no** Signals tab, and `GET /api/behavior/alerts` / `analytics/summary`
return **404** (removed).
