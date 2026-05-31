"""Credit-note financial immutability (SPEC §0.3) — BEFORE DELETE trigger on `record`.

Credit notes are config-driven Records (entity_key='credit_note'), not their own physical
table. SPEC §0.3 forbids deleting financial records; payments/invoices already have per-table
triggers (b70ef3b98e27). For credit_note we attach a generic trigger to the shared `record`
table that only fires for credit_note rows — non-financial entity_keys (customer, ticket,
project, etc.) remain freely deletable.

The trigger condition uses a direct column comparison on entity_key (no subquery — Postgres
trigger WHEN clauses don't allow subqueries). Status-change UPDATEs (DRAFT→ISSUED→APPLIED→VOID)
remain open, matching the invoice/payment doctrine: state mutates, rows don't disappear.

Revision ID: f1a3b8d27e64
Revises: e8f3c1a9b526
Create Date: 2026-05-31
"""
from alembic import op


revision = 'f1a3b8d27e64'
down_revision = 'e8f3c1a9b526'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_delete_credit_note_record() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'credit_note records are immutable per SPEC §0.3 — use status mutations (VOID/APPLIED) instead of DELETE'
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("DROP TRIGGER IF EXISTS prevent_delete_credit_note_record ON record;")
    op.execute("""
        CREATE TRIGGER prevent_delete_credit_note_record
            BEFORE DELETE ON record
            FOR EACH ROW
            WHEN (OLD.entity_key = 'credit_note')
            EXECUTE FUNCTION prevent_delete_credit_note_record();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS prevent_delete_credit_note_record ON record;")
    op.execute("DROP FUNCTION IF EXISTS prevent_delete_credit_note_record();")
