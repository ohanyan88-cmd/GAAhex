"""SLA Standard (file 12) — first-class sla_record + sla_event tables.

Revision ID: 46a9dd4fd0fe
Revises: 4f20308c2ea3
Create Date: 2026-06-02 13:41:47.280011

Two additive tables. Pre-existing per-row SLA fields on helpdesk_ticket and
task are NOT modified here.

`sla_record`:
  - Polymorphic target (object_type + object_id, Approval precedent).
  - UNIQUE (tenant_id, reference_number) — SLA-000001 fence.
  - total_paused_seconds accumulates wall-clock pause time for effective-
    remaining-time calculation on resume.
  - Business calendar stub: calendar_id (nullable UUID) + timezone (string).
    24×7 wall-clock is v1 default; FK wired when Calendar module ships.
  - 2 indexes: (tenant_id, object_type, object_id) + (tenant_id, status).

`sla_event`:
  - Append-only audit trail for SLA status transitions.
  - NO CASCADE on sla_id FK — events survive SLA record lifecycle.
  - 2 indexes: (sla_id) + (tenant_id, occurred_at).

Also: wires task.sla_id → sla_record.id FK (was nullable UUID with comment
"FK when SLA module ships").

RLS tenant_isolation on both new tables (NULLIF-guarded).
No per-row hold column — central Legal Hold registry lands with Data Retention.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '46a9dd4fd0fe'
down_revision: Union[str, Sequence[str], None] = '4f20308c2ea3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── sla_record ────────────────────────────────────────────────────────────
    op.create_table(
        'sla_record',
        sa.Column('id',                       postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',                postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reference_number',         sa.String(length=20),  nullable=False),
        sa.Column('sla_policy_id',            postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('object_type',              sa.String(length=40),  nullable=False),
        sa.Column('object_id',                postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status',                   sa.String(length=20),  server_default='ON_TRACK',  nullable=False),
        sa.Column('started_at',               sa.DateTime(timezone=True), nullable=False),
        sa.Column('due_at',                   sa.DateTime(timezone=True), nullable=False),
        sa.Column('paused_at',                sa.DateTime(timezone=True), nullable=True),
        sa.Column('resumed_at',               sa.DateTime(timezone=True), nullable=True),
        sa.Column('breached_at',              sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at',             sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_at',             sa.DateTime(timezone=True), nullable=True),
        sa.Column('total_paused_seconds',     sa.Integer(), server_default='0', nullable=False),
        sa.Column('pause_reason',             sa.String(length=40),  nullable=True),
        sa.Column('owner_department',         sa.String(length=80),  nullable=True),
        sa.Column('primary_assignee_type',    sa.String(length=20),  nullable=True),
        sa.Column('primary_assignee_id',      postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('priority',                 sa.String(length=20),  nullable=True),
        sa.Column('calendar_id',              postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('timezone',                 sa.String(length=60),  server_default="'UTC'", nullable=False),
        sa.Column('correlation_id',           postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at',               sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',               postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('updated_at',               sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'],  ['tenant.id']),
        sa.ForeignKeyConstraint(['created_by'], ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'reference_number', name='uq_sla_reference_number'),
    )
    op.create_index('ix_sla_record_tenant_id', 'sla_record', ['tenant_id'], unique=False)
    op.create_index('ix_sla_object', 'sla_record', ['tenant_id', 'object_type', 'object_id'], unique=False)
    op.create_index('ix_sla_status', 'sla_record', ['tenant_id', 'status'], unique=False)

    # ── sla_event ─────────────────────────────────────────────────────────────
    op.create_table(
        'sla_event',
        sa.Column('id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',    postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('sla_id',       postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('event_type',   sa.String(length=20),  nullable=False),
        sa.Column('pause_reason', sa.String(length=40),  nullable=True),
        sa.Column('occurred_at',  sa.DateTime(timezone=True), nullable=False),
        sa.Column('actor_id',     postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('note',         sa.Text(), nullable=True),
        # No CASCADE — events outlive the SLA record.
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['sla_id'],    ['sla_record.id']),
        sa.ForeignKeyConstraint(['actor_id'],  ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_sla_event_sla_id', 'sla_event', ['sla_id'], unique=False)
    op.create_index('ix_sla_event_tenant',  'sla_event', ['tenant_id', 'occurred_at'], unique=False)
    op.create_index('ix_sla_event_tenant_id', 'sla_event', ['tenant_id'], unique=False)

    # ── RLS ───────────────────────────────────────────────────────────────────
    for table in ('sla_record', 'sla_event'):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
              USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
        """)

    # ── wire task.sla_id → sla_record.id (comment said "FK when SLA module ships") ──
    op.create_foreign_key(
        'fk_task_sla_record',
        'task', 'sla_record',
        ['sla_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_task_sla_record', 'task', type_='foreignkey')
    for table in ('sla_event', 'sla_record'):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
    op.drop_index('ix_sla_event_tenant_id', table_name='sla_event')
    op.drop_index('ix_sla_event_tenant',    table_name='sla_event')
    op.drop_index('ix_sla_event_sla_id',    table_name='sla_event')
    op.drop_table('sla_event')
    op.drop_index('ix_sla_status',           table_name='sla_record')
    op.drop_index('ix_sla_object',           table_name='sla_record')
    op.drop_index('ix_sla_record_tenant_id', table_name='sla_record')
    op.drop_table('sla_record')
