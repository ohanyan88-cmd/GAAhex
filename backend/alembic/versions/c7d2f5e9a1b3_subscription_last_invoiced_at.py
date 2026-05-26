"""subscription.last_invoiced_at (E20 billing-cycle idempotency marker)

Revision ID: c7d2f5e9a1b3
Revises: a95459b83902
Create Date: 2026-05-27 02:10:00.000000

Additive + reversible: one nullable column. Existing rows get NULL (never billed by a cycle run),
which the run-cycle endpoint treats as "due". No data backfill, no NOT NULL — safe to apply live.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d2f5e9a1b3'
down_revision: Union[str, Sequence[str], None] = 'a95459b83902'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('subscription', sa.Column('last_invoiced_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('subscription', 'last_invoiced_at')
