"""app_user.avatar_url (profile avatar, stored as a base64 data URL)

Revision ID: e1b7c4a920f3
Revises: d889038b294e
Create Date: 2026-05-29 00:00:00.000000

Additive + reversible: one nullable Text column on app_user. Existing rows get NULL (no avatar),
which the current-user payload and POST /api/me/avatar treat as "unset". No backfill, no NOT NULL —
safe to apply live. app_user already carries the tenant_isolation RLS policy, so nothing else needed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1b7c4a920f3'
down_revision: Union[str, Sequence[str], None] = 'd889038b294e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('app_user', sa.Column('avatar_url', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('app_user', 'avatar_url')
