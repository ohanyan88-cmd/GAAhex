"""Escalation Standard (file 02 / file 14) — first-class escalation table.

Revision ID: fa16384aa026
Revises: 19da2573e24e
Create Date: 2026-06-02 15:53:12.043409

Single additive table. Tracks when work is escalated due to SLA breach, status
stuck, priority increase, or other triggers. D11 — escalation is a *move*, not a
duplicate: the source assignment is reassigned to the target; no second parallel
membership is created.

`escalation`:
  - Polymorphic source (source_entity_type + source_entity_id, Approval precedent).
  - Polymorphic target (target_type + target_id, no FK — target_id covers user,
    department, queue, etc. depending on target_type).
  - triggered_by + resolved_by FK to app_user.id.
  - 3 indexes: (tenant_id, source_entity_type, source_entity_id),
    (tenant_id, status), (tenant_id, trigger).

Status lifecycle:
  PENDING (default) -> ACTIVE | CANCELLED
  ACTIVE -> RESOLVED | CANCELLED
  RESOLVED / CANCELLED are terminal.

RLS tenant_isolation (NULLIF-guarded) on the new table.

Parented at 6be9b1b55482 (the head at the time of this work item) because
parallel agents may be adding migrations off the same parent — apply with the
explicit revision hash (NOT `head`).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'fa16384aa026'
down_revision: Union[str, Sequence[str], None] = '19da2573e24e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'escalation',
        sa.Column('id',                  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('source_entity_type',  sa.String(length=40),   nullable=False),
        sa.Column('source_entity_id',    postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('trigger',             sa.String(length=40),   nullable=False),
        sa.Column('target_type',         sa.String(length=40),   nullable=False),
        sa.Column('target_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('level',               sa.String(length=20),   nullable=False),
        sa.Column('status',              sa.String(length=20),   server_default=sa.text("'PENDING'"), nullable=False),
        sa.Column('reason',              sa.Text(),              nullable=True),
        sa.Column('triggered_at',        sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('triggered_by',        postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('resolved_at',         sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by',         postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('resolution_note',     sa.Text(),              nullable=True),
        sa.Column('created_at',          sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'],    ['tenant.id']),
        sa.ForeignKeyConstraint(['triggered_by'], ['app_user.id']),
        sa.ForeignKeyConstraint(['resolved_by'],  ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_escalation_tenant_id', 'escalation', ['tenant_id'], unique=False)
    op.create_index('ix_escalation_source',    'escalation', ['tenant_id', 'source_entity_type', 'source_entity_id'], unique=False)
    op.create_index('ix_escalation_status',    'escalation', ['tenant_id', 'status'], unique=False)
    op.create_index('ix_escalation_trigger',   'escalation', ['tenant_id', 'trigger'], unique=False)

    # ── RLS ───────────────────────────────────────────────────────────────────
    op.execute("ALTER TABLE escalation ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON escalation
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON escalation;")
    op.drop_index('ix_escalation_trigger',   table_name='escalation')
    op.drop_index('ix_escalation_status',    table_name='escalation')
    op.drop_index('ix_escalation_source',    table_name='escalation')
    op.drop_index('ix_escalation_tenant_id', table_name='escalation')
    op.drop_table('escalation')
