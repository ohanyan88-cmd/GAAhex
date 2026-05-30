"""merge feature_flags and studio_page_versioning

Revision ID: aa178a3a15f3
Revises: b5e2d9f4c1a8, c1d2e3f4a5b6
Create Date: 2026-05-31 00:16:19.467772

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'aa178a3a15f3'
down_revision: Union[str, Sequence[str], None] = ('b5e2d9f4c1a8', 'c1d2e3f4a5b6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
