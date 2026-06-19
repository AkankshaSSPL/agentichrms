"""005_nudge_ledger

Revision ID: 005
Revises: 004
Create Date: 2026-06-18 12:00:00.000000

Author: system
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM

# revision identifiers, used by Alembic.
revision = '005'
down_revision = '004_add_last_filename'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to behavior_alerts
    op.add_column('behavior_alerts', sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('behavior_alerts', sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('behavior_alerts', sa.Column('nudge_text', sa.Text(), nullable=True))

    # Change status column: set default to 'PENDING' and allow new values
    # We need to alter the column to have a new default and potentially new enum values.
    # For simplicity, we can just add a new status column? But we already have status.
    # We'll change the server_default to 'PENDING' and ensure the column is String.
    # In practice, we can just alter the column default.
    op.alter_column('behavior_alerts', 'status',
                    server_default='PENDING',
                    existing_type=sa.String(20),
                    nullable=False)

    # Optionally, we could update existing rows: set status to 'PENDING' for all
    op.execute("UPDATE behavior_alerts SET status = 'PENDING' WHERE status = 'OPEN'")
    op.execute("UPDATE behavior_alerts SET status = 'DISMISSED' WHERE status = 'RESOLVED'")

    # Note: we keep the old 'resolved_at', 'resolved_by_employee_id', 'hr_note' columns for rollback safety.


def downgrade() -> None:
    # Drop the new columns
    op.drop_column('behavior_alerts', 'delivered_at')
    op.drop_column('behavior_alerts', 'dismissed_at')
    op.drop_column('behavior_alerts', 'nudge_text')

    # Restore old status defaults (if needed, but we can just set back to 'OPEN')
    # We'll revert status values: 'PENDING' → 'OPEN', 'DISMISSED' → 'RESOLVED', keep 'DELIVERED' as 'OPEN' maybe.
    op.execute("UPDATE behavior_alerts SET status = 'OPEN' WHERE status IN ('PENDING', 'DELIVERED')")
    op.execute("UPDATE behavior_alerts SET status = 'RESOLVED' WHERE status = 'DISMISSED'")
    op.alter_column('behavior_alerts', 'status',
                    server_default='OPEN',
                    existing_type=sa.String(20),
                    nullable=False)