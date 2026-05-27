"""workitem table (Batch 32): field-dispatch work assignment tracker

Revision ID: a1f4c8e23d709b52
Revises: d9f3b1e72c4a8051
Create Date: 2026-05-27 21:00:00.000000

Additive + reversible. Single new table for the WorkItem module. Tenant-scoped; carries the same
NULLIF-guarded tenant_isolation RLS policy as all post-enable-RLS tables.
gaaex_app grants inherit via the ALTER DEFAULT PRIVILEGES set in the enable-RLS migration.

NOT run against the live DB by the worker — coordinator applies: alembic upgrade head.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1f4c8e23d709b52'
down_revision: Union[str, Sequence[str], None] = 'd9f3b1e72c4a8051'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'workitem',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('owner_node_id', sa.UUID(), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('kind', sa.String(length=20), nullable=False, server_default='task'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='TODO'),
        sa.Column('priority', sa.String(length=20), nullable=False, server_default='NORMAL'),
        sa.Column('assigned_user_id', sa.UUID(), nullable=True),
        sa.Column('customer_id', sa.UUID(), nullable=True),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('location', sa.Text(), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
        sa.ForeignKeyConstraint(['owner_node_id'], ['org_node.id'], ),
        sa.ForeignKeyConstraint(['assigned_user_id'], ['app_user.id'], ),
        sa.ForeignKeyConstraint(['customer_id'], ['record.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_workitem_tenant_id'), 'workitem', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_workitem_assigned_user_id'), 'workitem', ['assigned_user_id'], unique=False)
    op.create_index(op.f('ix_workitem_customer_id'), 'workitem', ['customer_id'], unique=False)

    # RLS on workitem
    op.execute("ALTER TABLE workitem ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON workitem
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON workitem;")
    op.drop_index(op.f('ix_workitem_customer_id'), table_name='workitem')
    op.drop_index(op.f('ix_workitem_assigned_user_id'), table_name='workitem')
    op.drop_index(op.f('ix_workitem_tenant_id'), table_name='workitem')
    op.drop_table('workitem')
