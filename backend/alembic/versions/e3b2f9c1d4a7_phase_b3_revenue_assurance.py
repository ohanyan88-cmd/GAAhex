"""Phase B.3 — Revenue Assurance: ra_finding + ra_scan_run.

Two first-class physical tables for leakage detection:
* ``ra_finding``   — one row per discovered anomaly. Partial-unique on
                     (tenant_id, finding_type, entity_id) WHERE status IN ('open','investigating')
                     prevents duplicate open findings from successive scans.
* ``ra_scan_run``  — one row per scan invocation; status walks running -> success | failed.

Revision ID: e3b2f9c1d4a7
Revises: c9f5a3b7e2d1
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op


revision = 'e3b2f9c1d4a7'
down_revision = 'c9f5a3b7e2d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1. ra_finding ----
    op.create_table(
        'ra_finding',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('finding_type', sa.String(60), nullable=False),
        sa.Column('severity', sa.String(20), nullable=False, server_default='medium'),
        sa.Column('entity_type', sa.String(40), nullable=False),
        sa.Column('entity_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('summary', sa.String(255), nullable=False),
        sa.Column('detail_json', sa.dialects.postgresql.JSONB, nullable=False,
                  server_default='{}'),
        sa.Column('detected_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('status', sa.String(20), nullable=False, server_default='open'),
        sa.Column('ack_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ack_by', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('app_user.id'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('app_user.id'), nullable=True),
        sa.Column('resolution', sa.Text, nullable=True),
        sa.Column('scan_run_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('open','investigating','resolved','false_positive')",
            name='ck_ra_finding_status',
        ),
        sa.CheckConstraint(
            "severity IN ('low','medium','high','critical')",
            name='ck_ra_finding_severity',
        ),
    )
    op.create_index('ix_ra_finding_tenant_id', 'ra_finding', ['tenant_id'])
    op.create_index('ix_ra_finding_scan_run_id', 'ra_finding', ['scan_run_id'])
    op.create_index('ix_ra_finding_worklist', 'ra_finding',
                    ['tenant_id', 'status', 'detected_at'])
    # Partial unique: only one OPEN/INVESTIGATING finding per (tenant, type, entity).
    op.create_index(
        'uq_ra_finding_open_per_entity',
        'ra_finding',
        ['tenant_id', 'finding_type', 'entity_id'],
        unique=True,
        postgresql_where=sa.text("status IN ('open','investigating')"),
    )

    # ---- 2. ra_scan_run ----
    op.create_table(
        'ra_scan_run',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='running'),
        sa.Column('findings_count', sa.Integer, nullable=False, server_default='0'),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('triggered_by', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('app_user.id'), nullable=True),
        sa.CheckConstraint(
            "status IN ('running','success','failed')",
            name='ck_ra_scan_run_status',
        ),
    )
    op.create_index('ix_ra_scan_run_tenant_id', 'ra_scan_run', ['tenant_id'])


def downgrade() -> None:
    op.drop_index('ix_ra_scan_run_tenant_id', table_name='ra_scan_run')
    op.drop_table('ra_scan_run')

    op.drop_index('uq_ra_finding_open_per_entity', table_name='ra_finding')
    op.drop_index('ix_ra_finding_worklist', table_name='ra_finding')
    op.drop_index('ix_ra_finding_scan_run_id', table_name='ra_finding')
    op.drop_index('ix_ra_finding_tenant_id', table_name='ra_finding')
    op.drop_table('ra_finding')
