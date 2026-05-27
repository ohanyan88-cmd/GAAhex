"""helpdesk tables (Batch 31): helpdesk_queue + helpdesk_ticket

Revision ID: d9f3b1e72c4a8051
Revises: a4f8e2d1c9b7f3e0
Create Date: 2026-05-27 20:00:00.000000

Additive + reversible. Two new tables for the helpdesk module. Tenant-scoped; carries the same
NULLIF-guarded tenant_isolation RLS policy as all post-enable-RLS tables.
gaaex_app grants inherit via the ALTER DEFAULT PRIVILEGES set in the enable-RLS migration.

NOT run against the live DB by the worker — coordinator applies: alembic upgrade head.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9f3b1e72c4a8051'
down_revision: Union[str, Sequence[str], None] = 'a4f8e2d1c9b7f3e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # helpdesk_queue table
    op.create_table(
        'helpdesk_queue',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('owner_node_id', sa.UUID(), nullable=True),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('default_sla_minutes', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
        sa.ForeignKeyConstraint(['owner_node_id'], ['org_node.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_helpdesk_queue_tenant_id'), 'helpdesk_queue', ['tenant_id'], unique=False)

    # RLS on helpdesk_queue
    op.execute("ALTER TABLE helpdesk_queue ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON helpdesk_queue
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)

    # helpdesk_ticket table
    op.create_table(
        'helpdesk_ticket',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('owner_node_id', sa.UUID(), nullable=True),
        sa.Column('customer_id', sa.UUID(), nullable=True),
        sa.Column('queue_id', sa.UUID(), nullable=True),
        sa.Column('subject', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('priority', sa.String(length=20), nullable=False, server_default='NORMAL'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='OPEN'),
        sa.Column('assigned_agent_id', sa.UUID(), nullable=True),
        sa.Column('sla_due_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sla_breached', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
        sa.ForeignKeyConstraint(['owner_node_id'], ['org_node.id'], ),
        sa.ForeignKeyConstraint(['customer_id'], ['record.id'], ),
        sa.ForeignKeyConstraint(['queue_id'], ['helpdesk_queue.id'], ),
        sa.ForeignKeyConstraint(['assigned_agent_id'], ['app_user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_helpdesk_ticket_tenant_id'), 'helpdesk_ticket', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_helpdesk_ticket_customer_id'), 'helpdesk_ticket', ['customer_id'], unique=False)
    op.create_index(op.f('ix_helpdesk_ticket_queue_id'), 'helpdesk_ticket', ['queue_id'], unique=False)

    # RLS on helpdesk_ticket
    op.execute("ALTER TABLE helpdesk_ticket ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON helpdesk_ticket
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema — reverse order (ticket depends on queue)."""
    # helpdesk_ticket
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON helpdesk_ticket;")
    op.drop_index(op.f('ix_helpdesk_ticket_queue_id'), table_name='helpdesk_ticket')
    op.drop_index(op.f('ix_helpdesk_ticket_customer_id'), table_name='helpdesk_ticket')
    op.drop_index(op.f('ix_helpdesk_ticket_tenant_id'), table_name='helpdesk_ticket')
    op.drop_table('helpdesk_ticket')

    # helpdesk_queue
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON helpdesk_queue;")
    op.drop_index(op.f('ix_helpdesk_queue_tenant_id'), table_name='helpdesk_queue')
    op.drop_table('helpdesk_queue')
