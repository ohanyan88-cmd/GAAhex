"""page_config_table

Revision ID: f2c8a1b4d6e9
Revises: e1b7c4a920f3
Create Date: 2026-05-29 00:00:00.000000

Additive + reversible. Tenant-scoped, superadmin-editable per-page presentation descriptors
(one row per tenant+page_key) with the standard tenant_isolation RLS policy. Backs the
"configure in place" mechanism for bespoke pages (Services first); no config = page default.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f2c8a1b4d6e9'
down_revision: Union[str, Sequence[str], None] = 'e1b7c4a920f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'page_config',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('page_key', sa.String(length=80), nullable=False),
        sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'page_key', name='uq_page_config_tenant_page'),
    )
    op.create_index(op.f('ix_page_config_tenant_id'), 'page_config', ['tenant_id'], unique=False)

    op.execute("ALTER TABLE page_config ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON page_config
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON page_config;")
    op.drop_index(op.f('ix_page_config_tenant_id'), table_name='page_config')
    op.drop_table('page_config')
