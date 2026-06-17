"""Add last_filename column to behavior_alerts

Revision ID: 004_add_last_filename
Revises: 003_add_access_source
Create Date: 2026-06-17

Adds one column:
  behavior_alerts.last_filename  String  NULLABLE

Records the most recently accessed document filename that contributed to
this alert. Nullable because existing alert rows have no filename history
to backfill from — they will show "Unknown document" in the UI until the
next access in that category sets it.

Run with:
    alembic upgrade head

Rollback with:
    alembic downgrade 003_add_access_source
"""

import sqlalchemy as sa
from alembic import op

revision = "004_add_last_filename"
down_revision = "003_add_access_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "behavior_alerts",
        sa.Column(
            "last_filename",
            sa.String(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("behavior_alerts", "last_filename")