"""rename pin_code to pin_hash in pin_verifications

Revision ID: 001_rename_pin_code
Revises: 
Create Date: 2026-06-08

Run with:
    alembic upgrade head
"""
from alembic import op
import sqlalchemy as sa

revision = '001_rename_pin_code'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Check if pin_code column exists before renaming
    # (safe to run multiple times)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('pin_verifications')]

    if 'pin_code' in columns and 'pin_hash' not in columns:
        with op.batch_alter_table('pin_verifications') as batch_op:
            batch_op.alter_column(
                'pin_code',
                new_column_name='pin_hash',
                existing_type=sa.String(length=6),
                type_=sa.String(length=128),   # hash is longer than 6 chars
                existing_nullable=False,
            )
    elif 'pin_hash' in columns:
        print("pin_hash already exists — skipping rename")
    else:
        print("WARNING: Neither pin_code nor pin_hash found in pin_verifications")


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('pin_verifications')]

    if 'pin_hash' in columns and 'pin_code' not in columns:
        with op.batch_alter_table('pin_verifications') as batch_op:
            batch_op.alter_column(
                'pin_hash',
                new_column_name='pin_code',
                existing_type=sa.String(length=128),
                type_=sa.String(length=6),
                existing_nullable=False,
            )