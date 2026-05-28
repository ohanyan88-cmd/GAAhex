"""automation_rule_table

Revision ID: d889038b294e
Revises: d2e3f4a5b6c7
Create Date: 2026-05-28 21:12:07.839797

Additive + reversible. Tenant-scoped automation rules table with RLS policy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd889038b294e'
down_revision: Union[str, Sequence[str], None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'automation_rule',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('key', sa.String(length=120), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('event_type', sa.String(length=40), nullable=False),
        sa.Column('entity_key', sa.String(length=80), nullable=False),
        sa.Column('condition', sa.String(length=1000), nullable=True),
        sa.Column('action', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('order', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_automation_rule_tenant_id'), 'automation_rule', ['tenant_id'], unique=False)

    op.execute("ALTER TABLE automation_rule ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON automation_rule
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON automation_rule;")
    op.drop_index(op.f('ix_automation_rule_tenant_id'), table_name='automation_rule')
    op.drop_table('automation_rule')
