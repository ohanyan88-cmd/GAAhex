"""kernel: stage_def + kpi_def tables, entity_def.owner_module column

Revision ID: c5e9a3b1d7f4
Revises: a3d7e9f1b2c4
Create Date: 2026-05-31 00:00:00.000000

Additive + reversible:

  - CREATE TABLE stage_def — canonical pipeline stages (SPEC §3, 14 rows). Tenant-scoped.
  - CREATE TABLE kpi_def   — KPI catalog (SPEC §3 / §5.4 / §9). One-owner-one-formula invariant.
  - ALTER  TABLE entity_def ADD COLUMN owner_module VARCHAR(80) NULL
      (entity_def semantically == SPEC's record_def; literal rename deferred to a later pass.
       Nullable now — Step 3 backfills from the §2.2 ownership matrix.)

Both new tables carry the standard NULLIF-guarded tenant_isolation RLS policy applied across
every post-enable-RLS table — keeps the kernel default-deny invariant (§0 rule 2) intact.

Seeds (the 14 stage rows + KPI catalog + entity_def.owner_module backfill) land in Steps 3-4;
kernel invariant enforcement (control-gate write-lock, one-KPI-one-owner check) lands in Step 2.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5e9a3b1d7f4'
down_revision: Union[str, Sequence[str], None] = 'a3d7e9f1b2c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ------------------------------------------------------------------ stage_def
    op.create_table(
        'stage_def',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('owner_module', sa.String(length=80), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('exit_gate', sa.String(length=255), nullable=True),
        sa.Column('kpi_def_key', sa.String(length=80), nullable=True),
        sa.Column('is_control_gate', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'key', name='uq_stage_def_key'),
        sa.UniqueConstraint('tenant_id', 'sequence', name='uq_stage_def_sequence'),
    )
    op.create_index(op.f('ix_stage_def_tenant_id'), 'stage_def', ['tenant_id'], unique=False)

    op.execute("ALTER TABLE stage_def ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON stage_def
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)

    # ------------------------------------------------------------------ kpi_def
    op.create_table(
        'kpi_def',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('owner_module', sa.String(length=80), nullable=False),
        sa.Column('formula', sa.String(length=500), nullable=True),
        sa.Column('denominator', sa.String(length=255), nullable=True),
        sa.Column('bound_stage_key', sa.String(length=80), nullable=True),
        sa.Column('bound_workflow_key', sa.String(length=80), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'key', name='uq_kpi_def_key'),
    )
    op.create_index(op.f('ix_kpi_def_tenant_id'), 'kpi_def', ['tenant_id'], unique=False)

    op.execute("ALTER TABLE kpi_def ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON kpi_def
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)

    # ------------------------------------------------------------------ entity_def.owner_module
    # Nullable: Step 3 backfills from SPEC §2.2 ownership matrix; no server_default so a missing
    # value stays NULL (signals "not yet assigned") rather than silently coercing to empty.
    op.add_column('entity_def', sa.Column('owner_module', sa.String(length=80), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('entity_def', 'owner_module')

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON kpi_def;")
    op.drop_index(op.f('ix_kpi_def_tenant_id'), table_name='kpi_def')
    op.drop_table('kpi_def')

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON stage_def;")
    op.drop_index(op.f('ix_stage_def_tenant_id'), table_name='stage_def')
    op.drop_table('stage_def')
