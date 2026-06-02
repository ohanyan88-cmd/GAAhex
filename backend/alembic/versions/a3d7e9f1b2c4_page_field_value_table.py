"""page_field_value_table

Revision ID: a3d7e9f1b2c4
Revises: f2c8a1b4d6e9
Create Date: 2026-05-29 00:00:00.000000

Additive + reversible. Tenant-scoped store for the per-ROW VALUES of the custom data fields a
superadmin adds to a bespoke page (defs live in the page_config descriptor's `customFields`).
One row per (tenant, page_key, row_id); `data` = {field_key: value}. Standard tenant_isolation
RLS policy. No values = nothing rendered (page behaves as today).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a3d7e9f1b2c4'
down_revision: Union[str, Sequence[str], None] = 'f2c8a1b4d6e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'page_field_value',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('page_key', sa.String(length=80), nullable=False),
        sa.Column('row_id', sa.String(length=255), nullable=False),
        sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'page_key', 'row_id', name='uq_page_field_value_tenant_page_row'),
    )
    op.create_index(op.f('ix_page_field_value_tenant_id'), 'page_field_value', ['tenant_id'], unique=False)

    op.execute("ALTER TABLE page_field_value ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON page_field_value
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON page_field_value;")
    op.drop_index(op.f('ix_page_field_value_tenant_id'), table_name='page_field_value')
    op.drop_table('page_field_value')
