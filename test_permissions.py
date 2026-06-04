# test_permissions.py  (place in project root: D:\agentichrms-main\)
# Run with: pytest test_permissions.py -v

import pytest
from backend.core.permissions import has_permission, get_permissions, PERMISSIONS
from backend.enums.roles import RoleName


# ── Registry sanity ──────────────────────────────────────────────────────────

def test_all_roles_present():
    for role in (RoleName.ADMIN, RoleName.HR, RoleName.EMPLOYEE):
        assert role in PERMISSIONS, f"Role '{role}' missing from PERMISSIONS"

def test_unknown_role_returns_empty():
    assert get_permissions("ghost") == []


# ── HR ───────────────────────────────────────────────────────────────────────

def test_hr_can_approve_leave():
    assert has_permission(RoleName.HR, "leave.approve")

def test_hr_can_reject_leave():
    assert has_permission(RoleName.HR, "leave.reject")

def test_hr_can_update_employee():
    assert has_permission(RoleName.HR, "employee.update")

def test_hr_cannot_delete_employee():
    assert not has_permission(RoleName.HR, "employee.delete")

def test_hr_cannot_manage_settings():
    assert not has_permission(RoleName.HR, "settings.manage")


# ── Admin ────────────────────────────────────────────────────────────────────

def test_admin_has_all_hr_permissions():
    hr_perms = set(get_permissions(RoleName.HR))
    admin_perms = set(get_permissions(RoleName.ADMIN))
    assert hr_perms.issubset(admin_perms)

def test_admin_can_delete_employee():
    assert has_permission(RoleName.ADMIN, "employee.delete")

def test_admin_can_manage_settings():
    assert has_permission(RoleName.ADMIN, "settings.manage")


# ── Employee ─────────────────────────────────────────────────────────────────

def test_employee_can_view_leave():
    assert has_permission(RoleName.EMPLOYEE, "leave.view")

def test_employee_cannot_approve_leave():
    assert not has_permission(RoleName.EMPLOYEE, "leave.approve")

def test_employee_cannot_view_reports():
    assert not has_permission(RoleName.EMPLOYEE, "reports.view")

def test_employee_cannot_delete_employee():
    assert not has_permission(RoleName.EMPLOYEE, "employee.delete")

def test_employee_cannot_manage_settings():
    assert not has_permission(RoleName.EMPLOYEE, "settings.manage")