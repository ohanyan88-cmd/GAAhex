"""workflow_engine_gate_type

Revision ID: c443f037e6ac
Revises: 89518e0c00a7
Create Date: 2026-06-02 17:29:40.958997

Workflow Engine Standard (file 12, standard 61) extension — adds the
GateType enum surface + WorkflowStatus + versioning + reference number
to `workflow_def`.

Additive migration — 4 nullable / defaulted columns on the existing
`workflow_def` table, plus one (tenant_id, reference_number) UNIQUE
constraint. Backward-compatible: legacy rows pick up the server_defaults
(workflow_status='ACTIVE', version=1) and NULL for the optional jsonb
arrays + reference_number.

New columns:
  workflow_status      varchar(20)  NULL  server_default 'ACTIVE'
      — file 14 WorkflowStatus enum (4 values):
        DRAFT | ACTIVE | DEPRECATED | RETIRED
        Enforced at the application/router layer (varchar, same
        approach taken everywhere on this platform — see
        helpdesk_ticket.status, helpdesk_ticket.priority).
  gate_types_used      jsonb        NULL
      — array of GateType values referenced by this definition's
        stages, e.g. ["COMMERCIAL_GATE", "TECHNICAL_GATE"]. Lets
        dashboards see at a glance which gates a workflow has. The
        GateType enum itself (file 14, 7 values:
        COMMERCIAL_GATE | TECHNICAL_GATE | SERVICE_GATE |
        OPERATIONAL_GATE | APPROVAL_GATE | COMPLIANCE_GATE |
        MANUAL_REVIEW_GATE) is referenced BY VALUE — no dedicated
        enum column.
  reference_number     varchar(20)  NULL
      — WFL-000001 prefix (file 00, S5 registered).
        UNIQUE(tenant_id, reference_number).
  version              integer      NOT NULL  server_default 1
      — versioned definitions; existing rows backfill to 1.

Constraint:
  uq_workflow_def_reference_number  UNIQUE(tenant_id, reference_number)

DO NOT APPLY — orchestrator runs the alembic upgrade at the end of the
batch. This migration was generated with --splice off of head
`6bf1bea1e0cd` (deletion_state_rollout); a parallel branch
(`3c31f1734821` queue_ownership_extension) also splits off the same
head. The orchestrator's merge migration will collapse the two heads.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c443f037e6ac'
down_revision: Union[str, Sequence[str], None] = '89518e0c00a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ---- workflow_def: 4 additive columns
    op.add_column(
        'workflow_def',
        sa.Column(
            'workflow_status',
            sa.String(length=20),
            server_default=sa.text("'ACTIVE'"),
            nullable=True,
        ),
    )
    op.add_column(
        'workflow_def',
        sa.Column(
            'gate_types_used',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        'workflow_def',
        sa.Column(
            'reference_number',
            sa.String(length=20),
            nullable=True,
        ),
    )
    op.add_column(
        'workflow_def',
        sa.Column(
            'version',
            sa.Integer(),
            server_default=sa.text('1'),
            nullable=False,
        ),
    )

    # ---- UNIQUE constraint for the WFL-000001 reference number.
    # Standard (tenant_id, reference_number) shape mirroring the rest of
    # the platform's reference-number-bearing tables.
    op.create_unique_constraint(
        'uq_workflow_def_reference_number',
        'workflow_def',
        ['tenant_id', 'reference_number'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'uq_workflow_def_reference_number',
        'workflow_def',
        type_='unique',
    )
    op.drop_column('workflow_def', 'version')
    op.drop_column('workflow_def', 'reference_number')
    op.drop_column('workflow_def', 'gate_types_used')
    op.drop_column('workflow_def', 'workflow_status')
