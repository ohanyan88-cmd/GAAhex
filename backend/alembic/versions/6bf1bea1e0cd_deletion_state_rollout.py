"""deletion_state_rollout

Revision ID: 6bf1bea1e0cd
Revises: f18655752e1c
Create Date: 2026-06-02 16:50:39.879750

Deletion / Archive / Restore Standard (file 12 — D14) rollout: adds the
soft-delete columns to 20 major business-object tables.

`deletion_state` is the orthogonal data-lifecycle axis. It is a SEPARATE field
from each table's lifecycle `status` — the two are never merged. Both can hold
the value 'ACTIVE' simultaneously. 5-value enum:

    ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED

Default: 'ACTIVE'. NOT NULL.

Audit timestamps (all timestamptz NULL — populated on the respective transition):
    archived_at    — set on transition to ARCHIVED
    deleted_at     — set on transition to SOFT_DELETED
    restored_at    — set on restore (any → ACTIVE)

V1 scope deferral (file 12 — D14):
    purged_at, purge_scheduled_at, archive_reason, delete_reason, restore_reason
    are explicitly deferred to a future phase.

Tables touched (20):
    record, helpdesk_ticket, task, workitem, sla_record, watcher, approval,
    pending_approval, subscription, invoice, payment, credit_note, "order",
    order_item, communication, configuration, escalation, relationship,
    import_job, export_job

None of these tables already carried a `deleted_at` column (verified during
the model-side roll). The platform's existing `deleted_at` columns live on
`comment` and `attachment`, which are NOT in the target list for this rollout.
The Invoice/Payment trigger-enforced immutability (SPEC §0.3, alembic
b70ef3b98e27) is unaffected: invoices/payments can flip into ARCHIVED /
SOFT_DELETED via UPDATE; the BEFORE DELETE triggers continue to block any
hard-delete attempts at the DB layer.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6bf1bea1e0cd'
down_revision: Union[str, Sequence[str], None] = 'f18655752e1c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tables this migration rolls out to. None of them already had `deleted_at` (verified
# during the model edit pass), so every table receives the full 4-column set.
TARGET_TABLES: tuple[str, ...] = (
    "record",
    "helpdesk_ticket",
    "task",
    "workitem",
    "sla_record",
    "watcher",
    "approval",
    "pending_approval",
    "subscription",
    "invoice",
    "payment",
    "credit_note",
    "order",          # SQL reserved word — Alembic / op.add_column quotes it via the dialect.
    "order_item",
    "communication",
    "configuration",
    "escalation",
    "relationship",
    "import_job",
    "export_job",
)


def upgrade() -> None:
    """Add deletion_state + audit timestamps to every target table.

    Column order per table (for readability of the resulting schema):
        deletion_state varchar(20) NOT NULL DEFAULT 'ACTIVE'
        archived_at    timestamptz NULL
        deleted_at     timestamptz NULL
        restored_at    timestamptz NULL
    """
    for table in TARGET_TABLES:
        op.add_column(
            table,
            sa.Column(
                "deletion_state",
                sa.String(length=20),
                nullable=False,
                server_default=sa.text("'ACTIVE'"),
            ),
        )
        op.add_column(
            table,
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.add_column(
            table,
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.add_column(
            table,
            sa.Column("restored_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    """Drop the four columns from every target table, reverse order."""
    for table in reversed(TARGET_TABLES):
        op.drop_column(table, "restored_at")
        op.drop_column(table, "deleted_at")
        op.drop_column(table, "archived_at")
        op.drop_column(table, "deletion_state")
