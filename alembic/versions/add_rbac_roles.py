"""Add RBAC roles, permissions, and role_id to employees (idempotent)

Revision ID: abcd1234efgh
Revises: 349faee636ca
Create Date: 2025-01-12 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision = 'abcd1234efgh'    # Replace with your unique ID, or use --autogenerate
down_revision = '349faee636ca'
branch_labels = None
depends_on = None

def table_exists(table_name):
    """Check if a table exists in the database."""
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    return table_name in inspector.get_table_names()

def column_exists(table_name, column_name):
    """Check if a column exists in a table."""
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns

def upgrade():
    # 1. Create roles table (only if it doesn't exist)
    if not table_exists('roles'):
        op.create_table('roles',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=50), nullable=False),
            sa.Column('description', sa.String(length=255), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('name', name='uq_roles_name')
        )
    else:
        print("Table 'roles' already exists, skipping creation.")

    # 2. Create permissions table (only if it doesn't exist)
    if not table_exists('permissions'):
        op.create_table('permissions',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=100), nullable=False),
            sa.Column('resource', sa.String(length=100), nullable=False),
            sa.Column('action', sa.String(length=50), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('name', name='uq_permissions_name')
        )
    else:
        print("Table 'permissions' already exists, skipping creation.")

    # 3. Create role_permissions association table (only if it doesn't exist)
    if not table_exists('role_permissions'):
        op.create_table('role_permissions',
            sa.Column('role_id', sa.Integer(), nullable=False),
            sa.Column('permission_id', sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('role_id', 'permission_id')
        )
    else:
        print("Table 'role_permissions' already exists, skipping creation.")

    # 4. Add role_id column to employees (only if missing)
    if not column_exists('employees', 'role_id'):
        op.add_column('employees', sa.Column('role_id', sa.Integer(), nullable=True))
        op.create_foreign_key(
            'fk_employees_role_id', 'employees', 'roles', ['role_id'], ['id'],
            ondelete='SET NULL'
        )
    else:
        print("Column 'role_id' already exists in 'employees', skipping add.")

    # 5. Seed the three base roles (PostgreSQL compatible, idempotent)
    op.execute("""
        INSERT INTO roles (name, description) VALUES
        ('admin', 'Full system access'),
        ('hr', 'Human resources management access'),
        ('employee', 'Basic employee access')
        ON CONFLICT (name) DO NOTHING
    """)

    # 6. Back‑fill all existing employees with the 'employee' role
    # (only for those who have no role_id yet)
    op.execute("""
        UPDATE employees
        SET role_id = (SELECT id FROM roles WHERE name = 'employee')
        WHERE role_id IS NULL
    """)

def downgrade():
    # Drop foreign key constraint if it exists
    if column_exists('employees', 'role_id'):
        bind = op.get_bind()
        inspector = Inspector.from_engine(bind)
        fk_name = None
        for fk in inspector.get_foreign_keys('employees'):
            if fk['constrained_columns'] == ['role_id']:
                fk_name = fk['name']
                break
        if fk_name:
            op.drop_constraint(fk_name, 'employees', type_='foreignkey')
        op.drop_column('employees', 'role_id')

    # Drop tables if they exist (reverse order)
    if table_exists('role_permissions'):
        op.drop_table('role_permissions')
    if table_exists('permissions'):
        op.drop_table('permissions')
    if table_exists('roles'):
        op.drop_table('roles')