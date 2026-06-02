"""search_history table (E27 saved searches / recent / pinned)

Revision ID: b3f2e1c8d905
Revises: e7c1a9d4b260
Create Date: 2026-05-27 18:00:00.000000

Additive + reversible: one new table for per-user search history (recent queries + pin flag).
Saved searches themselves reuse saved_view_def (entity_key='__search__'); this table only adds
the lightweight ring-buffer of recent queries + the pinned flag. No changes to existing tables.
Tenant-scoped; carries the same NULLIF-guarded tenant_isolation RLS policy as all post-enable-RLS
tables. gaahex_app grants inherit via the ALTER DEFAULT PRIVILEGES set in the enable-RLS migration.

NOT run against the live DB by the worker — coordinator applies: alembic upgrade head.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3f2e1c8d905'
down_revision: Union[str, Sequence[str], None] = 'e7c1a9d4b260'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'search_history',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('query', sa.String(length=500), nullable=False),
        sa.Column('entity', sa.String(length=80), nullable=True),
        sa.Column('pinned', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('queried_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['app_user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_search_history_tenant_id'), 'search_history', ['tenant_id'], unique=False)
    # composite index for cheap per-user newest-first scans
    op.create_index('ix_search_history_user_queried', 'search_history', ['user_id', 'queried_at'], unique=False)

    # RLS: same NULLIF-guarded tenant_isolation policy as all post-enable-RLS tables.
    op.execute("ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON search_history
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON search_history;")
    op.drop_index('ix_search_history_user_queried', table_name='search_history')
    op.drop_index(op.f('ix_search_history_tenant_id'), table_name='search_history')
    op.drop_table('search_history')
