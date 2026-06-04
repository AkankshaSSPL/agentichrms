# CLEANUP LOG

Trail of structural cleanup so anything can be located / restored if something
breaks. Every removal below was verified **dead** by static reachability analysis
(`_deadcode_scan.py`, stdlib `ast` import-graph) from the real entry points:

```
backend/main.py · seed_db.py · seed_meetings.py · set_admin_pin.py
retrain.py · rag/ingest_docs.py
```

A file is "dead" only if it is unreachable from every entry point above **and**
a grep cross-check found no dynamic references. Nothing was deleted on the
strength of the (older, reference-only) review MDs alone.

**Baseline commit (everything intact):** `d8949e4` on branch `master`.
**To restore any file:** `git checkout d8949e4 -- <path>`

---

## Phase 0.4 — Dead code removal

| Removed | Why it was dead |
|---|---|
| `agent/graph.py` | LangGraph alt agent impl. Not imported by `main.py`'s live path (which uses `agent/agent.py`). |
| `agent/state.py` | `AgentState` imported **only** by `agent/graph.py` (dead). |
| `tools/__init__.py` | Whole `tools/` package unreachable from any entry point. |
| `tools/analytics_tool.py` | dead `tools/` island |
| `tools/base.py` | dead `tools/` island |
| `tools/email_tool.py` | dead `tools/` island (also a root-`config.py` importer) |
| `tools/employee_tool.py` | dead `tools/` island |
| `tools/leave_tool.py` | dead `tools/` island |
| `tools/onboarding_tool.py` | dead `tools/` island |
| `tools/profile_tools.py` | dead `tools/` island |
| `tools/retrieval.py` | dead `tools/` island; only consumer was `test_retrieval.py` |
| `utils/document_viewer.py` | imported **only** by `tools/retrieval.py` (dead). `utils/` had no other contents. |
| `test_retrieval.py` | throwaway script exercising the dead `tools/retrieval.py` |
| `backend/schemas/chat.py` | orphaned DTO — referenced nowhere (routers define DTOs inline) |
| `backend/schemas/hr.py` | orphaned DTO — referenced nowhere |
| `backend/schemas/user.py` | empty file (0 lines) |
| `project_tree.txt` | 97 KB generated tree dump — pure noise |

**Kept (verified live, do not confuse with the above):**
`agent/agent.py`, `agent/tools_registry.py`, `backend/schemas/auth.py`
(used by `face_auth.py` + `pin_auth.py`), `rag/ingest_docs.py`.

## Phase 0.6 + 0.1 — Single settings source & secret stripping

| Change | Detail |
|---|---|
| Deleted root `config.py` shim | Re-exported `backend.core.config.settings` + carried a hardcoded `SECRET_KEY` literal and a personal `HR_EMAIL` default. Its only live importer (`rag/ingest_docs.py`) was repointed to `from backend.core.config import settings`. There is now exactly one settings object. |
| `DATABASE_URL` made required | Removed the in-code default that embedded DB credentials. |
| `JWT_SECRET` made required | Removed the `"change-this-in-production"` default — a known signing key makes every JWT forgeable. |
| Added `.env.example` | Documents every key; `.env` stays gitignored. |

**ACTION REQUIRED (you):** the old `JWT_SECRET`, DB password, and any committed
email/API creds must be treated as compromised and **rotated** on the server —
they still exist in the baseline commit `d8949e4` and prior history. Stripping
them from the working tree does not erase history.

## Phase 0.5 — Dev scripts relocated to `scripts/`

`seed_db.py`, `seed_meetings.py`, `set_admin_pin.py`, `retrain.py` moved out of
the repo root into `scripts/`. Each had its project-root resolution fixed for
the new depth (`parent` → `parent.parent`). Run them from the repo root, e.g.
`python scripts/seed_db.py`.

## Phase 0.2 — PIN hashing at rest

Found **three** plaintext-PIN stores (review only named one). All proven
**write-only** (no code path reads them for verification — login compares against
`Employee.permanent_pin_hash`, which was already hashed):

| Issue | Fix |
|---|---|
| `PINVerification.pin_code` (plaintext `String(6)`) | Renamed → `pin_hash String(128)`, hashed on write in `pin_auth.py` + `registration.py`. |
| `Employee.permanent_pin` (plaintext col, written at `pin_auth.py:245`) | Stopped writing it. Column now always NULL; drop it in a later migration. |
| `default_pin` returned by `POST /registration` | Removed from the response; SMS-fail path now tells the user to re-request. |

**Migration:** `alembic/versions/rename_pin_code_to_pin_hash.py`
(rev `a1b2c3d4e5f6`, chained to head `abcd1234efgh`). Invalidates pending PINs.
**NOT applied** — blocked on the missing `alembic/env.py` (below) + DB access.
Deploy order: restore `env.py` → `alembic upgrade head`.

> ⚠️ Until that migration runs, the ORM expects a `pin_hash` column the live DB
> doesn't have yet, so PIN issuance will fail. This is the documented
> author-migration-now / apply-at-deploy split.

## Phase 0.8 — Lint + CI baseline

- `ruff.toml` selects `E, F, I, T20` (no `print` — R13), `BLE` (no bare except — R14);
  `E501` ignored for now; `scripts/` + `rag/ingest_docs.py` exempt from `T201`.
- `.github/workflows/ci.yml`: ruff lint + gitleaks secret scan. Runs once the
  repo has a GitHub remote (it is currently local-only).
- **Baseline at config time: 137 ruff violations** (`backend`+`agent`+`rag`).
  Top: 49 blind-except (BLE001), 33 unsorted-imports, 32 unused-imports, 7 print.
  Safe auto-fixes (unused/unsorted imports, etc.) applied in the following
  commit; the manual ones (blind-except, print) are left for the per-module
  refactor phases. Rule: the count must not rise.

## Known issues logged during cleanup (not yet fixed)

- `alembic/env.py` is **missing** from the repo — Alembic migrations cannot run
  as-is. Separate from dead-code cleanup; flagged for the migrations pass.
- Root `config.py` still ships a hardcoded `SECRET_KEY` literal and a personal
  `HR_EMAIL` default (`backend/core/config.py` has `JWT_SECRET`/`DATABASE_URL`
  defaults). Secret-stripping is a separate step.
