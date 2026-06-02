"""Task Standard (file 05) — first-class task + task_dependency tables.

Revision ID: 4f20308c2ea3
Revises: 8d05e610f9cc
Create Date: 2026-06-02 12:57:39.908438

Two additive tables — WorkItem is PRESERVED unchanged.

`task`:
  - 34-value task_type, 6-status lifecycle, 5-priority, dependency chain, SLA status.
  - UNIQUE (tenant_id, reference_number) — the uniqueness fence for TSK-000001.
    SELECT COUNT(*)+1 races under high concurrency; the unique index makes a create
    fail rather than duplicate. Per-tenant sequence counter is the platform-wide fix
    tracked as a gap.
  - 4 indexes: (tenant_id, status), (tenant_id, assignee_type, assignee_id),
    (tenant_id, parent_entity_type, parent_entity_id), plus tenant_id standalone.

`task_dependency`:
  - Directed dependency between two tasks; both FKs CASCADE so cleanup is automatic.
  - UNIQUE (tenant_id, from_task_id, to_task_id, dependency_type).
  - Cycle detection is router-side (no DB-level constraint for directed cycles).

RLS `tenant_isolation` on both tables (NULLIF-guarded, matching the existing
18062d97ef59 pattern).

No per-task hold column — per the locked Data Retention design decision: hold is a
target-object invariant, centralised in the upcoming Legal Hold registry.

E15 gap note: HelpdeskQueue has owner_node_id (OrgNode FK) but no owning_department
string field. When owner_type or assignee_type is QUEUE, E15 says auto-watch resolves
to the queue's owning department. The router handles this at runtime (derive department
from owner_node_id) and logs a warning when owner_node_id is NULL. No schema change
needed for Task Phase 1 — the gap is in HelpdeskQueue.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '4f20308c2ea3'
down_revision: Union[str, Sequence[str], None] = '8d05e610f9cc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── task ──────────────────────────────────────────────────────────────────
    op.create_table(
        'task',
        sa.Column('id',                 postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',          postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reference_number',   sa.String(length=20),  nullable=False),
        sa.Column('title',              sa.String(length=255), nullable=False),
        sa.Column('task_type',          sa.String(length=40),  server_default='GENERAL',         nullable=False),
        sa.Column('task_scope',         sa.String(length=20),  server_default='STANDALONE',      nullable=False),
        sa.Column('status',             sa.String(length=20),  server_default='OPEN',            nullable=False),
        sa.Column('priority',           sa.String(length=20),  server_default='MEDIUM',          nullable=False),
        sa.Column('parent_entity_type', sa.String(length=40),  nullable=True),
        sa.Column('parent_entity_id',   postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('owner_type',         sa.String(length=20),  nullable=False),
        sa.Column('owner_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('assignee_type',      sa.String(length=20),  nullable=False),
        sa.Column('assignee_id',        postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('due_at',             sa.DateTime(timezone=True), nullable=True),
        sa.Column('sla_id',             postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('sla_due_at',         sa.DateTime(timezone=True), nullable=True),
        sa.Column('sla_status',         sa.String(length=20),  server_default='NOT_APPLICABLE',  nullable=False),
        sa.Column('blocked_reason',     sa.Text(), nullable=True),
        sa.Column('blocked_at',         sa.DateTime(timezone=True), nullable=True),
        sa.Column('blocked_by',         postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('waiting_reason',     sa.Text(), nullable=True),
        sa.Column('waiting_until',      sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at',       sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_by',       postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('completion_note',    sa.Text(), nullable=True),
        sa.Column('cancelled_at',       sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_by',       postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('cancellation_reason',sa.Text(), nullable=True),
        sa.Column('resolution',         sa.String(length=30), nullable=True),
        sa.Column('created_at',         sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',         postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('updated_at',         sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'],    ['tenant.id']),
        sa.ForeignKeyConstraint(['blocked_by'],   ['app_user.id']),
        sa.ForeignKeyConstraint(['completed_by'], ['app_user.id']),
        sa.ForeignKeyConstraint(['cancelled_by'], ['app_user.id']),
        sa.ForeignKeyConstraint(['created_by'],   ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'reference_number', name='uq_task_reference_number'),
    )
    op.create_index('ix_task_tenant_id', 'task', ['tenant_id'], unique=False)
    op.create_index('ix_task_status',    'task', ['tenant_id', 'status'], unique=False)
    op.create_index('ix_task_assignee',  'task', ['tenant_id', 'assignee_type', 'assignee_id'], unique=False)
    op.create_index('ix_task_parent',    'task', ['tenant_id', 'parent_entity_type', 'parent_entity_id'], unique=False)

    # ── task_dependency ───────────────────────────────────────────────────────
    op.create_table(
        'task_dependency',
        sa.Column('id',              postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',       postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('from_task_id',    postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('to_task_id',      postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('dependency_type', sa.String(length=20), nullable=False),
        sa.Column('created_at',      sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',      postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'],    ['tenant.id']),
        sa.ForeignKeyConstraint(['from_task_id'], ['task.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['to_task_id'],   ['task.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'],   ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'from_task_id', 'to_task_id', 'dependency_type',
                            name='uq_task_dependency'),
    )
    op.create_index('ix_task_dependency_tenant_id', 'task_dependency', ['tenant_id'], unique=False)
    op.create_index('ix_task_dependency_from',      'task_dependency', ['from_task_id'],  unique=False)
    op.create_index('ix_task_dependency_to',        'task_dependency', ['tenant_id', 'to_task_id'], unique=False)

    # ── RLS ───────────────────────────────────────────────────────────────────
    for table in ('task', 'task_dependency'):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
              USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
        """)


def downgrade() -> None:
    for table in ('task_dependency', 'task'):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
    op.drop_index('ix_task_dependency_to',        table_name='task_dependency')
    op.drop_index('ix_task_dependency_from',       table_name='task_dependency')
    op.drop_index('ix_task_dependency_tenant_id',  table_name='task_dependency')
    op.drop_table('task_dependency')
    op.drop_index('ix_task_parent',    table_name='task')
    op.drop_index('ix_task_assignee',  table_name='task')
    op.drop_index('ix_task_status',    table_name='task')
    op.drop_index('ix_task_tenant_id', table_name='task')
    op.drop_table('task')
