"""
backend/core/permissions.py
─────────────────────────────────────────────────────────────────────────────
Permission-based access control for the HRMS API.

DESIGN
------
Each role is assigned a fixed set of permission strings.
Endpoints declare which permission they need via:

    Depends(require_permission("leave.approve"))

The dependency reads the caller's role fresh from the DB on every request
(same approach as require_role) so role changes take effect immediately
without re-login.

PERMISSION STRINGS
------------------
Format: "<resource>.<action>"

    leave.view          — read any employee's leave requests
    leave.approve       — approve leave requests
    leave.reject        — reject leave requests
    leave.apply         — submit own leave request (all employees)

    employee.view       — view employee list and profiles
    employee.create     — register new employees
    employee.update     — update any employee's profile
    employee.delete     — delete employees

    approval.view       — view profile-change approval requests
    approval.action     — approve or reject profile-change requests

    admin.role_manage   — change employee roles
    admin.settings      — manage system settings (email config etc.)

    onboarding.view     — view onboarding tasks
    onboarding.manage   — create / complete onboarding tasks

ROLE → PERMISSION MAPPING
--------------------------
    admin    — everything
    hr       — leave + employee (no delete) + approval + onboarding
    manager  — leave.view + leave.approve + leave.reject + employee.view
    employee — leave.apply + onboarding.view (own data only, enforced in route)
"""

import logging
from fastapi import HTTPException, Request
from backend.enums import RoleName

logger = logging.getLogger(__name__)

# ── Permission registry ───────────────────────────────────────────────────────

ROLE_PERMISSIONS: dict[str, set[str]] = {
    RoleName.ADMIN: {
        "leave.view",
        "leave.approve",
        "leave.reject",
        "leave.apply",
        "employee.view",
        "employee.create",
        "employee.update",
        "employee.delete",
        "approval.view",
        "approval.action",
        "admin.role_manage",
        "admin.settings",
        "onboarding.view",
        "onboarding.manage",
        "behavior.manage",   # Admin only — tagging configuration
        "behaviour.analyze", # Admin only — AI chat-history mood/personality analysis
        # "behavior.view" removed — no HR dashboard alerts
    },
    RoleName.HR: {
        "leave.view",
        "leave.approve",
        "leave.reject",
        "leave.apply",
        "employee.view",
        "employee.create",
        "employee.update",
        "approval.view",
        "approval.action",
        "onboarding.view",
        "onboarding.manage",
        # "behavior.view" removed — HR no longer sees behavioral alerts
    },
    RoleName.EMPLOYEE: {
        "leave.apply",
        "onboarding.view",
    },
}


def get_permissions(role_name: str) -> set[str]:
    """Return the permission set for a given role name. Unknown roles get empty set."""
    return ROLE_PERMISSIONS.get(role_name, set())


def has_permission(role_name: str, permission: str) -> bool:
    """Check if a role has a specific permission."""
    return permission in get_permissions(role_name)


# ── FastAPI dependency ────────────────────────────────────────────────────────

def require_permission(permission: str):
    """
    FastAPI dependency — raises 403 if the caller's role lacks the permission.

    Always reads the role fresh from the DB so role changes take effect
    immediately without requiring re-login.

    Usage:
        @router.get("/leaves/pending")
        def pending(payload=Depends(require_permission("leave.view"))):
            ...

    The returned payload dict contains:
        sub   — employee ID (str)
        role  — role name (str, read from DB)
        email — employee email
    """
    def _check(request: Request) -> dict:
        from backend.core.security import verify_token
        from backend.database.session import SessionLocal
        from backend.database.models import Employee

        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or invalid token")

        token = auth.split(" ", 1)[1]
        payload = verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        employee_id = payload.get("sub")
        if not employee_id:
            raise HTTPException(status_code=401, detail="Invalid token: missing subject")

        # Read role fresh from DB — role changes take effect on next API call
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.id == int(employee_id)).first()
            if not emp:
                raise HTTPException(status_code=401, detail="Employee not found")
            role_name = emp.role.name if emp.role and hasattr(emp.role, "name") else None
            email = emp.email
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("DB error while verifying permissions for employee %s: %s", employee_id, exc)
            raise HTTPException(status_code=503, detail="Could not verify permissions, please try again.")
        finally:
            db.close()

        if not role_name:
            raise HTTPException(
                status_code=401,
                detail="Your session is outdated. Please log out and log in again.",
            )

        if not has_permission(role_name, permission):
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied. Required: '{permission}'. Your role: '{role_name}'.",
            )

        payload["role"] = role_name
        payload["email"] = email
        return payload

    return _check


# -- Authenticated-only dependency (no permission check) ----------------------

def require_authenticated(request: Request) -> dict:
    """
    FastAPI dependency -- requires a valid JWT token, but does not check
    role or permissions. Use for endpoints any logged-in employee can access.

    Returns the decoded token payload (contains 'sub' = employee ID).
    """
    from backend.core.security import verify_token

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth.split(" ", 1)[1]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid token: missing subject")

    return payload