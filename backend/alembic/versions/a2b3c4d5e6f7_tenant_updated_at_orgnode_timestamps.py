"""tenant.updated_at + org_node timestamps (created_at, updated_at)

L-1: Tenant.updated_at — tracks last profile write for change-detection,
     audit diffing, and cache invalidation.
L-2: OrgNode.created_at / updated_at — org structure audit; lets the
     front-end bust org-tree cache cheaply.

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-06-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add updated_at to tenant; add created_at + updated_at to org_node."""
    # L-1: tenant.updated_at — nullable, no server_default (NULL = never updated after creation).
    op.add_column('tenant', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))

    # L-2: org_node timestamps.
    # created_at: backfill existing rows with now(); new rows get server_default.
    op.add_column(
        'org_node',
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.add_column('org_node', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Remove timestamp columns added in this migration."""
    op.drop_column('org_node', 'updated_at')
    op.drop_column('org_node', 'created_at')
    op.drop_column('tenant', 'updated_at')
