"""add behavioral analytics tables

Revision ID: 002_add_behavioral_analytics
Revises: 001_rename_pin_code
Create Date: 2026-06-15

Creates three tables for the behavioral analytics feature:
  - document_tags         : admin-taggable filename → category map
  - document_access_logs  : append-only audit of tagged doc accesses via chat
  - behavior_alerts       : deduped HR alerts raised on windowed threshold breach

Run with:
    alembic upgrade head

Rollback with:
    alembic downgrade 001_rename_pin_code
"""

import sqlalchemy as sa
from alembic import op

revision = "002_add_behavioral_analytics"
down_revision = "001_rename_pin_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── document_tags ──────────────────────────────────────────────────────────
    op.create_table(
        "document_tags",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("filename", sa.String(), unique=True, index=True, nullable=False),
        sa.Column("category", sa.String(30), nullable=False, server_default="GENERAL"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── document_access_logs ───────────────────────────────────────────────────
    op.create_table(
        "document_access_logs",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id"), index=True, nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("chat_session_id", sa.Integer(), nullable=True),
        sa.Column("accessed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_access_logs_employee_category_time",
        "document_access_logs",
        ["employee_id", "category", "accessed_at"],
    )

    # ── behavior_alerts ────────────────────────────────────────────────────────
    op.create_table(
        "behavior_alerts",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id"), index=True, nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="OPEN", index=True),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("trigger_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("window_days", sa.Integer(), nullable=False),
        sa.Column("first_triggered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_employee_id", sa.Integer(), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("hr_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("behavior_alerts")
    op.drop_index("ix_access_logs_employee_category_time", table_name="document_access_logs")
    op.drop_table("document_access_logs")
    op.drop_table("document_tags")