"""FIN-1: payment_allocation over-allocation trigger compares LUMA-to-LUMA (drop the /100)

The audit (HARD-AUDIT-2026-06-14, FIN-1) flagged a unit contradiction in the
``enforce_payment_allocation_total`` trigger created by ``e1a4b2c3d5f7``:

  * ``payment.amount`` is BigInteger **luma** (minor units; 1 ֏ = 100 luma).
  * ``payment_allocation.amount`` is stored as **luma** too — the application
    (services/payment_allocation.invoice_balance_components + the over-allocation
    guard) and EVERY test (tests/test_payment_allocation.py uses 10000 against a
    10000-luma invoice → flips PAID) treat it as luma.
  * BUT the trigger divided ``payment.amount`` by 100, i.e. it assumed the
    allocation column was in MAJOR units. So in any migration-built DB (dev/prod)
    the trigger computed ``v_payment_total = 10000/100 = 100`` against
    ``v_alloc_sum = 10000`` and RAISED — every valid full allocation was rejected.
    The allocation path was 100% broken in production; the test suite missed it
    because conftest builds the schema via ``create_all`` (no triggers).

Fix: compare luma-to-luma — no division. ``payment_allocation.amount`` stays in
the existing ``Numeric(14, 2)`` column (it holds integer luma values fine, e.g.
10000.00); only the trigger's unit assumption was wrong. No data migration is
needed (the table is empty). ``CREATE OR REPLACE FUNCTION`` is sufficient — the
``trg_enforce_payment_allocation_total`` trigger already calls it by name.

Revision ID: fin1allocluma
Revises: picposfields
Create Date: 2026-06-14
"""
from typing import Sequence, Union

from alembic import op


revision: str = "fin1allocluma"
down_revision: Union[str, Sequence[str], None] = "picposfields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Luma-to-luma: payment_allocation.amount and payment.amount are BOTH luma.
    op.execute("""
        CREATE OR REPLACE FUNCTION enforce_payment_allocation_total() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            v_payment_total NUMERIC(14, 2);
            v_alloc_sum NUMERIC(14, 2);
        BEGIN
            -- FIN-1: both columns are luma (minor units). Compare directly; do NOT divide.
            SELECT amount::NUMERIC INTO v_payment_total
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


def downgrade() -> None:
    # Restore the prior (buggy major-units /100) function body for strict reversibility.
    op.execute("""
        CREATE OR REPLACE FUNCTION enforce_payment_allocation_total() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            v_payment_total NUMERIC(14, 2);
            v_alloc_sum NUMERIC(14, 2);
        BEGIN
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
