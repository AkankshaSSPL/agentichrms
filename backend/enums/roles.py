"""
Enum definitions for employee roles.

Usage:
    from backend.enums.roles import RoleName

    # Comparisons
    if employee.role.name == RoleName.HR:
        ...

    # require_role() in security.py
    Depends(require_role([RoleName.HR, RoleName.ADMIN]))

    # DB seeding / lookups
    db.query(Role).filter(Role.name == RoleName.EMPLOYEE).first()
"""

from enum import Enum


class RoleName(str, Enum):
    ADMIN = "admin"
    HR = "hr"
    EMPLOYEE = "employee"

    # Human-readable labels (used in emails, UI messages)
    @property
    def label(self) -> str:
        return {
            RoleName.ADMIN: "Administrator",
            RoleName.HR: "HR Manager",
            RoleName.EMPLOYEE: "Employee",
        }[self]