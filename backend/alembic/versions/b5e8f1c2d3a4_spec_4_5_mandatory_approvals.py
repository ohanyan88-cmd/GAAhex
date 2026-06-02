"""SPEC §4.5 mandatory approvals — approval table

Revision ID: b5e8f1c2d3a4
Revises: a7b3c9d5e1f2
Create Date: 2026-05-31 02:00:00.000000

Step 7-adjacent additive migration for the SPEC §4.5 Mandatory Approvals workflow. Adds
the `approval` table, distinct from the existing `pending_approval` table (the M12 workflow
transition parking lot). This is the canonical registry of the 12 high-stakes business
actions enumerated in SPEC §4.5:

    high_discount · refund · credit_note · invoice_cancel · service_suspend
    contract_change · payment_adjust · customer_delete · asset_writeoff
    procurement · role_perm_change · workflow_override

State machine: PENDING (default) -> APPROVED | REJECTED -> EXECUTED. Forward-only;
audit Event emitted on every transition via `workflow.emit` per SPEC §0.4.

Tenant-isolation RLS follows the standard NULLIF-guarded pattern used by every
post-RLS-flip table (see e.g. portal_ticket_reply, page_field_value).

Additive + reversible. No data migration; rows accumulate as adopters wire the kernel
gate into their mutation paths (see SPEC-4-5-APPROVALS.md for the adoption roadmap).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b5e8f1c2d3a4'
down_revision: Union[str, Sequence[str], None] = 'a7b3c9d5e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'approval',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('action_type', sa.String(length=60), nullable=False),
        sa.Column('target_entity_key', sa.String(length=80), nullable=True),
        sa.Column('target_record_id', sa.UUID(), nullable=True),
        sa.Column('requested_by', sa.UUID(), nullable=False),
        sa.Column('requested_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column('status', sa.String(length=20),
                  server_default=sa.text("'PENDING'"), nullable=False),
        sa.Column('decided_by', sa.UUID(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decision_reason', sa.Text(), nullable=True),
        sa.Column('executed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['requested_by'], ['app_user.id']),
        sa.ForeignKeyConstraint(['decided_by'], ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_approval_tenant_id'), 'approval', ['tenant_id'], unique=False)
    op.create_index('ix_approval_tenant_status', 'approval', ['tenant_id', 'status'], unique=False)
    op.create_index('ix_approval_target', 'approval',
                    ['target_entity_key', 'target_record_id'], unique=False)

    op.execute(
        "COMMENT ON TABLE approval IS "
        "'SPEC §4.5 mandatory-approval registry. Forward-only state machine "
        "PENDING -> APPROVED|REJECTED -> EXECUTED. Distinct from pending_approval "
        "(the M12 workflow-transition parking lot). Audit Event emitted on every "
        "state change via workflow.emit (SPEC §0.4 append-only).';"
    )

    op.execute("ALTER TABLE approval ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON approval
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON approval;")
    op.execute("ALTER TABLE approval DISABLE ROW LEVEL SECURITY;")
    op.drop_index('ix_approval_target', table_name='approval')
    op.drop_index('ix_approval_tenant_status', table_name='approval')
    op.drop_index(op.f('ix_approval_tenant_id'), table_name='approval')
    op.drop_table('approval')
