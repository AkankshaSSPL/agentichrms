"""merge heads

Revision ID: 64697194c11e
Revises: 001_rename_pin_code, 9f3e1a2b4c5d
Create Date: 2026-06-08 17:13:08.503283

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '64697194c11e'
down_revision: Union[str, Sequence[str], None] = ('001_rename_pin_code', '9f3e1a2b4c5d')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
