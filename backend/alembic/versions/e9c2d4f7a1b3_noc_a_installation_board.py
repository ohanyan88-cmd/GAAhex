"""NOC Phase A — Installation Board (Order pipeline stages 9-11).

Adds the resource-allocation + CPE-binding scaffolding behind the install board:

  * Three new first-class tables:
      - ``splitter_strand_allocation``  one-row-per-strand on each optical splitter
      - ``vlan_assignment``             ties one PoolAllocation (kind='vlan') to a service+purpose
      - ``cpe_binding``                 one bound ONT/router per (tenant, mac|serial) — live

  * Five additive columns on ``order`` (all nullable, no backfill):
      ``install_substage``, ``install_substage_at``,
      ``splitter_strand_allocation_id``, ``vlan_assignment_id``, ``cpe_binding_id``

  * Idempotent seed of a minimal ``entity_def(key='optical_splitter')`` per tenant so a Studio /
    EntityView page can render splitters via the generic ``/api/{slug}`` router. We seed JUST
    the entity_def row (status='active', label/plural/route_slug/icon) + the four canonical
    permission rows; field/status definitions can be layered later by the catalog seeder.

Per the locked architecture decision: the order's top-level ``status`` stays at 'PROVISIONING'
for the entire install pipeline; ``install_substage`` discriminates the sub-stage. No parallel
state machine is introduced.

Revision ID: e9c2d4f7a1b3
Revises: d8a3f1e2c5b6
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg


revision = 'e9c2d4f7a1b3'
down_revision = 'd8a3f1e2c5b6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1. splitter_strand_allocation ----
    op.create_table(
        'splitter_strand_allocation',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('splitter_record_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('record.id'), nullable=False),
        sa.Column('strand_no', sa.Integer, nullable=False),
        sa.Column('service_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('service.id'), nullable=True),
        sa.Column('order_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('order.id'), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='free'),
        sa.Column('allocated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('released_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('splitter_record_id', 'strand_no',
                            name='uq_splitter_strand_no'),
    )
    op.create_index('ix_splitter_strand_alloc_tenant_id',
                    'splitter_strand_allocation', ['tenant_id'])
    op.create_index('ix_splitter_strand_alloc_splitter_record_id',
                    'splitter_strand_allocation', ['splitter_record_id'])
    op.create_index('ix_splitter_strand_alloc_service_id',
                    'splitter_strand_allocation', ['service_id'])
    op.create_index('ix_splitter_strand_alloc_order_id',
                    'splitter_strand_allocation', ['order_id'])
    op.create_index('ix_splitter_strand_status',
                    'splitter_strand_allocation', ['splitter_record_id', 'status'])
    # partial unique on (splitter, strand_no) WHERE status='in_use'
    op.create_index(
        'uq_splitter_strand_in_use',
        'splitter_strand_allocation',
        ['splitter_record_id', 'strand_no'],
        unique=True,
        postgresql_where=sa.text("status = 'in_use'"),
    )

    # ---- 2. vlan_assignment ----
    op.create_table(
        'vlan_assignment',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('pool_allocation_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('pool_allocation.id'), nullable=False),
        sa.Column('service_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('service.id'), nullable=True),
        sa.Column('order_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('order.id'), nullable=True),
        sa.Column('purpose', sa.String(20), nullable=False, server_default='data'),
        sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('released_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('pool_allocation_id', name='uq_vlan_assign_pool_allocation'),
    )
    op.create_index('ix_vlan_assign_tenant_id', 'vlan_assignment', ['tenant_id'])
    op.create_index('ix_vlan_assign_pool_allocation_id',
                    'vlan_assignment', ['pool_allocation_id'])
    op.create_index('ix_vlan_assign_service_id', 'vlan_assignment', ['service_id'])
    op.create_index('ix_vlan_assign_order_id', 'vlan_assignment', ['order_id'])
    op.create_index('ix_vlan_assign_service_purpose',
                    'vlan_assignment', ['service_id', 'purpose'])

    # ---- 3. cpe_binding ----
    op.create_table(
        'cpe_binding',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('service_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('service.id'), nullable=True),
        sa.Column('order_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('order.id'), nullable=True),
        sa.Column('mac_address', sa.String(40), nullable=False),
        sa.Column('serial', sa.String(80), nullable=False),
        sa.Column('vendor', sa.String(80), nullable=True),
        sa.Column('model', sa.String(80), nullable=True),
        sa.Column('firmware', sa.String(80), nullable=True),
        sa.Column('provisioned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_payload_json', pg.JSONB, nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_cpe_binding_tenant_id', 'cpe_binding', ['tenant_id'])
    op.create_index('ix_cpe_binding_service', 'cpe_binding', ['service_id'])
    op.create_index('ix_cpe_binding_order', 'cpe_binding', ['order_id'])
    # partial unique on (tenant, mac) WHERE status<>'replaced'
    op.create_index(
        'uq_cpe_binding_tenant_mac_live',
        'cpe_binding',
        ['tenant_id', 'mac_address'],
        unique=True,
        postgresql_where=sa.text("status <> 'replaced'"),
    )
    # partial unique on (tenant, serial) WHERE status<>'replaced'
    op.create_index(
        'uq_cpe_binding_tenant_serial_live',
        'cpe_binding',
        ['tenant_id', 'serial'],
        unique=True,
        postgresql_where=sa.text("status <> 'replaced'"),
    )

    # ---- 4. order extensions (all nullable, additive) ----
    op.add_column('order', sa.Column('install_substage', sa.String(20), nullable=True))
    op.add_column('order', sa.Column('install_substage_at',
                                     sa.DateTime(timezone=True), nullable=True))
    op.add_column('order', sa.Column('splitter_strand_allocation_id',
                                     pg.UUID(as_uuid=True),
                                     sa.ForeignKey('splitter_strand_allocation.id'),
                                     nullable=True))
    op.add_column('order', sa.Column('vlan_assignment_id',
                                     pg.UUID(as_uuid=True),
                                     sa.ForeignKey('vlan_assignment.id'),
                                     nullable=True))
    op.add_column('order', sa.Column('cpe_binding_id',
                                     pg.UUID(as_uuid=True),
                                     sa.ForeignKey('cpe_binding.id'),
                                     nullable=True))
    op.create_index('ix_order_splitter_strand_allocation_id',
                    'order', ['splitter_strand_allocation_id'])
    op.create_index('ix_order_vlan_assignment_id', 'order', ['vlan_assignment_id'])
    op.create_index('ix_order_cpe_binding_id', 'order', ['cpe_binding_id'])

    # ---- 5. seed entity_def(key='optical_splitter') per tenant + canonical permissions ----
    # Idempotent: check-before-insert keyed off the existing (tenant_id, key) uniqueness on
    # entity_def. Skipping field/status defs here — the catalog seeder layers those when run.
    op.execute("""
        INSERT INTO entity_def (id, tenant_id, key, label, label_plural, route_slug, icon,
                                status, "order", created_at)
        SELECT gen_random_uuid(), t.id, 'optical_splitter', 'Optical Splitter',
               'Optical Splitters', 'optical-splitters', 'box', 'active', 0, NOW()
        FROM tenant t
        WHERE NOT EXISTS (
            SELECT 1 FROM entity_def e
            WHERE e.tenant_id = t.id AND e.key = 'optical_splitter'
        )
    """)
    op.execute("""
        INSERT INTO permission_def (id, tenant_id, key, label, "group")
        SELECT gen_random_uuid(), t.id, perm.k, perm.lbl, 'optical_splitter'
        FROM tenant t
        CROSS JOIN (VALUES
            ('optical_splitter.view',   'view optical_splitter'),
            ('optical_splitter.create', 'create optical_splitter'),
            ('optical_splitter.edit',   'edit optical_splitter'),
            ('optical_splitter.delete', 'delete optical_splitter')
        ) AS perm(k, lbl)
        WHERE NOT EXISTS (
            SELECT 1 FROM permission_def pd
            WHERE pd.tenant_id = t.id AND pd.key = perm.k
        )
    """)


def downgrade() -> None:
    # Reverse seed: drop the optical_splitter entity_def + its permissions (only if no records
    # of that kind exist; otherwise leave them in place to avoid cascading orphans).
    op.execute("""
        DELETE FROM permission_def
        WHERE "group" = 'optical_splitter'
          AND key LIKE 'optical_splitter.%'
    """)
    op.execute("""
        DELETE FROM entity_def
        WHERE key = 'optical_splitter'
          AND NOT EXISTS (
              SELECT 1 FROM record r WHERE r.entity_key = 'optical_splitter'
          )
    """)

    # Reverse order extensions.
    op.drop_index('ix_order_cpe_binding_id', table_name='order')
    op.drop_index('ix_order_vlan_assignment_id', table_name='order')
    op.drop_index('ix_order_splitter_strand_allocation_id', table_name='order')
    op.drop_column('order', 'cpe_binding_id')
    op.drop_column('order', 'vlan_assignment_id')
    op.drop_column('order', 'splitter_strand_allocation_id')
    op.drop_column('order', 'install_substage_at')
    op.drop_column('order', 'install_substage')

    # Reverse cpe_binding.
    op.drop_index('uq_cpe_binding_tenant_serial_live', table_name='cpe_binding')
    op.drop_index('uq_cpe_binding_tenant_mac_live', table_name='cpe_binding')
    op.drop_index('ix_cpe_binding_order', table_name='cpe_binding')
    op.drop_index('ix_cpe_binding_service', table_name='cpe_binding')
    op.drop_index('ix_cpe_binding_tenant_id', table_name='cpe_binding')
    op.drop_table('cpe_binding')

    # Reverse vlan_assignment.
    op.drop_index('ix_vlan_assign_service_purpose', table_name='vlan_assignment')
    op.drop_index('ix_vlan_assign_order_id', table_name='vlan_assignment')
    op.drop_index('ix_vlan_assign_service_id', table_name='vlan_assignment')
    op.drop_index('ix_vlan_assign_pool_allocation_id', table_name='vlan_assignment')
    op.drop_index('ix_vlan_assign_tenant_id', table_name='vlan_assignment')
    op.drop_table('vlan_assignment')

    # Reverse splitter_strand_allocation.
    op.drop_index('uq_splitter_strand_in_use', table_name='splitter_strand_allocation')
    op.drop_index('ix_splitter_strand_status', table_name='splitter_strand_allocation')
    op.drop_index('ix_splitter_strand_alloc_order_id',
                  table_name='splitter_strand_allocation')
    op.drop_index('ix_splitter_strand_alloc_service_id',
                  table_name='splitter_strand_allocation')
    op.drop_index('ix_splitter_strand_alloc_splitter_record_id',
                  table_name='splitter_strand_allocation')
    op.drop_index('ix_splitter_strand_alloc_tenant_id',
                  table_name='splitter_strand_allocation')
    op.drop_table('splitter_strand_allocation')
