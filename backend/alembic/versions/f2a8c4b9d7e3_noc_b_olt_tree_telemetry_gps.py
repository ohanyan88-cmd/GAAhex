"""NOC Phase B — first-class OLT tree, optical telemetry, OTDR, technician GPS.

Adds six new tables sitting under the existing ``record(entity_key='olt')`` polymorphic
row:

  * ``olt_chassis``        UNIQUE (olt_record_id, slot_no)
  * ``olt_card``           UNIQUE (chassis_id, slot_no)
  * ``olt_port``           UNIQUE (card_id, port_no) + composite idx (status, last_polled_at)
  * ``onu``                partial UNIQUE (tenant_id, serial) WHERE status<>'removed'
  * ``optical_power_sample`` polymorphic (source_type, source_id) — olt_port or onu
  * ``otdr_test``          polymorphic target; result_json holds the trace
  * ``technician_location_ping`` per-tech GPS trail

No seed: tests + production tooling materialize chassis/cards/ports as the OLT is
racked. v1 telemetry is produced by ``SimulatedDiagnosticAdapter`` — the schema is
identical for a future real-EMS adapter.

Revision ID: f2a8c4b9d7e3
Revises: e9c2d4f7a1b3
Create Date: 2026-06-02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg


revision = 'f2a8c4b9d7e3'
down_revision = 'e9c2d4f7a1b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1. olt_chassis ----
    op.create_table(
        'olt_chassis',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('olt_record_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('record.id'), nullable=False),
        sa.Column('slot_no', sa.Integer, nullable=False),
        sa.Column('model', sa.String(80), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('installed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint('olt_record_id', 'slot_no', name='uq_olt_chassis_slot'),
    )
    op.create_index('ix_olt_chassis_tenant_id', 'olt_chassis', ['tenant_id'])
    op.create_index('ix_olt_chassis_olt_record_id', 'olt_chassis', ['olt_record_id'])

    # ---- 2. olt_card ----
    op.create_table(
        'olt_card',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('chassis_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('olt_chassis.id'), nullable=False),
        sa.Column('slot_no', sa.Integer, nullable=False),
        sa.Column('type', sa.String(20), nullable=False),
        sa.Column('port_count', sa.Integer, nullable=False, server_default='0'),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('fw_version', sa.String(80), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint('chassis_id', 'slot_no', name='uq_olt_card_slot'),
    )
    op.create_index('ix_olt_card_tenant_id', 'olt_card', ['tenant_id'])
    op.create_index('ix_olt_card_chassis_id', 'olt_card', ['chassis_id'])

    # ---- 3. olt_port ----
    op.create_table(
        'olt_port',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('card_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('olt_card.id'), nullable=False),
        sa.Column('port_no', sa.Integer, nullable=False),
        sa.Column('type', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='up'),
        sa.Column('last_polled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint('card_id', 'port_no', name='uq_olt_port_no'),
    )
    op.create_index('ix_olt_port_tenant_id', 'olt_port', ['tenant_id'])
    op.create_index('ix_olt_port_card_id', 'olt_port', ['card_id'])
    op.create_index('ix_olt_port_status_polled', 'olt_port', ['status', 'last_polled_at'])

    # ---- 4. onu ----
    op.create_table(
        'onu',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('port_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('olt_port.id'), nullable=False),
        sa.Column('serial', sa.String(80), nullable=False),
        sa.Column('model', sa.String(80), nullable=True),
        sa.Column('customer_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('record.id'), nullable=True),
        sa.Column('service_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('service.id'), nullable=True),
        sa.Column('distance_m', sa.Integer, nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_onu_tenant_id', 'onu', ['tenant_id'])
    op.create_index('ix_onu_port_id', 'onu', ['port_id'])
    op.create_index('ix_onu_customer_id', 'onu', ['customer_id'])
    op.create_index('ix_onu_service_id', 'onu', ['service_id'])
    op.create_index('ix_onu_status_last_seen', 'onu', ['status', 'last_seen_at'])
    # Partial unique on (tenant, serial) WHERE status <> 'removed'
    op.create_index(
        'uq_onu_tenant_serial_live',
        'onu',
        ['tenant_id', 'serial'],
        unique=True,
        postgresql_where=sa.text("status <> 'removed'"),
    )

    # ---- 5. optical_power_sample ----
    op.create_table(
        'optical_power_sample',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('source_type', sa.String(20), nullable=False),
        sa.Column('source_id', pg.UUID(as_uuid=True), nullable=False),
        sa.Column('rx_dbm', sa.Numeric(6, 2), nullable=False),
        sa.Column('tx_dbm', sa.Numeric(6, 2), nullable=True),
        sa.Column('sampled_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_optical_sample_tenant_id', 'optical_power_sample', ['tenant_id'])
    op.create_index('ix_optical_sample_source_time',
                    'optical_power_sample',
                    ['source_type', 'source_id', 'sampled_at'])

    # ---- 6. otdr_test ----
    op.create_table(
        'otdr_test',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('target_type', sa.String(20), nullable=False),
        sa.Column('target_id', pg.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='queued'),
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('requested_by', pg.UUID(as_uuid=True),
                  sa.ForeignKey('app_user.id'), nullable=True),
        sa.Column('result_json', pg.JSONB, nullable=True),
        sa.Column('error_message', sa.Text, nullable=True),
    )
    op.create_index('ix_otdr_tenant_id', 'otdr_test', ['tenant_id'])
    op.create_index('ix_otdr_target', 'otdr_test', ['target_type', 'target_id'])
    op.create_index('ix_otdr_status_requested', 'otdr_test', ['status', 'requested_at'])

    # ---- 7. technician_location_ping ----
    op.create_table(
        'technician_location_ping',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('technician_user_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('app_user.id'), nullable=False),
        sa.Column('lat', sa.Numeric(9, 6), nullable=False),
        sa.Column('lng', sa.Numeric(9, 6), nullable=False),
        sa.Column('accuracy_m', sa.Integer, nullable=True),
        sa.Column('heading_deg', sa.Integer, nullable=True),
        sa.Column('speed_mps', sa.Numeric(6, 2), nullable=True),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_tech_ping_tenant_id', 'technician_location_ping', ['tenant_id'])
    op.create_index('ix_tech_ping_tech_recorded',
                    'technician_location_ping',
                    ['technician_user_id', 'recorded_at'])


def downgrade() -> None:
    # technician_location_ping
    op.drop_index('ix_tech_ping_tech_recorded', table_name='technician_location_ping')
    op.drop_index('ix_tech_ping_tenant_id', table_name='technician_location_ping')
    op.drop_table('technician_location_ping')

    # otdr_test
    op.drop_index('ix_otdr_status_requested', table_name='otdr_test')
    op.drop_index('ix_otdr_target', table_name='otdr_test')
    op.drop_index('ix_otdr_tenant_id', table_name='otdr_test')
    op.drop_table('otdr_test')

    # optical_power_sample
    op.drop_index('ix_optical_sample_source_time', table_name='optical_power_sample')
    op.drop_index('ix_optical_sample_tenant_id', table_name='optical_power_sample')
    op.drop_table('optical_power_sample')

    # onu
    op.drop_index('uq_onu_tenant_serial_live', table_name='onu')
    op.drop_index('ix_onu_status_last_seen', table_name='onu')
    op.drop_index('ix_onu_service_id', table_name='onu')
    op.drop_index('ix_onu_customer_id', table_name='onu')
    op.drop_index('ix_onu_port_id', table_name='onu')
    op.drop_index('ix_onu_tenant_id', table_name='onu')
    op.drop_table('onu')

    # olt_port
    op.drop_index('ix_olt_port_status_polled', table_name='olt_port')
    op.drop_index('ix_olt_port_card_id', table_name='olt_port')
    op.drop_index('ix_olt_port_tenant_id', table_name='olt_port')
    op.drop_table('olt_port')

    # olt_card
    op.drop_index('ix_olt_card_chassis_id', table_name='olt_card')
    op.drop_index('ix_olt_card_tenant_id', table_name='olt_card')
    op.drop_table('olt_card')

    # olt_chassis
    op.drop_index('ix_olt_chassis_olt_record_id', table_name='olt_chassis')
    op.drop_index('ix_olt_chassis_tenant_id', table_name='olt_chassis')
    op.drop_table('olt_chassis')
