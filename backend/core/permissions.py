# backend/core/permissions.py
# Phase 7: Centralized Permissions System (FastAPI version)

from fastapi import Depends, HTTPException
from backend.core.security import require_role
from backend.enums.roles import RoleName


# ─────────────────────────────────────────────
# 1. Permission Registry
# ─────────────────────────────────────────────

PERMISSIONS: dict[str, list[str]] = {
    RoleName.ADMIN: [
        "leave.approve",
        "leave.reject",
        "leave.view",
        "employee.create",
        "employee.update",
        "employee.delete",
        "employee.view",
        "reports.view",
        "reports.export",
        "settings.manage",
    ],
    RoleName.HR: [
        "leave.approve",
        "leave.reject",
        "leave.view",
        "employee.update",
        "employee.view",
        "reports.view",
    ],
    RoleName.EMPLOYEE: [
        "leave.view",
        "employee.view",
    ],
}


# ─────────────────────────────────────────────
# 2. Core helpers
# ─────────────────────────────────────────────

def get_permissions(role: str) -> list[str]:
    """Return the permission list for a role (empty list for unknown roles)."""
    return PERMISSIONS.get(role, [])


def has_permission(role: str, permission: str) -> bool:
    """Check whether a role holds a specific permission."""
    return permission in get_permissions(role)


# ─────────────────────────────────────────────
# 3. FastAPI dependency factories
# ─────────────────────────────────────────────

def require_permission(permission: str):
    """
    FastAPI dependency — raises 403 if the user lacks the permission.

    Usage
    -----
    @router.post("/leave/approve")
    def approve_leave(
        payload: dict = Depends(require_permission("leave.approve")),
    ):
        ...
    """
    def dependency(
        payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN, RoleName.EMPLOYEE]))
    ):
        role = payload.get("role")
        if not has_permission(role, permission):
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Permission denied. "
                    f"Role '{role}' does not have '{permission}'."
                ),
            )
        return payload
    return dependency


def require_any_permission(*permissions: str):
    """
    Passes if the user holds AT LEAST ONE of the listed permissions.
    """
    def dependency(
        payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN, RoleName.EMPLOYEE]))
    ):
        role = payload.get("role")
        user_perms = get_permissions(role)
        if not any(p in user_perms for p in permissions):
            raise HTTPException(
                status_code=403,
                detail=f"Requires one of: {', '.join(permissions)}.",
            )
        return payload
    return dependency


def require_all_permissions(*permissions: str):
    """
    Passes only if the user holds ALL listed permissions.
    """
    def dependency(
        payload: dict = Depends(require_role([RoleName.HR, RoleName.ADMIN, RoleName.EMPLOYEE]))
    ):
        role = payload.get("role")
        user_perms = get_permissions(role)
        missing = [p for p in permissions if p not in user_perms]
        if missing:
            raise HTTPException(
                status_code=403,
                detail=f"Missing permissions: {', '.join(missing)}.",
            )
        return payload
    return dependency