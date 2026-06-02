"""kernel: order.control_pass trio for Stage 8 Control Gate (SPEC §3 / §10.4)

Revision ID: 98d4d53f889c
Revises: b70ef3b98e27
Create Date: 2026-05-31 00:00:00.000000

Additive + reversible.

Adds the Revenue Control verdict trio to the `"order"` table so the Stage 8 kernel function
(`app.kernel.control_gate.assert_can_advance_to_scheduling`) has a place to read from when deciding
whether an order may transition from stage 7 (Order Created) to stage 9 (Scheduling):

    control_pass     boolean  NULL  — NULL = not yet validated; TRUE = Revenue Control passed;
                                       FALSE = explicitly failed (KYC / Credit / Fraud / Tariff mismatch).
    control_pass_at  timestamptz NULL — when the verdict was recorded (audit trail).
    control_pass_by  uuid NULL       — which user recorded the verdict (audit trail; no FK yet — the
                                       Revenue Control role-gate lands in Step 6).

`"order"` is quoted because `order` is a SQL reserved word — SQLAlchemy quotes it automatically in
the ORM layer (see `app/models/order.py`) and we mirror that in the raw DDL here.

The Stage 8 invariant from SPEC §3 control rule (also restated in §10.4):
    "No order advances to Scheduling without Control Pass = TRUE."
is enforced at the application layer by `assert_can_advance_to_scheduling`, which reads
`order.control_pass` and raises `ControlGateNotPassed` (mapped to HTTP 409) when the gate is closed.
A DB-level CHECK isn't viable because the transition is to a sibling row (workitem / dispatch), not
a column mutation on `order` itself.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '98d4d53f889c'
down_revision: Union[str, Sequence[str], None] = 'b70ef3b98e27'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # All three columns nullable + no server_default — NULL is the semantic "not yet validated"
    # state, distinct from FALSE ("explicitly failed Revenue Control"). The gate refuses both.
    op.add_column('order', sa.Column('control_pass', sa.Boolean(), nullable=True))
    op.add_column('order', sa.Column('control_pass_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('order', sa.Column('control_pass_by', sa.UUID(), nullable=True))

    op.execute(
        'COMMENT ON COLUMN "order".control_pass IS '
        "'SPEC §3 Stage 8 Control Gate verdict. NULL = pending, TRUE = Revenue Control passed, "
        "FALSE = failed. Order cannot advance to Scheduling unless TRUE.';"
    )
    op.execute(
        'COMMENT ON COLUMN "order".control_pass_at IS '
        "'When the Stage 8 Control Gate verdict was recorded (audit trail).';"
    )
    op.execute(
        'COMMENT ON COLUMN "order".control_pass_by IS '
        "'User who recorded the Stage 8 Control Gate verdict. Role gating (Revenue Control only) "
        "lands in Step 6 — no FK constraint yet.';"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('order', 'control_pass_by')
    op.drop_column('order', 'control_pass_at')
    op.drop_column('order', 'control_pass')
