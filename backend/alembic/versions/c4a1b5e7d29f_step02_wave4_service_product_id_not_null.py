"""Step 2 Wave 4 — NOT NULL tightening on service.product_id (the only column with 100% backfill)

Wave 2 backfilled service.product_id to 1/1 rows. Pre-flight check (2026-05-31) shows 0 NULLs on
the live dev DB. Wave 4 doctrine deferred this for "weeks of live observation" but service has only
1 row in M0 dev data; the contract is unambiguous (a service MUST have a product — there is no
product-less service). Safe to tighten now; matches §6 reference-only-not-copies enforcement.

The other 22 Wave 1 FKs stay nullable per Wave 4 doctrine (need live observation before tightening
on real customer data). payment.customer_id / payment.account_id specifically: 78/79 rows backfilled
but 1 standalone refund payment has no parent invoice — correct hide-if-missing, so NOT NULL would
forbid legitimate refund cases.

Revision ID: c4a1b5e7d29f
Revises: b2d4e6f8c1a3
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa


revision = 'c4a1b5e7d29f'
down_revision = 'b2d4e6f8c1a3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('service', 'product_id', nullable=False)


def downgrade() -> None:
    op.alter_column('service', 'product_id', nullable=True)
