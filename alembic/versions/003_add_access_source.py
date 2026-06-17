"""Add access_source column to document_access_logs

Revision ID: 003_add_access_source
Revises: 002_add_behavioral_analytics
Create Date: 2026-06-16

Adds one column:
  document_access_logs.access_source  String(20) NOT NULL default "chat"

The server_default="chat" backfills all existing rows as chat accesses
so no data is lost and no manual UPDATE is needed.

Run with:
    alembic upgrade head

Rollback with:
    alembic downgrade 002_add_behavioral_analytics
"""

import sqlalchemy as sa
from alembic import op

revision = "003_add_access_source"
down_revision = "002_add_behavioral_analytics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_access_logs",
        sa.Column(
            "access_source",
            sa.String(20),
            nullable=False,
            server_default="chat",   # backfills all existing chat rows
        ),
    )


def downgrade() -> None:
    op.drop_column("document_access_logs", "access_source")