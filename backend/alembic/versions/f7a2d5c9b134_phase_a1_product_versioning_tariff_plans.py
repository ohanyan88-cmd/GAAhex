"""Phase A.1 — Product MRC/NRC + ProductVersion + TariffPlan.

Three things in one revision:

1. Adds ``recurring_price`` (Numeric(12,2)), ``one_time_price`` (Numeric(12,2)), and
   ``proration_mode`` (String, server_default='daily') to the existing ``product`` table.
   The legacy integer-luma ``default_amount`` is preserved for backward-compat with old
   subscriptions and pre-A.1 catalog rows.

2. Creates the ``product_version`` table — immutable per-product snapshots of the priced spec,
   with ``effective_from`` / ``effective_to`` windows and a JSONB ``spec_json`` blob. UNIQUE
   (product_id, version_no). ``superseded_by_id`` self-FK back-points to the version that
   replaced this one.

3. Creates the ``tariff_plan`` table — first-class tariff rate-card (base recurring + included
   units + overage / tiered overage), tenant-scoped, with UNIQUE (tenant_id, key). Soft-delete
   via ``active`` column.

Revision ID: f7a2d5c9b134
Revises: d7f9b4a2c3e1
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = 'f7a2d5c9b134'
down_revision = 'd7f9b4a2c3e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1. Product MRC/NRC + proration_mode ----
    op.add_column('product', sa.Column('recurring_price', sa.Numeric(12, 2), nullable=True))
    op.add_column('product', sa.Column('one_time_price', sa.Numeric(12, 2), nullable=True))
    op.add_column(
        'product',
        sa.Column('proration_mode', sa.String(length=20), nullable=False, server_default='daily'),
    )

    # ---- 2. product_version ----
    op.create_table(
        'product_version',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('product_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('effective_from', sa.DateTime(timezone=True), nullable=False),
        sa.Column('effective_to', sa.DateTime(timezone=True), nullable=True),
        sa.Column('recurring_price', sa.Numeric(12, 2), nullable=True),
        sa.Column('one_time_price', sa.Numeric(12, 2), nullable=True),
        sa.Column('cycle', sa.String(length=20), nullable=True),
        sa.Column('spec_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column('superseded_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['product_id'], ['product.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['superseded_by_id'], ['product_version.id'], ondelete='SET NULL'),
        sa.UniqueConstraint('product_id', 'version_no', name='uq_product_version_no'),
    )
    op.create_index('ix_product_version_product_id', 'product_version', ['product_id'])

    # ---- 3. tariff_plan ----
    op.create_table(
        'tariff_plan',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('base_recurring_price', sa.Numeric(12, 2), nullable=False),
        sa.Column('included_units', sa.Integer(), nullable=True),
        sa.Column('overage_rate', sa.Numeric(12, 4), nullable=True),
        sa.Column('tiers_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column('cycle', sa.String(length=20), nullable=False, server_default='monthly'),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.UniqueConstraint('tenant_id', 'key', name='uq_tariff_plan_key'),
    )
    op.create_index('ix_tariff_plan_tenant_id', 'tariff_plan', ['tenant_id'])


def downgrade() -> None:
    op.drop_index('ix_tariff_plan_tenant_id', table_name='tariff_plan')
    op.drop_table('tariff_plan')

    op.drop_index('ix_product_version_product_id', table_name='product_version')
    op.drop_table('product_version')

    op.drop_column('product', 'proration_mode')
    op.drop_column('product', 'one_time_price')
    op.drop_column('product', 'recurring_price')
