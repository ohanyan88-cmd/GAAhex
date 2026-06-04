"""settle_order race close — payment.payment_order_id + partial UNIQUE index.

F6 (Critical D3) third line of defense. Stage 1 added ``SELECT … FOR UPDATE`` on the
PaymentOrder row inside ``payment_gateway.settle_order``, which fences any two callers
that go through the same in-process import — but two **independent sessions** can still
race because the FOR UPDATE lock is session-bound and Payment INSERTs are not visible
to the other session until commit. A concurrent provider callback + the periodic
reconcile sweep could each settle the same order and write two Payment rows before
either committed.

This migration adds the column ``payment.payment_order_id`` (nullable, FK to
payment_order.id) and a **partial UNIQUE index** on the column WHERE
``payment_order_id IS NOT NULL``. Once paired with the app-side reorder in
``settle_order`` (lock PaymentOrder → re-read status → return-if-PAID → Payment-by-order
lookup → INSERT) the DB makes two Payments-per-order **physically impossible** — the
second INSERT fails with IntegrityError, and the app-side guards catch it before it
ever fires in normal traffic.

Why partial / WHERE NOT NULL:
  * Legacy ``billing.add_payment`` writes Payment rows with no PaymentOrder (manual UI
    payments). Those rows naturally carry payment_order_id IS NULL — exempt from the
    constraint, exactly as intended.
  * Only Payments born from ``settle_order`` carry payment_order_id; the constraint
    binds **one settled Payment per PaymentOrder**.

Pre-flight discipline mirrors e1a4b2c3d5f7 (product_version one-open partial unique):
refuse to apply if pre-existing duplicates would be rejected by the new index, and
print a sample with cleanup instructions so the ops engineer can resolve before retry.

Reversible: ``downgrade`` drops the index and the column.

Revision ID: f8c5b1e9a3d2
Revises: e1a4b2c3d5f7
Create Date: 2026-06-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f8c5b1e9a3d2'
down_revision: Union[str, Sequence[str], None] = 'e1a4b2c3d5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add payment.payment_order_id + partial UNIQUE; pre-flight rejects existing dups."""

    # ------------------------------------------------------------------
    # 1. Add the column nullable. Existing legacy rows (manual add_payment
    #    paths) have no PaymentOrder — they stay NULL forever and the partial
    #    index ignores them by design.
    # ------------------------------------------------------------------
    op.add_column(
        'payment',
        sa.Column('payment_order_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_payment_payment_order_id',
        'payment', 'payment_order',
        ['payment_order_id'], ['id'],
        ondelete='RESTRICT',
    )

    # ------------------------------------------------------------------
    # 2. Backfill from the inverse side: payment_order.payment_id already points
    #    at the Payment created by settle_order, so we can hydrate
    #    payment.payment_order_id from that one-hop join. Any pre-existing duplicate
    #    (two Payments tied to the same PaymentOrder from before the fix) will surface
    #    in the pre-flight below.
    # ------------------------------------------------------------------
    op.execute("""
        UPDATE payment p
           SET payment_order_id = po.id
          FROM payment_order po
         WHERE po.payment_id = p.id
           AND p.payment_order_id IS NULL;
    """)

    # ------------------------------------------------------------------
    # 3. Pre-flight: refuse to apply if any payment_order already has > 1 Payment.
    #    Mirrors e1a4b2c3d5f7's product_version pre-flight: explicit, actionable
    #    error rather than a cryptic IntegrityError mid-CREATE INDEX.
    # ------------------------------------------------------------------
    conn = op.get_bind()
    dups = conn.execute(sa.text("""
        SELECT payment_order_id, COUNT(*) AS n
          FROM payment
         WHERE payment_order_id IS NOT NULL
         GROUP BY payment_order_id
        HAVING COUNT(*) > 1
    """)).fetchall()
    if dups:
        msg_lines = [
            "Migration f8c5b1e9a3d2 aborted: duplicate Payment rows exist for one or more"
            " payment_order_id values (the F6 settle_order race fired in production before"
            " the fix landed). Resolve before re-running:",
        ]
        for row in dups:
            msg_lines.append(f"  payment_order_id={row.payment_order_id} count={row.n}")
        msg_lines.append(
            "Manual cleanup: for each payment_order_id above, keep the EARLIEST Payment row"
            " (lowest created_at / paid_at) and delete the rest — financial-immutability"
            " trigger trg_prevent_delete_payment forbids DELETE, so first downgrade that"
            " trigger or use an owner-role surgical script (audit-logged). The Payment kept"
            " should be the one whose id == payment_order.payment_id for that order."
        )
        raise RuntimeError("\n".join(msg_lines))

    # ------------------------------------------------------------------
    # 4. The partial UNIQUE index — the third line of defense on top of the
    #    in-process FOR UPDATE + the app-side existence check. With this in
    #    place the race is physically impossible.
    # ------------------------------------------------------------------
    op.create_index(
        "uq_payment_one_per_order",
        "payment",
        ["payment_order_id"],
        unique=True,
        postgresql_where=sa.text("payment_order_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Drop the partial UNIQUE, then the FK, then the column. Reverse of upgrade."""
    op.drop_index("uq_payment_one_per_order", table_name="payment")
    op.drop_constraint('fk_payment_payment_order_id', 'payment', type_='foreignkey')
    op.drop_column('payment', 'payment_order_id')
