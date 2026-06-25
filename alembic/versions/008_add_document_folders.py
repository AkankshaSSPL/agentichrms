"""add document_folders and folder_id to document_tags

Revision ID: 008_add_document_folders
Revises: 007_behaviour_deleted_at
Create Date: 2026-06-20

Creates:
  document_folders  — named folder rows (HR/Admin managed)
  document_tags.folder_id  — FK to document_folders (nullable, existing rows = null = Uncategorised)
"""
import sqlalchemy as sa
from alembic import op

revision = "008_add_document_folders"
down_revision = "007_behaviour_deleted_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create document_folders table
    op.create_table(
        "document_folders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["employees.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_document_folders_name"),
    )
    op.create_index("ix_document_folders_name", "document_folders", ["name"], unique=True)

    # 2. Add folder_id to document_tags (nullable — existing rows = Uncategorised)
    op.add_column(
        "document_tags",
        sa.Column("folder_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_document_tags_folder",
        "document_tags", "document_folders",
        ["folder_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_document_tags_folder_id", "document_tags", ["folder_id"])


def downgrade() -> None:
    op.drop_index("ix_document_tags_folder_id", table_name="document_tags")
    op.drop_constraint("fk_document_tags_folder", "document_tags", type_="foreignkey")
    op.drop_column("document_tags", "folder_id")
    op.drop_index("ix_document_folders_name", table_name="document_folders")
    op.drop_table("document_folders")