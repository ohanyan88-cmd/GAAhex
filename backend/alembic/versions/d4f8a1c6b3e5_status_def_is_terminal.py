"""kernel: status_def.is_terminal column for SPEC §7 status standardization

Revision ID: d4f8a1c6b3e5
Revises: 98d4d53f889c
Create Date: 2026-05-31 00:00:00.000000

Status Standardization. Additive + reversible.

SPEC §7 fixes a small terminal vocabulary per entity kind — `Closed`, `Archived`, `Cancelled`,
`Terminated`, etc. The seeder in `app/seed_statuses.py` needs a column to mark those terminal
rows so downstream code (workflow guards landing in Step 6, dashboards, exports) can ask
"is this a terminal state?" with one cheap boolean read instead of recomputing the rule.

The existing `status_def.is_initial` flag was added in the initial schema; this revision adds the
complementary `is_terminal`. Default `false` so existing rows stay non-terminal until explicitly
flagged by a seed re-run or Studio edit.

Why not derive terminal-ness from WorkflowDef transitions?
    - The workflow_def engine isn't built yet (lands later). The terminal vocabulary from SPEC §7 is
      LOCKED right now and needs to be queryable from boot, not waiting on a separate engine.
    - Studio will eventually allow overriding terminal-ness per tenant; storing it on `status_def`
      keeps that override local to the row, not bound to a workflow.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4f8a1c6b3e5'
down_revision: Union[str, Sequence[str], None] = '98d4d53f889c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Server default 'false' so every existing status_def row materializes the non-terminal state
    # immediately (no NULLs in the column, no app-side coalesce needed).
    op.add_column(
        'status_def',
        sa.Column('is_terminal', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.execute(
        "COMMENT ON COLUMN status_def.is_terminal IS "
        "'SPEC §7 terminal status flag. TRUE = lifecycle stops here (Closed, Archived, Cancelled, "
        "Terminated, Expired, Disconnected, Paid, Credited, Reconciled, Chargeback, "
        "Disqualified, Converted). Workflow guards land in Step 6.';"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('status_def', 'is_terminal')
