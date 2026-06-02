"""Watcher / Subscriber Standard (file 05) — first-class watcher table.

Revision ID: 8d05e610f9cc
Revises: 82b37b6342b2
Create Date: 2026-06-02 11:36:41.289547

One additive table. Polymorphic target pin (`target_entity_type` + `target_entity_id`,
Approval precedent — no FK). PrincipalType subset for the watcher principal
(EMPLOYEE | ROLE | DEPARTMENT | TEAM; no QUEUE per D12).

DB-enforced invariants:
  * RLS `tenant_isolation` policy (NULLIF-guarded, matches the orders_tables
    precedent at 18062d97ef59).
  * Partial UNIQUE index on (tenantId, targetEntityType, targetEntityId,
    watcherType, watcherId) WHERE status='ACTIVE' — landed from day one to
    close the concurrent-double-add race; the spec calls this the canonical
    uniqueness key.

NOT modeled — per-row legal-hold column. Hold is a target-object invariant,
not a per-watcher attribute, and is centralized in the upcoming Legal Hold
registry defined by the Data Retention Standard. Mutating endpoints will
consult that registry once it lands. Until then there is no real hold.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '8d05e610f9cc'
down_revision: Union[str, Sequence[str], None] = '82b37b6342b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'watcher',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('target_entity_type', sa.String(length=40), nullable=False),
        sa.Column('target_entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('watcher_type', sa.String(length=20), nullable=False),
        sa.Column('watcher_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='ACTIVE', nullable=False),
        sa.Column('source', sa.String(length=20), server_default='MANUAL', nullable=False),
        sa.Column('scope', sa.String(length=30), server_default='OBJECT_ONLY', nullable=False),
        sa.Column('priority', sa.String(length=20), server_default='NORMAL', nullable=False),
        sa.Column('notification_frequency', sa.String(length=30), server_default='IMMEDIATE', nullable=False),
        sa.Column('watch_reason', sa.Text(), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('paused_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('paused_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('removed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('removed_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['paused_by'], ['app_user.id']),
        sa.ForeignKeyConstraint(['removed_by'], ['app_user.id']),
        sa.ForeignKeyConstraint(['created_by'], ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_watcher_tenant_id', 'watcher', ['tenant_id'], unique=False)
    op.create_index('ix_watcher_target', 'watcher', ['tenant_id', 'target_entity_type', 'target_entity_id'], unique=False)
    op.create_index('ix_watcher_principal', 'watcher', ['tenant_id', 'watcher_type', 'watcher_id'], unique=False)

    # Spec lock — one ACTIVE watcher per (target, principal) tuple. Partial unique index
    # closes the concurrent-double-add race window at the DB layer (router-side checks
    # alone would still race).
    op.create_index(
        'uq_watcher_active_target_principal',
        'watcher',
        ['tenant_id', 'target_entity_type', 'target_entity_id', 'watcher_type', 'watcher_id'],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )

    op.execute("ALTER TABLE watcher ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON watcher
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON watcher;")
    op.drop_index('uq_watcher_active_target_principal', table_name='watcher')
    op.drop_index('ix_watcher_principal', table_name='watcher')
    op.drop_index('ix_watcher_target', table_name='watcher')
    op.drop_index('ix_watcher_tenant_id', table_name='watcher')
    op.drop_table('watcher')
