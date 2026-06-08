"""Make employees.role_id NOT NULL

All rows were back-filled with the 'employee' role in migration abcd1234efgh,
so no NULL values should exist before this runs. This migration:

  1. Asserts no NULLs remain (raises if any do — deploy blocker, not silent).
  2. Alters the column to NOT NULL.
  3. Drops the SET NULL on-delete action and replaces it with RESTRICT so a
     role can never be deleted while employees reference it.

Author only — do NOT apply without first running `alembic upgrade head` on a
DB that has abcd1234efgh applied, and verifying `SELECT count(*) FROM employees
WHERE role_id IS NULL` returns 0.

Revision ID: 9f3e1a2b4c5d
Revises: abcd1234efgh
Create Date: 2026-06-08 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision: str = "9f3e1a2b4c5d"
down_revision: str = "abcd1234efgh"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # ── Safety check: refuse to run if any NULL role_id rows exist ────────────
    result = bind.execute(sa.text("SELECT COUNT(*) FROM employees WHERE role_id IS NULL"))
    null_count = result.scalar()
    if null_count:
        raise RuntimeError(
            f"Cannot make role_id NOT NULL: {null_count} employee(s) still have "
            "role_id = NULL. Back-fill them first:\n"
            "  UPDATE employees SET role_id = (SELECT id FROM roles WHERE name = 'employee') "
            "WHERE role_id IS NULL;"
        )

    # ── Drop the existing FK (SET NULL on-delete) ─────────────────────────────
    # Actual constraint name in DB is 'employees_role_id_fkey' (PostgreSQL default).
    op.drop_constraint("employees_role_id_fkey", "employees", type_="foreignkey")

    # ── Alter column to NOT NULL ──────────────────────────────────────────────
    op.alter_column(
        "employees",
        "role_id",
        existing_type=sa.Integer(),
        nullable=False,
    )

    # ── Re-create FK with RESTRICT so roles can't be deleted while in use ─────
    op.create_foreign_key(
        "employees_role_id_fkey",
        "employees",
        "roles",
        ["role_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    # Reverse: drop RESTRICT FK, make nullable again, restore SET NULL FK.
    op.drop_constraint("employees_role_id_fkey", "employees", type_="foreignkey")

    op.alter_column(
        "employees",
        "role_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    op.create_foreign_key(
        "employees_role_id_fkey",
        "employees",
        "roles",
        ["role_id"],
        ["id"],
        ondelete="SET NULL",
    )