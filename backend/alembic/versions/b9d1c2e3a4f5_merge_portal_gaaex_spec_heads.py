"""merge portal + gaaex spec heads

Revision ID: b9d1c2e3a4f5
Revises: 19f9f4bd6599, 7a4b1e9c2f08, d3e4f5a6b7c8
Create Date: 2026-05-31 18:54:11.657094

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9d1c2e3a4f5'
down_revision: Union[str, Sequence[str], None] = ('19f9f4bd6599', '7a4b1e9c2f08', 'd3e4f5a6b7c8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
