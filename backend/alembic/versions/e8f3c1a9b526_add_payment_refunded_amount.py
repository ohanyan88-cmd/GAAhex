"""Add payment.refunded_amount + payment.refunded_at for refund tracking (SPEC §4.5 path 'refund')

Financial immutability (SPEC §0.3) allows state changes via UPDATE on payment; the DB trigger only
blocks DELETE. A refund records the refunded amount as a delta on the payment row, not as a
deletion or replacement. Sum of (refunded_amount) ≤ payment.amount enforced at router layer.

Revision ID: e8f3c1a9b526
Revises: d5b9c6f4e21a
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa


revision = 'e8f3c1a9b526'
down_revision = 'd5b9c6f4e21a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('payment', sa.Column('refunded_amount', sa.BigInteger(), nullable=False, server_default='0'))
    op.add_column('payment', sa.Column('refunded_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('payment', 'refunded_at')
    op.drop_column('payment', 'refunded_amount')
