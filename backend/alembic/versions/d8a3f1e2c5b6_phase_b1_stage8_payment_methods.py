"""Phase B.1 — Stage 8 deposit fields + payment_method table.

Adds the deposit + payment-method linkage to the ``order`` table and creates a new
``payment_method`` first-class table that stores GATEWAY-VAULTED card references (never PAN /
CVV). Also relaxes ``payment.invoice_id`` to NULLABLE so deposit payments — collected before
any invoice exists for the order — can be recorded as Payment rows.

Order extensions (all nullable, additive):
  * deposit_required    Numeric(14, 2)  — what Stage 8 needs to clear (NULL = none).
  * deposit_collected   Numeric(14, 2)  — running total collected so far.
  * deposit_held_until  timestamptz     — release date; NULL = held indefinitely.
  * payment_method_id   uuid FK         — the vaulted card the order will be billed against.
  * deposit_payment_id  uuid FK         — back-ref to the Payment row recording the deposit.

New table ``payment_method``:
  * UNIQUE (tenant_id, gateway_token)
  * INDEX  (customer_id, status)
  * No CHECK constraints on brand / status — those are app-layer validated; the column lengths
    keep the schema future-proof for new brands/statuses without a migration.

Payment relaxation:
  * payment.invoice_id  → NULLABLE so deposit Payment rows can exist without an invoice.

Revision ID: d8a3f1e2c5b6
Revises: e3b2f9c1d4a7
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op


revision = 'd8a3f1e2c5b6'
down_revision = 'e3b2f9c1d4a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1. payment_method table ----
    op.create_table(
        'payment_method',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('customer_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('record.id'), nullable=False),
        sa.Column('account_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('account.id'), nullable=True),
        sa.Column('gateway', sa.String(40), nullable=False),
        sa.Column('gateway_token', sa.String(255), nullable=False),
        sa.Column('last4', sa.String(4), nullable=False),
        sa.Column('brand', sa.String(20), nullable=False),
        sa.Column('exp_month', sa.Integer, nullable=False),
        sa.Column('exp_year', sa.Integer, nullable=False),
        sa.Column('is_default', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('tenant_id', 'gateway_token', name='uq_payment_method_tenant_token'),
    )
    op.create_index('ix_payment_method_tenant_id', 'payment_method', ['tenant_id'])
    op.create_index('ix_payment_method_customer_id', 'payment_method', ['customer_id'])
    op.create_index('ix_payment_method_account_id', 'payment_method', ['account_id'])
    op.create_index('ix_payment_method_customer_status', 'payment_method',
                    ['customer_id', 'status'])

    # ---- 2. order: deposit + payment-method linkage (all nullable, no backfill) ----
    op.add_column('order', sa.Column('deposit_required', sa.Numeric(14, 2), nullable=True))
    op.add_column('order', sa.Column('deposit_collected', sa.Numeric(14, 2), nullable=True))
    op.add_column('order', sa.Column('deposit_held_until',
                                     sa.DateTime(timezone=True), nullable=True))
    op.add_column('order', sa.Column('payment_method_id',
                                     sa.dialects.postgresql.UUID(as_uuid=True),
                                     sa.ForeignKey('payment_method.id'), nullable=True))
    op.add_column('order', sa.Column('deposit_payment_id',
                                     sa.dialects.postgresql.UUID(as_uuid=True),
                                     sa.ForeignKey('payment.id'), nullable=True))
    op.create_index('ix_order_payment_method_id', 'order', ['payment_method_id'])
    op.create_index('ix_order_deposit_payment_id', 'order', ['deposit_payment_id'])

    # ---- 3. payment.invoice_id → nullable (deposits have no invoice yet) ----
    op.alter_column('payment', 'invoice_id',
                    existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
                    nullable=True)


def downgrade() -> None:
    # Reverse step 3: re-tighten payment.invoice_id to NOT NULL. Any deposit rows must be
    # cleaned up by the operator before running this downgrade (the kernel never deletes
    # Payment rows — SPEC §0.3 — so a manual cleanup pass is required).
    op.alter_column('payment', 'invoice_id',
                    existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
                    nullable=False)

    # Reverse step 2: drop the order columns.
    op.drop_index('ix_order_deposit_payment_id', table_name='order')
    op.drop_index('ix_order_payment_method_id', table_name='order')
    op.drop_column('order', 'deposit_payment_id')
    op.drop_column('order', 'payment_method_id')
    op.drop_column('order', 'deposit_held_until')
    op.drop_column('order', 'deposit_collected')
    op.drop_column('order', 'deposit_required')

    # Reverse step 1: drop the payment_method table.
    op.drop_index('ix_payment_method_customer_status', table_name='payment_method')
    op.drop_index('ix_payment_method_account_id', table_name='payment_method')
    op.drop_index('ix_payment_method_customer_id', table_name='payment_method')
    op.drop_index('ix_payment_method_tenant_id', table_name='payment_method')
    op.drop_table('payment_method')
