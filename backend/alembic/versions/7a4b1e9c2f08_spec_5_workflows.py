"""SPEC §5 universal workflow contract + workflow_instance

Revision ID: 7a4b1e9c2f08
Revises: d2bea9d7f819
Create Date: 2026-05-31 06:00:00.000000

Step 4 of the SPEC build — SPEC §5 Workflow Orchestration. Additive + reversible.

Two things land in this migration:

1. **workflow_def gets the Universal Workflow Contract columns (SPEC §5.1).** Every workflow
   must carry: Trigger · Conditions · Actions · Single Owner · SLA · Approval · Notification ·
   Failure handling. The pre-existing entity-lifecycle rows (key `<entity>_lifecycle`, config
   `{"transitions":[...]}`) stay valid — the new columns are all NULLable so legacy rows
   continue to work. SPEC §5 cross-entity workflow rows (W1..W5) populate the new columns
   instead of the `config` blob.

   `entity_def_id` is relaxed from NOT NULL to NULL. Cross-entity workflows (W1 spans Pipeline,
   Orders, Billing, Customer 360, …) by definition don't bind to a single entity.

   A UNIQUE(tenant_id, key) constraint is added — the seeder needs it for
   `ON CONFLICT DO NOTHING` idempotency.

2. **workflow_instance — new table.** Runtime state of one workflow execution. Forward-only
   state machine: running -> completed | failed | escalated. Tenant-isolated via the standard
   NULLIF-guarded RLS policy (matches every post-RLS-flip table).

The Stage 8 control gate at `app.kernel.control_gate.assert_can_advance_to_scheduling` is
REUSED by the workflow engine's `control_gate` action — NO second gate created. The W1 seed
embeds a `{"type": "control_gate", ...}` action that delegates to the existing kernel function.

What this migration does NOT do (deferred):
  - Async SLA monitor — sla_breached_at is set on-demand by the engine today, not by a
    background worker. Real-time SLA enforcement lands in a later step.
  - W4-W5 module dependencies — Procurement and Inventory modules don't exist yet; W4-W5
    actions reference them with the assumption they'll exist when the engine tries to dispatch.
  - Apply to live DB — file-only per Gev's gate; live run still gated on test-DB verify.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '7a4b1e9c2f08'
down_revision: Union[str, Sequence[str], None] = 'd2bea9d7f819'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # -------------------------------------------------- workflow_def: SPEC §5.1 columns + uniq
    # Add the 8 SPEC §5.1 Universal Workflow Contract columns. All NULLable so existing rows
    # (entity-lifecycle workflows seeded by seed_catalog) remain valid.
    op.add_column('workflow_def', sa.Column('trigger_spec', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('workflow_def', sa.Column('conditions_spec', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('workflow_def', sa.Column('actions_spec', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('workflow_def', sa.Column('owner_module', sa.String(length=80), nullable=True))
    op.add_column('workflow_def', sa.Column('sla_seconds', sa.Integer(), nullable=True))
    op.add_column('workflow_def', sa.Column('approval_required', sa.Boolean(), nullable=True))
    op.add_column('workflow_def', sa.Column('notification_def_key', sa.String(length=120), nullable=True))
    op.add_column('workflow_def', sa.Column('failure_action', sa.String(length=40), nullable=True))

    # Cross-entity SPEC §5 workflows (W1..W5) don't bind to a single entity_def. Drop the NOT NULL.
    op.alter_column('workflow_def', 'entity_def_id',
                    existing_type=sa.UUID(),
                    nullable=True)

    # UNIQUE for idempotent seeding via pg_insert(...).on_conflict_do_nothing(["tenant_id","key"]).
    op.create_unique_constraint('uq_workflow_def_key', 'workflow_def', ['tenant_id', 'key'])

    op.execute(
        "COMMENT ON COLUMN workflow_def.trigger_spec IS "
        "'SPEC §5.2 trigger — what fires this workflow. JSONB: {\"type\": \"record_created\", \"entity_key\": \"lead\"} etc.';"
    )
    op.execute(
        "COMMENT ON COLUMN workflow_def.actions_spec IS "
        "'SPEC §5.3 action list, executed in order by app/kernel/workflow_engine.py. "
        "The control_gate action type reuses app/kernel/control_gate.py:assert_can_advance_to_scheduling.';"
    )

    # -------------------------------------------------- workflow_instance: new table
    op.create_table(
        'workflow_instance',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('workflow_key', sa.String(length=120), nullable=False),
        sa.Column('triggered_by_record_id', sa.UUID(), nullable=True),
        sa.Column('triggered_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('status', sa.String(length=20),
                  server_default=sa.text("'running'"), nullable=False),
        sa.Column('current_action_index', sa.Integer(),
                  server_default=sa.text('0'), nullable=False),
        sa.Column('context', postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column('sla_breached_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failure_reason', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_workflow_instance_tenant_id'), 'workflow_instance', ['tenant_id'], unique=False)
    op.create_index('ix_workflow_instance_tenant_status', 'workflow_instance',
                    ['tenant_id', 'status'], unique=False)
    op.create_index('ix_workflow_instance_key', 'workflow_instance',
                    ['tenant_id', 'workflow_key'], unique=False)

    op.execute(
        "COMMENT ON TABLE workflow_instance IS "
        "'SPEC §5 runtime instance of workflow_def. Forward-only state machine "
        "running -> completed|failed|escalated. Each transition emits an audit Event "
        "via workflow.emit (SPEC §0.4 append-only).';"
    )

    op.execute("ALTER TABLE workflow_instance ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON workflow_instance
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    # workflow_instance
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON workflow_instance;")
    op.execute("ALTER TABLE workflow_instance DISABLE ROW LEVEL SECURITY;")
    op.drop_index('ix_workflow_instance_key', table_name='workflow_instance')
    op.drop_index('ix_workflow_instance_tenant_status', table_name='workflow_instance')
    op.drop_index(op.f('ix_workflow_instance_tenant_id'), table_name='workflow_instance')
    op.drop_table('workflow_instance')

    # workflow_def: drop uniq + tighten entity_def_id back + drop §5.1 columns
    op.drop_constraint('uq_workflow_def_key', 'workflow_def', type_='unique')
    op.alter_column('workflow_def', 'entity_def_id',
                    existing_type=sa.UUID(),
                    nullable=False)
    op.drop_column('workflow_def', 'failure_action')
    op.drop_column('workflow_def', 'notification_def_key')
    op.drop_column('workflow_def', 'approval_required')
    op.drop_column('workflow_def', 'sla_seconds')
    op.drop_column('workflow_def', 'owner_module')
    op.drop_column('workflow_def', 'actions_spec')
    op.drop_column('workflow_def', 'conditions_spec')
    op.drop_column('workflow_def', 'trigger_spec')
