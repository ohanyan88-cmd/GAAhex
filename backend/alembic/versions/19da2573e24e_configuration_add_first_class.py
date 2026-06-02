"""Configuration Standard (file 08) — first-class configuration + configuration_history tables.

Revision ID: 19da2573e24e
Revises: 3dac5acb70b7
Create Date: 2026-06-02 15:52:59.822612

Two additive tables. Pre-existing ad-hoc config tables (tenant_settings,
feature_flag, etc.) are NOT modified — Configuration ships side-by-side.

`configuration`:
  - Polymorphic scope (file 14 ConfigurationScope, 6 values).
  - UNIQUE (tenant_id, configuration_key, scope) — exactly ONE live row per
    (tenant, key, scope). Duplicates raise IntegrityError → 409 in the router.
  - UNIQUE (tenant_id, reference_number) — CFG-000001 fence.
  - 2 supporting indexes: (tenant_id, configuration_key), (tenant_id, scope).
  - configuration_value is JSONB — opaque to the platform.

`configuration_history`:
  - Append-only audit trail (no UPDATE/DELETE in router).
  - NO CASCADE on configuration_id — history survives parent deletion (same
    durability principle as SlaEvent).
  - 1 supporting index: (tenant_id, configuration_id, version).

RLS tenant_isolation on both tables (NULLIF-guarded — matches the existing
precedent in 18062d97ef59_orders_tables.py:55-75).

down_revision pinned to 6be9b1b55482 (head at task issue time). Parallel
agents may be appending their own migrations; the orchestrator applies this
revision by specific hash, not `head`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '19da2573e24e'
down_revision: Union[str, Sequence[str], None] = '3dac5acb70b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── configuration ─────────────────────────────────────────────────────────
    op.create_table(
        'configuration',
        sa.Column('id',                  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reference_number',    sa.String(length=20),  nullable=False),
        sa.Column('configuration_key',   sa.String(length=200), nullable=False),
        sa.Column('scope',               sa.String(length=20),  nullable=False),
        sa.Column('configuration_value', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('status',              sa.String(length=20),  server_default='ACTIVE', nullable=False),
        sa.Column('version',             sa.Integer(),          server_default='1', nullable=False),
        sa.Column('description',         sa.Text(),             nullable=True),
        sa.Column('change_reason',       sa.Text(),             nullable=True),
        sa.Column('created_at',          sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',          postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('updated_at',          sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_by',          postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'],  ['tenant.id']),
        sa.ForeignKeyConstraint(['created_by'], ['app_user.id']),
        sa.ForeignKeyConstraint(['updated_by'], ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'configuration_key', 'scope',
                            name='uq_configuration_key_scope'),
        sa.UniqueConstraint('tenant_id', 'reference_number',
                            name='uq_configuration_reference_number'),
    )
    op.create_index('ix_configuration_tenant_id', 'configuration', ['tenant_id'], unique=False)
    op.create_index('ix_configuration_key', 'configuration',
                    ['tenant_id', 'configuration_key'], unique=False)
    op.create_index('ix_configuration_scope', 'configuration',
                    ['tenant_id', 'scope'], unique=False)

    # ── configuration_history ─────────────────────────────────────────────────
    op.create_table(
        'configuration_history',
        sa.Column('id',                  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('configuration_id',    postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('version',             sa.Integer(),          nullable=False),
        sa.Column('configuration_value', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('change_reason',       sa.Text(),             nullable=True),
        sa.Column('changed_at',          sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('changed_by',          postgresql.UUID(as_uuid=True), nullable=False),
        # No CASCADE — history rows outlive the parent Configuration.
        sa.ForeignKeyConstraint(['tenant_id'],        ['tenant.id']),
        sa.ForeignKeyConstraint(['configuration_id'], ['configuration.id']),
        sa.ForeignKeyConstraint(['changed_by'],       ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_configuration_history_tenant_id', 'configuration_history',
                    ['tenant_id'], unique=False)
    op.create_index('ix_configuration_history_cfg_version', 'configuration_history',
                    ['tenant_id', 'configuration_id', 'version'], unique=False)

    # ── RLS tenant_isolation (NULLIF-guarded) ────────────────────────────────
    for table in ('configuration', 'configuration_history'):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
              USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
        """)


def downgrade() -> None:
    for table in ('configuration_history', 'configuration'):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
    op.drop_index('ix_configuration_history_cfg_version', table_name='configuration_history')
    op.drop_index('ix_configuration_history_tenant_id', table_name='configuration_history')
    op.drop_table('configuration_history')
    op.drop_index('ix_configuration_scope', table_name='configuration')
    op.drop_index('ix_configuration_key', table_name='configuration')
    op.drop_index('ix_configuration_tenant_id', table_name='configuration')
    op.drop_table('configuration')
