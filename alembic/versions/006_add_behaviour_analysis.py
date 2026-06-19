"""add behaviour_analyses table

Revision ID: 006_add_behaviour_analysis
Revises: 005
Create Date: 2026-06-19

Admin-only AI behaviour analysis snapshots. Author only — do NOT apply here.
Run `alembic upgrade head` as an explicit deploy/test step.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "006_add_behaviour_analysis"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "behaviour_analyses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id"), nullable=False, index=True),
        sa.Column("analyzed_by_employee_id", sa.Integer(), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("mood", sa.String(length=100), nullable=True),
        sa.Column("personality", sa.Text(), nullable=True),
        sa.Column("traits", sa.Text(), nullable=True),
        sa.Column("attitude_trend", sa.String(length=100), nullable=True),
        sa.Column("observations", sa.Text(), nullable=True),
        sa.Column("suggested_talking_points", sa.Text(), nullable=True),
        sa.Column("confidence", sa.String(length=20), nullable=True),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("model", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("behaviour_analyses")