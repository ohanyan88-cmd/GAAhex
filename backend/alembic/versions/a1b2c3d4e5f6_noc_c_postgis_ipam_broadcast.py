"""NOC Phase C — PostGIS extension, fiber routes, outage paths, IPAM assignments,
asset location history, RADIUS sessions, mass broadcasts.

New tables:
  * fiber_route          — WKT-based fiber path geometry (TEXT, castable to PostGIS geometry)
  * outage_path          — links outage Records to fiber_route rows with cut-point WKT
  * ip_assignment        — per-address IP lease detail ON TOP of pool_allocation rows
  * asset_location_history — multi-location audit trail for asset Records
  * radius_session       — RADIUS Acct-Start/Stop session records
  * mass_broadcast       — outage notification mass-send management

PostGIS: CREATE EXTENSION IF NOT EXISTS postgis is run at the top of upgrade() so
spatial casts work in raw SQL queries on fiber_route.geo_path and OutagePath.cut_location_wkt.

Revision ID: a1b2c3d4e5f6
Revises: f2a8c4b9d7e3
Create Date: 2026-06-02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg


revision = 'a1b2c3d4e5f6'
down_revision = 'f2a8c4b9d7e3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable PostGIS — idempotent, no-op if already installed.
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    # ---- 1. fiber_route ----
    op.create_table(
        'fiber_route',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('geo_path', sa.Text, nullable=True),
        sa.Column('capacity_gbps', sa.Integer, nullable=True),
        sa.Column('origin_pop', sa.String(200), nullable=True),
        sa.Column('destination_pop', sa.String(200), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_fiber_route_tenant_id', 'fiber_route', ['tenant_id'])
    op.create_index('ix_fiber_route_tenant_status', 'fiber_route', ['tenant_id', 'status'])

    # ---- 2. outage_path ----
    op.create_table(
        'outage_path',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('outage_record_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('record.id'), nullable=False),
        sa.Column('fiber_route_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('fiber_route.id'), nullable=False),
        sa.Column('cut_location_wkt', sa.Text, nullable=True),
        sa.Column('cut_distance_from_origin_m', sa.Integer, nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_outage_path_tenant_id', 'outage_path', ['tenant_id'])
    op.create_index('ix_outage_path_outage_record_id', 'outage_path', ['outage_record_id'])
    op.create_index('ix_outage_path_fiber_route_id', 'outage_path', ['fiber_route_id'])

    # ---- 3. ip_assignment ----
    op.create_table(
        'ip_assignment',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('pool_allocation_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('pool_allocation.id'), nullable=False),
        sa.Column('address', sa.String(45), nullable=False),
        sa.Column('family', sa.Integer, nullable=False),
        sa.Column('service_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('service.id'), nullable=True),
        sa.Column('asset_record_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('record.id'), nullable=True),
        sa.Column('mac', sa.String(20), nullable=True),
        sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('released_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_ip_assignment_tenant_id', 'ip_assignment', ['tenant_id'])
    op.create_index('ix_ip_assignment_pool_allocation_id', 'ip_assignment', ['pool_allocation_id'])
    op.create_index('ix_ip_assignment_service_id', 'ip_assignment', ['service_id'])
    op.create_index('ix_ip_assignment_address_tenant', 'ip_assignment', ['address', 'tenant_id'])
    # Partial unique: at most one active (released_at IS NULL) assignment per (tenant, address)
    op.create_index(
        'uq_ip_assignment_active',
        'ip_assignment',
        ['tenant_id', 'address'],
        unique=True,
        postgresql_where=sa.text("released_at IS NULL"),
    )

    # ---- 4. asset_location_history ----
    op.create_table(
        'asset_location_history',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('asset_record_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('record.id'), nullable=False),
        sa.Column('from_location_type', sa.String(30), nullable=True),
        sa.Column('from_location_id', pg.UUID(as_uuid=True), nullable=True),
        sa.Column('to_location_type', sa.String(30), nullable=False),
        sa.Column('to_location_id', pg.UUID(as_uuid=True), nullable=True),
        sa.Column('moved_by_user_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('app_user.id'), nullable=True),
        sa.Column('moved_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('reason', sa.Text, nullable=True),
        sa.Column('work_order_id', pg.UUID(as_uuid=True), nullable=True),
    )
    op.create_index('ix_asset_location_history_tenant_id', 'asset_location_history', ['tenant_id'])
    op.create_index('ix_asset_location_history_asset_time',
                    'asset_location_history', ['asset_record_id', 'moved_at'])

    # ---- 5. radius_session ----
    op.create_table(
        'radius_session',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('service_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('service.id'), nullable=True),
        sa.Column('username', sa.String(200), nullable=False),
        sa.Column('session_id', sa.String(200), nullable=False),
        sa.Column('nas_ip', sa.String(45), nullable=True),
        sa.Column('nas_port', sa.String(100), nullable=True),
        sa.Column('framed_ip', sa.String(45), nullable=True),
        sa.Column('acct_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('acct_stop', sa.DateTime(timezone=True), nullable=True),
        sa.Column('octets_in', sa.BigInteger, nullable=True),
        sa.Column('octets_out', sa.BigInteger, nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.UniqueConstraint('tenant_id', 'session_id', name='uq_radius_session_tenant_session'),
    )
    op.create_index('ix_radius_session_tenant_id', 'radius_session', ['tenant_id'])
    op.create_index('ix_radius_session_service_id', 'radius_session', ['service_id'])
    op.create_index('ix_radius_session_username_start', 'radius_session', ['username', 'acct_start'])
    # Partial index for fast "who is online" — only active rows
    op.create_index(
        'ix_radius_session_active',
        'radius_session',
        ['status'],
        postgresql_where=sa.text("status = 'active'"),
    )

    # ---- 6. mass_broadcast ----
    op.create_table(
        'mass_broadcast',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('incident_record_id', pg.UUID(as_uuid=True),
                  sa.ForeignKey('record.id'), nullable=True),
        sa.Column('channel', sa.String(20), nullable=False),
        sa.Column('template_id', sa.String(200), nullable=True),
        sa.Column('audience_filter_json', pg.JSONB, nullable=True),
        sa.Column('recipients_count', sa.Integer, nullable=True),
        sa.Column('sent_count', sa.Integer, nullable=True),
        sa.Column('failed_count', sa.Integer, nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='draft'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', pg.UUID(as_uuid=True),
                  sa.ForeignKey('app_user.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index('ix_mass_broadcast_tenant_id', 'mass_broadcast', ['tenant_id'])
    op.create_index('ix_mass_broadcast_incident_record_id', 'mass_broadcast', ['incident_record_id'])
    op.create_index('ix_mass_broadcast_status_created', 'mass_broadcast', ['status', 'created_at'])


def downgrade() -> None:
    # mass_broadcast
    op.drop_index('ix_mass_broadcast_status_created', table_name='mass_broadcast')
    op.drop_index('ix_mass_broadcast_incident_record_id', table_name='mass_broadcast')
    op.drop_index('ix_mass_broadcast_tenant_id', table_name='mass_broadcast')
    op.drop_table('mass_broadcast')

    # radius_session
    op.drop_index('ix_radius_session_active', table_name='radius_session')
    op.drop_index('ix_radius_session_username_start', table_name='radius_session')
    op.drop_index('ix_radius_session_service_id', table_name='radius_session')
    op.drop_index('ix_radius_session_tenant_id', table_name='radius_session')
    op.drop_table('radius_session')

    # asset_location_history
    op.drop_index('ix_asset_location_history_asset_time', table_name='asset_location_history')
    op.drop_index('ix_asset_location_history_tenant_id', table_name='asset_location_history')
    op.drop_table('asset_location_history')

    # ip_assignment
    op.drop_index('uq_ip_assignment_active', table_name='ip_assignment')
    op.drop_index('ix_ip_assignment_address_tenant', table_name='ip_assignment')
    op.drop_index('ix_ip_assignment_service_id', table_name='ip_assignment')
    op.drop_index('ix_ip_assignment_pool_allocation_id', table_name='ip_assignment')
    op.drop_index('ix_ip_assignment_tenant_id', table_name='ip_assignment')
    op.drop_table('ip_assignment')

    # outage_path
    op.drop_index('ix_outage_path_fiber_route_id', table_name='outage_path')
    op.drop_index('ix_outage_path_outage_record_id', table_name='outage_path')
    op.drop_index('ix_outage_path_tenant_id', table_name='outage_path')
    op.drop_table('outage_path')

    # fiber_route
    op.drop_index('ix_fiber_route_tenant_status', table_name='fiber_route')
    op.drop_index('ix_fiber_route_tenant_id', table_name='fiber_route')
    op.drop_table('fiber_route')

    # Drop PostGIS extension last — only if nothing else depends on it
    op.execute("DROP EXTENSION IF EXISTS postgis")
