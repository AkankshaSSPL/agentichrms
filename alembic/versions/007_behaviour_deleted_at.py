"""add deleted_at to behaviour_analyses

Revision ID: 007_behaviour_deleted_at
Revises: 006_add_behaviour_analysis
Create Date: 2026-06-19

BaseModel defines deleted_at for soft-delete support; 006 omitted it from
the explicit column list. Adding it here to match what the ORM expects.
"""
from alembic import op
import sqlalchemy as sa


revision = "007_behaviour_deleted_at"
down_revision = "006_add_behaviour_analysis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "behaviour_analyses",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("behaviour_analyses", "deleted_at")