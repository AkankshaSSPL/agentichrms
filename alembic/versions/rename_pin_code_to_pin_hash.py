"""Rename pin_verifications.pin_code -> pin_hash and widen to hold a hash

Renames the transient-PIN column and widens it from String(6) to String(128)
so the value can be stored hashed (RULES R18) instead of plaintext.

Existing pending PINs are invalidated: their old plaintext values cannot be
re-hashed (the raw PIN is gone), and transient PINs already expire in minutes,
so invalidation is the bounded-impact choice (STRUCTURAL_REVIEW Section F.1).

Revision ID: a1b2c3d4e5f6
Revises: abcd1234efgh
Create Date: 2026-06-04 00:00:00.000000

⚠️ NOT YET APPLIED. Two prerequisites before this can run:
   1. `alembic/env.py` is missing from the repo — restore it first.
   2. Apply with `alembic upgrade head` against a DB (deploy step).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "abcd1234efgh"
branch_labels = None
depends_on = None


def column_exists(table_name, column_name):
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return column_name in [c["name"] for c in inspector.get_columns(table_name)]


def upgrade():
    if column_exists("pin_verifications", "pin_hash"):
        print("Column 'pin_hash' already exists, skipping.")
        return
    # Invalidate pending PINs whose plaintext value is about to become unusable.
    op.execute("UPDATE pin_verifications SET verified = true WHERE verified = false")
    op.alter_column(
        "pin_verifications",
        "pin_code",
        new_column_name="pin_hash",
        type_=sa.String(length=128),
        existing_type=sa.String(length=6),
        existing_nullable=False,
    )


def downgrade():
    if not column_exists("pin_verifications", "pin_hash"):
        print("Column 'pin_hash' does not exist, skipping.")
        return
    # Hashes cannot be reduced back to 6-char PINs — invalidate, then truncate.
    op.execute("UPDATE pin_verifications SET verified = true WHERE verified = false")
    op.alter_column(
        "pin_verifications",
        "pin_hash",
        new_column_name="pin_code",
        type_=sa.String(length=6),
        existing_type=sa.String(length=128),
        existing_nullable=False,
        postgresql_using="left(pin_hash, 6)",
    )
