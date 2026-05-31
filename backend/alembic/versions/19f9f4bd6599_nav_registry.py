"""SPEC §1 nav registry — nav_group + nav_module tables (PREPARE, not yet activated)

Revision ID: 19f9f4bd6599
Revises: d2bea9d7f819
Create Date: 2026-05-31 19:00:00.000000

SPEC §1 codifies the Left Navigation Information Architecture (IA): 9 top-level groups
(Workspace, Work Management, CRM & Commercial, Billing & Revenue, Network & Operations,
Analytics & AI, Enterprise, System, Studio) with their child modules, each tagged with
the [O] (owns records) / [V] (view-only) placement legend. Today that tree lives in the
SPEC doc and the UI is meant to render it — but until now there was no data home for it.

This migration creates that home:

  - `nav_group`  — tenant-scoped, key/name/order; one row per top-level group.
  - `nav_module` — tenant-scoped, group_id FK, key/name/order/placement/owner_record_keys/route;
                   one row per module within a group.

Both tables carry the standard NULLIF-guarded `tenant_isolation` RLS policy (mirrors the
shape used by every post-RLS-flip table: `region`, `approval`, `portal_ticket_reply`, ...).

PREPARE-only (Step 7 of the SPEC build, gated on Gev's ⛔ approval):
  - This is FILE ONLY. Apply with `alembic upgrade head` ONLY after Gev approves.
  - The companion seeder (`seed_nav_registry.py::seed_nav_registry_if_empty`) is
    written but its lifespan hook in `app/main.py` is COMMENTED OUT.
  - The read-only API stub (`routers/nav_registry.py`) is written but NOT mounted in
    `app/main.py`.

Additive + reversible. No data migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '19f9f4bd6599'
down_revision: Union[str, Sequence[str], None] = 'd2bea9d7f819'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ---------------- nav_group ----------------
    op.create_table(
        'nav_group',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('icon', sa.String(length=60), nullable=True),
        sa.Column('order', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20),
                  server_default=sa.text("'active'"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'key', name='uq_nav_group_key'),
        sa.UniqueConstraint('tenant_id', 'order', name='uq_nav_group_order'),
    )
    op.create_index(op.f('ix_nav_group_tenant_id'), 'nav_group', ['tenant_id'], unique=False)

    op.execute(
        "COMMENT ON TABLE nav_group IS "
        "'SPEC §1 top-level Left-Nav group (Workspace, CRM & Commercial, Billing & Revenue, "
        "Network & Operations, Analytics & AI, Enterprise, System, Studio, Work Management). "
        "Tenant-scoped; key is the stable machine id, order is display position 1..N.';"
    )

    op.execute("ALTER TABLE nav_group ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON nav_group
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)

    # ---------------- nav_module ----------------
    op.create_table(
        'nav_module',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('group_id', sa.UUID(), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('icon', sa.String(length=60), nullable=True),
        sa.Column('order', sa.Integer(), nullable=False),
        sa.Column('placement', sa.String(length=20), nullable=False),
        sa.Column('owner_module', sa.String(length=80), nullable=False),
        sa.Column('owner_record_keys', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('route', sa.String(length=160), nullable=True),
        sa.Column('status', sa.String(length=20),
                  server_default=sa.text("'active'"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['group_id'], ['nav_group.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'group_id', 'key', name='uq_nav_module_key_in_group'),
        sa.UniqueConstraint('tenant_id', 'group_id', 'order', name='uq_nav_module_order_in_group'),
    )
    op.create_index(op.f('ix_nav_module_tenant_id'), 'nav_module', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_nav_module_group_id'), 'nav_module', ['group_id'], unique=False)
    op.create_index('ix_nav_module_owner_module', 'nav_module', ['owner_module'], unique=False)

    op.execute(
        "COMMENT ON TABLE nav_module IS "
        "'SPEC §1 module within a nav_group. placement: O = owns records (see "
        "owner_record_keys for the entity_def keys it owns) | V = view/aggregation only. "
        "Locked SPEC placements enforced by the seed: Orders & Validation under "
        "Billing & Revenue (NOT CRM); Contracts in CRM; KB/Announcements/Communications/"
        "Calendar under Workspace with placement=O; Workspace hub items are V; "
        "Studio is its own top-level group.';"
    )

    op.execute("ALTER TABLE nav_module ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON nav_module
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON nav_module;")
    op.execute("ALTER TABLE nav_module DISABLE ROW LEVEL SECURITY;")
    op.drop_index('ix_nav_module_owner_module', table_name='nav_module')
    op.drop_index(op.f('ix_nav_module_group_id'), table_name='nav_module')
    op.drop_index(op.f('ix_nav_module_tenant_id'), table_name='nav_module')
    op.drop_table('nav_module')

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON nav_group;")
    op.execute("ALTER TABLE nav_group DISABLE ROW LEVEL SECURITY;")
    op.drop_index(op.f('ix_nav_group_tenant_id'), table_name='nav_group')
    op.drop_table('nav_group')
