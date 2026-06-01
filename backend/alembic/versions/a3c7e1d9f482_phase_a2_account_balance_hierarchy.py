"""Phase A.2 — Account balance + hierarchy materialized path.

Adds five columns to the ``account`` table:

* ``current_balance`` — SIGNED Numeric(14,2). NEGATIVE = customer owes us, POSITIVE = credit on
  account. server_default '0'.
* ``credit_limit`` — Numeric(14,2), server_default '0'. The max NEGATIVE balance allowed before
  an order block is triggered (Stage 8).
* ``available_credit`` — Numeric(14,2), server_default '0'. Cached max(0, credit_limit + balance).
* ``balance_updated_at`` — nullable timestamp; set every time recompute_account_balance() runs.
* ``hierarchy_path`` — nullable String, dot-joined UUIDs (materialized path). String (not LTREE)
  for portability — we maintain it manually in app code.

Backfill (idempotent):

1. Explicit UPDATE forces ``current_balance``/``credit_limit``/``available_credit`` to 0 for any
   row whose server_default did not fire (edge case for pre-existing rows on some Postgres
   versions where ``ADD COLUMN ... DEFAULT`` rewrites only for new INSERTs).
2. ``hierarchy_path`` is computed by a recursive CTE that walks ``parent_account_id`` from each
   root (parent IS NULL) down to its descendants. Roots get ``id::text``; children get
   ``parent.path || '.' || id::text``.

Revision ID: a3c7e1d9f482
Revises: f7a2d5c9b134
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op


revision = 'a3c7e1d9f482'
down_revision = 'f7a2d5c9b134'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- 1. Add the five columns. server_default covers the safe path. ----
    op.add_column(
        'account',
        sa.Column('current_balance', sa.Numeric(14, 2), nullable=False, server_default='0'),
    )
    op.add_column(
        'account',
        sa.Column('credit_limit', sa.Numeric(14, 2), nullable=False, server_default='0'),
    )
    op.add_column(
        'account',
        sa.Column('available_credit', sa.Numeric(14, 2), nullable=False, server_default='0'),
    )
    op.add_column(
        'account',
        sa.Column('balance_updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'account',
        sa.Column('hierarchy_path', sa.String(), nullable=True),
    )

    # ---- 2. Explicit safety-UPDATE for existing rows (idempotent: matches server_default). ----
    op.execute(
        "UPDATE account SET current_balance = 0 WHERE current_balance IS NULL"
    )
    op.execute(
        "UPDATE account SET credit_limit = 0 WHERE credit_limit IS NULL"
    )
    op.execute(
        "UPDATE account SET available_credit = 0 WHERE available_credit IS NULL"
    )

    # ---- 3. Backfill hierarchy_path with a recursive CTE walk from each root down. ----
    op.execute("""
        WITH RECURSIVE tree AS (
            SELECT id, id::text AS path
              FROM account
             WHERE parent_account_id IS NULL
            UNION ALL
            SELECT a.id, t.path || '.' || a.id::text
              FROM account a
              JOIN tree t ON a.parent_account_id = t.id
        )
        UPDATE account AS a
           SET hierarchy_path = tree.path
          FROM tree
         WHERE a.id = tree.id;
    """)

    # ---- 4. Helpful index on hierarchy_path (LIKE subtree-prefix lookups in consolidated_balance). ----
    op.create_index('ix_account_hierarchy_path', 'account', ['hierarchy_path'])


def downgrade() -> None:
    op.drop_index('ix_account_hierarchy_path', table_name='account')
    op.drop_column('account', 'hierarchy_path')
    op.drop_column('account', 'balance_updated_at')
    op.drop_column('account', 'available_credit')
    op.drop_column('account', 'credit_limit')
    op.drop_column('account', 'current_balance')
