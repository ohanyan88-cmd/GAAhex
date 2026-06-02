"""payment_order table (Batch 33): online payment gateway

Revision ID: b4f2c9d3e1a7
Revises: a1f4c8e23d709b52
Create Date: 2026-05-27 22:00:00.000000

Additive + reversible. Single new table for the PaymentOrder module. Tenant-scoped; carries the
NULLIF-guarded tenant_isolation RLS policy identical to all post-enable-RLS tables.
gaahex_app grants inherit via the ALTER DEFAULT PRIVILEGES set in the enable-RLS migration.

NOT run against the live DB by the worker — coordinator applies: alembic upgrade head.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b4f2c9d3e1a7'
down_revision: Union[str, Sequence[str], None] = 'a1f4c8e23d709b52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema — create payment_order table + indexes + RLS policy."""
    op.create_table(
        'payment_order',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('owner_node_id', sa.UUID(), nullable=True),
        sa.Column('invoice_id', sa.UUID(), nullable=False),
        sa.Column('customer_id', sa.UUID(), nullable=True),
        sa.Column('payment_id', sa.UUID(), nullable=True),
        sa.Column('provider', sa.String(length=20), nullable=False, server_default='dev'),
        sa.Column('amount', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('currency', sa.String(length=3), nullable=False, server_default='AMD'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='PENDING'),
        sa.Column('provider_ref', sa.String(length=255), nullable=True),
        sa.Column('idempotency_key', sa.String(length=255), nullable=True),
        sa.Column('redirect_url', sa.Text(), nullable=True),
        sa.Column('raw_callback', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('initiated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
        sa.ForeignKeyConstraint(['owner_node_id'], ['org_node.id'], ),
        sa.ForeignKeyConstraint(['invoice_id'], ['invoice.id'], ),
        sa.ForeignKeyConstraint(['customer_id'], ['record.id'], ),
        sa.ForeignKeyConstraint(['payment_id'], ['payment.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_payment_order_tenant_id'), 'payment_order', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_payment_order_invoice_id'), 'payment_order', ['invoice_id'], unique=False)
    op.create_index(op.f('ix_payment_order_provider_ref'), 'payment_order', ['provider_ref'], unique=False)

    # RLS on payment_order — identical NULLIF guard used by workitem, helpdesk, etc.
    op.execute("ALTER TABLE payment_order ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON payment_order
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON payment_order;")
    op.drop_index(op.f('ix_payment_order_provider_ref'), table_name='payment_order')
    op.drop_index(op.f('ix_payment_order_invoice_id'), table_name='payment_order')
    op.drop_index(op.f('ix_payment_order_tenant_id'), table_name='payment_order')
    op.drop_table('payment_order')
