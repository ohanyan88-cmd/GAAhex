"""kernel: SPEC §0 invariants — DB triggers (financial + audit) + region_id partition key

Revision ID: b70ef3b98e27
Revises: c5e9a3b1d7f4
Create Date: 2026-05-31 00:00:00.000000

Enforces the DB-level half of the 7 Global Invariants. The application-level half lives in
`backend/app/kernel/invariants.py`.

Additive + reversible. Lives below the Kernel Line — runtime always sees these constraints.

------------------------------------------------------------------------------------------------
SPEC §0.3 — Financial immutability
  Invoices and Payments are NEVER deleted. State changes only (cancel, credit, refund, reconcile).
  Enforced via BEFORE DELETE triggers on `invoice` and `payment` that raise an exception.
  Status mutations (UPDATE) remain allowed — the invariant is about deletion, not edits.

SPEC §0.4 — Audit append-only
  The audit log cannot be edited or deleted by any role, including Admin. The `event` table is the
  canonical audit log (see `app/models/event.py`). Triggers on BEFORE UPDATE and BEFORE DELETE
  raise exceptions, sealing the table to inserts only.

SPEC §0.6 — Region/Branch is a partition key
  Every operational record carries a `region_id`. Nullable now — backfill lands in Step 3 and a
  later pass will tighten to NOT NULL once population is complete. The cross-region read guard is
  application-side (kernel.invariants.assert_can_read_region) and is wired into routers in Step 6.

  Tables widened: `record`, `invoice`, `payment`, `"order"`, `service`, `helpdesk_ticket`,
  `workitem`. `workitem` is GAAhex's work-order table (SPEC §0.6 names it "work_order" — same kind
  of record). Subscription/account/billing_account get region_id later if they prove needed; the
  list above is the operational surface the SPEC explicitly calls out plus the generic Record bag.

SPEC §0.7 — One KPI = one owner = one formula = one valid denominator
  Already enforced structurally by the `UNIQUE(tenant_id, key)` constraint on `kpi_def` from Step 1
  (revision `c5e9a3b1d7f4`). The one-formula and one-denominator halves are application-side
  invariants checked at kpi_def write time (deferred to the Studio KPI builder; the structural
  uniqueness guarantee is enough for Step 2).

All other invariants (#1 single-owner write lock, #2 default-deny, #5 references-not-copies,
#6 cross-region read guard) are runtime checks — see `backend/app/kernel/invariants.py`.
------------------------------------------------------------------------------------------------
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b70ef3b98e27'
down_revision: Union[str, Sequence[str], None] = 'c5e9a3b1d7f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Operational tables that get the region_id partition key (SPEC §0.6).
# Quoted form for SQL — handles `order` (a reserved word). The triggers below are emitted with the
# bare table name where it isn't reserved; `invoice`, `payment`, `event` are all safe bare.
_REGION_TABLES = [
    "record",
    "invoice",
    "payment",
    '"order"',         # SQL-reserved — must be quoted
    "service",
    "helpdesk_ticket",
    "workitem",
]


def upgrade() -> None:
    """Upgrade schema."""

    # --------------------------------------------------------------- SPEC §0.3 financial immutability
    # Invoices: no DELETE, ever. Status mutations (DRAFT → ISSUED → PAID → VOID etc.) handle the
    # state-change requirement; deletion of a record that ever existed is forbidden by the SPEC.
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_delete_invoice() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'invoice records are immutable per SPEC §0.3 — use status mutations (cancel, credit, refund, void) instead of DELETE'
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER prevent_delete_invoice
            BEFORE DELETE ON invoice
            FOR EACH ROW EXECUTE FUNCTION prevent_delete_invoice();
    """)

    # Payments: same rule. Reverse via refund/reconcile state changes, never DELETE.
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_delete_payment() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'payment records are immutable per SPEC §0.3 — use refund/reconcile state mutations instead of DELETE'
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER prevent_delete_payment
            BEFORE DELETE ON payment
            FOR EACH ROW EXECUTE FUNCTION prevent_delete_payment();
    """)

    # --------------------------------------------------------------- SPEC §0.4 audit append-only
    # The `event` table is the audit log. No edit, no delete — by ANY role, including Admin.
    # Inserts are the only legal mutation path. The triggers below enforce that at the DB layer so
    # even a superuser using raw psql cannot bypass it without first dropping the trigger (which is
    # itself a DDL-visible action).
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_update_event() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'event (audit log) is append-only per SPEC §0.4 — no UPDATE allowed by any role including Admin'
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER prevent_update_event
            BEFORE UPDATE ON event
            FOR EACH ROW EXECUTE FUNCTION prevent_update_event();
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_delete_event() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'event (audit log) is append-only per SPEC §0.4 — no DELETE allowed by any role including Admin'
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER prevent_delete_event
            BEFORE DELETE ON event
            FOR EACH ROW EXECUTE FUNCTION prevent_delete_event();
    """)

    # --------------------------------------------------------------- SPEC §0.6 region partition key
    # Add `region_id UUID NULL` to each operational table. Nullable now — Step 3 backfills, and a
    # later pass tightens to NOT NULL once population is complete and the org_region (or whatever
    # the canonical region table ends up named) is wired.
    #
    # No FK constraint yet — the canonical region/branch table doesn't exist in the schema as a
    # first-class entity yet (regions today are modeled as org_node nodes via ltree). When the
    # canonical region table lands, a later migration adds the FK; for now `region_id` is a free
    # UUID that the application binds to whatever the org partition becomes.
    for table_sql in _REGION_TABLES:
        op.execute(f"ALTER TABLE {table_sql} ADD COLUMN region_id UUID NULL;")
        op.execute(
            f"COMMENT ON COLUMN {table_sql}.region_id IS "
            "'SPEC §0.6 partition key — Region/Branch. Nullable until Step 3 backfill. "
            "Cross-region read guard lives in app.kernel.invariants.assert_can_read_region.';"
        )


def downgrade() -> None:
    """Downgrade schema. Triggers are removed first (so the table is fully open again before any
    structural changes), then the region_id columns are dropped."""

    # SPEC §0.6 — drop region_id columns
    for table_sql in _REGION_TABLES:
        op.execute(f"ALTER TABLE {table_sql} DROP COLUMN IF EXISTS region_id;")

    # SPEC §0.4 — drop audit append-only triggers
    op.execute("DROP TRIGGER IF EXISTS prevent_delete_event ON event;")
    op.execute("DROP FUNCTION IF EXISTS prevent_delete_event();")
    op.execute("DROP TRIGGER IF EXISTS prevent_update_event ON event;")
    op.execute("DROP FUNCTION IF EXISTS prevent_update_event();")

    # SPEC §0.3 — drop financial immutability triggers
    op.execute("DROP TRIGGER IF EXISTS prevent_delete_payment ON payment;")
    op.execute("DROP FUNCTION IF EXISTS prevent_delete_payment();")
    op.execute("DROP TRIGGER IF EXISTS prevent_delete_invoice ON invoice;")
    op.execute("DROP FUNCTION IF EXISTS prevent_delete_invoice();")
