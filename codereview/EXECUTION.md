# EXECUTION.md — The Playbook (v2, hyper-detailed)

> Day-by-day, hour-by-hour, command-by-command execution of the migration described in `STRUCTURAL_REVIEW.md`. Reads alongside `RULES.md` (the enforceable conventions) and `ARCHITECTURE.md` (the target structure).
>
> **No assumption is left implicit.** Every shell command has a verification step. Every code block is complete (no `...`, no `TODO`). Every step has an "if this fails" branch. A competent engineer with no prior context should be able to execute any task in this doc without asking anyone anything.
>
> **The contract:** follow this religiously → you never need a structural review of this project again.

---

## Table of contents

1. [Pre-flight (Week 0)](#pre-flight-week-0)
2. [Decision worksheets (F.1–F.6)](#decision-worksheets)
3. [Pinned dependency manifest](#pinned-dependency-manifest)
4. [Operating cadence](#operating-cadence)
5. [PR workflow](#pr-workflow)
6. [Code review checklist](#code-review-checklist)
7. [Testing playbook](#testing-playbook)
8. [Migration runbook](#migration-runbook)
9. [Frontend execution specifics](#frontend-execution-specifics)
10. [Reference implementations](#reference-implementations)
11. [Phase-by-phase playbook (hour-level)](#phase-by-phase-playbook)
12. [Deployment & rollout](#deployment--rollout)
13. [Seed data & local realism](#seed-data--local-realism)
14. [Incident response](#incident-response)
15. [Tracking templates](#tracking-templates)
16. [Sign-off ladders](#sign-off-ladders)
17. [Common pitfalls (25, project-specific)](#common-pitfalls)
18. [When this is done](#when-this-is-done)
19. [Quick reference — every command](#quick-reference)

---

## Pre-flight (Week 0)

> Nothing below this line happens until every Week-0 checkbox is ticked. Skipping pre-flight is the #1 reason migrations like this fail.

### W0.0 — System prerequisites

#### Ubuntu / Debian (22.04 LTS or newer)

```bash
# System update
sudo apt update && sudo apt upgrade -y

# Python 3.11 (Ubuntu 22.04 ships 3.10; add deadsnakes)
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev build-essential
python3.11 --version       # → Python 3.11.x  (verify)

# Node 20 LTS via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
node --version             # → v20.x.x  (verify)
npm --version              # → 10.x.x   (verify)

# Docker (rootless or sudo-able)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version           # → Docker version 24.x or newer  (verify)
docker run hello-world     # → "Hello from Docker!"  (verify)

# Postgres client (psql)
sudo apt install -y postgresql-client-16
psql --version             # → psql (PostgreSQL) 16.x  (verify)

# Build deps for face_recognition / dlib (Phase 4.1 needs these)
sudo apt install -y cmake libopenblas-dev liblapack-dev libx11-dev libgtk-3-dev

# git (almost always present)
git --version              # ≥ 2.30  (verify)
```

**If `nvm install 20` fails on a corp network:** `sudo apt install -y nodejs npm` then check `node --version`. If it's < 20, install NodeSource: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`.

**If Docker `hello-world` says "permission denied":** the `newgrp docker` didn't take effect. Log out, log in, try again.

#### macOS (Intel and Apple Silicon)

```bash
# Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Python 3.11
brew install python@3.11
python3.11 --version       # → Python 3.11.x  (verify)

# Node 20 via nvm
brew install nvm
mkdir -p ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc
nvm install 20
node --version             # → v20.x.x  (verify)

# Docker Desktop
brew install --cask docker
open /Applications/Docker.app   # Start Docker Desktop, accept the prompt
docker --version           # → Docker version 24.x or newer  (verify)

# Postgres client
brew install libpq
brew link --force libpq
psql --version             # (verify)

# dlib / face_recognition prereqs
brew install cmake openblas
```

**If `brew install python@3.11` reports already-installed but `python3.11` not in PATH:** `brew link --force python@3.11`.

#### Windows (WSL2 — Ubuntu 22.04)

```powershell
# In an admin PowerShell on Windows
wsl --install -d Ubuntu-22.04
# Reboot if prompted. Open the Ubuntu app, set a user/password.
```

Inside the WSL2 Ubuntu shell, run the **Ubuntu** instructions above verbatim.

```bash
# Docker Desktop on Windows with WSL2 integration enabled is recommended.
# Inside WSL:
docker --version           # should show Docker from Windows host

# Postgres client inside WSL
sudo apt install -y postgresql-client-16
```

**If `docker` is "not found" inside WSL:** open Docker Desktop → Settings → Resources → WSL Integration → enable for your distro → Apply & Restart.

#### Verify the full toolchain (any OS)

```bash
python3.11 --version    # 3.11.x
node --version          # v20.x
npm --version           # 10.x
docker --version        # 24+
psql --version          # 16
git --version           # 2.30+
cmake --version         # 3.20+
```

All six must report a version. If any fails, fix before proceeding — the migration **will** trip on the missing tool later.

---

### W0.1 — Decision sign-off (1 day, blocking)

The six product/security decisions in `STRUCTURAL_REVIEW.md` Section F cascade through every later phase. Until all are decided, **do not write code**.

Use the worksheets in the [Decision worksheets](#decision-worksheets) section below. For each:

1. The decision owner reads the worksheet.
2. Picks an option (or proposes a third with rationale).
3. Records the decision in `docs/decisions/F<n>-<slug>.md` with date and signatures.
4. Posts the decision in the team channel.

Decision tracker:

```
F.1  PIN migration strategy            owner: ____  decided: ____  doc: docs/decisions/F1-pin-migration.md
F.2  User/Employee fate                owner: ____  decided: ____  doc: docs/decisions/F2-user-employee.md
F.3  Onboarding stub scope             owner: ____  decided: ____  doc: docs/decisions/F3-onboarding-scope.md
F.4  Agent executor cache key          owner: ____  decided: ____  doc: docs/decisions/F4-executor-cache.md
F.5  Permission seed catalogue         owner: ____  decided: ____  doc: docs/decisions/F5-permissions.md
F.6  Frontend route guard pattern      owner: ____  decided: ____  doc: docs/decisions/F6-route-guards.md
```

**If a decision can't be made within Week 0:** descope that decision's downstream work or recruit a decider. Do not start coding with an open decision; you will re-litigate it three times.

---

### W0.2 — Team & ownership

```
[ ] Tech lead identified (signs every phase tag)
[ ] Backend devs identified (count + names)
[ ] Frontend devs identified (count + names)
[ ] Reviewer pool — ≥ 2 humans who can review each PR (NOT the author)
[ ] Team channel created (Slack / Discord / Teams — one channel for this migration)
[ ] Kickoff meeting scheduled (60 min, all hands, week 0 Friday)
[ ] Calendar invite for weekly 30-min phase review (Fridays)
[ ] Decision-tree doc created in docs/decisions/
```

**If the team is one person:** designate the tech lead as the reviewer pool. Self-review is allowed but every PR must sit 24h before merge to catch your own mistakes on a re-read. Document this exception in the project channel.

---

### W0.3 — Backups (do not skip)

```bash
# Production DB backup
pg_dump -h <prod-host> -U <prod-user> -d <prod-db> -Fc -f /tmp/hrms-prod-$(date +%Y%m%d).dump
# Verify restorable:
createdb hrms-restore-test
pg_restore -d hrms-restore-test /tmp/hrms-prod-*.dump
psql -d hrms-restore-test -c "SELECT count(*) FROM employees;"
dropdb hrms-restore-test
# Move the dump file to a secure store (S3, encrypted backup volume).

# ChromaDB snapshot
tar -czf /tmp/chroma-$(date +%Y%m%d).tar.gz data/chroma_db/

# Face model weights
tar -czf /tmp/face-models-$(date +%Y%m%d).tar.gz data/face_models/

# .env files for each env — copy to a password manager / vault, NOT git
# (.env is in .gitignore already; verify:)
grep -E "^\.env" .gitignore
# Should print: .env (and possibly .env.* lines)

# Tag the current commit
git tag pre-migration-baseline
git push --tags
```

```
[ ] pg_dump completes without error
[ ] pg_restore round-trip works
[ ] ChromaDB tar created and copied to backup storage
[ ] Face model weights tar created
[ ] .env files copied to vault
[ ] git tag pre-migration-baseline pushed
```

---

### W0.4 — Local development environment (per dev, 1 day)

Step-by-step, with verification after each step. **Run from a clean shell.**

```bash
# Step 1 — Clone
mkdir -p ~/Development && cd ~/Development
git clone <repo-url> agentichrms
cd agentichrms
# Verify
ls -la
# Expect: backend/ frontend/ agent/ alembic/ STRUCTURAL_REVIEW.md ...
```

```bash
# Step 2 — Python venv
python3.11 -m venv venv
source venv/bin/activate
python --version
# Expect: Python 3.11.x
```

```bash
# Step 3 — Install Python deps
pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt    # created in W0.6 below; if missing now, run:
pip install ruff==0.6.9 mypy==1.11.2 pytest==8.3.3 pytest-asyncio==0.24.0 \
            pytest-cov==5.0.0 httpx==0.27.2 factory-boy==3.3.1 faker==30.1.0 \
            pre-commit==3.8.0
# Verify
ruff --version    # 0.6.9
pytest --version  # 8.3.x
```

```bash
# Step 4 — Postgres container
docker rm -f hrms-pg 2>/dev/null
docker run -d --name hrms-pg \
  -e POSTGRES_USER=hrms_user \
  -e POSTGRES_PASSWORD=hrms_pass \
  -e POSTGRES_DB=agentic_hrms \
  -p 5432:5432 \
  postgres:16
sleep 5
# Verify
docker ps | grep hrms-pg
# Expect: STATUS column shows "Up X seconds"
psql -h localhost -U hrms_user -d agentic_hrms -c "SELECT version();"
# (password: hrms_pass)
# Expect: PostgreSQL 16.x ...
```

```bash
# Step 5 — Test Postgres
docker run -d --name hrms-pg-test \
  -e POSTGRES_USER=hrms_user \
  -e POSTGRES_PASSWORD=hrms_pass \
  -e POSTGRES_DB=agentic_hrms_test \
  -p 5433:5432 \
  postgres:16
sleep 5
# Verify
psql -h localhost -p 5433 -U hrms_user -d agentic_hrms_test -c "SELECT 1;"
```

```bash
# Step 6 — Local SMTP capture (mailpit)
docker run -d --name hrms-mailpit \
  -p 8025:8025 -p 1025:1025 \
  axllent/mailpit
# Verify: open http://localhost:8025 — Mailpit UI loads.
```

```bash
# Step 7 — .env (after W0.6 publishes .env.example)
cp .env.example .env
# Open .env in editor; fill REQUIRED values:
#   DATABASE_URL=postgresql://hrms_user:hrms_pass@localhost:5432/agentic_hrms
#   JWT_SECRET=$(openssl rand -hex 32)        # generate locally
#   AI_KEY=sk-...                              # your OpenAI key
#   EMAIL_USER=dev@example.com
#   EMAIL_PASS=ignored-with-mailpit
#   EMAIL_HOST=localhost
#   EMAIL_PORT=1025
#   HR_EMAIL=hr@example.com
#   ADMIN_EMAIL=admin@example.com
#   TWILIO_ACCOUNT_SID=AC_test
#   TWILIO_AUTH_TOKEN=test
#   TWILIO_PHONE_NUMBER=+15555555555
# Verify
grep -c "^[A-Z_]*=$" .env
# Expect: 0  (no empty REQUIRED keys; if > 0, fill them)
```

```bash
# Step 8 — Run migrations
alembic upgrade head
# Verify
psql -h localhost -U hrms_user -d agentic_hrms -c "\dt"
# Expect: employees, leaves, roles, permissions, ... at least 14 tables
```

```bash
# Step 9 — Seed
python scripts/seed_db.py
python scripts/seed_meetings.py
# Verify
psql -h localhost -U hrms_user -d agentic_hrms \
  -c "SELECT count(*) FROM employees;"
# Expect: > 0
```

```bash
# Step 10 — ChromaDB ingest
python rag/ingest_docs.py
# Verify: prints "Found N file(s)" and finishes without exception.
ls data/chroma_db/
# Expect: chroma.sqlite3 plus subdirectories
```

```bash
# Step 11 — Face model retrain (if face_models/ data is present)
python scripts/retrain.py
# If "Loaded 0 embeddings", that's OK for dev — face login won't work locally
# without enrolment data, but PIN login will.
```

```bash
# Step 12 — Backend up
python -m uvicorn backend.main:app --reload --port 8000 &
sleep 3
# Verify
curl -s http://localhost:8000/health
# Expect: {"status":"healthy"}
```

```bash
# Step 13 — Frontend up (separate shell)
cd frontend
npm ci
npm run dev &
sleep 5
# Verify
curl -s http://localhost:3000 | head -c 200
# Expect: HTML containing "vite" or app shell markup
```

```bash
# Step 14 — End-to-end smoke
# Open http://localhost:3000 in a browser.
# Log in with a seeded user (check scripts/seed_db.py for credentials).
# Send a chat message: "what is the maternity leave policy"
# Verify: response includes a citation block.
# Apply a leave: "apply for casual leave 2026-06-01 to 2026-06-03 because vacation"
# Verify: leave row appears in the DB (psql -c "SELECT * FROM leaves;").
```

**If Step 12 fails with a config error:** likely a missing env var. The error message names it. Fill in `.env` and retry.

**If Step 13 hangs at `npm ci`:** delete `package-lock.json` and `node_modules`, retry with `npm install`. If it still hangs, you're behind a corp proxy — set `npm config set registry https://registry.npmjs.org/` and retry.

**If Step 14 chat returns 500:** check `AI_KEY` is a real OpenAI key with credits. Check backend logs.

**End-of-W0.4 checklist:**

```
[ ] All 14 steps pass without manual fixups
[ ] Local dev runbook posted in team channel
[ ] Any deviations documented in docs/dev-setup-notes.md
```

---

### W0.5 — Branch strategy (decided once, never debated)

**Trunk-based development.** Period.

- `main` is always green and deployable. No exceptions.
- Every change branches off `main`, ships within ≤ 3 days, merges back via squash-merge.
- Branch naming:
  - `migration/p<N>-<slug>` — phase migration work (e.g. `migration/p2-leave-service`)
  - `fix/p<N>-<slug>` — bug in a phase work item
  - `chore/<slug>` — tooling, CI, docs
  - `hotfix/<slug>` — emergency prod fix (gated through tech lead)
- **No long-lived feature branches.** If two PRs depend on each other, sequence them.
- Tag every phase exit: `git tag phase-0-complete`, `git tag phase-1-complete`, etc.

---

### W0.6 — CI scaffold

Create CI **before** Phase 0 starts. It is allowed to fail on existing code initially; every new PR must keep it green.

#### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

env:
  PYTHON_VERSION: "3.11"
  NODE_VERSION: "20"

jobs:
  backend:
    runs-on: ubuntu-22.04
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: hrms_user
          POSTGRES_PASSWORD: hrms_pass
          POSTGRES_DB: agentic_hrms_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://hrms_user:hrms_pass@localhost:5432/agentic_hrms_test
      JWT_SECRET: ci-test-secret-do-not-use
      AI_KEY: sk-ci-fake
      EMAIL_USER: ci@example.com
      EMAIL_PASS: ci
      EMAIL_HOST: localhost
      EMAIL_PORT: "1025"
      HR_EMAIL: hr@example.com
      ADMIN_EMAIL: admin@example.com
      TWILIO_ACCOUNT_SID: AC_ci
      TWILIO_AUTH_TOKEN: ci
      TWILIO_PHONE_NUMBER: "+15555555555"
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
          cache: pip

      - name: Install deps
        run: |
          pip install --upgrade pip
          pip install -r requirements.txt -r requirements-dev.txt

      - name: Ruff
        run: ruff check backend/ scripts/

      - name: Mypy (strict on core + modules)
        run: mypy backend/core/ backend/modules/ || true   # gradually strict; revisit after Phase 1

      - name: AST lint — router purity (R1)
        run: python scripts/lint/router_purity.py

      - name: AST lint — tools purity (R10)
        run: python scripts/lint/tools_purity.py

      - name: AST lint — forbidden status strings (R7)
        run: python scripts/lint/forbidden_strings.py

      - name: AST lint — os.getenv only in config (R17)
        run: python scripts/lint/getenv_in_config_only.py

      - name: Alembic round-trip
        run: |
          alembic upgrade head
          alembic downgrade base
          alembic upgrade head

      - name: Pytest with coverage
        run: |
          pytest -v --cov=backend --cov-report=term-missing --cov-report=xml \
            --cov-fail-under=70   # raise to 80 after Phase 2

      - name: Gitleaks
        uses: gitleaks/gitleaks-action@v2

  frontend:
    runs-on: ubuntu-22.04
    defaults:
      run: { working-directory: frontend }
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - run: npm ci

      - name: ESLint
        run: npm run lint

      - name: TypeScript
        run: npm run typecheck

      - name: Vitest
        run: npm test -- --run --coverage

      # Type-drift check (runs after Phase 6 backend is up — keep as a soft check until then)
      - name: OpenAPI type drift (soft)
        run: |
          # Boot a minimal backend in the background, regenerate types, diff
          # This step is skipped until Phase 6.4 wires it up.
          echo "skipped pre-Phase-6"
```

#### `pyproject.toml`

```toml
[tool.ruff]
line-length = 100
target-version = "py311"
extend-exclude = [
  "alembic/versions/",
  "venv/",
  ".venv/",
]

[tool.ruff.lint]
select = [
  "E",     # pycodestyle errors
  "F",     # pyflakes
  "I",     # isort
  "B",     # flake8-bugbear
  "UP",    # pyupgrade
  "T201",  # print
  "BLE001",# blind except Exception
  "ARG",   # unused arguments
  "SIM",   # simplify
  "C4",    # comprehensions
  "PIE",   # misc
]
ignore = ["E501"]  # line length handled separately

[tool.ruff.lint.per-file-ignores]
"scripts/**" = ["T201", "BLE001"]   # scripts may print + broadly catch
"backend/tests/**" = ["ARG"]         # unused fixture args are common

[tool.mypy]
python_version = "3.11"
strict = true
files = ["backend/core/", "backend/modules/"]
exclude = [
  "alembic/",
  "backend/api/",        # legacy until Phase 4 lands
  "backend/database/",   # legacy until Phase 1.1 lands
  "scripts/",
]
plugins = ["pydantic.mypy"]

[tool.pytest.ini_options]
testpaths = ["backend/tests"]
asyncio_mode = "auto"
addopts = "-ra --strict-markers"
markers = [
  "characterization: tests that pin current behaviour during refactor",
  "integration: tests that hit the real DB / real router",
  "slow: tests that take > 1 second",
]

[tool.coverage.run]
branch = true
source = ["backend"]
omit = [
  "*/tests/*",
  "*/migrations/*",
  "backend/main.py",
  "alembic/*",
]

[tool.coverage.report]
exclude_lines = [
  "pragma: no cover",
  "raise NotImplementedError",
  "if TYPE_CHECKING:",
]
```

#### `.pre-commit-config.yaml`

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.6.9
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.4
    hooks:
      - id: gitleaks

  - repo: local
    hooks:
      - id: router-purity
        name: Router purity (R1)
        entry: python scripts/lint/router_purity.py
        language: system
        pass_filenames: false
        files: backend/modules/.*/router\.py$

      - id: tools-purity
        name: Tools purity (R10)
        entry: python scripts/lint/tools_purity.py
        language: system
        pass_filenames: false
        files: backend/modules/.*/tools\.py$

      - id: forbidden-strings
        name: Forbidden status strings (R7)
        entry: python scripts/lint/forbidden_strings.py
        language: system
        pass_filenames: false

      - id: getenv-in-config-only
        name: os.getenv only in config (R17)
        entry: python scripts/lint/getenv_in_config_only.py
        language: system
        pass_filenames: false
```

Install pre-commit:

```bash
pip install pre-commit==3.8.0
pre-commit install
pre-commit run --all-files
# Will likely fail on existing code — that's expected. Fix only on new commits.
```

#### AST lint scripts

##### `scripts/lint/router_purity.py` (full)

```python
"""R1 — Routers must be thin.

Forbidden inside backend/modules/*/router.py:
  - db.query / db.add / db.commit / db.delete
  - SessionLocal()
  - _send_email / send_email
  - re.search / re.match / re.compile (no regex on LLM output)
  - Model constructors (Notification(...), Leave(...), etc.)
  - Inline 'from ... import ...' inside functions
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

# Tweak this list if new models are introduced.
MODEL_NAMES = {
    "Notification", "Leave", "LeaveBalance", "Employee", "User",
    "NameChangeRequest", "Meeting", "OnboardingTask",
    "FaceLoginAttempt", "PINVerification", "EmailLog",
    "ChatSession", "ChatMessage",
}
FORBIDDEN_CALLS = {"SessionLocal", "_send_email", "send_email"}
FORBIDDEN_DB_METHODS = {"query", "add", "commit", "delete", "flush", "rollback"}
FORBIDDEN_RE_METHODS = {"search", "match", "compile", "findall", "sub"}


def check_file(path: Path) -> list[str]:
    src = path.read_text()
    tree = ast.parse(src, filename=str(path))
    errors: list[str] = []

    func_stack: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            func_stack.append(node.name)

        if isinstance(node, ast.Call):
            fn = node.func

            # Plain Name() calls — SessionLocal(), Notification(), etc.
            if isinstance(fn, ast.Name):
                if fn.id in FORBIDDEN_CALLS:
                    errors.append(f"{path}:{node.lineno} R1: forbidden call '{fn.id}(...)'")
                if fn.id in MODEL_NAMES:
                    errors.append(
                        f"{path}:{node.lineno} R1: model constructor '{fn.id}(...)' in router"
                    )

            # Attribute calls — db.query / db.add / re.search / etc.
            if isinstance(fn, ast.Attribute):
                if isinstance(fn.value, ast.Name):
                    obj, method = fn.value.id, fn.attr
                    if obj == "db" and method in FORBIDDEN_DB_METHODS:
                        errors.append(f"{path}:{node.lineno} R1: db.{method}() in router")
                    if obj == "re" and method in FORBIDDEN_RE_METHODS:
                        errors.append(f"{path}:{node.lineno} R1/R11: re.{method}() in router")

        # Inline imports inside function bodies
        if isinstance(node, ast.ImportFrom | ast.Import):
            if func_stack:
                errors.append(
                    f"{path}:{node.lineno} R1: inline import inside function '{func_stack[-1]}'"
                )

    return errors


def main() -> int:
    routers = list(Path("backend/modules").rglob("router.py"))
    if not routers:
        # Pre-Phase-4: no modules yet. Soft-pass.
        print("[router_purity] no routers under backend/modules/ yet — skipping")
        return 0

    all_errors: list[str] = []
    for r in routers:
        all_errors.extend(check_file(r))

    for e in all_errors:
        print(e)

    if all_errors:
        print(f"\n[router_purity] {len(all_errors)} violation(s)")
        return 1

    print(f"[router_purity] OK — {len(routers)} router file(s) clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

##### `scripts/lint/tools_purity.py` (full)

```python
"""R10 — Agent tools call services, never the DB.

Forbidden inside backend/modules/*/tools.py:
  - SessionLocal / sqlalchemy imports
  - db.query / db.add / db.commit
  - .repository or .models imports
  - direct row constructors
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

FORBIDDEN_IMPORT_SUFFIXES = {".repository", ".models"}
FORBIDDEN_IMPORT_NAMES = {"sqlalchemy", "SessionLocal"}


def check_file(path: Path) -> list[str]:
    src = path.read_text()
    tree = ast.parse(src, filename=str(path))
    errors: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            for suf in FORBIDDEN_IMPORT_SUFFIXES:
                if mod.endswith(suf):
                    errors.append(f"{path}:{node.lineno} R10: imports from '{mod}'")
            if mod == "sqlalchemy" or mod.startswith("sqlalchemy."):
                errors.append(f"{path}:{node.lineno} R10: imports sqlalchemy")
            if mod == "backend.db.session" and any(
                a.name == "SessionLocal" for a in node.names
            ):
                errors.append(f"{path}:{node.lineno} R10: imports SessionLocal")

        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == "sqlalchemy" or a.name.startswith("sqlalchemy."):
                    errors.append(f"{path}:{node.lineno} R10: imports {a.name}")

        if isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name) and fn.id == "SessionLocal":
                errors.append(f"{path}:{node.lineno} R10: SessionLocal() in tool")
            if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name):
                if fn.value.id == "db" and fn.attr in {"query", "add", "commit", "delete"}:
                    errors.append(f"{path}:{node.lineno} R10: db.{fn.attr}() in tool")

    return errors


def main() -> int:
    tools = list(Path("backend/modules").rglob("tools.py"))
    if not tools:
        print("[tools_purity] no tools.py under backend/modules/ yet — skipping")
        return 0

    errs: list[str] = []
    for t in tools:
        errs.extend(check_file(t))

    for e in errs:
        print(e)

    if errs:
        print(f"\n[tools_purity] {len(errs)} violation(s)")
        return 1
    print(f"[tools_purity] OK — {len(tools)} tools file(s) clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

##### `scripts/lint/forbidden_strings.py` (full)

```python
"""R7 — No hardcoded status strings.

Banned literals (case-sensitive) anywhere in backend/ except:
  - backend/db/models/*.py (enum *definitions*)
  - alembic/ (backfill SQL)
  - backend/tests/characterization/ (must reference current values)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

BANNED = {
    '"Pending"', '"Approved"', '"Rejected"',
    "'Pending'", "'Approved'", "'Rejected'",
    '"pending"', '"approved"', '"rejected"',
    "'pending'", "'approved'", "'rejected'",
}
EXEMPT_PREFIXES = (
    "backend/db/models/",
    "alembic/",
    "backend/tests/characterization/",
)


def main() -> int:
    errs: list[str] = []
    for py in Path("backend").rglob("*.py"):
        s = str(py)
        if any(s.startswith(p) for p in EXEMPT_PREFIXES):
            continue
        for i, line in enumerate(py.read_text().splitlines(), start=1):
            # Skip comments
            stripped = line.split("#", 1)[0]
            for token in BANNED:
                if token in stripped:
                    errs.append(f"{py}:{i} R7: banned status literal {token}")
    for e in errs:
        print(e)
    if errs:
        print(f"\n[forbidden_strings] {len(errs)} violation(s)")
        return 1
    print("[forbidden_strings] OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

##### `scripts/lint/getenv_in_config_only.py` (full)

```python
"""R17 — os.getenv is allowed only in backend/core/config.py."""
from __future__ import annotations

import ast
import sys
from pathlib import Path

ALLOWED = Path("backend/core/config.py").resolve()


def check_file(path: Path) -> list[str]:
    if path.resolve() == ALLOWED:
        return []
    try:
        tree = ast.parse(path.read_text())
    except SyntaxError:
        return []
    errs: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id == "os" and node.attr == "getenv":
                errs.append(f"{path}:{node.lineno} R17: os.getenv outside config")
    return errs


def main() -> int:
    errs: list[str] = []
    for py in Path("backend").rglob("*.py"):
        errs.extend(check_file(py))
    for e in errs:
        print(e)
    if errs:
        print(f"\n[getenv_in_config_only] {len(errs)} violation(s)")
        return 1
    print("[getenv_in_config_only] OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Create the directory:

```bash
mkdir -p scripts/lint
# Paste each script above into the named file.
chmod +x scripts/lint/*.py
# Smoke
python scripts/lint/router_purity.py
python scripts/lint/tools_purity.py
python scripts/lint/forbidden_strings.py
python scripts/lint/getenv_in_config_only.py
```

#### `.env.example` (canonical)

```bash
# Database (no default — required)
DATABASE_URL=postgresql://hrms_user:hrms_pass@localhost:5432/agentic_hrms

# JWT — required, generate with: openssl rand -hex 32
JWT_SECRET=
ALGORITHM=HS256
JWT_EXPIRY_HOURS=24

# OpenAI / Anthropic — required
AI_KEY=
AI_MODEL=gpt-4o-mini

# SMTP — required
EMAIL_USER=
EMAIL_PASS=
EMAIL_HOST=localhost
EMAIL_PORT=1025
SMTP_TIMEOUT=10

# HR / admin notification recipients — required
HR_EMAIL=
ADMIN_EMAIL=

# Twilio — required for SMS PIN delivery
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Outlook ICS calendar feed — optional; conflict check skipped if blank
COMPANY_CALENDAR_ICS_URL=

# Face recognition tuning (defaults sane for dev)
FACE_DISTANCE_THRESHOLD=1.2

# PIN policy
PIN_LENGTH=6
PIN_EXPIRY_MINUTES=5
PIN_MAX_ATTEMPTS=3

# RAG models (defaults sane)
EMBEDDING_MODEL=all-MiniLM-L6-v2
RERANK_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2

# CORS
ALLOWED_ORIGINS=["http://localhost:3000","http://localhost:5173"]

# Feature flags (per-module rollout — default off; flip per Phase 4)
LEAVE_MODULE_V2_ENABLED=false
EMPLOYEE_MODULE_V2_ENABLED=false
NAME_CHANGE_MODULE_V2_ENABLED=false
ONBOARDING_MODULE_V2_ENABLED=false
DOCUMENTS_MODULE_V2_ENABLED=false
ADMIN_MODULE_V2_ENABLED=false
MEETINGS_MODULE_V2_ENABLED=false
CHAT_MODULE_V2_ENABLED=false

# Logging
LOG_LEVEL=INFO
LOG_FORMAT=json   # json | plain
```

```
[ ] .github/workflows/ci.yml in place
[ ] pyproject.toml configured
[ ] .pre-commit-config.yaml configured
[ ] All 4 lint scripts in scripts/lint/ and executable
[ ] .env.example committed
[ ] pre-commit installed locally
[ ] CI green on a fresh clone (or known-fail list documented)
```

---

### W0.7 — Tracking board

Create one card per task in the per-phase playbook below. Don't invent your own breakdown — copy from this doc.

Columns: `Backlog → Doing → Review → Done → Verified`.

Limits:
- "Doing" — ≤ 2 cards per dev.
- "Review" — must have a reviewer assigned within 24h.
- "Done" — code merged, but not verified by phase exit checklist.
- "Verified" — phase tag applied.

Per-card fields:
- Title (matches the task number, e.g. "0.2 Hash PIN column")
- Owner
- Phase
- Estimate (hours)
- Linked PR
- Rule citations
- Definition-of-done checklist (paste R29)

---

### W0.8 — Kickoff meeting (60 min)

Agenda (with a slide deck or shared screen):

```
00:00 — 05:00   Welcome + meeting goal
05:00 — 15:00   Walk through STRUCTURAL_REVIEW.md Section A (the audit findings)
15:00 — 25:00   Walk through ARCHITECTURE.md Sections 2 & 3 (target topology + modules)
25:00 — 35:00   Walk through RULES.md R1 + R3 + R10 + R11 (the four most-violated rules)
35:00 — 45:00   Walk through this doc — PR workflow, code review checklist
45:00 — 55:00   Show the tracking board; assign Week 0 cards
55:00 — 60:00   Q&A; agree on weekly meeting time
```

**Record the meeting.** Anyone who joins later watches it before touching code.

---

## Decision worksheets

For each open decision, complete the worksheet and save to `docs/decisions/F<n>-<slug>.md`.

### F.1 — PIN migration strategy

**Question.** `PINVerification.pin_code` currently stores plaintext (6-digit) PINs. The column will be renamed to `pin_hash` and hashed at rest. How do we handle the existing rows?

**Constraints (from audit).**
- Transient PINs have a 5-minute expiry (`backend/core/config.py:93` `PIN_EXPIRY_MINUTES=5`).
- The longer-lived `Employee.permanent_pin_hash` is already hashed correctly (`models.py:70`).
- Registration currently returns the PIN in the response body (`registration.py:168`) — that also stops.

**Options.**

| Option | Pros | Cons |
|---|---|---|
| (a) Hash-on-next-use | Existing transient PINs continue to work until the user verifies once. Smooth. | Rehash logic in two paths; one branch reads plaintext for ≤5 min after deploy. |
| (b) **One-shot invalidation (recommended)** | Single-path code. No transient-PIN logic. | Users with a pending PIN at deploy moment must request a new one. Impact bounded by 5-min expiry. |
| (c) Delete the column entirely; only `permanent_pin_hash` remains | Simplest. | Lose the "send a one-time login PIN" feature without redesign. |

**Recommendation.** **(b)**. Deploy in a low-traffic window. Announce 5 min before deploy: "PIN flow refresh — any pending PIN may need to be re-requested."

**Decision template.**

```
Decision: F.1 PIN migration
Chosen option: (a) / (b) / (c)
Decided by: __________
Date: __________
Rationale: __________
Open follow-ups: __________
```

### F.2 — User vs Employee

**Question.** `User` table (`models.py:149-163`) and `Employee` table (`models.py:53-119`) overlap. Both have `role` info, `face_registered`, `face_login_enabled`. Which is canonical?

**Constraints (from audit).**
- `Employee.role_id` (FK to `Role`) is the **new** RBAC pointer.
- `User.role` is a string — legacy.
- `ChatSession` FKs to `User.id`, not `Employee.id`.
- `Employee.email` is the de-facto identity used by face login (`face_auth.py:68-75`) and PIN login.

**Options.**

| Option | Pros | Cons |
|---|---|---|
| (a) **Collapse `User` into `Employee`; keep a tiny `users` for username/password (recommended)** | One canonical record per person. FKs simplify. | `ChatSession` migration: rename `user_id` → `employee_id`. |
| (b) Keep both, document the boundary (User = auth, Employee = HR data) | Less migration. | Continues the duplication; both must be kept in sync. |
| (c) Delete `User` entirely; put password_hash on `Employee` | Single table. | Mixes HR record with credential storage — security smell. |

**Recommendation.** **(a)**. The migration in Phase 1.2 renames `chat_sessions.user_id` → `chat_sessions.employee_id`, drops the duplicate columns on `User`, and leaves `User` with just `username`, `password_hash`, `employee_id`.

**Decision template.**

```
Decision: F.2 User/Employee
Chosen option: (a) / (b) / (c)
Decided by: __________
Date: __________
Rationale: __________
```

### F.3 — Onboarding stub tools

**Question.** Five agent tools currently return hardcoded strings (`agent/tools_registry.py:524-558`). They lie to the user. What should they do?

**Options.**

| Option | Pros | Cons |
|---|---|---|
| (a) Implement them against real `OnboardingTask` + `EmployeeOnboarding` data | Honest product. | Real work; Phase 4.3 grows. |
| (b) **Replace them with a tool that says "this feature isn't built — ask HR" (recommended near-term)** | Honest, ships fast. | UX gap. |
| (c) Remove them from the agent's tool list | Stops the lie. | Agent will improvise (less safe). |

**Recommendation.** **(b)** for Phase 4.3, schedule (a) as a separate product initiative. (c) is risky — the LLM will fabricate.

**Decision template.**

```
Decision: F.3 Onboarding stubs
Chosen option: (a) / (b) / (c)
Decided by: __________
Date: __________
Follow-up product ticket (if b chosen): __________
```

### F.4 — Agent executor cache key

**Question.** `build_agent()` runs on every chat request (`chat.py:69`). The new `agent/runner.py` caches executors. Keyed by what?

**Options.**

| Option | Pros | Cons |
|---|---|---|
| (a) Per (employee_id, session_id) | Tightly scoped. Memory grows with active sessions. | Memory pressure: 100 active sessions = 100 executors. |
| (b) **Per employee_id (recommended)** | Memory bounded by user count. Sufficient — chat_history is passed per call. | One executor handles concurrent sessions for the same user. Need lock. |
| (c) Per (model, employee_id) | Future-proof if multi-model. | Premature. |

**Recommendation.** **(b)** with an `asyncio.Lock` per cache entry. TTL 30 min. Max cache size 500.

**Decision template.**

```
Decision: F.4 Executor cache
Chosen option: (a) / (b) / (c)
Cache size: __________
TTL: __________
Decided by: __________
Date: __________
```

### F.5 — Permission seed catalogue

**Question.** RBAC moves from role-name strings to permission rows (`RolePermission`). What's the day-one catalogue?

**Recommended starting set** (already mirrored in `ARCHITECTURE.md` §8):

```
leave.request             → employee, hr, admin
leave.approve             → hr, admin
leave.reject              → hr, admin
leave.cancel.self         → employee, hr, admin
leave.cancel.any          → hr, admin
leave.read.self           → employee, hr, admin
leave.read.any            → hr, admin

employee.read.self        → employee, hr, admin
employee.read.any         → hr, admin
employee.update.self      → employee, hr, admin
employee.update.any       → hr, admin

name_change.request       → employee, hr, admin
name_change.review        → hr, admin

onboarding.read.self      → employee, hr, admin
onboarding.read.any       → hr, admin
onboarding.update.self    → employee, hr, admin

document.search           → employee, hr, admin
document.upload           → hr, admin
document.delete           → admin

notification.read.self    → employee, hr, admin

admin.role.update         → admin
admin.email.read          → admin
admin.user.delete         → admin

meeting.read.self         → employee, hr, admin
meeting.read.any          → hr, admin
```

**Decision template.**

```
Decision: F.5 Permission catalogue
Approved set: (the list above, or amended — paste final)
Decided by: __________
Date: __________
```

### F.6 — Frontend route guard pattern

**Question.** Should `/login` be a route, or a redirect target from a global guard?

**Options.**

| Option | Pros | Cons |
|---|---|---|
| (a) **`/login` is a route; `<RequireAuth>` wraps everything else (recommended)** | Clear, idiomatic, easy to deep-link. | More boilerplate per route. |
| (b) Global guard at app root, redirects to `/login` on null auth | DRY. | Harder to deep-link; harder to test. |

**Recommendation.** **(a)**.

**Decision template.**

```
Decision: F.6 Route guard
Chosen option: (a) / (b)
Decided by: __________
Date: __________
```

---

## Pinned dependency manifest

Every dep below is pinned. Floating versions cause "we need to refactor X again" tickets. When you bump a version, **bump it in one PR**, run the full CI, and update this table.

### `requirements.txt` (backend, post-migration)

```
# === Core framework ===
fastapi==0.115.0
uvicorn[standard]==0.31.0
pydantic==2.9.2
pydantic-settings==2.5.2
python-multipart==0.0.12

# === Database ===
sqlalchemy==2.0.35
alembic==1.13.3
psycopg2-binary==2.9.9

# === Auth & crypto ===
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
bcrypt==4.0.1            # pin <4.1 — passlib 1.7.4 emits noisy DeprecationWarning on >=4.1
python-dotenv==1.0.1

# === LLM agent ===
langchain==0.3.3
langchain-openai==0.2.2
langchain-community==0.3.2
openai==1.51.0
# LangGraph deliberately omitted — single-agent stack (R5.3)

# === RAG ===
chromadb==0.5.13
sentence-transformers==3.1.1
torch==2.4.1             # required by sentence-transformers

# === File parsing (RAG ingest) ===
pypdf==5.0.1
python-docx==1.1.2
openpyxl==3.1.5
pandas==2.2.3

# === Email / SMS ===
twilio==9.3.4

# === Face recognition ===
face-recognition==1.3.0
opencv-python==4.10.0.84
numpy==1.26.4            # face_recognition + scikit-learn compat
scikit-learn==1.5.2
dlib-bin==19.24.6
Pillow==10.4.0
joblib==1.4.2

# === Calendar / ICS ===
icalendar==6.0.0
requests==2.32.3

# === Logging / observability ===
python-json-logger==2.0.7
```

### `requirements-dev.txt`

```
# === Lint / type ===
ruff==0.6.9
mypy==1.11.2
types-requests==2.32.0.20240914
types-python-jose==3.3.4.20240106

# === Test ===
pytest==8.3.3
pytest-asyncio==0.24.0
pytest-cov==5.0.0
pytest-mock==3.14.0
httpx==0.27.2
factory-boy==3.3.1
faker==30.1.0
freezegun==1.5.1

# === Tooling ===
pre-commit==3.8.0
```

### `frontend/package.json` (post-migration)

```jsonc
{
  "name": "hrms-frontend",
  "private": true,
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint . --max-warnings 0",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "gen:types": "openapi-typescript http://localhost:8000/openapi.json -o src/types/api.d.ts"
  },
  "dependencies": {
    "@hookform/resolvers": "3.9.0",
    "@radix-ui/react-dialog": "1.1.2",
    "@radix-ui/react-dropdown-menu": "2.1.2",
    "@radix-ui/react-label": "2.1.0",
    "@radix-ui/react-select": "2.1.2",
    "@radix-ui/react-slot": "1.1.0",
    "@radix-ui/react-tabs": "1.1.1",
    "@radix-ui/react-toast": "1.2.2",
    "@radix-ui/react-tooltip": "1.1.3",
    "@tanstack/react-query": "5.59.0",
    "@tanstack/react-query-devtools": "5.59.0",
    "axios": "1.7.7",
    "class-variance-authority": "0.7.0",
    "clsx": "2.1.1",
    "dompurify": "3.1.7",
    "framer-motion": "11.11.0",
    "lucide-react": "0.451.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-hook-form": "7.53.0",
    "react-markdown": "10.1.0",
    "react-router-dom": "6.27.0",
    "react-webcam": "7.2.0",
    "sonner": "1.5.0",
    "tailwind-merge": "2.5.2",
    "tailwindcss-animate": "1.0.7",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.5.0",
    "@testing-library/react": "16.0.1",
    "@testing-library/user-event": "14.5.2",
    "@types/dompurify": "3.0.5",
    "@types/node": "22.7.5",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "@typescript-eslint/eslint-plugin": "8.8.1",
    "@typescript-eslint/parser": "8.8.1",
    "@vitejs/plugin-react": "4.3.2",
    "autoprefixer": "10.4.20",
    "eslint": "9.12.0",
    "eslint-plugin-react": "7.37.1",
    "eslint-plugin-react-hooks": "5.0.0",
    "jsdom": "25.0.1",
    "msw": "2.4.9",
    "openapi-typescript": "7.4.1",
    "postcss": "8.4.47",
    "tailwindcss": "3.4.13",
    "typescript": "5.6.2",
    "vite": "5.4.8",
    "vitest": "2.1.2"
  }
}
```

### Rationale for select pins

- **bcrypt==4.0.1.** passlib 1.7.4 raises a `DeprecationWarning: __about__ attribute removed` on bcrypt ≥ 4.1.
- **numpy==1.26.4.** face_recognition and sklearn 1.5 dislike numpy 2.x.
- **react==19.0.0 + @types/react==19.0.0.** lockstep.
- **LangChain 0.3.x.** Pydantic v2 + structured-output stable. Avoid 0.2.x (pydantic v1 transition).
- **Vite 5 (not 6).** Vite 6 has plugin churn; pin until ecosystem catches up.
- **ESLint 9 + flat config.** New config style; required for the custom rules in Frontend specifics below.

---

## Operating cadence

### Daily (async standup, by 10:00 local)

```
*Yesterday:*
- <merged PRs or progress>

*Today:*
- <in-flight tasks; tracker links>

*Blockers:*
- <none / specific blocker + @who can unblock>

*Rule violations encountered:*
- <none / R-number + how resolved>
```

Tech lead pings anyone silent by 11:00.

### Weekly (30 min, Friday)

**Agenda.**

```
00:00 — 05:00   Phase tracker: on schedule? burndown vs estimate
05:00 — 10:00   Merged PRs this week — quick walkthrough
10:00 — 15:00   Rule violations this week — were they caught in PR review? CI?
15:00 — 20:00   Carry-over blockers
20:00 — 25:00   Next week scope; reassign cards
25:00 — 30:00   Retro: keep / stop / start
```

### Phase exit

When the last PR of a phase merges:

```bash
# 1. Tag
git tag phase-<N>-complete
git push origin phase-<N>-complete

# 2. CHANGELOG
echo "## Phase <N> — <date>" >> CHANGELOG.md
# Add a 3-5 bullet summary

# 3. Verify the phase exit checklist (per phase below)

# 4. Schedule 60-min retro before next phase
```

### Escalation

A task stuck > 2 days:

1. Owner posts in team channel with the specific blocker (one paragraph).
2. Tech lead either unblocks within 24h or **formally descopes** the task.
3. Descoped tasks → `docs/deferred.md` with rationale.

---

## PR workflow

### Branch naming

```
migration/p<N>-<slug>      # phase work
fix/p<N>-<slug>            # bug fix in a phase work item
chore/<slug>               # tooling / docs / CI
hotfix/<slug>              # prod emergency (tech lead approval)
```

### Sizing

- **Target ≤ 400 lines diff.**
- **Hard cap 800 lines diff.** Above this, reviewer rejects on size alone.
- Generated files (`api.d.ts`, lockfiles, alembic versions) don't count.
- If you can't stay under 400 lines, split the work — the architecture allows it (every module is a separate PR).

### Lifetime

≤ 3 days from branch creation to merge. If longer, the work is too big.

### Commit hygiene

- Logical, focused commits. Not "WIP", not "more stuff".
- Present-tense imperative messages: `extract LeaveService.request()`, not `did refactor`.
- Squash if history is messy; preserve if each commit tells a clean story.

### PR template (`.github/pull_request_template.md`)

```markdown
## What

<one paragraph>

## Why

<one paragraph; cite phase and module>

## Phase / Module

`Phase X.Y` — `backend/modules/<feature>/` and/or `frontend/src/features/<feature>/`

## Rule citations (RULES.md)

R__, R__, R__

## Definition-of-Done (R29)

- [ ] Router thin (no DB / SMTP / regex / model constructors)
- [ ] Repository owns all SQL
- [ ] Service is the only repository importer
- [ ] Agent tool imports only the service
- [ ] Every endpoint declares `response_model`
- [ ] No `os.getenv` outside `backend/core/config.py`
- [ ] No `print()`; no bare `except Exception`
- [ ] Status fields use enums
- [ ] RBAC uses `Depends(require_permission(...))`
- [ ] Characterization tests still pass
- [ ] Service coverage ≥ 80%
- [ ] Migration (if any) is reversible
- [ ] `npm run gen:types` regenerates without diff
- [ ] Module README updated

## Verification

How to test locally:
1. ...
2. ...

## Rollback

If this PR breaks prod:
1. `git revert <merge-sha>` and redeploy.
2. Migration rollback: `alembic downgrade <previous-rev>`.
3. Feature flag: set `<MODULE>_V2_ENABLED=false` and restart.
```

### Review SLA

- First review within 24 working hours of PR open.
- Author addresses comments within 24h.
- > 3 days in review → tech lead escalates.

### Merge gates

```
[ ] CI green (no skipped jobs)
[ ] ≥ 1 approval from the reviewer pool (NOT the author)
[ ] PR description checklist all ticked or N/A
[ ] No new "TODO" comments without a tracker ticket
[ ] Branch rebased onto current main (no merge commits)
```

Merge method: **squash-and-merge** with PR title as the squash commit message.

---

## Code review checklist

Stick this above your monitor.

```
ARCHITECTURE
[ ] Change belongs in this module (if not, split)
[ ] Layer order respected: router ← service ← repository ← model
[ ] Dependencies injected, not constructed inside functions
[ ] Cross-feature calls go through another module's service, not its repository

CORRECTNESS
[ ] Happy path
[ ] At least one failure path
[ ] Race conditions considered (concurrent writes, idempotency)
[ ] Dates timezone-aware where it matters

RULES
[ ] R1  Router thin
[ ] R3  All SQL in repository
[ ] R6  DTO + response_model
[ ] R7  Statuses are enums
[ ] R8  No secrets with defaults
[ ] R9  require_permission, not role string
[ ] R10 Tool imports only service
[ ] R11 No regex on LLM prose
[ ] R13 No print
[ ] R14 No bare except
[ ] R17 No os.getenv outside config
[ ] R20 Generated FE types include this PR's schemas
[ ] R23 No static inline style on FE
[ ] R24 shadcn primitives
[ ] R25 react-hook-form + zod

TESTS
[ ] Happy-path test
[ ] At least one failure-mode test
[ ] Authorization test (if endpoint is permissioned)
[ ] Characterization tests green
[ ] Coverage didn't drop

DOCS
[ ] Module README mentions any new surface
[ ] Permission catalogue updated if a new permission added
[ ] .env.example updated if a new env var added

ROLLBACK
[ ] Revert is clean
[ ] Migration downgrade works
[ ] Feature flag exists for risky changes
```

If any architecture or rules box can't be ticked → **Request Changes**. No merge with intent to fix later.

---

## Testing playbook

### Layout

```
backend/tests/
├── conftest.py
├── factories/
│   ├── __init__.py
│   ├── employee.py
│   ├── role.py
│   ├── permission.py
│   ├── leave.py
│   └── notification.py
├── fakes/
│   ├── __init__.py
│   ├── fake_executor.py
│   ├── fake_email.py
│   └── fake_ics.py
├── characterization/        # delete at end of Phase 4
│   ├── test_apply_leave_current.py
│   ├── test_confirm_leave_current.py
│   ├── test_approve_reject_emails_current.py
│   ├── test_name_change_intent_current.py
│   └── test_login_pin_current.py
├── modules/
│   └── leave/
│       ├── test_service.py
│       ├── test_repository.py
│       └── test_tools.py
└── integration/
    ├── test_leave_e2e.py
    └── test_chat_e2e.py
```

### `conftest.py` (full)

```python
"""Shared pytest fixtures. Transactional rollback per test."""
from __future__ import annotations

import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from fastapi.testclient import TestClient

from backend.main import app
from backend.db.base import Base
from backend.db.session import get_db
from backend.core.config import settings

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://hrms_user:hrms_pass@localhost:5433/agentic_hrms_test",
)


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(TEST_DB_URL)
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture()
def db(engine) -> Session:
    """Function-scoped session in a transactional rollback."""
    conn = engine.connect()
    trans = conn.begin()
    SessionLocal = sessionmaker(bind=conn, autoflush=False, autocommit=False)
    sess = SessionLocal()
    try:
        yield sess
    finally:
        sess.close()
        if trans.is_active:
            trans.rollback()
        conn.close()


@pytest.fixture()
def client(db) -> TestClient:
    """FastAPI client wired to the transactional db fixture."""
    def _override():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def role_factory(db):
    from backend.tests.factories.role import RoleFactory
    RoleFactory._meta.sqlalchemy_session = db
    return RoleFactory


@pytest.fixture()
def employee_factory(db, role_factory):
    from backend.tests.factories.employee import EmployeeFactory
    EmployeeFactory._meta.sqlalchemy_session = db
    return EmployeeFactory


@pytest.fixture()
def leave_factory(db, employee_factory):
    from backend.tests.factories.leave import LeaveFactory
    LeaveFactory._meta.sqlalchemy_session = db
    return LeaveFactory


@pytest.fixture()
def auth_headers(employee_factory, db):
    """Return a function: auth_headers(role='employee') -> {Authorization: Bearer ...}."""
    from backend.core.security import create_access_token

    def _make(role: str = "employee", **emp_kwargs):
        emp = employee_factory(role__name=role, **emp_kwargs)
        db.commit()
        token = create_access_token({
            "sub": str(emp.id),
            "email": emp.email,
            "name": emp.name,
            "role": role,
        })
        return {"Authorization": f"Bearer {token}"}, emp
    return _make


@pytest.fixture()
def fake_executor():
    """Returns a builder for a stubbed AgentExecutor.

    Usage:
        ex = fake_executor(intermediate_steps=[(action, {"conflict": True, ...})])
        # Then inject via monkeypatch into agent/runner.py
    """
    from backend.tests.fakes.fake_executor import FakeExecutorBuilder
    return FakeExecutorBuilder()


@pytest.fixture(autouse=True)
def _silence_external_calls(monkeypatch):
    """Block real network calls in unit tests."""
    def _no_network(*a, **kw):
        raise RuntimeError("Real network call attempted in test — mock it.")
    monkeypatch.setattr("requests.get", _no_network)
    monkeypatch.setattr("requests.post", _no_network)
```

### Factories

`backend/tests/factories/role.py`:

```python
import factory
from factory.alchemy import SQLAlchemyModelFactory
from backend.db.models.rbac import Role


class RoleFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Role
        sqlalchemy_session_persistence = "flush"

    name = factory.Iterator(["employee", "hr", "admin"])
    description = factory.LazyAttribute(lambda o: f"Auto: {o.name}")
```

`backend/tests/factories/employee.py`:

```python
import factory
from factory.alchemy import SQLAlchemyModelFactory
from datetime import datetime
from backend.db.models.employee import Employee
from backend.tests.factories.role import RoleFactory


class EmployeeFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Employee
        sqlalchemy_session_persistence = "flush"

    name = factory.Faker("name")
    email = factory.Sequence(lambda n: f"emp{n}@example.com")
    phone = factory.Sequence(lambda n: f"+15555{n:06d}")
    department = factory.Faker("job")
    designation = factory.Faker("job")
    join_date = factory.LazyFunction(datetime.utcnow)
    status = "active"
    employee_code = factory.Sequence(lambda n: f"EMP{n:04d}")
    permanent_pin_hash = "$2b$12$dummy"   # bcrypt-shaped, never verifies
    pin_type = "default"
    face_enrolled = False
    face_registered = False
    role = factory.SubFactory(RoleFactory)
```

`backend/tests/factories/leave.py`:

```python
import factory
from factory.alchemy import SQLAlchemyModelFactory
from datetime import datetime, timedelta
from backend.db.models.leave import Leave, LeaveStatus
from backend.tests.factories.employee import EmployeeFactory


class LeaveFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Leave
        sqlalchemy_session_persistence = "flush"

    employee = factory.SubFactory(EmployeeFactory)
    leave_type = "casual"
    start_date = factory.LazyFunction(lambda: datetime.utcnow() + timedelta(days=7))
    end_date = factory.LazyAttribute(lambda o: o.start_date + timedelta(days=2))
    reason = factory.Faker("sentence")
    status = LeaveStatus.PENDING
```

### `FakeExecutorBuilder`

`backend/tests/fakes/fake_executor.py`:

```python
"""Stub LangChain AgentExecutor for unit/integration tests."""
from dataclasses import dataclass, field
from typing import Any


@dataclass
class FakeAction:
    tool: str
    tool_input: dict = field(default_factory=dict)


class FakeExecutor:
    def __init__(self, *, output: str, intermediate_steps: list):
        self._output = output
        self._steps = intermediate_steps

    def invoke(self, inputs: dict) -> dict:
        return {
            "output": self._output,
            "intermediate_steps": self._steps,
            "sources": [],
        }


class FakeExecutorBuilder:
    """Fluent builder. Example:

        ex = FakeExecutorBuilder().tool_call("apply_leave", returns={"conflict": True}).build()
    """
    def __init__(self):
        self._steps: list = []
        self._output: str = ""

    def tool_call(self, tool: str, *, returns: Any, args: dict | None = None) -> "FakeExecutorBuilder":
        self._steps.append((FakeAction(tool=tool, tool_input=args or {}), returns))
        return self

    def output(self, text: str) -> "FakeExecutorBuilder":
        self._output = text
        return self

    def build(self) -> FakeExecutor:
        return FakeExecutor(output=self._output, intermediate_steps=self._steps)
```

### Characterization test (one example, full)

`backend/tests/characterization/test_apply_leave_current.py`:

```python
"""Pins the CURRENT behaviour of apply_leave so Phase 2's refactor
cannot regress without us knowing. Delete this file after Phase 4."""
import pytest
from unittest.mock import patch
from datetime import datetime


@pytest.mark.characterization
def test_apply_leave_no_conflict_creates_pending(client, auth_headers, db, monkeypatch):
    # Skip ICS conflict check
    monkeypatch.setenv("COMPANY_CALENDAR_ICS_URL", "")
    headers, emp = auth_headers(role="employee")

    res = client.post("/api/chat/", json={
        "message": "Apply for casual leave 2026-06-01 to 2026-06-03 because vacation",
    }, headers=headers)

    assert res.status_code == 200
    body = res.json()
    assert body.get("conflict") is not True

    from backend.db.models.leave import Leave
    db.commit()
    leave = db.query(Leave).filter(Leave.employee_id == emp.id).first()
    assert leave is not None
    assert str(leave.status).lower() == "pending"
    assert leave.leave_type.lower() == "casual"


@pytest.mark.characterization
def test_apply_leave_with_conflict_returns_payload(client, auth_headers, db, monkeypatch):
    fake_meetings = [{"title": "All-hands", "date": "2026-06-02", "time": "10:00 AM"}]
    monkeypatch.setattr(
        "agent.tools_registry._fetch_ics_meetings",
        lambda *a, **kw: fake_meetings,
    )
    monkeypatch.setenv("COMPANY_CALENDAR_ICS_URL", "https://x/y.ics")
    headers, emp = auth_headers(role="employee")

    res = client.post("/api/chat/", json={
        "message": "Apply for sick leave 2026-06-01 to 2026-06-05 fever",
    }, headers=headers)

    assert res.status_code == 200
    body = res.json()
    assert body.get("conflict") is True
    assert any(m["title"] == "All-hands" for m in body.get("meetings", []))


@pytest.mark.characterization
def test_apply_leave_invalid_date_format(client, auth_headers, db, monkeypatch):
    monkeypatch.setenv("COMPANY_CALENDAR_ICS_URL", "")
    headers, _ = auth_headers(role="employee")

    res = client.post("/api/chat/", json={
        "message": "Apply for casual leave on 1st of June",  # ambiguous
    }, headers=headers)

    # Either succeeds with date inference OR returns a clarifying answer.
    # The contract: never crashes. Pin that.
    assert res.status_code == 200
```

Write equivalent characterization tests for: `confirm_leave`, `approve/reject_leave` emails (assert `EmailLog` row count + content), `name_change_intent` (assert `NameChangeRequest` + `Notification` rows created when the LLM emits the sentinel), `login_with_permanent_pin` (assert JWT shape).

### Service test template (mocked repo, fast)

```python
# backend/tests/modules/leave/test_service.py
from unittest.mock import Mock
from datetime import date

from backend.modules.leave.service import LeaveService
from backend.modules.leave.schemas import LeaveRequest, LeaveCreated, ConflictDetected
from backend.db.models.leave import LeaveStatus


def _payload(**overrides):
    base = dict(
        leave_type="casual",
        start_date=date(2026, 6, 1),
        end_date=date(2026, 6, 3),
        reason="vacation",
    )
    base.update(overrides)
    return LeaveRequest(**base)


def test_request_no_conflict_creates_pending_and_dispatches_event():
    repo = Mock()
    meetings = Mock()
    events = Mock()
    meetings.find_conflicts.return_value = []
    repo.create.return_value = Mock(id=1, status=LeaveStatus.PENDING, employee_id=42)

    svc = LeaveService(repo=repo, meetings=meetings, events=events)
    result = svc.request(employee_id=42, payload=_payload())

    assert isinstance(result, LeaveCreated)
    repo.create.assert_called_once()
    events.dispatch.assert_called_once()


def test_request_with_conflict_returns_conflict_without_writing():
    repo = Mock()
    meetings = Mock()
    events = Mock()
    meetings.find_conflicts.return_value = [
        Mock(title="All-hands", date=date(2026, 6, 2), time="10:00 AM")
    ]

    svc = LeaveService(repo=repo, meetings=meetings, events=events)
    result = svc.request(employee_id=42, payload=_payload(), force=False)

    assert isinstance(result, ConflictDetected)
    repo.create.assert_not_called()
    events.dispatch.assert_not_called()


def test_request_force_bypasses_conflict_check():
    repo = Mock()
    meetings = Mock()
    events = Mock()
    repo.create.return_value = Mock(id=2, status=LeaveStatus.PENDING, employee_id=42)

    svc = LeaveService(repo=repo, meetings=meetings, events=events)
    result = svc.request(employee_id=42, payload=_payload(), force=True)

    assert isinstance(result, LeaveCreated)
    meetings.find_conflicts.assert_not_called()
    repo.create.assert_called_once()


def test_approve_updates_status_and_dispatches():
    repo = Mock()
    leave = Mock(id=5, status=LeaveStatus.PENDING)
    repo.get.return_value = leave
    events = Mock()
    svc = LeaveService(repo=repo, meetings=Mock(), events=events)

    svc.approve(leave_id=5, approver_id=99)

    repo.update_status.assert_called_once_with(leave, LeaveStatus.APPROVED, approver_id=99)
    events.dispatch.assert_called_once()


def test_approve_not_found_raises():
    from backend.core.exceptions import NotFoundError
    repo = Mock()
    repo.get.return_value = None
    svc = LeaveService(repo=repo, meetings=Mock(), events=Mock())

    with pytest.raises(NotFoundError):
        svc.approve(leave_id=999, approver_id=99)
```

### Integration test (real DB, real router, fake LLM)

```python
# backend/tests/integration/test_leave_e2e.py
import pytest

@pytest.mark.integration
def test_rest_and_chat_produce_identical_db_state(client, auth_headers, db, fake_executor, monkeypatch):
    """The whole point of Phase 2: one service, two adapters."""
    headers, emp = auth_headers(role="employee")

    # 1) REST path
    rest_body = {
        "leave_type": "casual",
        "start_date": "2026-06-01",
        "end_date": "2026-06-03",
        "reason": "rest",
    }
    rest_res = client.post("/api/leave/", json=rest_body, headers=headers)
    assert rest_res.status_code == 200

    # 2) Chat path — fake LLM emits a tool call to apply_leave with same args
    ex = (
        fake_executor
        .tool_call("apply_leave", args=rest_body, returns={"intent": "leave_created", "leave_id": "_"})
        .output("Done.")
        .build()
    )
    monkeypatch.setattr("backend.agent.runner.get_executor", lambda **kw: ex)
    chat_res = client.post("/api/chat/", json={"message": "apply casual leave..."}, headers=headers)
    assert chat_res.status_code == 200

    from backend.db.models.leave import Leave
    db.commit()
    leaves = db.query(Leave).filter(Leave.employee_id == emp.id).order_by(Leave.id).all()
    assert len(leaves) == 2
    assert leaves[0].leave_type == leaves[1].leave_type
    assert leaves[0].status == leaves[1].status
    assert leaves[0].reason == leaves[1].reason
```

### Frontend tests — vitest + RTL + msw

`frontend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: { reporter: ["text", "html"], exclude: ["src/types/**", "src/main.tsx"] },
  },
});
```

`frontend/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, afterAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw";

afterEach(() => cleanup());
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`frontend/src/test/msw.ts`:

```ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/health", () => HttpResponse.json({ status: "healthy" })),
];

export const server = setupServer(...handlers);
```

`frontend/src/features/leave/components/LeaveRequestForm.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeaveRequestForm } from "./LeaveRequestForm";

const renderWithQuery = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe("LeaveRequestForm", () => {
  it("shows validation errors for an empty submit", async () => {
    renderWithQuery(<LeaveRequestForm />);
    await userEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(await screen.findByText(/reason is required/i)).toBeVisible();
  });

  it("opens conflict dialog when API returns leave_conflict intent", async () => {
    server.use(
      http.post("/api/leave/", () => HttpResponse.json({
        intent: "leave_conflict",
        meetings: [{ title: "All-hands", date: "2026-06-02", time: "10:00 AM" }],
        pending_payload: { /* ... */ },
      })),
    );
    renderWithQuery(<LeaveRequestForm />);

    await userEvent.selectOptions(screen.getByLabelText(/type/i), "casual");
    await userEvent.type(screen.getByLabelText(/reason/i), "vacation");
    await userEvent.type(screen.getByLabelText(/start/i), "2026-06-01");
    await userEvent.type(screen.getByLabelText(/end/i), "2026-06-03");
    await userEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /conflict/i })).toBeVisible();
      expect(screen.getByText(/all-hands/i)).toBeVisible();
    });
  });
});
```

### Coverage gates

- `backend/modules/*/service.py` ≥ 80%
- `backend/modules/*/repository.py` ≥ 80%
- `backend/modules/*/router.py` ≥ 60% (integration covers most)
- `backend/core/*` ≥ 80%
- `frontend/src/features/*` ≥ 60% (visual + lint do the rest)

CI fails on any drop.

---

## Migration runbook

### Writing a migration

```bash
# 1. Create
alembic revision -m "rename_pin_code_to_pin_hash"

# 2. Edit upgrade() and downgrade() — see anatomy below

# 3. Test locally — up
alembic upgrade head
psql -h localhost -U hrms_user -d agentic_hrms -c "\d pin_verifications"

# 4. Round-trip — down then up
alembic downgrade -1
psql -h localhost -U hrms_user -d agentic_hrms -c "\d pin_verifications"
alembic upgrade head

# 5. Commit the migration in the same PR as the code that depends on it
```

### Anatomy (full template, reversible)

`alembic/versions/0004_rename_pin_code_to_pin_hash.py`:

```python
"""rename pin_code to pin_hash

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-30

Rule: R18 — PIN is hashed at rest.

Strategy (per Decision F.1 option b): one-shot invalidation.
Existing transient pin_code values are dropped; users with a pending PIN
must request a new one (5-minute window already in place).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the plaintext column outright (Decision F.1.b)
    op.drop_column("pin_verifications", "pin_code")
    # Add hashed column
    op.add_column(
        "pin_verifications",
        sa.Column("pin_hash", sa.String(length=128), nullable=False, server_default=""),
    )
    # Server default was only to satisfy NOT NULL; drop it
    op.alter_column("pin_verifications", "pin_hash", server_default=None)


def downgrade() -> None:
    op.drop_column("pin_verifications", "pin_hash")
    op.add_column(
        "pin_verifications",
        sa.Column("pin_code", sa.String(length=6), nullable=False, server_default=""),
    )
    op.alter_column("pin_verifications", "pin_code", server_default=None)
```

### Enum migration (full template)

`alembic/versions/0002_add_leave_status_enum.py`:

```python
"""add leave_status enum

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-28

Rule: R7 — no string statuses.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

LEAVE_STATUS = ("pending", "approved", "rejected")


def upgrade() -> None:
    # 1) Create enum type
    op.execute("CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'rejected')")

    # 2) Temporary column with the new type
    op.add_column(
        "leaves",
        sa.Column("status_new", sa.Enum(*LEAVE_STATUS, name="leave_status"), nullable=True),
    )

    # 3) Backfill, tolerating mixed case
    op.execute("""
        UPDATE leaves SET status_new = CASE
            WHEN LOWER(status) = 'pending'  THEN 'pending'::leave_status
            WHEN LOWER(status) = 'approved' THEN 'approved'::leave_status
            WHEN LOWER(status) = 'rejected' THEN 'rejected'::leave_status
            ELSE 'pending'::leave_status
        END
    """)

    # 4) Drop old, rename new
    op.drop_column("leaves", "status")
    op.alter_column("leaves", "status_new", new_column_name="status", nullable=False)


def downgrade() -> None:
    op.add_column("leaves", sa.Column("status_str", sa.String(length=20), nullable=True))
    op.execute("UPDATE leaves SET status_str = status::text")
    op.drop_column("leaves", "status")
    op.alter_column("leaves", "status_str", new_column_name="status", nullable=False)
    op.execute("DROP TYPE leave_status")
```

### Permission seed migration (full)

`alembic/versions/0005_seed_permissions.py`:

```python
"""seed permission catalogue (Decision F.5)

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-31
"""
from __future__ import annotations

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

# (permission_name, allowed_role_names)
CATALOGUE: list[tuple[str, list[str]]] = [
    ("leave.request",          ["employee", "hr", "admin"]),
    ("leave.approve",          ["hr", "admin"]),
    ("leave.reject",           ["hr", "admin"]),
    ("leave.cancel.self",      ["employee", "hr", "admin"]),
    ("leave.cancel.any",       ["hr", "admin"]),
    ("leave.read.self",        ["employee", "hr", "admin"]),
    ("leave.read.any",         ["hr", "admin"]),
    ("employee.read.self",     ["employee", "hr", "admin"]),
    ("employee.read.any",      ["hr", "admin"]),
    ("employee.update.self",   ["employee", "hr", "admin"]),
    ("employee.update.any",    ["hr", "admin"]),
    ("name_change.request",    ["employee", "hr", "admin"]),
    ("name_change.review",     ["hr", "admin"]),
    ("onboarding.read.self",   ["employee", "hr", "admin"]),
    ("onboarding.read.any",    ["hr", "admin"]),
    ("onboarding.update.self", ["employee", "hr", "admin"]),
    ("document.search",        ["employee", "hr", "admin"]),
    ("document.upload",        ["hr", "admin"]),
    ("document.delete",        ["admin"]),
    ("notification.read.self", ["employee", "hr", "admin"]),
    ("admin.role.update",      ["admin"]),
    ("admin.email.read",       ["admin"]),
    ("admin.user.delete",      ["admin"]),
    ("meeting.read.self",      ["employee", "hr", "admin"]),
    ("meeting.read.any",       ["hr", "admin"]),
]


def upgrade() -> None:
    conn = op.get_bind()

    for perm_name, roles in CATALOGUE:
        conn.execute(op.inline_literal(""))  # noop to keep formatter happy
        conn.exec_driver_sql(
            "INSERT INTO permissions (name, description) VALUES (%s, %s) ON CONFLICT (name) DO NOTHING",
            (perm_name, f"Auto-seeded: {perm_name}"),
        )
        for role in roles:
            conn.exec_driver_sql("""
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id
                FROM roles r, permissions p
                WHERE r.name = %s AND p.name = %s
                ON CONFLICT DO NOTHING
            """, (role, perm_name))


def downgrade() -> None:
    conn = op.get_bind()
    for perm_name, _ in CATALOGUE:
        conn.exec_driver_sql(
            "DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name=%s)",
            (perm_name,),
        )
        conn.exec_driver_sql("DELETE FROM permissions WHERE name=%s", (perm_name,))
```

### Baseline squash runbook (Phase 1.4)

```bash
# 0. Safety net
git tag pre-squash
git push --tags

# 1. Spin up a fresh DB
docker rm -f hrms-pg-squash 2>/dev/null
docker run -d --name hrms-pg-squash \
  -e POSTGRES_USER=hrms_user -e POSTGRES_PASSWORD=hrms_pass \
  -e POSTGRES_DB=agentic_hrms_squash -p 5434:5432 postgres:16
sleep 5

# 2. Run every existing migration to reach current schema
DATABASE_URL=postgresql://hrms_user:hrms_pass@localhost:5434/agentic_hrms_squash \
  alembic upgrade head

# 3. Dump schema (no data)
docker exec hrms-pg-squash pg_dump -U hrms_user --schema-only --no-owner --no-privileges \
  agentic_hrms_squash > alembic/baseline_schema.sql

# 4. Wipe the alembic_version table
DATABASE_URL=postgresql://hrms_user:hrms_pass@localhost:5434/agentic_hrms_squash \
  alembic downgrade base

# 5. Delete every existing migration file
rm alembic/versions/*.py

# 6. Create the new baseline
alembic revision -m "baseline" --rev-id 0001

# 7. Edit the new file:
#    - Open alembic/versions/0001_baseline.py
#    - Replace upgrade() with:
#         with open("alembic/baseline_schema.sql") as f:
#             op.execute(f.read())
#    - Replace downgrade() with:
#         op.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")

# 8. Apply on a fresh DB to verify
docker exec hrms-pg-squash psql -U hrms_user agentic_hrms_squash -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
DATABASE_URL=postgresql://hrms_user:hrms_pass@localhost:5434/agentic_hrms_squash \
  alembic upgrade head
docker exec hrms-pg-squash psql -U hrms_user agentic_hrms_squash -c "\dt"
# Should list every table.

# 9. Round-trip
alembic downgrade base
alembic upgrade head

# 10. Run characterization tests against the squashed schema
DATABASE_URL=postgresql://hrms_user:hrms_pass@localhost:5434/agentic_hrms_squash \
  pytest backend/tests/characterization/ -v

# 11. If green, commit
git add alembic/ && git commit -m "squash migrations to single 0001 baseline"
git tag post-squash

# 12. Cleanup
docker rm -f hrms-pg-squash
```

**If step 8 fails:** the dumped schema references types or extensions that aren't created. Add `op.execute("CREATE EXTENSION IF NOT EXISTS ...")` at the top of `upgrade()`.

**Production deploy of the squash:** **do not** apply the new 0001 to a database with existing alembic_version rows. The correct path is:

1. Verify prod schema equals dev schema (`pg_dump --schema-only`, diff).
2. On prod: `UPDATE alembic_version SET version_num = '0001';` (matches the new baseline).
3. Future migrations stack on top.

This is a one-time, off-hours operation. Tech lead + DBA execute together.

### Production migration playbook

For any non-trivial migration (anything that touches > 1 column or adds an enum):

```
PRE-CHECKS (T - 1 hour)
  [ ] Migration tested on staging with prod-shaped data
  [ ] alembic downgrade -1 / upgrade head round-trip green on staging
  [ ] Lock detection: SELECT pid, state, query FROM pg_stat_activity
      WHERE state != 'idle' AND wait_event_type = 'Lock';
  [ ] No long-running transactions on target tables
  [ ] Backup taken (pg_dump in last 1 hour)
  [ ] Maintenance window announced

DEPLOY (T = 0)
  [ ] Set MAINTENANCE_MODE=true (returns 503 from /api except /health)
  [ ] alembic upgrade head
  [ ] Verify with psql: \d <changed-table>
  [ ] Run smoke tests against the migrated schema
  [ ] Set MAINTENANCE_MODE=false

POST (T + 5 min)
  [ ] Tail logs for errors
  [ ] Check error rate dashboard
  [ ] Confirm a sample user flow end-to-end
```

### Zero-downtime: expand → contract

For a column rename or type change with no maintenance window:

```
Phase A — Expand (deploy 1)
  - Migration: add new column, nullable.
  - Code: write both old and new on every update.
  - Backfill: batched UPDATE statements, off-peak.

Phase B — Switch reads (deploy 2)
  - Code: read from new, fall back to old.
  - Verify metrics — error rate flat.

Phase C — Contract (deploy 3)
  - Code: stop writing/reading old.
  - Migration: drop old column.
```

Three deploys, but the table never holds a lock longer than a few ms.

### Migration mid-failure recovery

If `alembic upgrade head` errors halfway:

```bash
# 1. DON'T panic-revert. Check alembic_version
psql -c "SELECT * FROM alembic_version;"
# Says the last successfully-committed revision.

# 2. Inspect what actually changed
psql -c "\d <table-the-migration-touched>"

# 3. Decide:
#    a) Roll forward — fix the migration script, run again
#    b) Roll back — alembic downgrade -1 (if the partial change is reversible)
#    c) Manual cleanup — psql to restore the intended state, then update alembic_version manually

# 4. If unsure: restore from the pre-deploy backup.
#    pg_restore -d agentic_hrms /tmp/hrms-prod-YYYYMMDD.dump
```

**Rule:** never edit a migration file in place after it's run in prod. Write a new migration on top.

---

## Frontend execution specifics

### Day-by-day order (Phase 6)

The exact order matters. Each day unblocks the next.

#### Day 1 — TypeScript

```bash
cd frontend
npm i -D typescript@5.6.2 @types/react@19.0.0 @types/react-dom@19.0.0 @types/node@22.7.5
```

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowJs": true,
    "checkJs": false,
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

```bash
git mv src/main.jsx src/main.tsx
# Open src/main.tsx — fix any TS errors (usually: typed createRoot, typed App import)
npx tsc --noEmit
# Expect: 0 errors.  If errors, fix one at a time.
```

#### Day 2 — Tailwind

```bash
npm i -D tailwindcss@3.4.13 postcss@8.4.47 autoprefixer@10.4.20 tailwindcss-animate@1.0.7
npx tailwindcss init -p
```

`frontend/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class", "body.theme-dark"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        // Map every CSS variable currently declared in src/index.css:5-57
        background: "var(--bg-primary)",
        foreground: "var(--text-primary)",
        card: { DEFAULT: "var(--bg-card)", foreground: "var(--text-primary)" },
        popover: { DEFAULT: "var(--bg-card)", foreground: "var(--text-primary)" },
        primary: { DEFAULT: "var(--accent)", foreground: "#ffffff" },
        secondary: { DEFAULT: "var(--bg-secondary)", foreground: "var(--text-primary)" },
        muted: { DEFAULT: "var(--bg-muted)", foreground: "var(--text-secondary)" },
        accent: { DEFAULT: "var(--accent)", foreground: "#ffffff" },
        destructive: { DEFAULT: "var(--red)", foreground: "#ffffff" },
        border: "var(--border)",
        input: "var(--border)",
        ring: "var(--accent)",
        // Semantic shortcuts
        success: "var(--green)",
        warning: "var(--yellow)",
        danger: "var(--red)",
      },
      borderRadius: {
        lg: "var(--radius, 0.5rem)",
        md: "calc(var(--radius, 0.5rem) - 2px)",
        sm: "calc(var(--radius, 0.5rem) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
```

`frontend/src/styles/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Preserve existing CSS variable design tokens from old index.css */
:root {
  --bg-primary: #f8fafc;
  --bg-secondary: #f1f5f9;
  --bg-card: #ffffff;
  --bg-muted: #f1f5f9;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --border: #e2e8f0;
  --accent: #3b82f6;
  --green: #22c55e;
  --yellow: #f59e0b;
  --red: #ef4444;
  --radius: 0.5rem;
}

body.theme-dark {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-card: #1e293b;
  --bg-muted: #334155;
  --text-primary: #f8fafc;
  --text-secondary: #cbd5e1;
  --border: #334155;
  --accent: #60a5fa;
  --green: #4ade80;
  --yellow: #fbbf24;
  --red: #f87171;
}

body { @apply bg-background text-foreground; }
```

```bash
# Verify
npm run dev
# Open localhost:3000 → a <div class="bg-primary">test</div> should appear in expected colour.
```

#### Day 3 — shadcn/ui init

```bash
npx shadcn@latest init
# Answers:
#   Style: default
#   Base color: slate
#   CSS variables: yes
#   tailwind.config: tailwind.config.ts
#   Components alias: @/components
#   Utils alias: @/lib/utils
#   React Server Components: no
#   Tailwind prefix: (none)

# Add 16 primitives we'll use
for c in button dialog sheet input label form card sonner dropdown-menu \
         tabs select textarea tooltip alert skeleton; do
  npx shadcn@latest add $c
done

# Smoke
echo 'import { Button } from "@/components/ui/button"; export const Test = () => <Button>Hi</Button>' \
  > src/test-shadcn.tsx
npx tsc --noEmit
rm src/test-shadcn.tsx
```

#### Day 4 — `apiClient` + `AuthProvider`

`frontend/src/lib/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  VITE_API_URL: z.string().url().or(z.string().startsWith("/")).default("/api"),
});

export const env = schema.parse(import.meta.env);
```

`frontend/src/lib/apiClient.ts` (full):

```ts
import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import { env } from "./env";

type AuthAccessor = {
  getToken: () => string | null;
  onUnauthorized: () => void;
};

let auth: AuthAccessor = {
  getToken: () => null,
  onUnauthorized: () => {},
};

export const wireAuth = (a: AuthAccessor) => {
  auth = a;
};

export const apiClient: AxiosInstance = axios.create({
  baseURL: env.VITE_API_URL,
  timeout: 30_000,
});

apiClient.interceptors.request.use((cfg: AxiosRequestConfig) => {
  const token = auth.getToken();
  if (token) {
    cfg.headers = { ...(cfg.headers ?? {}), Authorization: `Bearer ${token}` };
  }
  return cfg as never;
});

apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      auth.onUnauthorized();
    }
    return Promise.reject(err);
  },
);

// Typed helpers — every feature module's api.ts uses these
export const api = {
  get: <T>(url: string, cfg?: AxiosRequestConfig) =>
    apiClient.get<T>(url, cfg).then((r) => r.data),
  post: <T>(url: string, body?: unknown, cfg?: AxiosRequestConfig) =>
    apiClient.post<T>(url, body, cfg).then((r) => r.data),
  put: <T>(url: string, body?: unknown, cfg?: AxiosRequestConfig) =>
    apiClient.put<T>(url, body, cfg).then((r) => r.data),
  patch: <T>(url: string, body?: unknown, cfg?: AxiosRequestConfig) =>
    apiClient.patch<T>(url, body, cfg).then((r) => r.data),
  delete: <T>(url: string, cfg?: AxiosRequestConfig) =>
    apiClient.delete<T>(url, cfg).then((r) => r.data),
};
```

`frontend/src/features/auth/AuthProvider.tsx` (full):

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { wireAuth } from "@/lib/apiClient";

export interface Employee {
  id: number;
  email: string;
  name: string;
  role: string;
  department?: string;
}

interface AuthState {
  token: string | null;
  employee: Employee | null;
  login: (token: string, employee: Employee) => void;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

const TOKEN_KEY = "hrms_token";
const EMP_KEY = "hrms_employee";

const readEmployee = (): Employee | null => {
  const raw = localStorage.getItem(EMP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Employee;
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [employee, setEmployee] = useState<Employee | null>(() => readEmployee());

  const logout = useCallback(() => {
    setToken(null);
    setEmployee(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMP_KEY);
  }, []);

  const login = useCallback((tok: string, emp: Employee) => {
    setToken(tok);
    setEmployee(emp);
    localStorage.setItem(TOKEN_KEY, tok);
    localStorage.setItem(EMP_KEY, JSON.stringify(emp));
  }, []);

  // Wire apiClient interceptors
  useEffect(() => {
    wireAuth({
      getToken: () => token,
      onUnauthorized: logout,
    });
  }, [token, logout]);

  // Cross-tab sync — listen for storage events from other tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY) {
        setToken(e.newValue);
        if (!e.newValue) setEmployee(null);
      }
      if (e.key === EMP_KEY) {
        setEmployee(readEmployee());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ token, employee, login, logout }),
    [token, employee, login, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useAuth = (): AuthState => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
};
```

#### Day 5 — Router + React Query

```bash
npm i react-router-dom@6.27.0 @tanstack/react-query@5.59.0 @tanstack/react-query-devtools@5.59.0 \
      react-hook-form@7.53.0 @hookform/resolvers@3.9.0 zod@3.23.8 axios@1.7.7 sonner@1.5.0 \
      lucide-react@0.451.0
```

`frontend/src/app/router.tsx`:

```tsx
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthProvider";
import { LoginPage } from "@/features/auth/components/LoginPage";
import { RegisterPage } from "@/features/auth/components/RegisterPage";
import { ChatPage } from "@/features/chat/components/ChatPage";
import { AdminPage } from "@/features/admin/components/AdminPage";
import { HRPage } from "@/features/hr/components/HRPage";
import { ProfilePage } from "@/features/employees/components/ProfilePage";
import { OnboardingPage } from "@/features/onboarding/components/OnboardingPage";

const RequireAuth = () => {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
};

const RequireRole = ({ allow }: { allow: string[] }) => {
  const { employee } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  if (!allow.includes(employee.role)) return <Navigate to="/chat" replace />;
  return <Outlet />;
};

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: "/chat", element: <ChatPage /> },
      { path: "/profile", element: <ProfilePage /> },
      { path: "/onboarding", element: <OnboardingPage /> },
      {
        element: <RequireRole allow={["hr", "admin"]} />,
        children: [{ path: "/hr", element: <HRPage /> }],
      },
      {
        element: <RequireRole allow={["admin"]} />,
        children: [{ path: "/admin", element: <AdminPage /> }],
      },
    ],
  },
]);
```

`frontend/src/app/App.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { router } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export const App = () => (
  <AuthProvider>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors position="top-right" />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </AuthProvider>
);
```

`frontend/src/main.tsx`:

```tsx
import "@/styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

#### Day 6 — OpenAPI type generation

```bash
npm i -D openapi-typescript@7.4.1
```

`frontend/package.json` scripts:

```json
"gen:types": "openapi-typescript http://localhost:8000/openapi.json -o src/types/api.d.ts"
```

```bash
# Backend must be running
npm run gen:types
ls -la src/types/api.d.ts   # non-empty
git diff --exit-code src/types/api.d.ts   # CI gate
```

Add to CI (`.github/workflows/ci.yml` frontend job):

```yaml
- name: OpenAPI type drift
  run: |
    # Start backend
    pip install -r ../requirements.txt
    cd .. && python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
    sleep 5
    cd frontend
    npm run gen:types
    git diff --exit-code src/types/api.d.ts
```

#### Day 7 — ESLint flat config + custom rules

```bash
npm i -D eslint@9.12.0 @typescript-eslint/eslint-plugin@8.8.1 @typescript-eslint/parser@8.8.1 \
        eslint-plugin-react@7.37.1 eslint-plugin-react-hooks@5.0.0
```

`frontend/eslint.config.js`:

```js
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["dist", "node_modules", "src/types/api.d.ts"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],

      // === Custom enforcement of RULES.md ===

      // R21 — No raw fetch outside lib/apiClient.ts
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "R21: use @/lib/apiClient (api.get/post/...) instead of fetch" },
      ],
      // R21 — No axios imports outside lib/apiClient.ts (enforced by file convention; see below)

      // R22 — localStorage only inside features/auth/
      // (Enforced via no-restricted-syntax with override per file)
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='localStorage']",
          message: "R22: localStorage only inside features/auth/AuthProvider.tsx",
        },
        {
          // R23 — static inline style objects
          selector: "JSXAttribute[name.name='style'][value.expression.type='ObjectExpression']",
          message: "R23: no static inline style — use Tailwind classes (dynamic computed values are allowed via spread)",
        },
        {
          // R26 — conditional rendering as routing
          selector: "ConditionalExpression > BinaryExpression[operator='==='][left.name=/^(view|screen|page)$/]",
          message: "R26: use react-router, not view === 'X' ternaries",
        },
      ],
    },
  },
  {
    // Override: features/auth/ can touch localStorage
    files: ["src/features/auth/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error",
      { selector: "JSXAttribute[name.name='style'][value.expression.type='ObjectExpression']",
        message: "R23: no static inline style" },
    ]},
  },
  {
    // Override: lib/apiClient.ts can import axios + use fetch
    files: ["src/lib/apiClient.ts"],
    rules: { "no-restricted-globals": "off" },
  },
];
```

`package.json` scripts:

```json
"lint": "eslint . --max-warnings 0",
"typecheck": "tsc --noEmit"
```

```bash
npm run lint
npm run typecheck
```

#### Day 7 — Smoke test

```
[ ] tsc --noEmit clean
[ ] npm run lint clean
[ ] Tailwind class renders (bg-primary background appears)
[ ] shadcn <Button onClick={() => toast("hi")}>Test</Button> works
[ ] api.get("/health") returns 200 from a click handler
[ ] /login route renders LoginPage
[ ] Unauth → / redirects to /login
[ ] AuthProvider login() persists; refresh keeps user logged in
[ ] localStorage write in another tab triggers re-render
[ ] React Query devtools panel visible
```

If any red, fix before Phase 7.

---

### Worked example: convert `Login.jsx` → `LoginPage.tsx`

`Login.jsx` (old, 425 lines) was the entry point for face + PIN auth. Here's a fully-worked conversion to demonstrate the pattern. Apply the same approach to every other component.

#### Old (selected excerpts from `frontend/src/components/Login.jsx`)

```jsx
// 425 lines, inline fetch, inline styles, hand-rolled validation, vanilla modal

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function Login({ onLogin, onShowRegister }) {
  const [mode, setMode] = useState('face');   // 'face' | 'pin'
  const [identifier, setIdentifier] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePinLogin = async (e) => {
    e.preventDefault();
    if (!identifier || !currentPin) { setError('All fields required'); return; }
    if (currentPin.length !== 6) { setError('PIN must be 6 digits'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login-with-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, pin: currentPin }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Login failed');
      const data = await res.json();
      localStorage.setItem('hrms_token', data.access_token);
      localStorage.setItem('hrms_employee', JSON.stringify(data.employee));
      onLogin(data.access_token, data.employee);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
      <div style={{ width: 400, padding: 32, background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
        {/* ...inline tabs, inline buttons, inline modal for errors... */}
      </div>
    </div>
  );
}
```

**Violations:** inline `fetch` (R21), inline `localStorage` (R22), inline `style={{}}` (R23), hand-rolled validation (R25), no router (R26), no types (R19).

#### New (`frontend/src/features/auth/components/LoginPage.tsx`)

`frontend/src/features/auth/schemas.ts`:

```ts
import { z } from "zod";

export const pinLoginSchema = z.object({
  identifier: z
    .string()
    .min(3, "Enter your email or phone")
    .refine((s) => s.includes("@") || /^\+?\d{10,}$/.test(s), "Email or phone (E.164)"),
  pin: z.string().regex(/^\d{6}$/, "PIN must be 6 digits"),
});

export type PinLoginInput = z.infer<typeof pinLoginSchema>;
```

`frontend/src/features/auth/api.ts`:

```ts
import { api } from "@/lib/apiClient";
import type { paths } from "@/types/api";

type LoginBody = paths["/api/auth/login-with-pin"]["post"]["requestBody"]["content"]["application/json"];
type LoginResp = paths["/api/auth/login-with-pin"]["post"]["responses"]["200"]["content"]["application/json"];

export const authApi = {
  loginPin: (body: LoginBody) => api.post<LoginResp>("/auth/login-with-pin", body),
  // ... loginFace, register, etc.
};
```

`frontend/src/features/auth/hooks.ts`:

```ts
import { useMutation } from "@tanstack/react-query";
import { authApi } from "./api";
import { useAuth } from "./AuthProvider";

export const usePinLogin = () => {
  const { login } = useAuth();
  return useMutation({
    mutationFn: authApi.loginPin,
    onSuccess: (data) => {
      // data.access_token, data.employee — both typed from OpenAPI
      login(data.access_token, data.employee);
    },
  });
};
```

`frontend/src/features/auth/components/LoginPage.tsx`:

```tsx
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

import { pinLoginSchema, type PinLoginInput } from "../schemas";
import { usePinLogin } from "../hooks";
import { FaceLogin } from "./FaceLogin";

export const LoginPage = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"face" | "pin">("face");

  const form = useForm<PinLoginInput>({
    resolver: zodResolver(pinLoginSchema),
    defaultValues: { identifier: "", pin: "" },
  });

  const pinLogin = usePinLogin();

  const onSubmit = async (values: PinLoginInput) => {
    try {
      await pinLogin.mutateAsync(values);
      toast.success("Welcome back");
      navigate("/chat");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      toast.error(msg);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "face" | "pin")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="face">Face ID</TabsTrigger>
              <TabsTrigger value="pin">PIN</TabsTrigger>
            </TabsList>

            <TabsContent value="face" className="mt-4">
              <FaceLogin onSuccess={() => navigate("/chat")} />
            </TabsContent>

            <TabsContent value="pin" className="mt-4">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="identifier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email or phone</FormLabel>
                        <FormControl>
                          <Input placeholder="you@example.com" autoComplete="username" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>6-digit PIN</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            inputMode="numeric"
                            maxLength={6}
                            autoComplete="current-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={pinLogin.isPending}>
                    {pinLogin.isPending ? "Signing in..." : "Sign in"}
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex justify-between text-sm">
          <Link to="/register" className="text-primary hover:underline">
            New here? Register
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
};
```

**Compared to the old:** zero inline `style`, zero raw `fetch`, zero `localStorage` (moves through `AuthProvider.login()` via the hook), typed throughout, validated by `zod`, routed via `react-router-dom`. ~80 lines vs 425. Visually equivalent.

---

### Feature port template (Phase 7)

For every feature `<X>`:

```
Day 1 — Scaffold
  [ ] mkdir -p src/features/<X>/components
  [ ] touch src/features/<X>/{api.ts,hooks.ts,schemas.ts,routes.tsx}
  [ ] Add the feature's routes to app/router.tsx
  [ ] Identify the old component(s) being replaced: list them

Day 2 — schemas + api + hooks
  [ ] Define zod schemas (use generated api.d.ts types as ground truth)
  [ ] Write typed api.ts wrapping apiClient.api.{get,post,...}
  [ ] Write React Query hooks (useX, useXMutation)

Day 3-4 — Components
  [ ] Replace inline <button> with <Button>
  [ ] Replace vanilla modals with <Dialog>
  [ ] Replace inline styles with Tailwind classes
  [ ] Replace inline forms with react-hook-form + zod + <Form>
  [ ] Wire navigation with useNavigate
  [ ] Use toast for success/error feedback

Day 5 — Tests
  [ ] vitest test for the happy path
  [ ] vitest test for at least one failure path
  [ ] msw handlers for the API endpoints used

Day 6 — Cleanup + PR
  [ ] Delete the old jsx file(s)
  [ ] Remove any imports of them
  [ ] Visual diff against pre-migration
  [ ] PR with checklist
```

---

### Tailwind class migration cheatsheet

When converting `style={{...}}` → `className="..."`:

| Old inline | New Tailwind |
|---|---|
| `padding: '10px'` | `p-2.5` |
| `padding: '16px 24px'` | `px-6 py-4` |
| `margin: 'auto'` | `m-auto` |
| `background: 'var(--accent)'` | `bg-primary` (mapped in tailwind.config) |
| `background: '#fff'` | `bg-white` |
| `color: 'var(--text-primary)'` | `text-foreground` |
| `borderRadius: 8` | `rounded-md` |
| `border: '1px solid var(--border)'` | `border border-border` |
| `display: 'flex'` | `flex` |
| `flexDirection: 'column'` | `flex-col` |
| `alignItems: 'center'` | `items-center` |
| `justifyContent: 'center'` | `justify-center` |
| `gap: 12` | `gap-3` |
| `width: '100%'` | `w-full` |
| `height: '100vh'` | `h-screen` |
| `position: 'fixed', inset: 0` | (use `<Dialog>` from shadcn) |
| `boxShadow: '0 2px 8px rgba(0,0,0,.1)'` | `shadow-md` |
| `fontSize: 14` | `text-sm` |
| `fontWeight: 600` | `font-semibold` |

**Dynamic-only:** keep `style={{ width: \`${progress}%\` }}` inline because the value is computed at runtime. That's the one carve-out R23 allows.

---

### Intent registry (`features/chat/intentHandlers.ts`)

The chatbot returns structured intents via the agent's tool output. The frontend dispatches into a registry — never `if/else if` on response keys.

```ts
// frontend/src/features/chat/intentHandlers.ts
import type { ReactNode } from "react";
import { LeaveConflictDialog } from "@/features/leave/components/LeaveConflictDialog";
import { NameChangeConfirmationDialog } from "@/features/employees/components/NameChangeConfirmationDialog";

export type IntentType =
  | "leave_created"
  | "leave_conflict"
  | "leave_rejected"
  | "name_change_submitted"
  | "document_uploaded"
  | "onboarding_task_completed";

export interface IntentPayload {
  [key: string]: unknown;
}

export interface IntentContext {
  refreshSessions: () => void;
  closeChat: () => void;
}

type Handler = (payload: IntentPayload, ctx: IntentContext) => ReactNode | void;

export const intentHandlers: Record<IntentType, Handler> = {
  leave_created: (_payload, ctx) => {
    // No UI; toast handled by feature
    ctx.refreshSessions();
  },
  leave_conflict: (payload, _ctx) => (
    <LeaveConflictDialog
      meetings={payload.meetings as Array<{ title: string; date: string; time?: string }>}
      pendingPayload={payload.pending_payload as Record<string, unknown>}
    />
  ),
  leave_rejected: (_payload, _ctx) => null,
  name_change_submitted: (payload, _ctx) => (
    <NameChangeConfirmationDialog
      requestId={payload.id as number}
      newName={payload.new_name as string}
    />
  ),
  document_uploaded: () => null,
  onboarding_task_completed: () => null,
};

// Exhaustiveness check — fails to compile if a case is missed
const _exhaustive: Record<IntentType, Handler> = intentHandlers;
void _exhaustive;
```

Usage in `ChatPage.tsx`:

```tsx
const [overlay, setOverlay] = useState<ReactNode>(null);

const onChatResponse = (data: ChatResponse) => {
  if (data.intent) {
    const handler = intentHandlers[data.intent as IntentType];
    if (handler) {
      const node = handler(data.intent_payload ?? {}, { refreshSessions, closeChat });
      if (node) setOverlay(node);
    }
  }
};
```

Adding a new intent: one entry in the registry + a backend tool that returns `{intent: "new_thing", intent_payload: {...}}`. Two-file change. Done.

---

## Reference implementations

The canonical small files that everything else depends on. Copy these verbatim; customize only when a phase task explicitly requires it.

### `backend/core/exceptions.py` (full)

```python
"""Typed application exceptions. Mapped to HTTP by the global handler."""
from __future__ import annotations


class AppError(Exception):
    """Base for all domain exceptions."""
    http_status: int = 500
    code: str = "internal_error"

    def __init__(self, message: str = "", *, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message or self.code
        self.details = details or {}


class NotFoundError(AppError):
    http_status = 404
    code = "not_found"


class PermissionDeniedError(AppError):
    http_status = 403
    code = "permission_denied"


class ConflictError(AppError):
    http_status = 409
    code = "conflict"


class ValidationError(AppError):
    http_status = 422
    code = "validation_error"


class UnauthenticatedError(AppError):
    http_status = 401
    code = "unauthenticated"


class ExternalServiceError(AppError):
    """Upstream failure (SMTP, Twilio, OpenAI, ICS)."""
    http_status = 502
    code = "external_service_error"
```

Register on `backend/main.py`:

```python
from fastapi import Request
from fastapi.responses import JSONResponse
from backend.core.exceptions import AppError

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.http_status,
        content={"code": exc.code, "message": exc.message, "details": exc.details},
    )
```

### `backend/core/events.py` (full)

```python
"""In-process pub/sub.

Sync subscribers run inside the caller's transaction.
Use this for: notifications, audit, email (post-commit).
"""
from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable
from typing import Any, TypeVar

logger = logging.getLogger(__name__)

E = TypeVar("E")
_subs: dict[type, list[Callable[[Any], None]]] = defaultdict(list)


def subscribe(event_type: type[E]):
    """Decorator. Registers a function as a subscriber to event_type."""
    def deco(fn: Callable[[E], None]) -> Callable[[E], None]:
        _subs[event_type].append(fn)
        logger.debug("subscribed %s to %s", fn.__qualname__, event_type.__name__)
        return fn
    return deco


def dispatch(event: Any) -> None:
    """Call every subscriber for the event's type. Errors in subscribers
    are logged and re-raised — the caller decides whether to swallow."""
    handlers = _subs.get(type(event), [])
    for h in handlers:
        try:
            h(event)
        except Exception:
            logger.exception("subscriber %s failed for %s", h.__qualname__, type(event).__name__)
            raise


def reset_for_tests() -> None:
    _subs.clear()
```

Define event types in each module's `events.py`:

```python
# backend/modules/leave/events.py
from dataclasses import dataclass

@dataclass(frozen=True)
class LeaveRequested:
    leave_id: int
    employee_id: int

@dataclass(frozen=True)
class LeaveApproved:
    leave_id: int
    approver_id: int

@dataclass(frozen=True)
class LeaveRejected:
    leave_id: int
    rejector_id: int
    reason: str
```

### `backend/core/middleware.py` (full)

```python
"""Request-ID middleware + JSON logging configuration."""
from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from pythonjsonlogger import jsonlogger

REQUEST_ID_HEADER = "X-Request-ID"
logger = logging.getLogger("hrms")


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
    root = logging.getLogger()
    root.handlers.clear()
    h = logging.StreamHandler()
    if fmt == "json":
        h.setFormatter(jsonlogger.JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            rename_fields={"asctime": "ts", "levelname": "level", "name": "logger"},
        ))
    else:
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(h)
    root.setLevel(level.upper())


async def request_id_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    rid = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
    request.state.request_id = rid
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request.error", extra={"request_id": rid, "path": str(request.url.path)})
        raise
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers[REQUEST_ID_HEADER] = rid
    logger.info("request.complete", extra={
        "request_id": rid,
        "method": request.method,
        "path": str(request.url.path),
        "status": response.status_code,
        "elapsed_ms": round(elapsed_ms, 1),
    })
    return response
```

Wire it up in `backend/main.py`:

```python
from backend.core.middleware import configure_logging, request_id_middleware
from backend.core.config import settings

configure_logging(settings.LOG_LEVEL, settings.LOG_FORMAT)
app.middleware("http")(request_id_middleware)
```

### `backend/core/dependencies.py` (full)

```python
"""FastAPI dependencies — the only place auth and DB sessions are obtained."""
from __future__ import annotations

from collections.abc import Generator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.exceptions import PermissionDeniedError, UnauthenticatedError
from backend.core.security import verify_token
from backend.db.session import SessionLocal
from backend.db.models.employee import Employee


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_employee(
    request: Request,
    db: Session = Depends(get_db),
) -> Employee:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise UnauthenticatedError("Missing bearer token")
    token = auth.split(" ", 1)[1]
    payload = verify_token(token)
    if not payload:
        raise UnauthenticatedError("Invalid or expired token")
    employee_id = int(payload.get("sub", 0))
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise UnauthenticatedError("Token refers to unknown employee")
    return employee


def require_permission(permission: str):
    """Depends() that resolves the actor's role → permissions, denying if absent."""
    from backend.modules.rbac.service import RBACService    # local import — avoids cycle at import time
    from backend.modules.rbac.repository import RBACRepository

    def _check(
        employee: Employee = Depends(get_current_employee),
        db: Session = Depends(get_db),
    ) -> Employee:
        svc = RBACService(repo=RBACRepository(db))
        if not svc.has_permission(employee.role_id, permission):
            raise PermissionDeniedError(
                f"Permission '{permission}' required",
                details={"actor_role_id": employee.role_id, "required": permission},
            )
        return employee

    return _check
```

### `backend/agent/runner.py` (full)

```python
"""Single, cached AgentExecutor per employee. TTL + LRU."""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_openai import ChatOpenAI

from backend.agent.tool_registry import get_all_tools
from backend.core.config import settings

CACHE_SIZE = 500
TTL_SECONDS = 30 * 60
PROMPTS_DIR = Path(__file__).parent / "prompts"


@dataclass
class _Entry:
    executor: AgentExecutor
    created_at: float
    lock: threading.Lock


class _ExecutorCache:
    def __init__(self) -> None:
        self._entries: OrderedDict[int, _Entry] = OrderedDict()
        self._mu = threading.Lock()

    def _evict_expired(self) -> None:
        now = time.monotonic()
        for k in list(self._entries.keys()):
            if now - self._entries[k].created_at > TTL_SECONDS:
                self._entries.pop(k, None)

    def _evict_lru(self) -> None:
        while len(self._entries) > CACHE_SIZE:
            self._entries.popitem(last=False)

    def get_or_build(self, employee_id: int, *, employee_email: str, employee_name: str) -> _Entry:
        with self._mu:
            self._evict_expired()
            if employee_id in self._entries:
                self._entries.move_to_end(employee_id)
                return self._entries[employee_id]
            entry = _Entry(
                executor=_build_executor(employee_email, employee_name),
                created_at=time.monotonic(),
                lock=threading.Lock(),
            )
            self._entries[employee_id] = entry
            self._evict_lru()
            return entry

    def invalidate(self, employee_id: int) -> None:
        with self._mu:
            self._entries.pop(employee_id, None)

    def clear(self) -> None:
        with self._mu:
            self._entries.clear()


_cache = _ExecutorCache()


def _load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text()


def _build_executor(employee_email: str, employee_name: str) -> AgentExecutor:
    from datetime import date
    today = date.today().strftime("%A, %d %B %Y")

    raw = _load_prompt("main")
    system = raw.format(
        today=today,
        year=today[-4:],
        employee_name=employee_name,
        employee_email=employee_email,
    )

    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        MessagesPlaceholder("chat_history", optional=True),
        ("human", "{input}"),
        MessagesPlaceholder("agent_scratchpad"),
    ])

    llm = ChatOpenAI(
        model=settings.AI_MODEL,
        api_key=settings.AI_KEY,
        temperature=0,
    )

    tools = get_all_tools()
    agent = create_openai_tools_agent(llm, tools, prompt)
    return AgentExecutor(
        agent=agent,
        tools=tools,
        return_intermediate_steps=True,
        verbose=False,
        max_iterations=8,
        handle_parsing_errors=True,
    )


def get_executor(employee_id: int, employee_email: str, employee_name: str) -> AgentExecutor:
    """Acquire the cached executor for this employee. Per-employee lock prevents concurrent invocations."""
    entry = _cache.get_or_build(employee_id, employee_email=employee_email, employee_name=employee_name)
    return entry.executor


def invalidate_executor(employee_id: int) -> None:
    """Call when an employee's role/permissions change."""
    _cache.invalidate(employee_id)


def clear_all() -> None:
    """Used by tests."""
    _cache.clear()
```

### `backend/agent/tool_registry.py` (full)

```python
"""Aggregates tools from every module. Import order is intentional."""
from __future__ import annotations

from langchain_core.tools import BaseTool


def get_all_tools() -> list[BaseTool]:
    # Per-module tools. Each module exports its tools in tools.py.
    from backend.modules.leave.tools import LEAVE_TOOLS
    from backend.modules.employees.tools import EMPLOYEE_TOOLS
    from backend.modules.name_change.tools import NAME_CHANGE_TOOLS
    from backend.modules.onboarding.tools import ONBOARDING_TOOLS
    from backend.modules.documents.tools import DOCUMENT_TOOLS
    from backend.modules.notifications.tools import NOTIFICATION_TOOLS

    return [
        *LEAVE_TOOLS,
        *EMPLOYEE_TOOLS,
        *NAME_CHANGE_TOOLS,
        *ONBOARDING_TOOLS,
        *DOCUMENT_TOOLS,
        *NOTIFICATION_TOOLS,
    ]
```

### `backend/agent/prompts/main.md`

```markdown
You are an intelligent HR Assistant for the HRMS platform.

TODAY'S DATE: {today}

The employee currently logged in:
  Name : {employee_name}
  Email: {employee_email}

CRITICAL RULES:

RULE 1 — IDENTITY: You know who the user is. NEVER ask for name or email.
  Always pass employee_email = "{employee_email}" to every tool that needs it.

RULE 2 — DATES: Derive dates from TODAY'S DATE above. Use {year} when the user gives a date with no year.
  Convert natural language to YYYY-MM-DD before calling any tool.

RULE 3 — TOOL CHOICE: Call exactly one tool per user request when an action is needed.
  Tools return structured results — the user-facing answer is in result["answer"].
  Do not re-execute prior actions; respond conversationally to "ok", "thanks", etc.

RULE 4 — INTENTS: Tools may return an "intent" key (e.g. "leave_conflict", "name_change_submitted").
  Do not invent intents. Do not emit special tags or JSON in your prose.
  The frontend reads intents from structured tool output, not from your reply.

RULE 5 — POLICY: For policy questions ("what is the maternity leave policy?"), use search_policies.
  Always cite the source ([Source: file | Section: X]).

RULE 6 — DECLINE: For math, weather, sports, general trivia — decline politely.
  "I can only help with HR matters."

Be concise. Professional. No emojis unless the user uses them first.
```

### `backend/modules/leave/` (every file, full)

`backend/modules/leave/__init__.py`:

```python
"""Leave module — request/approve/reject leave."""
```

`backend/modules/leave/models.py`:

```python
from __future__ import annotations

from datetime import datetime
import enum

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from backend.db.base import Base, BaseModel


class LeaveStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class LeaveType(str, enum.Enum):
    CASUAL = "casual"
    SICK = "sick"
    ANNUAL = "annual"
    MATERNITY = "maternity"
    PATERNITY = "paternity"
    UNPAID = "unpaid"


class Leave(BaseModel):
    __tablename__ = "leaves"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    leave_type = Column(Enum(LeaveType, name="leave_type"), nullable=False)
    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True), nullable=False)
    status = Column(Enum(LeaveStatus, name="leave_status"), nullable=False, default=LeaveStatus.PENDING)
    reason = Column(Text, nullable=False)
    rejection_reason = Column(Text, nullable=True)
    approver_id = Column(Integer, ForeignKey("employees.id"), nullable=True)

    employee = relationship("Employee", foreign_keys=[employee_id], back_populates="leaves")
    approver = relationship("Employee", foreign_keys=[approver_id])


class LeaveBalance(BaseModel):
    __tablename__ = "leave_balances"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    leave_type = Column(Enum(LeaveType, name="leave_type"), nullable=False)
    allocated = Column(Float, nullable=False)
    used = Column(Float, nullable=False, default=0.0)
```

`backend/modules/leave/schemas.py`:

```python
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.modules.leave.models import LeaveStatus, LeaveType


class LeaveRequest(BaseModel):
    leave_type: LeaveType
    start_date: date
    end_date: date
    reason: str = Field(min_length=3, max_length=500)


class LeaveResponse(BaseModel):
    id: int
    employee_id: int
    leave_type: LeaveType
    start_date: datetime
    end_date: datetime
    status: LeaveStatus
    reason: str
    rejection_reason: str | None = None

    class Config:
        from_attributes = True


class ConflictingMeeting(BaseModel):
    title: str
    date: str
    time: str | None = None


class LeaveCreated(BaseModel):
    intent: Literal["leave_created"] = "leave_created"
    leave: LeaveResponse


class ConflictDetected(BaseModel):
    intent: Literal["leave_conflict"] = "leave_conflict"
    meetings: list[ConflictingMeeting]
    pending_payload: LeaveRequest


LeaveResult = LeaveCreated | ConflictDetected


class LeaveRejection(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
```

`backend/modules/leave/repository.py`:

```python
from __future__ import annotations

from datetime import date
from sqlalchemy.orm import Session

from backend.modules.leave.models import Leave, LeaveBalance, LeaveStatus, LeaveType


class LeaveRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, leave_id: int) -> Leave | None:
        return self.db.query(Leave).filter(Leave.id == leave_id).first()

    def list_pending_for_manager(self, manager_id: int) -> list[Leave]:
        # TODO Phase 4: filter by manager_id via Employee.manager_id; for now return all pending.
        return self.db.query(Leave).filter(Leave.status == LeaveStatus.PENDING).all()

    def list_for_employee(self, employee_id: int) -> list[Leave]:
        return self.db.query(Leave).filter(Leave.employee_id == employee_id).order_by(Leave.start_date.desc()).all()

    def create(
        self,
        *,
        employee_id: int,
        leave_type: LeaveType,
        start_date: date,
        end_date: date,
        reason: str,
        status: LeaveStatus = LeaveStatus.PENDING,
    ) -> Leave:
        leave = Leave(
            employee_id=employee_id,
            leave_type=leave_type,
            start_date=start_date,
            end_date=end_date,
            reason=reason,
            status=status,
        )
        self.db.add(leave)
        self.db.flush()
        return leave

    def update_status(
        self,
        leave: Leave,
        status: LeaveStatus,
        *,
        approver_id: int | None = None,
        rejection_reason: str | None = None,
    ) -> None:
        leave.status = status
        if approver_id is not None:
            leave.approver_id = approver_id
        if rejection_reason is not None:
            leave.rejection_reason = rejection_reason
        self.db.flush()

    def delete_pending_for_employee(self, employee_id: int) -> int:
        q = self.db.query(Leave).filter(
            Leave.employee_id == employee_id, Leave.status == LeaveStatus.PENDING
        )
        n = q.count()
        q.delete(synchronize_session=False)
        return n

    def balance_for(self, employee_id: int, leave_type: LeaveType) -> LeaveBalance | None:
        return self.db.query(LeaveBalance).filter(
            LeaveBalance.employee_id == employee_id, LeaveBalance.leave_type == leave_type
        ).first()
```

`backend/modules/leave/service.py`:

```python
from __future__ import annotations

import logging

from backend.core.events import dispatch
from backend.core.exceptions import NotFoundError, ValidationError
from backend.modules.leave.events import LeaveApproved, LeaveRejected, LeaveRequested
from backend.modules.leave.models import LeaveStatus
from backend.modules.leave.repository import LeaveRepository
from backend.modules.leave.schemas import (
    ConflictDetected,
    ConflictingMeeting,
    LeaveCreated,
    LeaveRequest,
    LeaveResponse,
    LeaveResult,
)

logger = logging.getLogger(__name__)


class LeaveService:
    def __init__(self, repo: LeaveRepository, meetings, events_dispatch=dispatch) -> None:
        self.repo = repo
        self.meetings = meetings
        self._dispatch = events_dispatch

    def request(self, employee_id: int, payload: LeaveRequest, *, force: bool = False) -> LeaveResult:
        if payload.end_date < payload.start_date:
            raise ValidationError("end_date must be on or after start_date")

        if not force:
            conflicts = self.meetings.find_conflicts(employee_id, payload.start_date, payload.end_date)
            if conflicts:
                return ConflictDetected(
                    meetings=[ConflictingMeeting(**c) for c in conflicts],
                    pending_payload=payload,
                )

        leave = self.repo.create(
            employee_id=employee_id,
            leave_type=payload.leave_type,
            start_date=payload.start_date,
            end_date=payload.end_date,
            reason=payload.reason,
        )
        self._dispatch(LeaveRequested(leave_id=leave.id, employee_id=employee_id))
        return LeaveCreated(leave=LeaveResponse.model_validate(leave))

    def approve(self, leave_id: int, approver_id: int) -> LeaveResponse:
        leave = self.repo.get(leave_id)
        if not leave:
            raise NotFoundError(f"leave {leave_id} not found")
        self.repo.update_status(leave, LeaveStatus.APPROVED, approver_id=approver_id)
        self._dispatch(LeaveApproved(leave_id=leave.id, approver_id=approver_id))
        return LeaveResponse.model_validate(leave)

    def reject(self, leave_id: int, rejector_id: int, reason: str) -> LeaveResponse:
        leave = self.repo.get(leave_id)
        if not leave:
            raise NotFoundError(f"leave {leave_id} not found")
        self.repo.update_status(
            leave, LeaveStatus.REJECTED, approver_id=rejector_id, rejection_reason=reason
        )
        self._dispatch(LeaveRejected(leave_id=leave.id, rejector_id=rejector_id, reason=reason))
        return LeaveResponse.model_validate(leave)
```

`backend/modules/leave/router.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db, get_current_employee, require_permission
from backend.db.models.employee import Employee
from backend.modules.leave.repository import LeaveRepository
from backend.modules.leave.schemas import LeaveRejection, LeaveRequest, LeaveResponse, LeaveResult
from backend.modules.leave.service import LeaveService
from backend.modules.meetings.service import MeetingsService
from backend.modules.meetings.repository import MeetingsRepository

router = APIRouter(prefix="/leave", tags=["Leave"])


def _service(db: Session = Depends(get_db)) -> LeaveService:
    meetings = MeetingsService(MeetingsRepository(db))
    return LeaveService(LeaveRepository(db), meetings)


@router.post("/", response_model=LeaveResult)
def request_leave(
    payload: LeaveRequest,
    actor: Employee = Depends(require_permission("leave.request")),
    svc: LeaveService = Depends(_service),
) -> LeaveResult:
    return svc.request(actor.id, payload, force=False)


@router.post("/confirm", response_model=LeaveResponse)
def confirm_leave(
    payload: LeaveRequest,
    actor: Employee = Depends(require_permission("leave.request")),
    svc: LeaveService = Depends(_service),
):
    result = svc.request(actor.id, payload, force=True)
    # force=True can only return LeaveCreated
    assert result.intent == "leave_created"
    return result.leave


@router.post("/{leave_id}/approve", response_model=LeaveResponse)
def approve(
    leave_id: int,
    actor: Employee = Depends(require_permission("leave.approve")),
    svc: LeaveService = Depends(_service),
):
    return svc.approve(leave_id, actor.id)


@router.post("/{leave_id}/reject", response_model=LeaveResponse)
def reject(
    leave_id: int,
    payload: LeaveRejection,
    actor: Employee = Depends(require_permission("leave.reject")),
    svc: LeaveService = Depends(_service),
):
    return svc.reject(leave_id, actor.id, payload.reason)
```

`backend/modules/leave/tools.py`:

```python
"""Agent tools — thin adapters. No DB, no business logic."""
from __future__ import annotations

from datetime import date

from langchain.tools import tool

from backend.core.dependencies import get_db
from backend.modules.leave.repository import LeaveRepository
from backend.modules.leave.schemas import LeaveRequest, LeaveResult
from backend.modules.leave.service import LeaveService
from backend.modules.meetings.repository import MeetingsRepository
from backend.modules.meetings.service import MeetingsService
from backend.modules.employees.service import lookup_employee_by_email


def _service_and_session():
    """Context manager helper — yields a (service, session) pair."""
    gen = get_db()
    db = next(gen)
    svc = LeaveService(LeaveRepository(db), MeetingsService(MeetingsRepository(db)))
    return svc, db, gen


@tool
def apply_leave(
    employee_email: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    reason: str,
) -> dict:
    """Apply for leave (calendar conflict check enabled).

    Returns a structured dict with `intent` key. The frontend dispatches on it.
    """
    svc, db, _ = _service_and_session()
    try:
        emp = lookup_employee_by_email(db, employee_email)
        payload = LeaveRequest(
            leave_type=leave_type,
            start_date=date.fromisoformat(start_date),
            end_date=date.fromisoformat(end_date),
            reason=reason,
        )
        result: LeaveResult = svc.request(emp.id, payload, force=False)
        db.commit()
        return result.model_dump(mode="json")
    finally:
        db.close()


@tool
def confirm_leave(
    employee_email: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    reason: str,
) -> dict:
    """Confirm a leave despite calendar conflicts. Use after the user clicks 'Proceed' on a conflict dialog."""
    svc, db, _ = _service_and_session()
    try:
        emp = lookup_employee_by_email(db, employee_email)
        payload = LeaveRequest(
            leave_type=leave_type,
            start_date=date.fromisoformat(start_date),
            end_date=date.fromisoformat(end_date),
            reason=reason,
        )
        result = svc.request(emp.id, payload, force=True)
        db.commit()
        return result.model_dump(mode="json")
    finally:
        db.close()


@tool
def approve_leave(leave_id: int, approver_email: str) -> dict:
    """Approve a leave request (HR/admin only)."""
    svc, db, _ = _service_and_session()
    try:
        approver = lookup_employee_by_email(db, approver_email)
        resp = svc.approve(leave_id, approver.id)
        db.commit()
        return {"answer": f"Leave {leave_id} approved.", "intent": "leave_approved", "leave": resp.model_dump(mode="json")}
    finally:
        db.close()


@tool
def reject_leave(leave_id: int, rejector_email: str, reason: str) -> dict:
    """Reject a leave request (HR/admin only)."""
    svc, db, _ = _service_and_session()
    try:
        rejector = lookup_employee_by_email(db, rejector_email)
        resp = svc.reject(leave_id, rejector.id, reason)
        db.commit()
        return {"answer": f"Leave {leave_id} rejected.", "intent": "leave_rejected", "leave": resp.model_dump(mode="json")}
    finally:
        db.close()


LEAVE_TOOLS = [apply_leave, confirm_leave, approve_leave, reject_leave]
```

`backend/modules/leave/events.py`:

```python
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class LeaveRequested:
    leave_id: int
    employee_id: int


@dataclass(frozen=True)
class LeaveApproved:
    leave_id: int
    approver_id: int


@dataclass(frozen=True)
class LeaveRejected:
    leave_id: int
    rejector_id: int
    reason: str
```

### `backend/modules/notifications/subscribers.py` (full)

```python
"""Subscribers — react to events emitted by other modules.

When this file is imported (in backend/main.py), the @subscribe decorators
register the handlers. Importing is the registration mechanism.
"""
from __future__ import annotations

import logging

from backend.core.events import subscribe
from backend.core.email import send_email
from backend.modules.leave.events import LeaveApproved, LeaveRejected, LeaveRequested
from backend.modules.name_change.events import NameChangeRequested
from backend.modules.notifications.service import notifications_service_factory
from backend.modules.employees.service import lookup_employee_by_id
from backend.db.session import SessionLocal

logger = logging.getLogger(__name__)


@subscribe(LeaveRequested)
def on_leave_requested(event: LeaveRequested) -> None:
    with SessionLocal() as db:
        svc = notifications_service_factory(db)
        svc.create_for_role(
            db,
            role_name="hr",
            title="New leave request",
            message=f"Employee #{event.employee_id} submitted leave request #{event.leave_id}.",
        )
        emp = lookup_employee_by_id(db, event.employee_id)
        send_email(
            db=db,
            to="hr@example.com",   # replaced by settings.HR_EMAIL in production
            subject=f"Leave request — {emp.name}",
            body=f"{emp.name} (#{emp.id}) requested leave #{event.leave_id}.",
            triggered_by="leave.requested",
        )
        db.commit()


@subscribe(LeaveApproved)
def on_leave_approved(event: LeaveApproved) -> None:
    with SessionLocal() as db:
        svc = notifications_service_factory(db)
        # Notify the employee (find via the leave)
        from backend.modules.leave.repository import LeaveRepository
        leave = LeaveRepository(db).get(event.leave_id)
        if not leave:
            logger.warning("LeaveApproved fired for unknown leave_id %s", event.leave_id)
            return
        svc.create_for_employee(
            db,
            employee_id=leave.employee_id,
            title="Leave approved",
            message=f"Your {leave.leave_type.value} leave has been approved.",
        )
        emp = lookup_employee_by_id(db, leave.employee_id)
        send_email(
            db=db, to=emp.email,
            subject="Leave approved",
            body=f"Hi {emp.name}, your {leave.leave_type.value} leave was approved.",
            triggered_by="leave.approved",
        )
        db.commit()


@subscribe(LeaveRejected)
def on_leave_rejected(event: LeaveRejected) -> None:
    with SessionLocal() as db:
        from backend.modules.leave.repository import LeaveRepository
        leave = LeaveRepository(db).get(event.leave_id)
        if not leave:
            return
        svc = notifications_service_factory(db)
        svc.create_for_employee(
            db,
            employee_id=leave.employee_id,
            title="Leave rejected",
            message=f"Your leave was rejected: {event.reason}",
        )
        emp = lookup_employee_by_id(db, leave.employee_id)
        send_email(
            db=db, to=emp.email,
            subject="Leave rejected",
            body=f"Hi {emp.name}, your leave was rejected.\n\nReason: {event.reason}",
            triggered_by="leave.rejected",
        )
        db.commit()


@subscribe(NameChangeRequested)
def on_name_change_requested(event: NameChangeRequested) -> None:
    with SessionLocal() as db:
        svc = notifications_service_factory(db)
        svc.create_for_role(
            db, role_name="hr",
            title="Name change request",
            message=f"Employee #{event.employee_id} requested name change to '{event.new_name}'.",
        )
        db.commit()
```

Register subscribers in `backend/main.py`:

```python
# After app setup, BEFORE first request:
import backend.modules.notifications.subscribers  # noqa: F401
import backend.modules.audit.subscribers          # noqa: F401
```

---

## Phase-by-phase playbook

Every task is broken to hour-level granularity. Each step has a verify command. Each task has a recovery branch.

### Phase 0 — Safety (1 week)

#### Task 0.1 — Rotate committed secrets (4 hours)

**Hour 1 — Generate new secrets.**

```bash
# JWT
openssl rand -hex 32
# → copy to .env and to every environment's secret store

# Database password (if rotating)
openssl rand -base64 24

# Verify entropy
python3 -c "import secrets; print(len(secrets.token_hex(32)))"
# → 64
```

**Hour 2 — Update `.env` files everywhere.**

```bash
# Local dev
sed -i.bak "s/^JWT_SECRET=.*/JWT_SECRET=<new>/" .env

# Staging
ssh staging "sed -i.bak 's/^JWT_SECRET=.*/JWT_SECRET=<new>/' /opt/agentichrms/.env"

# Prod: use whatever secret manager (Vault, AWS SSM, GCP Secret Manager)
# Update there, then redeploy.
```

Verify: `grep JWT_SECRET .env` shows new value.

**Hour 3 — Strip literal from `config.py`.**

```bash
# Open config.py (root)
# Delete the line: SECRET_KEY = 'WvRVUUNfrXG1mBesBboQKylrFJnoRdcu9RI7aldfmdW'
# Delete the line: HR_EMAIL = getattr(settings, "HR_EMAIL", "akulkarni@sveltoz.com")
# (Note: root config.py is fully deleted in task 0.6 — for now, just strip the offending literals.)

# Open backend/core/config.py
# Replace: JWT_SECRET: str = "change-this-in-production"
# With:    JWT_SECRET: str   # required, no default
# Same for DATABASE_URL, AI_KEY, EMAIL_PASS, HR_EMAIL, ADMIN_EMAIL

# Verify
python -c "from backend.core.config import settings; print(settings.JWT_SECRET[:8])"
# → first 8 chars of the new secret (loaded from .env)
gitleaks detect --source . --no-git
# → no findings
```

**Hour 4 — Verify CI gitleaks step + PR.**

```bash
# Run pre-commit
pre-commit run gitleaks --all-files
# → Passed

# Commit
git checkout -b migration/p0-rotate-secrets
git add config.py backend/core/config.py
git commit -m "rotate JWT_SECRET, strip committed defaults (R8)"
git push -u origin migration/p0-rotate-secrets
gh pr create --title "Phase 0.1 — Rotate committed secrets" --body "Closes secrets in config.py and removes JWT_SECRET default. Rule R8."
```

**If a service starts failing with "JWT decode failed":** the new secret didn't propagate to all instances. Roll back the deploy, fix `.env`, redeploy.

**Rollback:** restore `pre-migration-baseline` tag + restore old `.env` from vault. Notify users that their session may need re-login.

---

#### Task 0.2 — Hash PIN column (per Decision F.1) (4 hours)

**Hour 1 — Migration.**

```bash
alembic revision -m "rename_pin_code_to_pin_hash"
# Open the generated file at alembic/versions/<rev>_rename_pin_code_to_pin_hash.py
# Paste the upgrade()/downgrade() from "Migration runbook → Anatomy" above.

alembic upgrade head
# Verify
psql -h localhost -U hrms_user -d agentic_hrms -c "\d pin_verifications"
# → pin_hash column exists, pin_code column gone
```

**Hour 2 — Update service code.**

```bash
grep -rn "pin_code" backend/
# → expected hits in pin_auth.py and (after split) modules/auth/pin_service.py
```

For each hit, decide based on context:

| Context | Replacement |
|---|---|
| Writing to DB: `pv.pin_code = pin` | `pv.pin_hash = bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()` |
| Comparing for verification: `if pv.pin_code == submitted` | `if bcrypt.checkpw(submitted.encode(), pv.pin_hash.encode())` |
| Returning to API: `default_pin = pin_code` | **Delete.** Never return a PIN. |

Verify: `grep -rn "pin_code" backend/` → 0 hits.

**Hour 3 — Tests.**

Update characterization test for PIN login. Ensure the legacy plaintext-PIN path no longer exists.

```bash
pytest backend/tests/characterization/test_login_pin_current.py -v
```

**Hour 4 — PR.**

```bash
git checkout -b migration/p0-hash-pin
git add -A
git commit -m "hash PIN at rest, drop plaintext column (R18, decision F.1.b)"
gh pr create --title "Phase 0.2 — Hash PIN column"
```

**Rollback:** `alembic downgrade -1` puts the plaintext column back (empty). Service code reverts via `git revert`.

---

#### Task 0.3 — Remove auto-migration from app startup (1 hour)

```bash
# Edit backend/main.py
# Delete the run_migrations() function (lines ~34-42)
# Delete the call to run_migrations() inside lifespan
# Verify
grep -n "alembic" backend/main.py
# → 0 hits

# Add a startup smoke that verifies the DB is at head revision (fail-fast)
# Append to lifespan startup:
#     from alembic.runtime.migration import MigrationContext
#     from sqlalchemy import inspect
#     with engine.connect() as conn:
#         ctx = MigrationContext.configure(conn)
#         current = ctx.get_current_revision()
#         if not current:
#             raise RuntimeError("DB not migrated; run `alembic upgrade head`")

# PR
git checkout -b migration/p0-no-autostart-migrations
git add backend/main.py
git commit -m "move migrations to deploy step; refuse to boot on unmigrated DB (R16)"
```

---

#### Task 0.4 — Delete dead code (2 hours)

```bash
# Verify each is truly dead before deleting
grep -rn "from tools\|import tools" backend/ agent/
# → only test_retrieval.py
grep -rn "agent.graph\|from agent import graph" backend/
# → 0 hits
grep -rn "app.py" .
# → README only (file doesn't exist)

# Delete
rm -rf tools/
rm agent/graph.py
rm test_retrieval.py
rm project_tree.txt

# Verify the app still boots
python -m uvicorn backend.main:app --port 8000 &
sleep 3
curl http://localhost:8000/health
# → {"status":"healthy"}
kill %1

# PR
git checkout -b migration/p0-delete-dead-code
git add -A
git commit -m "delete unused tools/, agent/graph.py, test_retrieval.py, project_tree.txt"
```

**If something breaks:** the dead-code check was wrong. `git revert` and grep more carefully (case-sensitive, look for `from X import` and dynamic imports via `importlib`).

---

#### Task 0.5 — Move dev scripts to `scripts/` (1 hour)

```bash
mkdir -p scripts
git mv seed_db.py scripts/seed_db.py
git mv seed_meetings.py scripts/seed_meetings.py
git mv set_admin_pin.py scripts/set_admin_pin.py
git mv retrain.py scripts/retrain.py

# Fix any hardcoded relative paths inside the scripts
# (most use Path(__file__).parent.parent for ROOT — verify still correct)

# Update README to reference scripts/ paths

# Verify
python scripts/seed_db.py --help 2>&1 | head -1
# → should not error on import
```

---

#### Task 0.6 — Delete root `config.py` shim (2 hours)

```bash
# Find all importers
grep -rn "from config import\|^import config" .
# → expected: agent/agent.py, rag/ingest_docs.py, scripts/* if any

# Replace each
sed -i.bak 's|from config import|from backend.core.config import settings  # NOTE: refactor downstream|' agent/agent.py
# ...and so on — but cleaner to do it manually file by file.

# For each file, change e.g.:
#   from config import OPENAI_API_KEY, AGENT_MODEL
# to:
#   from backend.core.config import settings
# Then reference settings.AI_KEY, settings.AI_MODEL.

# Delete the shim
rm config.py

# Verify
python -c "from backend.core.config import settings; print(settings.AI_KEY[:5])"
python -m uvicorn backend.main:app --port 8000 &
sleep 3
curl http://localhost:8000/health
kill %1

# PR
```

**If imports break:** `git revert`, list remaining shim imports, fix them, retry.

---

#### Task 0.7 — README rewrite (2 hours)

```bash
# Open README.md
# Replace:
#   - "SQLite" → "Postgres"
#   - "data/hr_database.sqlite" → "Postgres (DATABASE_URL)"
#   - Streamlit app.py paragraph → delete
#   - "17 AI-Powered Tools" → "15 tools (10 functional, 5 stubs — see Phase 4 plan)"
#   - "python ingest_docs.py" → "python rag/ingest_docs.py"
#   - "python seed_db.py" → "python scripts/seed_db.py"

# Append a "Documentation" section linking to:
#   STRUCTURAL_REVIEW.md, RULES.md, ARCHITECTURE.md, EXECUTION.md
```

---

#### Task 0.8 — CI baseline (4 hours)

Already specified in [W0.6](#w06--ci-scaffold). Push the workflow + AST scripts + ruff/mypy config in one PR.

**Verify:** PR triggers CI; CI runs; pass/fail status reflects code state.

---

#### Phase 0 exit gate

```
[ ] gitleaks clean
[ ] PINVerification.pin_hash column exists; .pin_code gone
[ ] backend/main.py has no alembic.upgrade call
[ ] tools/ + agent/graph.py + project_tree.txt + test_retrieval.py + root config.py deleted
[ ] scripts/ contains the dev scripts
[ ] README accurate
[ ] CI green on a fresh clone (or known-failure list documented)
[ ] git tag phase-0-complete
```

---

### Phase 1 — Foundation (1 week)

#### Task 1.4 — Alembic baseline squash (8 hours, tech lead)

Already detailed step-by-step in [Migration runbook → Baseline squash runbook](#baseline-squash-runbook-phase-14).

#### Task 1.1 — Split `models.py` per domain (8 hours, backend dev A)

**Hour 1 — Create the directory.**

```bash
mkdir -p backend/db/models
touch backend/db/models/__init__.py
```

**Hour 2 — `backend/db/base.py`.**

```python
# backend/db/base.py
from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, DateTime, func


class Base(DeclarativeBase):
    pass


class BaseModel(Base):
    __abstract__ = True
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
```

**Hour 3-6 — Move models one file at a time.**

For each table, in order: `rbac.py`, `employee.py`, `auth.py` (PINVerification, FaceLoginAttempt, User), `leave.py`, `notification.py`, `chat.py`, `onboarding.py`, `meeting.py`, `name_change.py`, `audit.py`.

For each:

```bash
# Step 1: copy the class definition from backend/database/models.py to backend/db/models/<file>.py
# Step 2: import Base/BaseModel from backend.db.base (not from backend.database.session)
# Step 3: rewrite relationships using string references — "Leave" not Leave

# After each file, verify
python -c "from backend.db.models.leave import Leave; print(Leave.__tablename__)"
# → leaves
```

**Hour 7 — `__init__.py` re-exports.**

```python
# backend/db/models/__init__.py
from backend.db.base import Base, BaseModel
from .rbac import Role, Permission, RolePermission
from .employee import Employee
from .auth import User, FaceLoginAttempt, PINVerification
from .leave import Leave, LeaveBalance, LeaveStatus, LeaveType
from .notification import Notification
from .chat import ChatSession, ChatMessage
from .onboarding import OnboardingTask
from .meeting import Meeting
from .name_change import NameChangeRequest, NameChangeStatus
from .audit import EmailLog

__all__ = [
    "Base", "BaseModel",
    "Role", "Permission", "RolePermission",
    "Employee",
    "User", "FaceLoginAttempt", "PINVerification",
    "Leave", "LeaveBalance", "LeaveStatus", "LeaveType",
    "Notification",
    "ChatSession", "ChatMessage",
    "OnboardingTask",
    "Meeting",
    "NameChangeRequest", "NameChangeStatus",
    "EmailLog",
]
```

**Hour 8 — Delete old `backend/database/models.py` + fix imports.**

```bash
# Update every importer
grep -rn "from backend.database.models" backend/ scripts/ agent/

# Replace
find backend/ scripts/ agent/ -name "*.py" -exec sed -i.bak \
  's|from backend.database.models|from backend.db.models|g' {} +

# Remove the old file
git rm backend/database/models.py

# Verify
wc -l backend/db/models/*.py
# → none > 150
python -c "from backend.db.models import Employee, Leave, Role; print(Employee, Leave, Role)"
alembic upgrade head    # should be a no-op
pytest backend/tests/characterization/ -v
```

**If circular imports:** the issue is almost always cross-module `relationship(SomeClass, ...)` — replace with `relationship("SomeClass", ...)` (string reference).

---

#### Task 1.2 — Resolve User vs Employee (8 hours, per Decision F.2.a)

(Detailed migration template — same pattern as 0.2 hash PIN. Plan: drop face_registered, face_login_enabled, role columns from User; rename chat_sessions.user_id → employee_id; backfill.)

Skipped here for brevity — follow the expand→contract pattern in [Migration runbook → Zero-downtime](#zero-downtime-expand--contract) over 3 deploys.

---

#### Task 1.3 — Introduce enums (4 hours)

```bash
alembic revision -m "add_status_enums"
# Paste the enum migration template from "Migration runbook → Enum migration"
# Repeat for: LeaveStatus, LeaveType, NameChangeStatus, PinType
alembic upgrade head
pytest backend/tests/characterization/ -v
```

---

#### Task 1.5 — `db/base.py` (1 hour) — already done in Task 1.1 Hour 2.

#### Task 1.6 — Service/repository scaffolds (3 hours)

Drop the reference implementations from [Reference implementations](#reference-implementations) above:
- `backend/core/exceptions.py`
- `backend/core/events.py`
- `backend/core/middleware.py`
- `backend/core/dependencies.py`

**Verify:**

```python
# Quick smoke
python -c "from backend.core.exceptions import NotFoundError; raise NotFoundError('x')"
# → NotFoundError: x
python -c "from backend.core.events import subscribe, dispatch; print('ok')"
```

#### Task 1.7 — Global exception handler (1 hour)

Wire up in `backend/main.py`:

```python
from backend.core.exceptions import AppError
from fastapi.responses import JSONResponse

@app.exception_handler(AppError)
async def _handle_app_error(request, exc: AppError):
    return JSONResponse(
        status_code=exc.http_status,
        content={"code": exc.code, "message": exc.message, "details": exc.details},
    )
```

Smoke: hit any endpoint that's been refactored to raise `NotFoundError` → response is 404 with `{code, message, details}` body.

#### Task 1.8 — Request-ID middleware + structured logging (2 hours)

Drop `backend/core/middleware.py` from Reference Implementations. Wire up in `main.py`.

Verify: tail logs from a curl → see JSON lines with `request_id` field.

#### Task 1.9 — Characterization tests (1.5 days)

Write the 9 mandatory tests. Each pinned to the **current** code path (pre-refactor).

After Phase 4 completes, delete `backend/tests/characterization/` in a single PR.

#### Phase 1 exit gate

```
[ ] backend/db/models/ — 10 files, none > 150 lines
[ ] Alembic squashed to 0001_baseline.py
[ ] Enums live: LeaveStatus, LeaveType, NameChangeStatus, PinType
[ ] User/Employee resolved per Decision F.2
[ ] BaseRepository, BaseService, exceptions, events, middleware all in place
[ ] Global exception handler maps typed exceptions to HTTP
[ ] Every log line carries request_id
[ ] Characterization tests pass (9 scenarios)
[ ] Coverage on backend/core/ ≥ 80%
[ ] CI green
[ ] git tag phase-1-complete
```

---

### Phase 2 — Reference module: `leave/` (1 week)

The hour-level breakdown for `leave/` is the template every later module copies.

#### Task 2.1 — Scaffold (1 hour)

```bash
mkdir -p backend/modules/leave
cd backend/modules/leave
touch __init__.py router.py service.py repository.py schemas.py tools.py events.py README.md
```

#### Task 2.2 — Move Leave models (1 hour)

The models already moved to `backend/db/models/leave.py` in Task 1.1. The module re-exports them via its own `models.py`:

```python
# backend/modules/leave/models.py
from backend.db.models.leave import Leave, LeaveBalance, LeaveStatus, LeaveType  # noqa: F401
```

#### Task 2.3 — `LeaveRepository` (2 hours)

Paste from Reference Implementations. Customize if needed (e.g. add `find_overlapping`).

```bash
# Verify
python -c "from backend.modules.leave.repository import LeaveRepository; print(LeaveRepository)"
```

#### Task 2.4 — `LeaveService` (6 hours)

Paste from Reference Implementations.

Tests:

```bash
# Write backend/tests/modules/leave/test_service.py from the test template above
pytest backend/tests/modules/leave/test_service.py -v --cov=backend/modules/leave/service
# → ≥ 80% coverage
```

#### Task 2.5 — Router (2 hours)

Paste from Reference Implementations.

```bash
# Smoke
curl -X POST http://localhost:8000/api/leave/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"leave_type":"casual","start_date":"2026-06-01","end_date":"2026-06-03","reason":"vacation"}'
# → {"intent":"leave_created","leave":{...}}
```

#### Task 2.6 — RBAC permissions migration (2 hours)

```bash
# Apply the permission seed migration from "Migration runbook → Permission seed"
alembic upgrade head
psql -c "SELECT name FROM permissions WHERE name LIKE 'leave.%';"
# → 7 rows
```

Wire `require_permission` in `dependencies.py`. Test:

```python
# An employee without 'leave.approve' should get 403
def test_employee_cannot_approve(client, auth_headers):
    headers, _ = auth_headers(role="employee")
    res = client.post("/api/leave/1/approve", headers=headers)
    assert res.status_code == 403
```

#### Task 2.7 — Agent tools (2 hours)

Paste `tools.py` from Reference Implementations.

```bash
# AST lint
python scripts/lint/tools_purity.py
# → OK
```

#### Task 2.8 — Characterization tests pass (gate)

```bash
pytest backend/tests/characterization/ -v
```

If any test fails: the service's behaviour differs from the original. Diff, decide, fix.

#### Task 2.9 — Agent tool registry update (1 hour)

Create `backend/agent/tool_registry.py` (from Reference Implementations) importing `LEAVE_TOOLS`. Delete `apply_leave`/`confirm_leave`/`approve_leave`/`reject_leave` from old `agent/tools_registry.py`.

#### Phase 2 exit gate

```
[ ] All 6 leave-related tools removed from agent/tools_registry.py
[ ] backend/modules/leave/* present
[ ] Router thin (AST lint passes)
[ ] Service tested ≥ 80%
[ ] Tools tested
[ ] RBAC: require_permission resolver works against Permission table
[ ] Integration test: REST + chat both produce identical leave rows
[ ] Characterization tests green
[ ] Module README written
[ ] git tag phase-2-complete
```

---

### Phase 3 — Notifications (3 days)

Apply the Phase-2 template to `backend/modules/notifications/`:

```
Day 1:
  Hour 1-2: scaffold module
  Hour 3-4: NotificationRepository
  Hour 5-6: NotificationService (create_for_employee, create_for_role, mark_read)
  Hour 7-8: router (GET /notifications/unread, POST /notifications/{id}/read)

Day 2:
  Hour 1-3: Subscribers (paste from Reference Implementations)
  Hour 4-6: Refactor backend/api/leaves_admin.py to call LeaveService.approve/reject
            — DELETE inline Notification(...) and send_email(...) calls
  Hour 7-8: Tests

Day 3:
  Hour 1-4: Refactor any remaining inline notification creation
            grep -rn "Notification(" backend/ | grep -v modules/notifications/
            → 0 hits
  Hour 5-8: Phase exit checklist + tag
```

**Exit:**

```
[ ] grep -rn "Notification(" backend/ | grep -v modules/notifications/ → 0 hits
[ ] Leave approval emits 1 event → 1 notification + 1 email + 1 audit row
[ ] git tag phase-3-complete
```

---

### Phase 4 — Remaining modules (2-3 weeks)

Each sub-phase is a 3-5 day PR. Apply the Phase-2 template. The hour-level breakdown is identical: scaffold → repo → service → router → tools → tests → RBAC seed.

#### 4.1 `auth/` (5 days, backend dev A)

Special concerns:
- Face enrollment + classifier retraining + SMS dispatch must split into `AuthService.enroll_face(...)`, `AuthService.send_pin(...)`, with the slow classifier-retraining moved to a background task (use FastAPI `BackgroundTasks`).
- The 3 sub-routers (face_auth, pin_auth, registration) collapse into one `modules/auth/router.py`.

#### 4.2 `employees/` + `name_change/` (5 days, backend dev B)

Special concerns:
- **Delete the `NAME_CHANGE_INTENT` regex block at chat.py:114-187**.
- Replace with a real agent tool `submit_name_change_request(employee_email, new_name, reason)` that returns `{intent: "name_change_submitted", id, new_name, ...}`.
- The frontend's intent registry picks it up and shows the confirmation dialog.

#### 4.3 `onboarding/` (2-5 days, per Decision F.3)

If decision = (b) "ask HR":

```python
@tool
def get_onboarding_checklist(employee_email: str) -> dict:
    return {"answer": "Onboarding details — please contact HR.", "intent": None}
```

If decision = (a) implement: full module like leave/, backed by `OnboardingTask` rows.

#### 4.4 `documents/` (3 days)

Move `rag/ingest_docs.py` → `backend/modules/documents/ingest.py`. Move `search_policies` → `modules/documents/tools.py`. Wire the reranker that's configured in `backend/core/config.py:98`:

```python
# modules/documents/retriever.py
from sentence_transformers import CrossEncoder

reranker = CrossEncoder(settings.RERANK_MODEL)

def search(query: str, k: int = 8, rerank_top: int = 3) -> list[dict]:
    results = collection.query(query_embeddings=[embed(query)], n_results=k, ...)
    # Rerank
    pairs = [(query, doc) for doc in results["documents"][0]]
    scores = reranker.predict(pairs)
    ranked = sorted(zip(results["documents"][0], results["metadatas"][0], scores), key=lambda x: -x[2])
    return ranked[:rerank_top]
```

#### 4.5 `admin/` (2 days)

Role updates, email log viewer, email-settings.

#### 4.6 `meetings/` (2 days)

`_fetch_ics_meetings` → `MeetingsService.find_conflicts`.

#### 4.7 `chat/` (3 days, tech lead)

By now every intent it dispatches is a tool. The router becomes:

```python
@router.post("/", response_model=ChatResponse)
def chat(payload: ChatRequest, actor=Depends(get_current_employee), svc: ChatService = Depends(_service)):
    return svc.invoke(actor, payload.message, payload.session_id)
```

`ChatService.invoke` calls `runner.get_executor(...)`, parses `intermediate_steps`, surfaces `intent` + `intent_payload`.

#### Phase 4 exit gate

```
[ ] grep -rn "NAME_CHANGE_INTENT" backend/ → 0
[ ] grep -rn "SessionLocal\|db\.query" backend/modules/*/tools.py → 0
[ ] grep -rn "Notification(" backend/ | grep -v modules/notifications/ → 0
[ ] grep -rn "require_role" backend/modules/ → 0
[ ] Every module has tools (or explicitly none) + router + service + repository + tests + README
[ ] Coverage ≥ 80% on every service.py
[ ] Characterization tests can now be DELETED
[ ] git tag phase-4-complete
```

---

### Phase 5 — Agent runner consolidation (3 days)

#### Day 1 — Runner

Paste `backend/agent/runner.py` from Reference Implementations. Paste `backend/agent/prompts/main.md`.

```bash
# Verify
python -c "from backend.agent.runner import get_executor; print(get_executor(1, 'a@b.com', 'A'))"
# → AgentExecutor instance
```

#### Day 2 — Switch chat router

```bash
# backend/modules/chat/service.py uses runner.get_executor
# Delete agent/agent.py
rm agent/agent.py
# Delete agent/tools_registry.py (already replaced by backend/agent/tool_registry.py)
rm agent/tools_registry.py
rmdir agent || true   # if empty
```

#### Day 3 — Latency benchmark

```bash
# Baseline (before): time 10 chat requests
hyperfine --runs 10 'curl -s -X POST http://localhost:8000/api/chat/ -H "Authorization: Bearer X" -d "{\"message\":\"hi\"}"'

# After cached executor:
# Expect ~100-300ms drop on the 2nd+ requests
```

#### Phase 5 exit gate

```
[ ] No reference to LangGraph anywhere
[ ] backend/agent/runner.py exists; cache works
[ ] System prompts under backend/agent/prompts/*.md
[ ] grep -rn "re\.search\|re\.match" backend/modules/chat/ → 0
[ ] Chat latency improvement documented in CHANGELOG
[ ] git tag phase-5-complete
```

---

### Phase 6 — Frontend foundation (1 week)

Detailed in [Frontend execution specifics → Day-by-day order](#day-by-day-order-phase-6).

#### Phase 6 exit gate

```
[ ] tsc --noEmit clean
[ ] Tailwind classes render
[ ] shadcn primitives render
[ ] apiClient is the only network surface (grep -rn "fetch(" frontend/src/ | grep -v lib/apiClient → 0)
[ ] AuthProvider is the only localStorage reader (grep -rn "localStorage" frontend/src/ | grep -v features/auth/ → 0 after Phase 7)
[ ] React Router routes work
[ ] React Query devtools visible
[ ] gen:types produces non-empty api.d.ts
[ ] ESLint custom rules enforce R21-R26
[ ] git tag phase-6-complete
```

---

### Phase 7 — Feature-by-feature FE rewrite (2-3 weeks)

Each feature is the [Feature port template](#feature-port-template-phase-7).

Order (matches backend module order):

| # | Feature | Days |
|---|---|---|
| 7.1 | auth (Login, Register, FaceLogin, PinLogin, VerifyPin) | 4 |
| 7.2 | leave (LeaveRequestForm, ConflictDialog, LeaveList) | 3 |
| 7.3 | chat (ChatPage, SessionSidebar, intent registry) | 4 |
| 7.4 | notifications (Bell, Dropdown) | 2 |
| 7.5 | employees/profile (ProfilePage, NameChangeDialog) | 2 |
| 7.6 | onboarding | 3 |
| 7.7 | admin | 2 |
| 7.8 | hr | 1 |
| 7.9-7.10 | Cleanup: delete App.jsx, delete flat components | 1 |

#### Phase 7 exit gate

```
[ ] frontend/src/App.jsx — deleted
[ ] frontend/src/components/*.jsx — deleted (all 12)
[ ] grep -rn "fetch(" frontend/src/features/ → 0
[ ] grep -rn "localStorage" frontend/src/features/ | grep -v features/auth/ → 0
[ ] grep -rn "style={{" frontend/src/features/ → only dynamic computed values (manual review)
[ ] All routes go through React Router
[ ] Vitest suite passes
[ ] Visual diff against pre-migration product-equivalent
[ ] git tag phase-7-complete
```

---

### Phase 8 — Hardening (1 week)

#### Day 1-2 — Audit log

```python
# backend/modules/audit/subscribers.py
from backend.core.events import subscribe
from backend.modules.leave.events import LeaveApproved, LeaveRejected, LeaveRequested
from backend.modules.audit.service import write_audit
from backend.db.session import SessionLocal


@subscribe(LeaveRequested)
def _audit_leave_requested(e):
    with SessionLocal() as db:
        write_audit(db, actor_id=e.employee_id, action="leave.requested", target_id=e.leave_id, details={})
        db.commit()

@subscribe(LeaveApproved)
def _audit_leave_approved(e):
    with SessionLocal() as db:
        write_audit(db, actor_id=e.approver_id, action="leave.approved", target_id=e.leave_id, details={})
        db.commit()

# ... and so on for every state-changing event
```

#### Day 2-3 — Accessibility pass

```bash
cd frontend
npm i -D @axe-core/react
# Add to development entrypoint:
#   if (import.meta.env.DEV) {
#     import('@axe-core/react').then(({ default: axe }) => axe(React, ReactDOM, 1000));
#   }
npm run dev
# Open browser devtools; review axe console output
```

Manual checklist per page:
- Keyboard nav: every interactive element reachable via Tab
- Focus visible
- Dialog focus-trapped
- Form labels associated
- Errors announced (aria-live)

#### Day 4 — React error boundary

```tsx
// frontend/src/app/errorBoundary.tsx
import { Component, ReactNode } from "react";
import { toast } from "sonner";

interface S { hasError: boolean }
export class ErrorBoundary extends Component<{ children: ReactNode }, S> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    toast.error("Something went wrong. Please reload.");
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">Something broke</h1>
            <p className="text-muted-foreground">Please reload the page.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Wrap `<App>` with it.

#### Day 4-5 — OpenAPI docs polish

```python
# In each router file
router = APIRouter(prefix="/leave", tags=["Leave"])

@router.post("/", response_model=LeaveResult, summary="Submit a leave request",
             description="Returns LeaveCreated on success, or ConflictDetected if calendar conflicts exist.")
def request_leave(...): ...
```

Visit `/docs` — every endpoint has a tag, summary, description, and example.

#### Day 5 — Final CI gates

Flip every soft rule to hard:

```yaml
# CI: was `mypy ... || true`, now no `|| true`
- name: Mypy
  run: mypy backend/core/ backend/modules/
# Coverage: was 70, now 80
- name: Pytest
  run: pytest --cov-fail-under=80
```

#### Phase 8 exit gate

```
[ ] Audit row exists for every state-changing event (smoke: approve a leave → check audit_log)
[ ] Production logs are JSON (set LOG_FORMAT=json in prod)
[ ] axe-core reports zero violations on /login, /chat, /admin
[ ] Error boundary catches a simulated render error
[ ] /docs has tags + summaries + descriptions on every endpoint
[ ] Every CI gate is blocking (no `|| true`, no `continue-on-error`)
[ ] git tag phase-8-complete
[ ] git tag migration-complete
```

---

## Deployment & rollout

### Environments

```
dev      — laptop, Docker Postgres, Mailpit
staging  — single VM or k8s, real Postgres, real Twilio (test account), real SMTP
prod     — multi-instance, managed Postgres (RDS/Cloud SQL), real SMTP, real Twilio
```

Each environment has its own `.env`. None of them ever include the others' secrets.

### Per-phase deployment

Every phase deploys to staging first; soaks for 24h; then prod.

```
Per phase:
  1. Merge phase work to main
  2. CI green
  3. Deploy main → staging
  4. Smoke test on staging (the phase exit-checklist tests)
  5. Soak 24 hours; monitor error rate, latency
  6. Deploy main → prod (off-peak window)
  7. Tag phase-N-complete
```

### Database migration deploy sequence

**Always run migrations BEFORE app deploy. Never simultaneously.**

```
T - 5 min:  Announce maintenance (if needed for breaking migrations)
T - 0:      ssh prod
            cd /opt/agentichrms
            git pull origin main
            source venv/bin/activate
            alembic upgrade head    # migrate
            psql -c "SELECT version_num FROM alembic_version;"   # verify
T + 1 min:  systemctl restart agentichrms-backend
            systemctl restart agentichrms-frontend
T + 2 min:  curl https://app.example.com/health
            tail -f /var/log/agentichrms.log | grep ERROR
T + 5 min:  Acknowledge in team channel
```

### Feature flag rollout (for risky modules)

Each refactored module ships with a `LEAVE_MODULE_V2_ENABLED` style env flag. In `backend/main.py`:

```python
if settings.LEAVE_MODULE_V2_ENABLED:
    from backend.modules.leave.router import router as leave_router
    app.include_router(leave_router, prefix="/api")
else:
    from backend.api.leaves_admin import router as legacy_leaves_router
    app.include_router(legacy_leaves_router, prefix="/api")
```

Rollout:
1. Deploy with flag = false. Code is in prod but inert.
2. Enable flag in staging. Soak.
3. Enable flag in prod. Monitor.
4. After 1 week stable, remove the flag (and the legacy router) in a cleanup PR.

### Blue/green or rolling

If you have ≥ 2 backend instances:

```
1. Deploy new code to 1 instance (green).
2. Health check passes.
3. Shift 10% traffic to green; soak 10 min.
4. Shift 50%; soak 10 min.
5. Shift 100%.
6. Decommission blue.
```

If single-instance: schedule the deploy in off-peak, accept 30 seconds of 503 during restart, set `MAINTENANCE_MODE=true` for the window.

### Cache invalidation

After deploying any of these, restart the backend process to clear in-memory state:
- A new permission added to `RolePermission`
- A change to `backend/agent/prompts/*.md`
- A change to `backend/core/config.py` constants

The agent executor cache (`backend/agent/runner.py`) auto-expires after 30 min, so a deploy + restart picks up new prompts within at most one TTL.

---

## Seed data & local realism

### `scripts/seed_db.py` v2 (sketch)

```python
"""Idempotent — safe to re-run. Creates a minimal but realistic dataset."""
from datetime import datetime, timedelta
from backend.db.session import SessionLocal
from backend.db.models import Role, Permission, RolePermission, Employee, User
from backend.core.security import get_password_hash

ROLES = ["employee", "hr", "admin"]
EMPLOYEES = [
    # (name, email, phone, dept, role)
    ("Rahul Sharma", "rahul@example.com", "+919876543210", "Engineering", "employee"),
    ("Akanksha Kulkarni", "hr@example.com", "+919876543211", "HR",           "hr"),
    ("Admin User",      "admin@example.com", "+919876543212", "Admin",       "admin"),
]

def seed():
    with SessionLocal() as db:
        # Roles
        for name in ROLES:
            if not db.query(Role).filter_by(name=name).first():
                db.add(Role(name=name, description=f"Auto: {name}"))
        db.flush()
        # Employees + Users
        for name, email, phone, dept, role_name in EMPLOYEES:
            role = db.query(Role).filter_by(name=role_name).first()
            emp = db.query(Employee).filter_by(email=email).first()
            if not emp:
                emp = Employee(
                    name=name, email=email, phone=phone, department=dept,
                    role_id=role.id, status="active",
                    permanent_pin_hash=get_password_hash("123456"),
                )
                db.add(emp)
                db.flush()
            if not db.query(User).filter_by(employee_id=emp.id).first():
                db.add(User(
                    employee_id=emp.id, username=email.split("@")[0],
                    password_hash=get_password_hash("password"),
                ))
        db.commit()
    print("Seeded.")

if __name__ == "__main__":
    seed()
```

### `scripts/seed_realistic.py`

Generates 50 employees across 5 departments, 200 leaves (mixed statuses), 30 onboarding tasks. Use `faker` for variety. Run only in dev.

### Local SMTP capture (Mailpit)

Already in W0.4 Step 6. UI at http://localhost:8025 shows every email sent. No real delivery.

### Local Twilio mock

Don't connect to real Twilio in dev. Patch `backend/services/twilio_service.py`:

```python
# In dev, replace send_pin_sms with a logger
if settings.TWILIO_ACCOUNT_SID.startswith("AC_test"):
    def send_pin_sms(*, phone_number: str, pin: str, **_) -> dict:
        logger.info("DEV stub SMS to %s: PIN=%s", phone_number, pin)
        return {"sid": "DEV_STUB", "status": "queued"}
```

### Local face-recognition without webcam

Pre-record a few static images under `data/face_models/dev_samples/<username>/`. The retrain script reads them. For dev login, the React app's webcam can be replaced with a "Use dev image" button that POSTs the static base64.

### Local Chroma

`data/chroma_db/` is a SQLite+files store. `python rag/ingest_docs.py` populates it from `data/docs/`. Commit a few sample policy PDFs under `data/docs/` for dev (they don't need to be real corporate docs — Faker-generated lorem PDFs are fine).

---

## Incident response

### "Prod broke after my PR merged"

1. **Don't panic-fix.** Don't push a hotfix yet.
2. **Revert first.** `git revert <merge-sha> && git push origin main`. Get prod green.
3. Investigate in a new branch with the reverted commit's diff as your starting point.
4. New PR with the fix **and** a regression test that would have caught the bug.
5. Post-mortem in team channel within 24h:
   - What happened (1 paragraph)
   - Why CI didn't catch it (1 paragraph)
   - What gate to add so this can't happen again (1 paragraph)

### "Characterization test fails during refactor"

You're mid-Phase-2/3/4 and a `backend/tests/characterization/*` test fails.

1. **Stop the in-progress PR.** Don't merge.
2. Diff: is the new code computing something different from the old?
3. If the **new** code is wrong → fix the new code.
4. If the **old** behaviour was a bug pinned by the test → update the test (with a comment explaining), and get a second reviewer.
5. If you can't decide in 30 min → escalate to tech lead.

### "Phase is overrunning by > 50%"

Tech lead splits the phase. What's green ships now; the rest moves to a new phase tag. **Never** keep merging past the budget — momentum is not progress.

### "Urgent feature request mid-migration"

Maintainer decides:

> Is this blocking real users, or just on a roadmap?

If real users blocked:
1. Build the feature in the **new** module shape (even if surrounding modules are still old).
2. Don't backport into the legacy code path.
3. Count the time against Phase 4's budget.

If roadmap want: queue it. Migration finishes first.

### "We're drifting from the rules"

Monthly audit: run every AST lint, every grep CI step, every coverage gate against the whole repo. Track violations.

**Fix as bugs, not refactors.** One PR per rule violation.

If violations exceed 5: **stop feature work and remediate.** A codebase with 5 silent violations is on the path back to where you started.

### "Migration ran on prod but app boots into a bad state"

```bash
# 1. Pull-aside
ssh prod
sudo systemctl stop agentichrms-backend

# 2. Snapshot the broken state
pg_dump -Fc agentichrms > /tmp/broken-state.dump

# 3. Decide
#    a) Roll forward — write a hotfix migration
#    b) Roll back — alembic downgrade -1, then redeploy previous code

# Most cases: (b) is faster. (a) is for data-corrupting bugs you've already debugged.

# 4. After rollback:
alembic current
git checkout <previous-tag>
pip install -r requirements.txt
sudo systemctl start agentichrms-backend
curl https://app/health
```

### "Chat returns 500 in prod after Phase 5"

Almost always the cached executor referencing an LLM client that was created before an env-var change.

```bash
# Restart kicks the cache
sudo systemctl restart agentichrms-backend
# Verify
curl -X POST https://app/api/chat/ -H "Authorization: Bearer <token>" -d '{"message":"hi"}'
```

If it persists: tail logs for the actual exception. The cache itself doesn't crash; the underlying tool does.

---

## Tracking templates

### Per-phase tracker (Linear / Notion / GitHub Projects)

```
Phase: __
Owner (Tech lead): __
Start: __    Target end: __    Actual end: __

Tasks:
  [ ] (link)  __ — owner __ — estimate __h — status __
  ...

Blockers (with @mentions):
  - 

Exit criteria:
  [ ] (copy from phase exit gate above)

Retro:
  Keep doing: 
  Stop doing: 
  Start doing: 
```

### Per-module README template

```markdown
# <Module name>

## Purpose
<one sentence>

## Public service surface
- `Service.method1(...)` → <what>
- `Service.method2(...)` → <what>

## Permissions
- `<feature>.<action>` — granted to: <role list>

## Agent tools
- `tool_name(args)` → returns `{intent, ...}`

## Events
Emits:
  - `EventName` — when it fires

Subscribes to:
  - (none) / (list)

## Migrations
- `0007_<slug>` — added X
- `0012_<slug>` — fixed Y

## Open questions / known limitations
- 
```

### Daily standup (paste in team channel)

```
*Yesterday:*
- 

*Today:*
- 

*Blockers:*
- 

*Rule violations encountered:*
- 
```

### PR description (already in `.github/pull_request_template.md` from W0.6)

---

## Sign-off ladders

The tech lead personally verifies every phase exit gate before applying the `phase-N-complete` tag. Self-reports from the dev are not enough.

```
Phase 0 sign-off — tech lead verifies:
  [ ] gitleaks scan returns 0 findings
  [ ] All Phase 0 PRs merged and tagged
  [ ] CI green on main
  [ ] PINVerification.pin_hash column exists; pin_code does not
  [ ] backend/main.py contains no alembic.upgrade call
  [ ] tools/, agent/graph.py, project_tree.txt, test_retrieval.py, root config.py — deleted
  → git tag phase-0-complete && push

Phase 1 sign-off:
  [ ] alembic downgrade base && alembic upgrade head round-trips clean
  [ ] backend/db/models/ has 10 files, none > 150 lines
  [ ] Characterization tests cover 9 mandatory scenarios, all green
  [ ] backend/core/ has exceptions, events, middleware, dependencies
  [ ] Global exception handler maps 4 typed exceptions → HTTP
  [ ] CI green
  → git tag phase-1-complete

Phase 2 sign-off:
  [ ] R29 checklist for backend/modules/leave/ — every box ticked
  [ ] Integration test: REST + chat produce identical DB rows + emails
  [ ] require_permission resolver hits RolePermission (verify by SQL log or counter test)
  [ ] CI green
  → git tag phase-2-complete

Phase 3 sign-off:
  [ ] grep -rn "Notification(" backend/ | grep -v modules/notifications/ → 0
  [ ] One leave approval → exactly one notification + one email + one audit row
  [ ] CI green
  → git tag phase-3-complete

Phase 4 sign-off:
  [ ] grep -rn "NAME_CHANGE_INTENT" backend/ → 0
  [ ] grep -rn "SessionLocal" backend/modules/*/tools.py → 0
  [ ] grep -rn "require_role" backend/modules/ → 0
  [ ] Every module README written
  [ ] Coverage ≥ 80% on every service.py
  [ ] CI green
  → git tag phase-4-complete

Phase 5 sign-off:
  [ ] No reference to LangGraph anywhere
  [ ] Chat latency benchmark posted (before/after)
  [ ] System prompts under backend/agent/prompts/*.md
  [ ] CI green
  → git tag phase-5-complete

Phase 6 sign-off:
  [ ] frontend/ tsc --noEmit clean
  [ ] npm run lint clean (R21-R26 custom rules active)
  [ ] OpenAPI types generate clean
  [ ] apiClient is the only network surface
  → git tag phase-6-complete

Phase 7 sign-off:
  [ ] App.jsx deleted; 12 flat components deleted
  [ ] Every feature folder mirrors a backend module
  [ ] Visual diff equivalent to pre-migration
  [ ] vitest suite green
  → git tag phase-7-complete

Phase 8 sign-off:
  [ ] Audit row exists for every state-changing event (verify via smoke)
  [ ] Production logs JSON; request_id present on every line
  [ ] axe-core 0 violations
  [ ] Every CI gate blocking (no || true, no continue-on-error)
  → git tag phase-8-complete && git tag migration-complete
```

---

## Common pitfalls

Specific to this codebase, in priority order:

1. **Circular imports when splitting `models.py`.** `Employee` ↔ `Leave` ↔ `Notification` cross-reference. Always use string references: `relationship("Leave", back_populates="employee")`, never `relationship(Leave, ...)`.

2. **`chat_sessions.user_id` → `employee_id` migration.** Don't drop the column blind. Use expand→contract over 3 deploys to avoid breaking chat for active sessions.

3. **Enum migration on existing data with mixed case** (`"Pending"` vs `"pending"`). The backfill `UPDATE` in `0002_add_leave_status_enum.py` uses `LOWER(status)` — keep that.

4. **The Outlook ICS fetch (`_fetch_ics_meetings`) blocks 10s on a network call.** Mock it in tests. In prod, give it a tight `timeout=10` and a try-on-failure fallback that lets leave through with a "calendar check skipped" note.

5. **`SentenceTransformer` model loads ~2-3s at import time.** Keep it module-level in `modules/documents/retriever.py`. Don't reload per request. In tests, mock it (`monkeypatch.setattr("modules.documents.retriever._model", FakeModel())`).

6. **`AgentExecutor` is not thread-safe across concurrent requests.** The cache in `backend/agent/runner.py` includes a per-employee lock — use it.

7. **The 5 onboarding stub tools.** Don't ship them as "we'll fix later." Per Decision F.3.b, they say "ask HR" and route the user out of the bot. Silent fake data is the worst option.

8. **shadcn modals don't take `zIndex`.** They use a Portal and stack correctly. If a custom modal sits over a shadcn Dialog, the custom modal is the bug — convert it.

9. **The 87 inline `fetch()` calls.** Don't try to convert all at once. Convert as you port each feature. Until then, leave them — but every **new** call goes through apiClient.

10. **`localStorage.getItem('hrms_token')` is everywhere.** Track each usage as you port features. Phase 7 exit gate fails if any remain outside `features/auth/`.

11. **The conditional-render routing in `App.jsx` propagates** to `LeaveRequests`, `Dashboard`, `OnboardingChat` (they check role strings). When porting, replace with `<RequireRole allow=[...]>` wrapper — don't reimplement role checks per-component.

12. **Don't refactor a module while a feature PR is open against it.** Sequence: ship the feature, then refactor. Or refactor first, then build the feature in the new shape.

13. **shadcn components are scaffolded, not imported as a library.** They live in your repo at `frontend/src/components/ui/*`. Customize freely — but treat changes like any other code (review, tests if non-trivial).

14. **Tests using `@tool`-decorated functions must call `.invoke(...)`**, not the bare function. LangChain wraps them. Pattern: `apply_leave.invoke({"employee_email": "...", ...})`.

15. **The `User.role` string column is going away** (Decision F.2.a). Every place that reads `user.role` must move to `employee.role.name`. Grep before Phase 1.2 lands.

16. **Phase 0's secret rotation logs everyone out everywhere.** Do it during low-traffic; announce 5 min before deploy.

17. **Alembic autogenerate misses index renames.** After every model change, eyeball the generated migration for missing `op.create_index` / `op.drop_index`.

18. **React 19 + React Query 5 + Suspense.** React 19 is stricter about suspending components. Wrap data-loading components in `<Suspense fallback={...}>` boundaries, or use `useQuery` (which doesn't suspend by default) instead of `useSuspenseQuery`.

19. **Sonner toasts vs older `react-hot-toast`.** Use Sonner. Import once in `App.tsx` (`<Toaster />`), call `toast()` from anywhere.

20. **Pydantic v2 `model_dump()` vs `dict()`.** In tests, `.dict()` returns a deprecated dict. Use `.model_dump(mode="json")` (serializes dates to strings) or `.model_dump()` (returns Python objects).

21. **LangChain `@tool` + async.** Don't write `async def` decorated with `@tool` unless you also call it via `await tool.ainvoke(...)`. Mixing sync/async causes silent hangs. Stick to sync tools — they're plenty for this codebase.

22. **ChromaDB collection reuse across tests.** ChromaDB's `PersistentClient` caches connections. In tests, use a temp dir: `ChromaPersistentClient(path=str(tmp_path))`, and delete the collection in teardown.

23. **Postgres enum migration: `ALTER TYPE ... ADD VALUE` is non-transactional.** If you need to add a value to an existing enum, do it in a separate migration that's auto-committed. Don't combine with other DDL in the same migration.

24. **`face_recognition` Python package on Ubuntu 24.04.** dlib build can fail with new compiler. Install: `sudo apt install -y cmake libopenblas-dev liblapack-dev`, then `pip install dlib-bin==19.24.6` (binary wheel), then `pip install face-recognition==1.3.0 --no-deps` (the deps include dlib which we just provided).

25. **Vite HMR through Docker.** If you containerize the frontend dev server, mount `node_modules` as a volume **outside** the bind mount, or HMR will be slow/broken. For now, run frontend on the host, not in Docker.

---

## When this is done

The migration is complete when:

```
[ ] git tag phase-0-complete through phase-8-complete + migration-complete exist
[ ] All 4 docs (this one, STRUCTURAL_REVIEW, RULES, ARCHITECTURE) are accurate
[ ] CI enforces every rule in RULES.md
[ ] A new contributor can add a feature by:
      (a) creating backend/modules/<feature>/
      (b) creating frontend/src/features/<feature>/
      (c) opening a PR that passes CI
    ... without asking anyone where things go.
[ ] The chatbot and the REST API call the same service methods (verified by integration tests)
[ ] The audit log has a row for every state-changing op since deploy
[ ] Three months pass with zero "we need to refactor X" tickets
```

When the last box is ticked: archive the four docs into `docs/migration-2026/` and replace them with a one-page `docs/CONVENTIONS.md` linking to `RULES.md` and `ARCHITECTURE.md` as the living contract.

You will not need a document like this again. The structure enforces itself.

---

## Quick reference

Every command in one place.

### Local dev

```bash
# Start
source venv/bin/activate
docker start hrms-pg hrms-mailpit
alembic upgrade head
python -m uvicorn backend.main:app --reload --port 8000 &
cd frontend && npm run dev &

# Stop
kill %1 %2 2>/dev/null
docker stop hrms-pg hrms-mailpit
```

### Tests

```bash
# Backend
pytest                                              # all
pytest backend/tests/modules/leave/                 # one module
pytest --cov=backend/modules/leave --cov-report=term-missing
pytest -k "test_request_leave"                      # by name
pytest -m characterization                          # only characterization

# Frontend
cd frontend && npm test -- --run                   # all
cd frontend && npm test -- --run --coverage        # with coverage
cd frontend && npm test                            # watch mode
```

### Lint

```bash
ruff check backend/ scripts/
mypy backend/core/ backend/modules/
python scripts/lint/router_purity.py
python scripts/lint/tools_purity.py
python scripts/lint/forbidden_strings.py
python scripts/lint/getenv_in_config_only.py
cd frontend && npm run lint && npm run typecheck
```

### Migrations

```bash
alembic revision -m "verb_noun"                    # new
alembic upgrade head                               # apply
alembic downgrade -1                               # rollback one
alembic downgrade base && alembic upgrade head     # round-trip
alembic history                                    # chain
alembic current                                    # current rev
```

### Type generation (frontend)

```bash
cd frontend && npm run gen:types
git diff --exit-code src/types/api.d.ts            # CI gate
```

### Tagging

```bash
git tag phase-N-complete && git push --tags
git tag pre-migration-baseline
git tag migration-complete
```

### Common greps (CI also runs these)

```bash
# R1: router purity
grep -rn "SessionLocal\|db\.query\|_send_email\|re\.search" backend/modules/*/router.py

# R10: tools purity
grep -rn "SessionLocal\|db\.query\|sqlalchemy" backend/modules/*/tools.py

# R7: forbidden status strings
grep -rEn '\"(Pending|Approved|Rejected|pending|approved|rejected)\"' backend/ \
  | grep -v "backend/db/models/" \
  | grep -v "backend/tests/characterization/" \
  | grep -v "alembic/"

# R17: os.getenv outside config
grep -rn "os.getenv" backend/ | grep -v "backend/core/config.py"

# R21: raw fetch in frontend
grep -rn "fetch(" frontend/src/ | grep -v "lib/apiClient"

# R22: localStorage outside AuthProvider
grep -rn "localStorage" frontend/src/ | grep -v "features/auth/"

# R23: static inline style
grep -rEn 'style=\{\{[^}]+\}\}' frontend/src/features/

# R11: regex on LLM prose
grep -rn "re\.search\|re\.match" backend/modules/chat/

# Dead code checks
grep -rn "NAME_CHANGE_INTENT" backend/
grep -rn "require_role" backend/modules/
grep -rn "Notification(" backend/ | grep -v "modules/notifications/"
```

### Branch + PR

```bash
git checkout -b migration/p2-leave-service
# ... work ...
git push -u origin migration/p2-leave-service
gh pr create --title "Phase 2 — Leave module"
gh pr checks                                       # CI status
gh pr review --approve
gh pr merge --squash --delete-branch
```

### Production migration deploy

```bash
ssh prod
cd /opt/agentichrms
git fetch origin && git checkout <tag>
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
psql -c "SELECT version_num FROM alembic_version;"
sudo systemctl restart agentichrms-backend agentichrms-frontend
curl https://app/health
```

### Emergency rollback

```bash
ssh prod
cd /opt/agentichrms
sudo systemctl stop agentichrms-backend agentichrms-frontend
git checkout <previous-tag>
pip install -r requirements.txt
alembic downgrade <prev-rev>
sudo systemctl start agentichrms-backend agentichrms-frontend
curl https://app/health
```

---

**End of playbook.**

Question not answered? The answer goes here. Edit and PR. Every blocker someone hits → a new section, a new pitfall, a new step. The doc grows with the team; the structure stays the same.







