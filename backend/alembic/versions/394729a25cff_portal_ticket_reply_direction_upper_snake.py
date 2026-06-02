"""portal_ticket_reply_direction_upper_snake

Revision ID: 394729a25cff
Revises: d355f4783ead
Create Date: 2026-06-02

B1 enum-standard follow-up (missed by the earlier B1 sweep in migration f18655752e1c).

Two tables in scope:

1. ``portal_ticket_reply.direction``
   Known lowercase value: 'inbound' (sole value written by portal_support.py before this fix).
   Canonical UPPER_SNAKE per file 14 enum registry — CommunicationDirection:
     INBOUND, OUTBOUND, INTERNAL, SYSTEM.
   Model default + server_default updated to 'INBOUND'.

2. ``service_action_log.status``
   Known lowercase values: 'queued', 'success', 'failed'
   (written by services/dunning.py and services/network_adapter.py before this fix).
   Canonical UPPER_SNAKE (not listed in file 14 explicitly; following BackgroundJobStatus
   pattern: QUEUED → SUCCESS / FAILED).
   Model default + server_default updated to 'QUEUED'.

Upgrade strategy — single UPDATE per table, idempotent:
  * Filter on exact lowercase set; rows already UPPER_SNAKE are untouched.

Downgrade strategy — reverses to lowercase. Idempotent.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '394729a25cff'
down_revision: Union[str, Sequence[str], None] = 'd355f4783ead'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Uppercase portal_ticket_reply.direction and service_action_log.status values."""
    # ------------------------------------------------------------------
    # 1. portal_ticket_reply.direction  ('inbound' → 'INBOUND', etc.)
    # ------------------------------------------------------------------
    op.execute(sa.text(
        "UPDATE portal_ticket_reply SET direction = UPPER(direction) "
        "WHERE direction IN ('inbound', 'outbound', 'internal', 'system')"
    ))
    op.alter_column(
        'portal_ticket_reply', 'direction',
        existing_type=sa.String(length=20),
        server_default=sa.text("'INBOUND'"),
        existing_nullable=False,
    )

    # ------------------------------------------------------------------
    # 2. service_action_log.status  ('queued' → 'QUEUED', etc.)
    # ------------------------------------------------------------------
    op.execute(sa.text(
        "UPDATE service_action_log SET status = UPPER(status) "
        "WHERE status IN ('queued', 'success', 'failed')"
    ))
    op.alter_column(
        'service_action_log', 'status',
        existing_type=sa.String(length=20),
        server_default=sa.text("'QUEUED'"),
        existing_nullable=False,
    )


def downgrade() -> None:
    """Lowercase portal_ticket_reply.direction and service_action_log.status back to pre-B1 form."""
    # ------------------------------------------------------------------
    # 2. service_action_log.status  ('QUEUED' → 'queued', etc.)
    # ------------------------------------------------------------------
    op.alter_column(
        'service_action_log', 'status',
        existing_type=sa.String(length=20),
        server_default=sa.text("'queued'"),
        existing_nullable=False,
    )
    op.execute(sa.text(
        "UPDATE service_action_log SET status = LOWER(status) "
        "WHERE status IN ('QUEUED', 'SUCCESS', 'FAILED')"
    ))

    # ------------------------------------------------------------------
    # 1. portal_ticket_reply.direction  ('INBOUND' → 'inbound', etc.)
    # ------------------------------------------------------------------
    op.alter_column(
        'portal_ticket_reply', 'direction',
        existing_type=sa.String(length=20),
        server_default=sa.text("'inbound'"),
        existing_nullable=False,
    )
    op.execute(sa.text(
        "UPDATE portal_ticket_reply SET direction = LOWER(direction) "
        "WHERE direction IN ('INBOUND', 'OUTBOUND', 'INTERNAL', 'SYSTEM')"
    ))
