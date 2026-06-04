"""H9 Stage 2 — subscription.billing_anchor_day (per-subscription anchor day-of-month)

Adds the `subscription.billing_anchor_day` column (Integer, NULLable) so each subscription can
carry an explicit billing-day-of-month anchor rather than implicitly deriving it from
`started_at.day` every cycle. NULL means "derive from started_at" — fully backward compatible
for every existing row.

Backfill rule (audit-flagged H9 ambiguity):
    Existing rows: copy `started_at.day` (clamped to 1..28). Values 29..31 → 28 — picking the
    most-conservative anchor (last day that exists in EVERY month) so the backfill never
    surprises a tenant by silently changing their effective billing cadence. Operators who
    actually WANT a 29/30/31 anchor can PATCH the column post-deploy; the `_add_cycle` helper
    already clamps short months to the month's last day for 29..31 anchors.

No NOT NULL alter — keeping NULL legal preserves the legacy "derive from started_at.day" path
for any future row that doesn't opt in to an explicit anchor.

Down_revision chain: this is the THIRD Stage-2 migration (after e1a4b2c3d5f7 + f8c5b1e9a3d2);
chains AFTER f8c5b1e9a3d2 (the current head as of 2026-06-04).

Revision ID: b3d5f7a9c2e4
Revises: f8c5b1e9a3d2
Create Date: 2026-06-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3d5f7a9c2e4'
down_revision: Union[str, Sequence[str], None] = 'f8c5b1e9a3d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add subscription.billing_anchor_day (NULL-default), backfill from started_at.day clamped to
    1..28. Future explicit 29..31 values are clamped at apply time by _add_cycle, not at write time."""

    # 1. Add the column NULLable (NULL = derive from started_at.day, legacy path preserved).
    op.add_column(
        'subscription',
        sa.Column('billing_anchor_day', sa.Integer(), nullable=True),
    )

    # 2. Backfill from started_at.day; clamp 29..31 → 28 (the most conservative anchor that
    #    survives every month). Operators who want a 29/30/31 anchor PATCH post-deploy.
    #
    # The CASE expression handles three buckets:
    #   day BETWEEN 1 AND 28  → keep as-is (anchor day exists in every month)
    #   day BETWEEN 29 AND 31 → 28 (back off to last-day-of-every-month for safety)
    #   started_at IS NULL    → leave NULL (derive at apply time)
    op.execute("""
        UPDATE subscription
           SET billing_anchor_day = CASE
                WHEN EXTRACT(DAY FROM started_at) BETWEEN 1 AND 28
                    THEN CAST(EXTRACT(DAY FROM started_at) AS INTEGER)
                WHEN EXTRACT(DAY FROM started_at) BETWEEN 29 AND 31
                    THEN 28
                ELSE NULL
           END
         WHERE started_at IS NOT NULL
           AND billing_anchor_day IS NULL;
    """)

    # 3. CHECK constraint to fence the 1..31 range at the DB layer. NULL stays legal
    #    (NULL = "derive from started_at.day"); explicit values must be in [1, 31].
    op.create_check_constraint(
        'ck_subscription_billing_anchor_day_range',
        'subscription',
        'billing_anchor_day IS NULL OR (billing_anchor_day BETWEEN 1 AND 31)',
    )


def downgrade() -> None:
    """Drop the CHECK + the column. Backfill is one-way (data already lived as
    started_at.day before, so we don't lose information when the column goes away)."""
    op.drop_constraint(
        'ck_subscription_billing_anchor_day_range',
        'subscription',
        type_='check',
    )
    op.drop_column('subscription', 'billing_anchor_day')
