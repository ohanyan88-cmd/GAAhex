"""queue_ownership_extension

Revision ID: 3c31f1734821
Revises: 6bf1bea1e0cd
Create Date: 2026-06-02 17:26:55.164128

Queue Ownership Standard (file 02 — B5; enums in file 14) extension to
`helpdesk_queue`. Closes the gap flagged in `app/models/task.py` docstring
where E15 auto-watch resolution on a QUEUE owner had no accountable-department
column to project from.

Four additive columns — all backward-compatible (nullable or NOT NULL with a
server_default so existing rows backfill cleanly):

    assignment_strategy varchar(30)  NULL  DEFAULT 'MANUAL'
        — file 14 QueueAssignmentStrategy enum:
          MANUAL | ROUND_ROBIN | LEAST_LOADED | SKILL_BASED |
          PRIORITY_BASED | CONFIGURABLE
    visibility          varchar(30)  NULL  DEFAULT 'DEPARTMENT'
        — file 14 QueueVisibility enum:
          QUEUE_MEMBERS | DEPARTMENT | MANAGEMENT | EVERYONE_WITH_PERMISSION
    owning_department   varchar(80)  NULL
        — file 02 B5: single accountable department (NOT a comma-separated list).
          When a Task's Owner is a QUEUE, E15 auto-watch projects this dept.
    is_active           boolean      NOT NULL  DEFAULT true
        — whether the queue accepts new tickets. False = drained / archival.

Enum values are enforced at the application layer (router validation) rather
than via a DB CHECK / native ENUM type — same approach used elsewhere on this
platform (e.g. `helpdesk_ticket.status`, `helpdesk_ticket.priority`).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3c31f1734821'
down_revision: Union[str, Sequence[str], None] = '6bf1bea1e0cd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema — add 4 ownership columns to helpdesk_queue."""
    op.add_column(
        'helpdesk_queue',
        sa.Column(
            'assignment_strategy',
            sa.String(length=30),
            nullable=True,
            server_default=sa.text("'MANUAL'"),
        ),
    )
    op.add_column(
        'helpdesk_queue',
        sa.Column(
            'visibility',
            sa.String(length=30),
            nullable=True,
            server_default=sa.text("'DEPARTMENT'"),
        ),
    )
    op.add_column(
        'helpdesk_queue',
        sa.Column(
            'owning_department',
            sa.String(length=80),
            nullable=True,
        ),
    )
    op.add_column(
        'helpdesk_queue',
        sa.Column(
            'is_active',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('true'),
        ),
    )

    op.execute(
        "COMMENT ON COLUMN helpdesk_queue.assignment_strategy IS "
        "'file 14 QueueAssignmentStrategy: MANUAL | ROUND_ROBIN | LEAST_LOADED "
        "| SKILL_BASED | PRIORITY_BASED | CONFIGURABLE. Default MANUAL.';"
    )
    op.execute(
        "COMMENT ON COLUMN helpdesk_queue.visibility IS "
        "'file 14 QueueVisibility: QUEUE_MEMBERS | DEPARTMENT | MANAGEMENT | "
        "EVERYONE_WITH_PERMISSION. Default DEPARTMENT.';"
    )
    op.execute(
        "COMMENT ON COLUMN helpdesk_queue.owning_department IS "
        "'file 02 B5 accountable department (single, NOT comma-separated). "
        "E15 auto-watch projects this when a Task Owner is this QUEUE.';"
    )
    op.execute(
        "COMMENT ON COLUMN helpdesk_queue.is_active IS "
        "'Whether the queue accepts new tickets. False = drained/archival.';"
    )


def downgrade() -> None:
    """Downgrade schema — drop the four ownership columns."""
    op.drop_column('helpdesk_queue', 'is_active')
    op.drop_column('helpdesk_queue', 'owning_department')
    op.drop_column('helpdesk_queue', 'visibility')
    op.drop_column('helpdesk_queue', 'assignment_strategy')
