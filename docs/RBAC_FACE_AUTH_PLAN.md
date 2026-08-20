# RBAC + Face Authentication — Integration Plan

**Repo:** `https://github.com/AkankshaSSPL/agentichrms.git`
**Branch:** `main`
**Status:** Plan only — no code changed

---

## 1. What's Already Built

### RBAC (Role-Based Access Control)
- Three roles defined: `admin`, `hr`, `employee` (`backend/enums/roles.py`)
- `require_permission()` FastAPI dependency reads the employee's role from DB on every request, then checks a hardcoded dict (`backend/core/permissions.py` — `ROLE_PERMISSIONS`)
- Role changes (promoting someone to HR) take effect immediately — no re-login needed
- **Problem:** Permission changes (e.g. giving HR a new ability) require editing Python source code and redeploying

### Face Authentication
- `backend/services/face_service.py` — uses `facenet_pytorch` (MTCNN + InceptionResnetV1) + sklearn KNN classifier
- `backend/api/face_auth.py` — `POST /auth/face-login` (face → JWT), `POST /auth/detect-faces`, `POST /auth/login-with-pin-face`
- `backend/api/registration.py` — anyone can self-register with face images (public endpoint, no auth)
- `backend/database/models/auth.py` — `FaceLoginAttempt` table logs every login attempt (success/fail, confidence score, IP)
- **Problem:** Face auth and RBAC are completely separate — no permission gates on face actions, no admin control over face enrollment

### Admin Panel
- `frontend/src/components/AdminPanel.jsx` — tabbed UI (~800 lines)
- Role Management tab fully working: employee table, colored role badges, inline dropdown, `PUT /api/admin/role`
- **Missing:** Face enrollment controls, face log viewer, permission management UI

---

## 2. Critical Bugs to Fix First

### Bug 1 — requirements.txt mismatch (DEPLOY BLOCKER)

`requirements.txt` currently lists:
```
face-recognition==1.3.0
opencv-python==4.9.0.80
dlib-bin==19.24.6
```

But `face_service.py` actually imports:
```python
from facenet_pytorch import MTCNN, InceptionResnetV1
import joblib
```

**Impact:** `pip install -r requirements.txt` installs the wrong libraries. The server crashes on startup with `ImportError` on any fresh environment.

**Fix:** Replace those three lines with:
```
facenet-pytorch>=2.5.3
torch>=2.0.0
joblib>=1.3.0
```
Keep `numpy`, `scikit-learn`, `Pillow` — still needed.

### Bug 2 — DB tables exist but are never used

`backend/database/models/rbac.py` defines `Role`, `Permission`, `RolePermission` tables. Alembic migrations created them. But:
- `seed_rbac()` is never called — tables are empty
- `require_permission()` never queries them — uses only the hardcoded dict

This is what blocks dynamic permission control. The tables are ready; they just need to be seeded and queried.

---

## 3. Integration Gap — What's Missing

```
Face Auth  ←——— NO CONNECTION ———→  RBAC
```

Specific gaps:
1. No `face.*` permissions in `ROLE_PERMISSIONS` — face actions are fully unprotected
2. No HR/Admin endpoint to enroll a face for an existing employee — only public self-registration exists
3. No HR/Admin endpoint to remove an employee's face enrollment
4. No admin view of face login attempt logs
5. Permission changes require code edits (no dynamic control via admin UI)

---

## 4. Target Architecture

```
Employee logs in via face
        ↓
POST /auth/face-login
        ↓
FaceLoginAttempt row written (success/fail, confidence, IP)
        ↓
JWT issued with role claim
        ↓
All subsequent requests → require_permission() reads role from DB
                        → checks permissions from DB (not hardcoded dict)
                        → admin can change permissions live via UI

HR/Admin enrolls face for employee
        ↓
POST /admin/employees/{id}/enroll-face  ← requires face.enroll permission
        ↓
face_service.enroll_faces() → stores embedding → retrain KNN
        ↓
Employee can now use face login
```

---

## 5. Role & Permission Matrix

| Permission | Admin | HR | Employee |
|---|---|---|---|
| `admin.role_manage` | ✅ | ❌ | ❌ |
| `admin.settings` | ✅ | ❌ | ❌ |
| `employee.view` | ✅ | ✅ | ❌ |
| `employee.manage` | ✅ | ✅ | ❌ |
| `leave.view` | ✅ | ✅ | ✅ |
| `leave.apply` | ✅ | ✅ | ✅ |
| `leave.approve` | ✅ | ✅ | ❌ |
| `onboarding.manage` | ✅ | ✅ | ❌ |
| `face.enroll` | ✅ | ✅ | ❌ |
| `face.retrain` | ✅ | ❌ | ❌ |
| `face.view_logs` | ✅ | ✅ | ❌ |

Admin can change any of these via the Permissions tab — no code edit needed.

---

## 6. Implementation Phases

---

### Phase 1 — Fix the Broken Foundation

**Files changed:** `requirements.txt`, `backend/core/permissions.py`, `backend/api/admin.py`

#### 1a. Fix requirements.txt
Replace `face-recognition`, `dlib-bin`, `opencv-python` with `facenet-pytorch`, `torch`, `joblib`.

#### 1b. Add face permissions to ROLE_PERMISSIONS dict
In `backend/core/permissions.py`, add to each role's set:
- Admin: `face.enroll`, `face.retrain`, `face.view_logs`
- HR: `face.enroll`, `face.view_logs`
- Employee: nothing (self-registration flow stays public)

#### 1c. New endpoints in backend/api/admin.py

**Enroll a face (HR/Admin only):**
```
POST /admin/employees/{employee_id}/enroll-face
Body: { "images_base64": ["<base64>", ...] }  — minimum 3 images
Requires: face.enroll permission
Action: calls face_service.enroll_faces() → BackgroundTask(retrain_classifier)
Returns: { success, employee_id, name, embeddings_stored }
```

**Remove face enrollment (HR/Admin only):**
```
DELETE /admin/employees/{employee_id}/face
Requires: face.enroll permission
Action: Employee.face_embedding = None, face_registered = False, face_samples_count = 0
        BackgroundTask(retrain_classifier)
Returns: { message }
```

**View face login attempt logs (HR/Admin only):**
```
GET /admin/face-login-attempts
Query params: ?employee_id=&success=true/false&limit=50
Requires: face.view_logs permission
Returns: [{ id, employee_id, employee_name, success, confidence_score,
            ip_address, failure_reason, attempt_time }]
```

**Verification checklist:**
- [ ] `pip install -r requirements.txt` completes without dlib/face-recognition errors
- [ ] Server starts, `face_service.py` imports without error
- [ ] HR user: `POST /admin/employees/1/enroll-face` → 200 OK, face enrolled
- [ ] Employee user: same endpoint → 403 Forbidden
- [ ] `GET /admin/face-login-attempts` returns attempt history

---

### Phase 2 — Dynamic Permission Control (Admin Changes Without Code Edits)

**Files changed:** `backend/main.py`, `backend/database/models/rbac.py`, `backend/core/permissions.py`, `backend/api/admin.py`

#### 2a. Seed DB on startup

Add to `backend/main.py` lifespan startup:

```python
def seed_rbac(db: Session):
    # 1. Upsert all permission strings from the dict
    all_perms = {p for perms in ROLE_PERMISSIONS.values() for p in perms}
    for name in all_perms:
        if not db.query(Permission).filter_by(name=name).first():
            db.add(Permission(name=name))
    db.flush()

    # 2. Upsert roles
    for role in RoleName:
        if not db.query(Role).filter_by(name=role.value).first():
            db.add(Role(name=role.value))
    db.flush()

    # 3. Upsert role-permission links (additive — never deletes admin changes)
    for role_name, perms in ROLE_PERMISSIONS.items():
        role_row = db.query(Role).filter_by(name=role_name).first()
        for perm_name in perms:
            perm_row = db.query(Permission).filter_by(name=perm_name).first()
            exists = db.query(RolePermission).filter_by(
                role_id=role_row.id, permission_id=perm_row.id
            ).first()
            if not exists:
                db.add(RolePermission(role_id=role_row.id, permission_id=perm_row.id))
    db.commit()
```

This is idempotent — safe to run on every startup. If admin already changed permissions, those changes are preserved (additive only, no deletes).

#### 2b. Add relationship to Role model

In `backend/database/models/rbac.py`:

```python
class Role(Base):
    ...
    permissions = relationship(
        "Permission",
        secondary="role_permissions",
        backref="roles",
        lazy="selectin"
    )
```

This allows: `{p.name for p in role_row.permissions}` — single joined query.

#### 2c. Switch require_permission to DB lookup

In `backend/core/permissions.py`, inside `require_permission._check()`:

```python
# DB lookup (primary)
role_row = db.query(Role).filter_by(name=role_name).first()
if role_row:
    allowed = permission in {p.name for p in role_row.permissions}
else:
    # Fallback to hardcoded dict if DB row missing
    allowed = has_permission(role_name, permission)

if not allowed:
    raise HTTPException(status_code=403, detail="Insufficient permissions")
```

The hardcoded dict stays as fallback — the system degrades gracefully if DB lookup fails.

#### 2d. Permission management endpoints

```
GET /admin/permissions
  — Returns flat list of all permission strings from Permission table
  — No auth level specified yet (admin only via require_permission("admin.settings"))

GET /admin/roles/permissions
  — Returns { "admin": ["perm1", ...], "hr": [...], "employee": [...] }
  — Reads from DB via Role.permissions relationship

PUT /admin/roles/{role_name}/permissions
  Body: { "permissions": ["perm1", "perm2", ...] }
  — Deletes existing RolePermission rows for that role
  — Inserts new ones from the body list
  — GUARD: if role_name == "admin", always keep "admin.role_manage" and "admin.settings"
    (prevents admin lockout — returns 400 if these are missing from the list)
  — Returns updated mapping
```

**Verification checklist:**
- [ ] Server start → `roles`, `permissions`, `role_permissions` tables populated
- [ ] `GET /admin/roles/permissions` → correct JSON mapping
- [ ] `PUT /admin/roles/hr/permissions` removing `leave.approve` → HR user gets 403 on leave approval immediately, no re-login
- [ ] Re-add `leave.approve` → access restored
- [ ] `PUT /admin/roles/admin/permissions` without `admin.role_manage` → 400 response, permission not removed

---

### Phase 3 — Admin UI: Permissions Tab + Face Management

**Files changed:** `frontend/src/components/AdminPanel.jsx`

#### 3a. Permissions tab

Add `{ id: 'permissions', label: 'Permissions' }` to the `tabs` array.

On tab open, fetch in parallel:
- `GET /api/admin/permissions` → flat list of all permission strings
- `GET /api/admin/roles/permissions` → current role-permission mapping

**Layout — 3 columns:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Permissions                                                      │
├──────────────────┬────────────────────┬────────────────────────┤
│  Admin 🔴        │  HR 🟡             │  Employee 🟢           │
│                  │                    │                        │
│  ─ admin.*       │  ─ admin.*         │  ─ leave.*             │
│  ☑ role_manage  │  □ role_manage     │  ☑ view                │
│  ☑ settings  🔒 │  □ settings        │  ☑ apply               │
│                  │                    │                        │
│  ─ leave.*       │  ─ leave.*         │  ─ face.*              │
│  ☑ view         │  ☑ view            │  □ enroll              │
│  ☑ approve      │  ☑ approve         │  □ view_logs           │
│  ...             │  ...               │  ...                   │
│                  │                    │                        │
│  [Save Admin]    │  [Save HR]         │  [Save Employee]       │
└──────────────────┴────────────────────┴────────────────────────┘
```

Reuse: `roleBadge()` for headers, `addAlert()` for success/error messages, existing card/button styles.

Lock icon on `admin.role_manage` and `admin.settings` — disabled checkboxes with tooltip "Required — cannot remove from Admin".

#### 3b. Face enrollment in Role Management tab

In the existing employee table (Role Management tab), add:

**New column — Face Status:**
- Green badge "Face Active" if `employee.face_registered === true`
- Yellow badge "Not Enrolled" if false

**New column — Actions:**
- "Enroll Face" button → opens `<FaceEnrollModal>`
- Visible only when logged-in user is admin or hr

**FaceEnrollModal component** (inside AdminPanel.jsx):
```
┌──────────────────────────────────────────────┐
│  Enroll Face — John Doe                       │
│                                              │
│  ┌────────────────────────┐                  │
│  │      [Camera feed]     │  Position the    │
│  │                        │  employee facing │
│  │                        │  the camera.     │
│  └────────────────────────┘  Capturing 5    │
│                              photos.         │
│  Photos: ■■■□□ (3 of 5)                     │
│                                              │
│  [Capture]          [Cancel]                 │
│                                              │
│  When done: [Submit Enrollment]              │
└──────────────────────────────────────────────┘
```

Logic:
- `navigator.mediaDevices.getUserMedia` — no external library
- Each capture: call `POST /api/auth/detect-faces` first — if face count ≠ 1, show error "No face / multiple faces detected"
- Collect 5 valid frames (1 second gap between captures)
- Submit: `POST /api/admin/employees/{id}/enroll-face` with `{ images_base64: [...] }`
- On success: close modal, refresh employee list, show alert "Face enrolled for John Doe"

If employee already has face enrolled:
- Show "Remove Face" button → confirm dialog (reuse existing `ConfirmDialog` if present)
- On confirm: `DELETE /api/admin/employees/{id}/face`

#### 3c. Face Logs tab

Add `{ id: 'face_logs', label: 'Face Logs' }` tab.

Fetch on open: `GET /api/admin/face-login-attempts?limit=100`

Table:
| Time | Employee | Result | Confidence | IP Address | Failure Reason |
|------|----------|--------|------------|------------|----------------|
| 2026-08-20 10:23 | John Doe | ✅ Pass | 0.42 | 192.168.1.5 | — |
| 2026-08-20 10:19 | Unknown | ❌ Fail | 1.87 | 192.168.1.9 | Below threshold |

Row color: green bg for success, red/rose bg for fail.
Confidence: lower = better match (it's a distance score, not a percentage).

**Verification checklist:**
- [ ] Admin opens Permissions tab → 3 columns, checkboxes match DB state
- [ ] Uncheck `leave.approve` for HR → Save → HR gets 403 on leave approval immediately
- [ ] Admin opens Role Management → employees have face status badge
- [ ] "Enroll Face" for an employee → camera opens → 5 captures → submit → employee shows "Face Active"
- [ ] That employee can now use `POST /auth/face-login` successfully
- [ ] "Remove Face" → confirm → employee shows "Not Enrolled"
- [ ] Face Logs tab → all attempts visible with pass/fail color coding

---

## 7. File Change Summary

```
Phase 1
  requirements.txt                        replace dlib/face-recognition with facenet-pytorch, torch, joblib
  backend/core/permissions.py             add face.enroll, face.retrain, face.view_logs to ROLE_PERMISSIONS dict
  backend/api/admin.py                    add enroll-face POST, face DELETE, face-login-attempts GET

Phase 2
  backend/main.py                         add seed_rbac() call in lifespan startup
  backend/database/models/rbac.py         add permissions relationship to Role model
  backend/core/permissions.py             switch require_permission to DB lookup with dict fallback
  backend/api/admin.py                    add /admin/permissions GET, /admin/roles/permissions GET+PUT

Phase 3
  frontend/src/components/AdminPanel.jsx  add Permissions tab, Face Logs tab, face enrollment in Role tab
```

## 8. What Does NOT Change

- JWT structure, token creation, token expiry — untouched
- `POST /auth/face-login` login endpoint logic — untouched
- `POST /auth/register` public self-registration — untouched
- `Login.jsx` and `Register.jsx` face capture UI — untouched
- All existing `require_permission()` call sites in all routers — untouched
- Alembic migrations — no new migrations needed (rbac tables already in schema)
- `ROLE_PERMISSIONS` dict — kept as seed source and fallback, not removed

---

## 9. Plain-English Summary (for non-technical stakeholders)

**What the system currently does:**
The app has three user types — Admin, HR, and Employee. Each type has a fixed set of things they're allowed to do. There's also a face login system where employees can use their face instead of a password. Both systems exist but they don't talk to each other.

**What's broken right now:**
- The app has the wrong dependency listed in its setup file, so it won't install correctly on a new computer.
- Any employee can register their own face — HR can't enroll a face on someone's behalf.
- There's no way for an admin to see who has tried to log in with their face and whether it worked.
- If we want to give HR a new ability (like approving overtime), a developer has to edit the code and redeploy the app.

**What this plan fixes:**

1. **Fix the broken install** — correct the setup file so the app works on a fresh machine.

2. **Connect face auth to permissions** — HR and Admin can now enroll faces for employees through the Admin Panel. Regular employees can only self-register. This is controlled by the permission system.

3. **Dynamic permission control** — Admin can change who can do what directly in the Admin Panel, without touching any code. Changes take effect immediately — no restart needed.

4. **Face login audit log** — HR and Admin can see a full history of face login attempts: who tried to log in, whether it worked, how confident the system was, and when it happened.

**The three phases:**
- Phase 1: Fix the broken install + wire face auth into the permission system + add HR/Admin face enrollment
- Phase 2: Move permission storage into the database so admin can change permissions live
- Phase 3: Add the UI in the Admin Panel — Permissions tab, face enrollment in the employee table, face login history tab
