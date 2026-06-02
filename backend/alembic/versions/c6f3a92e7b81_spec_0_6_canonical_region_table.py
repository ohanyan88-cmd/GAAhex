"""SPEC §0.6 canonical region/branch table

Revision ID: c6f3a92e7b81
Revises: b5e8f1c2d3a4
Create Date: 2026-05-31 04:00:00.000000

SPEC §0 invariant #6: "Region/Branch is a partition key on every operational record.
Cross-region read requires explicit grant." Step 2 (`b70ef3b98e27`) added a
`region_id UUID NULL` column to seven operational tables (record, invoice, payment,
order, service, helpdesk_ticket, workitem) — but there was no canonical region table
to FK those columns against. This migration creates that canonical home.

What this migration does:
  - CREATE TABLE `region` per `app/models/region.py` (tenant-scoped, hierarchical via
    self-referential `parent_id`, idempotent code per tenant via `uq_region_code`).
  - Standard NULLIF-guarded tenant_isolation RLS policy (mirrors the shape used by
    every post-RLS-flip table — see `approval`, `portal_ticket_reply`, etc.).

What this migration does NOT do (deferred to later, separate migrations):
  - FK additions from the existing `region_id` columns on the seven operational tables
    into `region.id`. Those columns hold pre-existing free UUIDs that may not match any
    seeded region row until backfill runs; adding the FK first would break running code.
  - NOT NULL tightening on `region_id` (same reason — needs the backfill pass first).
  - Cross-region read guard (`assert_can_read_region`) wired into routers — separate sweep.

Additive + reversible. No data migration. The companion seeder
`seed_regions.py::seed_demo_regions_if_empty` populates one starter Yerevan region per
tenant on boot (idempotent), so the table is never empty on a freshly-migrated demo DB.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c6f3a92e7b81'
down_revision: Union[str, Sequence[str], None] = 'b5e8f1c2d3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'region',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('code', sa.String(length=40), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('parent_id', sa.UUID(), nullable=True),
        sa.Column('region_type', sa.String(length=20),
                  server_default=sa.text("'region'"), nullable=False),
        sa.Column('status', sa.String(length=20),
                  server_default=sa.text("'active'"), nullable=False),
        sa.Column('timezone', sa.String(length=40), nullable=True),
        sa.Column('locale', sa.String(length=20), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['parent_id'], ['region.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'code', name='uq_region_code'),
    )
    op.create_index(op.f('ix_region_tenant_id'), 'region', ['tenant_id'], unique=False)
    op.create_index('ix_region_tenant_status', 'region', ['tenant_id', 'status'], unique=False)
    op.create_index('ix_region_parent', 'region', ['parent_id'], unique=False)

    op.execute(
        "COMMENT ON TABLE region IS "
        "'SPEC §0.6 canonical Region/Branch — partition key for every operational record. "
        "Hierarchy: country > region > city > branch via parent_id. "
        "FK wiring from the existing region_id columns on record/invoice/payment/order/"
        "service/helpdesk_ticket/workitem is deferred to a follow-up migration.';"
    )

    op.execute("ALTER TABLE region ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON region
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON region;")
    op.execute("ALTER TABLE region DISABLE ROW LEVEL SECURITY;")
    op.drop_index('ix_region_parent', table_name='region')
    op.drop_index('ix_region_tenant_status', table_name='region')
    op.drop_index(op.f('ix_region_tenant_id'), table_name='region')
    op.drop_table('region')
