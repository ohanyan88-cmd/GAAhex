"""Step 2 Wave 2 — low-risk FK backfills (idempotent, run within a transaction)

Per the relationship-map doc, low-risk Wave 2 backfills:
  #1  payment.customer_id    ← invoice.customer_id (via payment.invoice_id)
  #2  payment.account_id     ← invoice.account_id  (via payment.invoice_id)
  #18 service.product_id     ← subscription.product_id (via service.subscription_id)

Medium-risk backfills (#13/#14/#15/#17 invoice_line and order joins) are deferred — they
need per-tenant ambiguity audit (multi-match periods) and stay NULL until that's done.

Live dev DB run (2026-05-31): 78/79 payments updated for both FKs; 1/1 service updated.
The single payment that didn't backfill has no parent invoice (standalone refund/credit
gateway entry) — correct hide-if-missing behavior.

Revision ID: b2d4e6f8c1a3
Revises: 7f1c8a3d9e42
Create Date: 2026-05-31
"""
from alembic import op


revision = 'b2d4e6f8c1a3'
down_revision = '7f1c8a3d9e42'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent — each UPDATE is gated on the target column being NULL, so re-runs are no-ops.
    op.execute("""
        UPDATE payment p SET customer_id = i.customer_id
          FROM invoice i
         WHERE p.invoice_id = i.id
           AND p.customer_id IS NULL
           AND i.customer_id IS NOT NULL;
    """)
    op.execute("""
        UPDATE payment p SET account_id = i.account_id
          FROM invoice i
         WHERE p.invoice_id = i.id
           AND p.account_id IS NULL
           AND i.account_id IS NOT NULL;
    """)
    op.execute("""
        UPDATE service svc SET product_id = sub.product_id
          FROM subscription sub
         WHERE svc.subscription_id = sub.id
           AND svc.product_id IS NULL
           AND sub.product_id IS NOT NULL;
    """)


def downgrade() -> None:
    # Backfill is data, not schema — downgrade is a no-op. The columns themselves are
    # dropped by reverting Step 2 Wave 1 (60a9edffdefe).
    pass
