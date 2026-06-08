"""add pin_hash to pin_verifications

Revision ID: dc375aac3cda
Revises: 64697194c11e
Create Date: 2026-06-08 17:21:31.051617

MANUALLY TRIMMED: autogenerate picked up unrelated model drift.
This migration only adds the missing pin_hash column to pin_verifications.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'dc375aac3cda'
down_revision: Union[str, Sequence[str], None] = '64697194c11e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'pin_verifications',
        sa.Column('pin_hash', sa.String(length=128), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('pin_verifications', 'pin_hash')