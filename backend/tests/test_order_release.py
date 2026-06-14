"""Phase B.1 — Order control-gate /transition + /collect-deposit + stage-8-gated tests.

Covers (transition endpoints now go through the unified POST /api/orders/{id}/transition):
  * /transition to scheduling succeeds when Stage 8 passes; status flips order_validated→scheduling
  * /transition to scheduling returns 409 with control_gate_block_reason in detail when Stage 8 fails
  * /collect-deposit creates a Payment row of method='card' tagged as deposit (invoice_id NULL)
  * /collect-deposit accumulates: $50 + $50 = $100 deposit_collected
  * /collect-deposit with payment_method_id charges through LoggingGateway — synthetic charge_id
    surfaces on the Payment.note + the API response
  * The order_validated → scheduling crossing via /transition is also Stage-8-gated — refuses when checks fail
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Payment
from app.models.order import Order


async def _customer(client, admin, name) -> str:
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _order_with_credit_pass(client, admin, customer_id: str, amount: int = 1000) -> dict:
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": customer_id,
        "items": [{"description": "x", "quantity": 1, "unit_amount": amount}],
    })).json()
    # submit + flip credit to PASS so the stage 8 check is clear
    await client.post(f"/api/orders/{order['id']}/transition", headers=admin, json={"to": "ORDER_VALIDATED"})
    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order["id"])))).scalar_one()
        o.credit_check_status = "PASS"
        await s.commit()
    return order


# ===================== /release =====================


async def test_release_succeeds_when_stage8_passes(client, admin):
    cust = await _customer(client, admin, "Release happy")
    order = await _order_with_credit_pass(client, admin, cust)

    # Cutover split: the bundled /release became /stage8-apply (persist the Revenue-Control verdict →
    # control_pass=True) + the gated /transition. The frontend Stage8Modal does exactly this 2-step.
    await client.post(f"/api/orders/{order['id']}/stage8-apply", headers=admin)
    r = await client.post(f"/api/orders/{order['id']}/transition", headers=admin, json={"to": "SCHEDULING"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "SCHEDULING"

    # Verify control_pass was persisted to TRUE.
    async with SessionLocal() as s:
        fresh = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(order["id"]))
        )).scalar_one()
        assert fresh.control_pass is True
        assert fresh.control_gate_block_reason is None


async def test_release_409_with_block_reason_when_stage8_fails(client, admin):
    cust = await _customer(client, admin, "Release blocked")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()
    await client.post(f"/api/orders/{order['id']}/transition", headers=admin, json={"to": "ORDER_VALIDATED"})
    # credit_check_status left NULL — stage 8 should fail with "credit check pending"

    # Persist the (failing) verdict via /stage8-apply → control_pass=False + block reason, then the
    # gated /transition refuses (mirrors the UI's stage8-apply → release 2-step).
    await client.post(f"/api/orders/{order['id']}/stage8-apply", headers=admin)
    r = await client.post(f"/api/orders/{order['id']}/transition", headers=admin, json={"to": "SCHEDULING"})
    assert r.status_code == 409, r.text
    detail = r.json().get("detail", "")
    assert "stage 8" in detail.lower() or "control gate" in detail.lower(), detail
    assert "credit" in detail.lower(), detail

    # Status should NOT have advanced.
    async with SessionLocal() as s:
        fresh = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(order["id"]))
        )).scalar_one()
        assert fresh.status == "ORDER_VALIDATED"
        # control_pass was persisted as False with a block reason.
        assert fresh.control_pass is False
        assert fresh.control_gate_block_reason is not None


# ===================== /collect-deposit =====================


async def test_collect_deposit_creates_payment_tagged_as_deposit(client, admin):
    cust = await _customer(client, admin, "Deposit basic")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()

    r = await client.post(f"/api/orders/{order['id']}/collect-deposit", headers=admin,
                          json={"amount": "5000.00"})
    assert r.status_code == 200, r.text
    body = r.json()
    payment_id = body["payment_id"]

    async with SessionLocal() as s:
        pay = (await s.execute(
            select(Payment).where(Payment.id == uuid.UUID(payment_id))
        )).scalar_one()
        assert pay.method == "card"
        assert pay.invoice_id is None  # deposits have no invoice yet
        # luma = AMD × 100 → 5000.00 AMD → 500_000 luma
        assert pay.amount == 500_000
        assert pay.note is not None
        assert "deposit" in pay.note.lower()
        assert pay.customer_id == uuid.UUID(cust)

    # Order is linked + collected total updated.
    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order["id"])))).scalar_one()
        assert o.deposit_payment_id == uuid.UUID(payment_id)
        assert Decimal(o.deposit_collected) == Decimal("5000.00")


async def test_collect_deposit_accumulates(client, admin):
    """Re-running /collect-deposit on the same order adds to deposit_collected — does NOT replace."""
    cust = await _customer(client, admin, "Deposit accum")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()

    r1 = await client.post(f"/api/orders/{order['id']}/collect-deposit", headers=admin,
                           json={"amount": "50.00"})
    assert r1.status_code == 200, r1.text

    r2 = await client.post(f"/api/orders/{order['id']}/collect-deposit", headers=admin,
                           json={"amount": "50.00"})
    assert r2.status_code == 200, r2.text

    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order["id"])))).scalar_one()
        assert Decimal(o.deposit_collected) == Decimal("100.00")

    # And there are two Payment rows linked to this customer with the deposit marker.
    async with SessionLocal() as s:
        pays = (await s.execute(
            select(Payment).where(
                Payment.customer_id == uuid.UUID(cust),
                Payment.invoice_id.is_(None),
            )
        )).scalars().all()
        assert len(pays) == 2
        for p in pays:
            assert "deposit" in (p.note or "").lower()
            assert p.method == "card"


async def test_collect_deposit_with_payment_method_records_gateway_charge_id(client, admin):
    """When payment_method_id is supplied, /collect-deposit charges through LoggingGateway and
    the synthetic charge_id surfaces on the Payment.note + the API response."""
    cust = await _customer(client, admin, "Deposit pm charge")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()
    pm = (await client.post("/api/payment-methods", headers=admin, json={
        "customer_id": cust, "card_number": "4242424242424242",
        "exp_month": 12, "exp_year": 2030, "cvc": "123",
    })).json()

    r = await client.post(f"/api/orders/{order['id']}/collect-deposit", headers=admin,
                          json={"amount": "100.00", "payment_method_id": pm["id"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["gateway_charge_id"] is not None
    assert body["gateway_charge_id"].startswith("ch_log_")

    payment_id = body["payment_id"]
    async with SessionLocal() as s:
        pay = (await s.execute(
            select(Payment).where(Payment.id == uuid.UUID(payment_id))
        )).scalar_one()
        # Note carries the deposit marker + the gateway_charge_id (so the synthetic charge can
        # be correlated to this Payment row downstream).
        assert "deposit" in (pay.note or "").lower()
        assert "gateway_charge_id=" in (pay.note or "")
        assert body["gateway_charge_id"] in (pay.note or "")


# ===================== /advance is stage-8-gated =====================


async def test_advance_to_provisioning_refuses_when_stage8_fails(client, admin):
    """The existing POST /api/orders/{id}/advance must also enforce Stage 8 on the
    SUBMITTED → PROVISIONING crossing — refuses with 409 when checks fail."""
    cust = await _customer(client, admin, "Advance blocked")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()
    await client.post(f"/api/orders/{order['id']}/transition", headers=admin, json={"to": "ORDER_VALIDATED"})
    # credit_check left NULL → stage 8 fails

    r = await client.post(f"/api/orders/{order['id']}/transition", headers=admin, json={"to": "SCHEDULING"})
    assert r.status_code == 409
    detail = r.json().get("detail", "").lower()
    assert "stage 8" in detail or "control gate" in detail or "control_pass" in detail
