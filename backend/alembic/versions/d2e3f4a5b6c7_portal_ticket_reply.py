"""portal_ticket_reply table (Batch 36): customer-side replies on helpdesk tickets

Revision ID: d2e3f4a5b6c7
Revises: c1a2b3d4e5f6
Create Date: 2026-05-27 23:30:00.000000

Additive + reversible. Separate from Interaction (which requires agent_user_id NOT NULL).
Tenant-scoped; RLS policy identical to other post-enable-RLS tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, Sequence[str], None] = 'c1a2b3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'portal_ticket_reply',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('ticket_id', sa.UUID(), nullable=False),
        sa.Column('customer_user_id', sa.UUID(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('direction', sa.String(length=20), nullable=False, server_default='inbound'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['ticket_id'], ['helpdesk_ticket.id']),
        sa.ForeignKeyConstraint(['customer_user_id'], ['customer_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_portal_ticket_reply_tenant_id'), 'portal_ticket_reply', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_portal_ticket_reply_ticket_id'), 'portal_ticket_reply', ['ticket_id'], unique=False)
    op.create_index(op.f('ix_portal_ticket_reply_customer_user_id'), 'portal_ticket_reply', ['customer_user_id'], unique=False)

    op.execute("ALTER TABLE portal_ticket_reply ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON portal_ticket_reply
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON portal_ticket_reply;")
    op.drop_index(op.f('ix_portal_ticket_reply_customer_user_id'), table_name='portal_ticket_reply')
    op.drop_index(op.f('ix_portal_ticket_reply_ticket_id'), table_name='portal_ticket_reply')
    op.drop_index(op.f('ix_portal_ticket_reply_tenant_id'), table_name='portal_ticket_reply')
    op.drop_table('portal_ticket_reply')
