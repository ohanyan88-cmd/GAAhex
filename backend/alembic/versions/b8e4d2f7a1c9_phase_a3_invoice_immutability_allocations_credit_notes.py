"""Phase A.3 — Invoice immutability timestamps + PaymentAllocation + CreditNote.

Closes the financial-ledger foundation:
* ``invoice.posted_at`` / ``invoice.locked_by`` — set on DRAFT→ISSUED. NULL = mutable;
  NOT NULL = locked (only status/paid_at may change after, per SPEC §0.3).
* ``payment_allocation`` — explicit M:N row tying Payments to Invoices with an amount and
  applied_at timestamp. Drives ``outstanding_for_invoice`` and the auto-PAID transition.
* ``credit_note`` — first-class physical credit-note table with DRAFT/ISSUED/APPLIED/VOID
  lifecycle, per-tenant unique ``number`` (CN-XXXXX), and an ``applied_to_invoice_id`` link.
  Complements (does not replace) the legacy config-driven Record path at /api/credit-notes
  served by the SPEC §4.5 approval-gated endpoint.

Backfill is idempotent: existing ISSUED/OVERDUE/PAID/VOID invoices get ``posted_at = issued_at``
so the lock invariant applies retroactively.

Revision ID: b8e4d2f7a1c9
Revises: a3c7e1d9f482
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op


revision = 'b8e4d2f7a1c9'
down_revision = 'a3c7e1d9f482'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1. Invoice immutability columns. Both nullable; backfill UPDATE follows. ----
    op.add_column(
        'invoice',
        sa.Column('posted_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'invoice',
        sa.Column('locked_by', sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )

    # Idempotent backfill: only sets posted_at where it's still NULL and the invoice has
    # already been posted (status non-DRAFT) with a known issued_at timestamp. Re-running
    # the migration after a partial failure is a no-op for rows that already locked.
    op.execute("""
        UPDATE invoice
           SET posted_at = issued_at
         WHERE status IN ('ISSUED', 'OVERDUE', 'PAID', 'VOID')
           AND issued_at IS NOT NULL
           AND posted_at IS NULL;
    """)

    # ---- 2. payment_allocation table. ----
    op.create_table(
        'payment_allocation',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('payment_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('payment.id'), nullable=False),
        sa.Column('invoice_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('invoice.id'), nullable=False),
        sa.Column('amount', sa.Numeric(14, 2), nullable=False),
        sa.Column('applied_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('applied_by', sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint('amount > 0', name='ck_payment_allocation_amount_positive'),
    )
    op.create_index('ix_payment_allocation_tenant_id', 'payment_allocation', ['tenant_id'])
    op.create_index('ix_payment_allocation_payment_id', 'payment_allocation', ['payment_id'])
    op.create_index('ix_payment_allocation_invoice_id', 'payment_allocation', ['invoice_id'])

    # ---- 3. credit_note table. ----
    op.create_table(
        'credit_note',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('customer_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('record.id'), nullable=False),
        sa.Column('account_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('account.id'), nullable=True),
        sa.Column('number', sa.String(40), nullable=False),
        sa.Column('original_invoice_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('invoice.id'), nullable=True),
        sa.Column('amount', sa.Numeric(14, 2), nullable=False),
        sa.Column('reason', sa.String(500), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='DRAFT'),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('applied_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('applied_to_invoice_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('invoice.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', 'number', name='uq_credit_note_tenant_number'),
        sa.CheckConstraint('amount > 0', name='ck_credit_note_amount_positive'),
    )
    op.create_index('ix_credit_note_tenant_id', 'credit_note', ['tenant_id'])
    op.create_index('ix_credit_note_customer_id', 'credit_note', ['customer_id'])
    op.create_index('ix_credit_note_account_id', 'credit_note', ['account_id'])
    op.create_index('ix_credit_note_original_invoice_id', 'credit_note', ['original_invoice_id'])
    op.create_index('ix_credit_note_applied_to_invoice_id', 'credit_note', ['applied_to_invoice_id'])


def downgrade() -> None:
    op.drop_index('ix_credit_note_applied_to_invoice_id', table_name='credit_note')
    op.drop_index('ix_credit_note_original_invoice_id', table_name='credit_note')
    op.drop_index('ix_credit_note_account_id', table_name='credit_note')
    op.drop_index('ix_credit_note_customer_id', table_name='credit_note')
    op.drop_index('ix_credit_note_tenant_id', table_name='credit_note')
    op.drop_table('credit_note')

    op.drop_index('ix_payment_allocation_invoice_id', table_name='payment_allocation')
    op.drop_index('ix_payment_allocation_payment_id', table_name='payment_allocation')
    op.drop_index('ix_payment_allocation_tenant_id', table_name='payment_allocation')
    op.drop_table('payment_allocation')

    op.drop_column('invoice', 'locked_by')
    op.drop_column('invoice', 'posted_at')
