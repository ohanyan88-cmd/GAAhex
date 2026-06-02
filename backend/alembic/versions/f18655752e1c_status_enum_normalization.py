"""status_enum_normalization

Revision ID: f18655752e1c
Revises: c8d3a4f91b6e
Create Date: 2026-06-02 16:41:55.240178

B1 enum-standard alignment for THREE specific status/enum columns. All values
move to UPPER_SNAKE per ``docs/standards/14-enum-registry.md`` and the
``13-consistency-patch-notes.md`` B1 ruling.

In scope (this revision):
  1. ``workflow_instance.status``        running   -> RUNNING
                                         completed -> COMPLETED
                                         failed    -> FAILED
                                         escalated -> ESCALATED
     Model default + server_default flipped to ``RUNNING``.

  2. ``automation_rule.event_type``      create     -> CREATE
                                         update     -> UPDATE
                                         transition -> TRANSITION
                                         delete     -> DELETE
     No server_default on this column; only the row-data UPDATE is needed.

  3. ``dunning_case.status``             active    -> ACTIVE
                                         cured     -> CURED
                                         escalated -> ESCALATED
                                         closed    -> CLOSED
     Model default + server_default flipped to ``ACTIVE``.

Out of scope (deferred — flagged for a future pass):
  * ``dunning_policy.steps_json`` action verbs (notice|throttle|walled_garden|
    terminate) — JSONB element rewrite is risky to bundle here.
  * Tenant/User/EntityDef/NavGroup status, Notification category/priority, Party
    type, Account type/billing_cycle/status, Subscription/Product/TariffPlan
    cycle, WorkItem status — heavy test surface; separate normalization pass.

Downgrade: lowercases the three columns back and reverts the two
server_defaults. Idempotent UPDATEs guarded by IN(...) value lists.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f18655752e1c'
down_revision: Union[str, Sequence[str], None] = 'c8d3a4f91b6e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. workflow_instance.status — data + server_default
    op.execute(
        sa.text(
            "UPDATE workflow_instance SET status = UPPER(status) "
            "WHERE status IN ('running','completed','failed','escalated')"
        )
    )
    op.alter_column(
        'workflow_instance', 'status',
        existing_type=sa.String(length=20),
        server_default=sa.text("'RUNNING'"),
        existing_nullable=False,
    )

    # 2. automation_rule.event_type — data only (no server_default on the column)
    op.execute(
        sa.text(
            "UPDATE automation_rule SET event_type = UPPER(event_type) "
            "WHERE event_type IN ('create','update','transition','delete')"
        )
    )

    # 3. dunning_case.status — data + server_default
    op.execute(
        sa.text(
            "UPDATE dunning_case SET status = UPPER(status) "
            "WHERE status IN ('active','cured','escalated','closed')"
        )
    )
    op.alter_column(
        'dunning_case', 'status',
        existing_type=sa.String(length=20),
        server_default=sa.text("'ACTIVE'"),
        existing_nullable=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Reverse dunning_case.status
    op.alter_column(
        'dunning_case', 'status',
        existing_type=sa.String(length=20),
        server_default=sa.text("'active'"),
        existing_nullable=False,
    )
    op.execute(
        sa.text(
            "UPDATE dunning_case SET status = LOWER(status) "
            "WHERE status IN ('ACTIVE','CURED','ESCALATED','CLOSED')"
        )
    )

    # Reverse automation_rule.event_type
    op.execute(
        sa.text(
            "UPDATE automation_rule SET event_type = LOWER(event_type) "
            "WHERE event_type IN ('CREATE','UPDATE','TRANSITION','DELETE')"
        )
    )

    # Reverse workflow_instance.status
    op.alter_column(
        'workflow_instance', 'status',
        existing_type=sa.String(length=20),
        server_default=sa.text("'running'"),
        existing_nullable=False,
    )
    op.execute(
        sa.text(
            "UPDATE workflow_instance SET status = LOWER(status) "
            "WHERE status IN ('RUNNING','COMPLETED','FAILED','ESCALATED')"
        )
    )
