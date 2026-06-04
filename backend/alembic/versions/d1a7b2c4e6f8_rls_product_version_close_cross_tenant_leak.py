"""RLS — close cross-tenant leak on product_version.

product_version was deliberately skipped by Wave 3 (e7f4a2b9c8d1) on the theory that
its FK to product transitively scoped it by tenant. That holds only at the app layer
and only for callers that route through _get_product / product.tenant_id filters; at
the DB layer the table has no policy, so any query that hits product_version directly
(services/product_versions.py:current_version_for/mint_new_version, Stripe webhooks,
background jobs, reporting, future endpoints) reads and writes across tenants once the
runtime role is the NOSUPERUSER gaahex_app.

Fix matches the canonical convention for child/version tables (studio_page_version,
b5e2d9f4c1a8): give the child its own tenant_id column + standard tenant_isolation
policy. Backfill tenant_id from parent product. NOT NULL after backfill. Index for the
RLS predicate. FK to tenant for referential integrity (consistent with tariff_plan and
studio_page_version).

This revision also merges the two open heads (3dac5acb70b7 + f8a1b2c3d4e5) — only one
real chain at HEAD after this lands.

Revision ID: d1a7b2c4e6f8
Revises: 3dac5acb70b7, f8a1b2c3d4e5
Create Date: 2026-06-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd1a7b2c4e6f8'
down_revision: Union[str, Sequence[str], None] = ('3dac5acb70b7', 'f8a1b2c3d4e5')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add tenant_id as NULLABLE first so the ALTER doesn't reject existing rows.
    op.add_column(
        'product_version',
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
    )

    # 2. Backfill from parent product. CASCADE FK on product_id guarantees every row has a parent.
    op.execute("""
        UPDATE product_version pv
           SET tenant_id = p.tenant_id
          FROM product p
         WHERE pv.product_id = p.id
           AND pv.tenant_id IS NULL;
    """)

    # 3. Lock it down — NOT NULL + FK to tenant. Done after backfill so we never reject existing data.
    op.alter_column('product_version', 'tenant_id', nullable=False)
    op.create_foreign_key(
        'fk_product_version_tenant_id',
        'product_version', 'tenant',
        ['tenant_id'], ['id'],
    )

    # 4. Index for the RLS predicate (every tenant-scoped table in the repo has this index).
    op.create_index('ix_product_version_tenant_id', 'product_version', ['tenant_id'])

    # 5. Standard tenant_isolation policy — same NULLIF-guarded pattern as 3a9203795d07 /
    #    e7f4a2b9c8d1 / f8a1b2c3d4e5 / studio_page_version. No FORCE: matches repo convention
    #    (the owner role bypasses by design; gaahex_app NOSUPERUSER enforces).
    op.execute("ALTER TABLE product_version ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON product_version;")
    op.execute("""
        CREATE POLICY tenant_isolation ON product_version
          USING      (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON product_version;")
    op.execute("ALTER TABLE product_version DISABLE ROW LEVEL SECURITY;")

    op.drop_index('ix_product_version_tenant_id', table_name='product_version')
    op.drop_constraint('fk_product_version_tenant_id', 'product_version', type_='foreignkey')
    op.drop_column('product_version', 'tenant_id')
