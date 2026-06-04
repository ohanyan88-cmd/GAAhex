"""remediation 2026-06-04 — financial-immutability + auth-hardening + product-version single-open

Bundles seven schema changes flagged by the 2026-06-04 remediation pass. All additive, all
reversible, all guarded by pre-flight assertions where they could otherwise reject existing data.

1. product_version — partial unique on (product_id) WHERE effective_to IS NULL
   Closes a race window in `services/product_versions.mint_new_version`: two concurrent mints
   against the same product could each commit a row with effective_to=NULL, leaving the table
   with two "live" versions. The app-side check is correct but TOCTOU; this index makes the
   DB the arbiter. Pre-flight asserts zero products already have >1 open version.

2. credit_note — BEFORE DELETE trigger (SPEC §0.3 financial-immutability)
   Mirrors `prevent_delete_invoice` / `prevent_delete_payment` from b70ef3b98e27. Credit notes
   are financial documents — state changes (DRAFT→ISSUED→APPLIED|VOID) only, never deletion.

3. payment_allocation — BEFORE DELETE trigger (SPEC §0.3 financial-immutability)
   Same shape as #2. Allocations are the canonical record of "of payment X, this much went to
   invoice Y" — deleting them would silently corrupt outstanding_for_invoice and account balance.

4. payment_allocation — AFTER INSERT OR UPDATE over-allocation CHECK trigger
   Asserts SUM(amount) per payment_id <= payment.amount. The application-side check in
   services/payment_allocation.allocate_payment is correct but TOCTOU under concurrent allocate
   calls against the same payment; this trigger makes the invariant unbreakable.
   Unit-of-account: payment.amount is BigInteger luma (integer minor units — see billing.py:118
   docstring "luma"). payment_allocation.amount is Numeric(14, 2) in major units. The trigger
   compares Numeric-to-Numeric by casting payment.amount::NUMERIC / 100.

5. refresh_token — add `session_id UUID NOT NULL` + index
   Groups rotated tokens into a session family so revoke-all-for-session is a single UPDATE.
   Backfill: each existing token gets session_id = id (family-of-one, preserves current semantics).

6. customer_user — add `token_not_before TIMESTAMPTZ` nullable
   Issued-before-this-timestamp portal JWTs are rejected. NULL = "all tokens accepted" (current
   behavior, fully backward compatible). No index — read once per token-verify, indexed scan
   would be wasted.

7. api_key — add `expires_at TIMESTAMPTZ` + `scopes JSONB`, both nullable
   `expires_at` NULL = no expiry (current behavior preserved). `scopes` NULL or '[]' = no scope
   restriction (current behavior preserved). Both columns are read on every key auth; no index
   needed — the lookup is already keyed by key_hash (unique).

Revision ID: e1a4b2c3d5f7
Revises: d1a7b2c4e6f8
Create Date: 2026-06-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e1a4b2c3d5f7'
down_revision: Union[str, Sequence[str], None] = 'd1a7b2c4e6f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # --------------------------------------------------------------------------------------------
    # Change 1 — product_version: partial unique index, one open version per product.
    # --------------------------------------------------------------------------------------------
    # Pre-flight: refuse to apply if any product already has >1 open version. If this fires the
    # ops engineer must close the duplicate(s) (set effective_to on all-but-one) before retrying.
    conn = op.get_bind()
    dup_rows = conn.execute(sa.text("""
        SELECT product_id, COUNT(*) AS open_count
          FROM product_version
         WHERE effective_to IS NULL
         GROUP BY product_id
        HAVING COUNT(*) > 1
    """)).fetchall()
    if dup_rows:
        sample = ", ".join(f"{row[0]}({row[1]})" for row in dup_rows[:5])
        raise RuntimeError(
            f"product_version pre-flight failed: {len(dup_rows)} product(s) have >1 open version "
            f"(effective_to IS NULL). Sample [product_id(open_count)]: {sample}. Close duplicates "
            f"before re-running migration e1a4b2c3d5f7."
        )

    op.execute("""
        CREATE UNIQUE INDEX uq_product_version_one_open
          ON product_version (product_id)
          WHERE effective_to IS NULL;
    """)

    # --------------------------------------------------------------------------------------------
    # Change 2 — credit_note: BEFORE DELETE trigger (SPEC §0.3 financial-immutability).
    # Mirrors prevent_delete_invoice (b70ef3b98e27:75-87).
    # --------------------------------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_delete_credit_note() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'credit_note rows are immutable (SPEC §0.3 financial-immutability) — use status mutations (issue, apply, void) instead of DELETE'
                USING ERRCODE = 'restrict_violation';
        END;
        $$;
    """)
    op.execute("""
        CREATE TRIGGER trg_prevent_delete_credit_note
            BEFORE DELETE ON credit_note
            FOR EACH ROW EXECUTE FUNCTION prevent_delete_credit_note();
    """)

    # --------------------------------------------------------------------------------------------
    # Change 3 — payment_allocation: BEFORE DELETE trigger (SPEC §0.3 financial-immutability).
    # --------------------------------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_delete_payment_allocation() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'payment_allocation rows are immutable (SPEC §0.3 financial-immutability) — allocations are the canonical settlement record and cannot be deleted'
                USING ERRCODE = 'restrict_violation';
        END;
        $$;
    """)
    op.execute("""
        CREATE TRIGGER trg_prevent_delete_payment_allocation
            BEFORE DELETE ON payment_allocation
            FOR EACH ROW EXECUTE FUNCTION prevent_delete_payment_allocation();
    """)

    # --------------------------------------------------------------------------------------------
    # Change 4 — payment_allocation: AFTER INSERT OR UPDATE over-allocation CHECK trigger.
    # Unit-of-account note: payment.amount is BigInteger luma (minor units). payment_allocation.amount
    # is Numeric(14, 2) in major units. We compare Numeric-to-Numeric by casting payment.amount to
    # NUMERIC and dividing by 100 so 12345 luma == 123.45 allocation.amount.
    # --------------------------------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION enforce_payment_allocation_total() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            v_payment_total NUMERIC(14, 2);
            v_alloc_sum NUMERIC(14, 2);
        BEGIN
            -- payment.amount is BigInteger luma (minor units); cast and divide to compare in
            -- the major-units Numeric(14, 2) space that payment_allocation.amount lives in.
            SELECT (amount::NUMERIC / 100)::NUMERIC(14, 2) INTO v_payment_total
              FROM payment WHERE id = NEW.payment_id;
            SELECT COALESCE(SUM(amount), 0) INTO v_alloc_sum
              FROM payment_allocation WHERE payment_id = NEW.payment_id;
            IF v_alloc_sum > v_payment_total THEN
                RAISE EXCEPTION 'payment_allocation total (%) exceeds payment.amount (%) for payment_id %',
                    v_alloc_sum, v_payment_total, NEW.payment_id
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END;
        $$;
    """)
    op.execute("""
        CREATE TRIGGER trg_enforce_payment_allocation_total
            AFTER INSERT OR UPDATE ON payment_allocation
            FOR EACH ROW EXECUTE FUNCTION enforce_payment_allocation_total();
    """)

    # --------------------------------------------------------------------------------------------
    # Change 5 — refresh_token.session_id UUID NOT NULL + index.
    # Add nullable → backfill (session_id = id, family-of-one for legacy tokens) → NOT NULL → index.
    # --------------------------------------------------------------------------------------------
    op.add_column(
        'refresh_token',
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute("UPDATE refresh_token SET session_id = id WHERE session_id IS NULL;")

    # Pre-flight before NOT NULL: zero orphan rows.
    orphan_count = conn.execute(sa.text(
        "SELECT COUNT(*) FROM refresh_token WHERE session_id IS NULL"
    )).scalar()
    if orphan_count:
        raise RuntimeError(
            f"refresh_token.session_id backfill left {orphan_count} NULL row(s); refusing NOT NULL alter."
        )

    op.alter_column('refresh_token', 'session_id', nullable=False)
    op.create_index('ix_refresh_token_session_id', 'refresh_token', ['session_id'])

    # --------------------------------------------------------------------------------------------
    # Change 6 — customer_user.token_not_before TIMESTAMPTZ (nullable, no index).
    # NULL = all tokens accepted (current behavior). Set to UTC now to revoke-all-portal-sessions
    # for a given customer_user. Read once per portal JWT verify — no index, scan is by PK.
    # --------------------------------------------------------------------------------------------
    op.add_column(
        'customer_user',
        sa.Column('token_not_before', sa.DateTime(timezone=True), nullable=True),
    )

    # --------------------------------------------------------------------------------------------
    # Change 7 — api_key: expires_at TIMESTAMPTZ + scopes JSONB (both nullable, backward compatible).
    # NULL expires_at = no expiry. NULL or '[]' scopes = no scope restriction.
    # --------------------------------------------------------------------------------------------
    op.add_column(
        'api_key',
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'api_key',
        sa.Column('scopes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema. Triggers/indexes come off first (so the table is fully open again before
    structural changes), then the columns drop, then the partial unique index."""

    # Change 7 — api_key columns.
    op.drop_column('api_key', 'scopes')
    op.drop_column('api_key', 'expires_at')

    # Change 6 — customer_user.token_not_before.
    op.drop_column('customer_user', 'token_not_before')

    # Change 5 — refresh_token.session_id.
    op.drop_index('ix_refresh_token_session_id', table_name='refresh_token')
    op.drop_column('refresh_token', 'session_id')

    # Change 4 — payment_allocation over-allocation trigger.
    op.execute("DROP TRIGGER IF EXISTS trg_enforce_payment_allocation_total ON payment_allocation;")
    op.execute("DROP FUNCTION IF EXISTS enforce_payment_allocation_total();")

    # Change 3 — payment_allocation DELETE trigger.
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_delete_payment_allocation ON payment_allocation;")
    op.execute("DROP FUNCTION IF EXISTS prevent_delete_payment_allocation();")

    # Change 2 — credit_note DELETE trigger.
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_delete_credit_note ON credit_note;")
    op.execute("DROP FUNCTION IF EXISTS prevent_delete_credit_note();")

    # Change 1 — product_version one-open partial unique index.
    op.execute("DROP INDEX IF EXISTS uq_product_version_one_open;")
