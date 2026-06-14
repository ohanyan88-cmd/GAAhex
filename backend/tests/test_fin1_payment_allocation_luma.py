"""FIN-1 regression — the payment_allocation over-allocation trigger is LUMA-to-LUMA.

conftest builds the schema via ``create_all``, which does NOT include DB triggers — that
gap let the ``enforce_payment_allocation_total`` ``/100`` unit bug ship undetected: in any
migration-built (dev/prod) DB the trigger divided ``payment.amount`` by 100 and so rejected
EVERY valid full allocation (10000-luma allocation vs a 10000-luma payment → "exceeds").

This test installs the FIN-1 trigger on the test DB and proves the fixed semantics:
  * an allocation summing to EXACTLY payment.amount (luma) is ACCEPTED, and
  * one luma over is REJECTED.
The pre-fix function body would fail the first assertion, pinning the regression here.
"""
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from app.db import OwnerSessionLocal, owner_engine
from app.models.tenant import Tenant
from app.models.billing import Invoice, Payment
from app.models.payment_allocation import PaymentAllocation

# The luma-to-luma function from migration ``fin1allocluma`` (kept in sync deliberately —
# if someone re-introduces a /100 here OR in the migration, this test must move with it).
_FN_LUMA = """
CREATE OR REPLACE FUNCTION enforce_payment_allocation_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_payment_total NUMERIC(14, 2); v_alloc_sum NUMERIC(14, 2);
BEGIN
    SELECT amount::NUMERIC INTO v_payment_total FROM payment WHERE id = NEW.payment_id;
    SELECT COALESCE(SUM(amount), 0) INTO v_alloc_sum FROM payment_allocation WHERE payment_id = NEW.payment_id;
    IF v_alloc_sum > v_payment_total THEN
        RAISE EXCEPTION 'over-allocation % > %', v_alloc_sum, v_payment_total USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END; $$;
"""


@pytest.mark.asyncio
async def test_fin1_allocation_trigger_is_luma_to_luma():
    # Install the trigger (function already created by the suite's migrations on dev/prod;
    # here we add it to the create_all test DB so the unit semantics are actually exercised).
    async with owner_engine.begin() as c:
        await c.execute(text(_FN_LUMA))
        await c.execute(text("DROP TRIGGER IF EXISTS trg_fin1_test ON payment_allocation"))
        await c.execute(text(
            "CREATE TRIGGER trg_fin1_test AFTER INSERT OR UPDATE ON payment_allocation "
            "FOR EACH ROW EXECUTE FUNCTION enforce_payment_allocation_total()"
        ))

    inv_id = pay_id = None
    try:
        async with OwnerSessionLocal() as s:
            await s.connection(execution_options={"audit_tenant_filter": False})
            tenant = (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
            inv = Invoice(tenant_id=tenant.id, number=f"INV-FIN1-{uuid.uuid4().hex[:8]}",
                          status="ISSUED", total=10000)               # 10000 luma = 100.00 ֏
            s.add(inv)
            await s.flush()
            pay = Payment(tenant_id=tenant.id, invoice_id=inv.id, amount=10000, method="card")  # 10000 luma
            s.add(pay)
            await s.flush()
            inv_id, pay_id, tid = inv.id, pay.id, tenant.id

            # Full allocation == payment.amount (both luma). The /100 bug would RAISE here.
            s.add(PaymentAllocation(tenant_id=tid, payment_id=pay_id, invoice_id=inv_id,
                                    amount=Decimal("10000")))
            await s.commit()   # ACCEPTED → no exception

        # One luma over the payment total → REJECTED by the trigger.
        with pytest.raises(Exception):
            async with OwnerSessionLocal() as s2:
                await s2.connection(execution_options={"audit_tenant_filter": False})
                s2.add(PaymentAllocation(tenant_id=tid, payment_id=pay_id, invoice_id=inv_id,
                                         amount=Decimal("1")))   # 10000 + 1 > 10000
                await s2.commit()
    finally:
        async with owner_engine.begin() as c:
            await c.execute(text("DROP TRIGGER IF EXISTS trg_fin1_test ON payment_allocation"))
            if pay_id is not None:
                await c.execute(text("DELETE FROM payment_allocation WHERE payment_id = :p"), {"p": pay_id})
                await c.execute(text("DELETE FROM payment WHERE id = :p"), {"p": pay_id})
            if inv_id is not None:
                await c.execute(text("DELETE FROM invoice WHERE id = :i"), {"i": inv_id})
