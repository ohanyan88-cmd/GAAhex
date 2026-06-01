"""Phase B.1 — Stage 8 Control Gate predicate tests.

Covers:
  * No-deposit + credit PASS + no payment method + no approvals → pass=True
  * Deposit required > 0 but deposit_collected=0 → pass=False, blocker mentions deposit
  * Deposit required matched → pass=True
  * Expired payment_method → pass=False, blocker mentions expiry
  * Pending mandatory_approval row → pass=False, blocker mentions approvals
  * credit_check_status='FAIL' → pass=False
  * apply_stage8_result writes the boolean + reason + audit fields
  * Idempotency — calling stage8-apply twice produces the same result
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.approval import Approval
from app.models.order import Order
from app.models.payment_method import PaymentMethod
from app.services.payment_gateway_adapter import LoggingGateway
from app.services.stage8_gate import (
    apply_stage8_result,
    compute_stage8_status,
)


# ===================== fixtures / helpers =====================


async def _admin_user() -> User:
    async with SessionLocal() as s:
        return (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()


async def _customer(client, admin, name) -> str:
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _order(client, admin, customer_id: str, amount: int = 1000) -> dict:
    return (await client.post("/api/orders", headers=admin, json={
        "customer_id": customer_id,
        "items": [{"description": "test", "quantity": 1, "unit_amount": amount}],
    })).json()


async def _set_credit_pass(order_id: str, status: str = "PASS") -> None:
    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order_id)))).scalar_one()
        o.credit_check_status = status
        await s.commit()


async def _set_deposit(order_id: str, *, required: Decimal | None = None,
                       collected: Decimal | None = None) -> None:
    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order_id)))).scalar_one()
        if required is not None:
            o.deposit_required = required
        if collected is not None:
            o.deposit_collected = collected
        await s.commit()


async def _link_payment_method(order_id: str, pm_id: str) -> None:
    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order_id)))).scalar_one()
        o.payment_method_id = uuid.UUID(pm_id)
        await s.commit()


async def _vault_pm(client, admin, customer_id: str, *,
                    card_number: str = "4242424242424242",
                    exp_month: int = 12, exp_year: int = 2030) -> dict:
    return (await client.post("/api/payment-methods", headers=admin, json={
        "customer_id": customer_id, "card_number": card_number,
        "exp_month": exp_month, "exp_year": exp_year, "cvc": "123",
    })).json()


async def _add_pending_approval(tenant_id, order_id: str, requester_id) -> str:
    async with SessionLocal() as s:
        a = Approval(
            tenant_id=tenant_id,
            action_type="order_release",
            target_entity_key="order",
            target_record_id=uuid.UUID(order_id),
            requested_by=requester_id,
            status="PENDING",
            payload={},
        )
        s.add(a)
        await s.commit()
        return str(a.id)


# ===================== predicate happy + per-check failures =====================


async def test_no_deposit_credit_pass_no_pm_passes(client, admin):
    cust = await _customer(client, admin, "S8 happy")
    order = await _order(client, admin, cust)
    await _set_credit_pass(order["id"], "PASS")

    async with SessionLocal() as s:
        result = await compute_stage8_status(s, uuid.UUID(order["id"]))
    assert result["pass"] is True, result
    assert result["blockers"] == []
    assert result["checks"]["credit_check"] == "PASS"
    assert result["checks"]["deposit"] == "NOT_REQUIRED"
    assert result["checks"]["payment_method"] == "NOT_LINKED"
    assert result["checks"]["mandatory_approvals"] == "PASS"


async def test_deposit_required_but_not_collected_fails(client, admin):
    cust = await _customer(client, admin, "S8 deposit miss")
    order = await _order(client, admin, cust)
    await _set_credit_pass(order["id"], "PASS")
    await _set_deposit(order["id"], required=Decimal("5000.00"), collected=Decimal("0"))

    async with SessionLocal() as s:
        result = await compute_stage8_status(s, uuid.UUID(order["id"]))
    assert result["pass"] is False
    assert result["checks"]["deposit"] == "FAIL"
    assert any("deposit" in b.lower() for b in result["blockers"]), result["blockers"]


async def test_deposit_required_matched_passes(client, admin):
    cust = await _customer(client, admin, "S8 deposit ok")
    order = await _order(client, admin, cust)
    await _set_credit_pass(order["id"], "PASS")
    await _set_deposit(order["id"], required=Decimal("1000.00"), collected=Decimal("1000.00"))

    async with SessionLocal() as s:
        result = await compute_stage8_status(s, uuid.UUID(order["id"]))
    assert result["pass"] is True, result
    assert result["checks"]["deposit"] == "PASS"


async def test_expired_payment_method_fails(client, admin):
    cust = await _customer(client, admin, "S8 pm expired")
    order = await _order(client, admin, cust)
    await _set_credit_pass(order["id"], "PASS")

    # Vault a card in the past — January 2020.
    pm = await _vault_pm(client, admin, cust, exp_month=1, exp_year=2020)
    await _link_payment_method(order["id"], pm["id"])

    async with SessionLocal() as s:
        result = await compute_stage8_status(s, uuid.UUID(order["id"]))
    assert result["pass"] is False
    assert result["checks"]["payment_method"] == "EXPIRED"
    assert any("expir" in b.lower() for b in result["blockers"]), result["blockers"]


async def test_pending_mandatory_approval_fails(client, admin):
    cust = await _customer(client, admin, "S8 approval pending")
    order = await _order(client, admin, cust)
    await _set_credit_pass(order["id"], "PASS")

    admin_user = await _admin_user()
    await _add_pending_approval(admin_user.tenant_id, order["id"], admin_user.id)

    async with SessionLocal() as s:
        result = await compute_stage8_status(s, uuid.UUID(order["id"]))
    assert result["pass"] is False
    assert result["checks"]["mandatory_approvals"] == "PENDING"
    assert any("approval" in b.lower() for b in result["blockers"]), result["blockers"]


async def test_credit_check_fail_fails(client, admin):
    cust = await _customer(client, admin, "S8 credit fail")
    order = await _order(client, admin, cust)
    await _set_credit_pass(order["id"], "FAIL")

    async with SessionLocal() as s:
        result = await compute_stage8_status(s, uuid.UUID(order["id"]))
    assert result["pass"] is False
    assert result["checks"]["credit_check"] == "FAIL"
    assert any("credit" in b.lower() for b in result["blockers"]), result["blockers"]


# ===================== apply_stage8_result =====================


async def test_apply_stage8_writes_boolean_and_reason(client, admin):
    cust = await _customer(client, admin, "S8 apply pass")
    order = await _order(client, admin, cust)
    await _set_credit_pass(order["id"], "PASS")
    admin_user = await _admin_user()

    async with SessionLocal() as s:
        updated = await apply_stage8_result(
            s, uuid.UUID(order["id"]), actor_id=admin_user.id,
        )
        await s.commit()
        await s.refresh(updated)

    async with SessionLocal() as s:
        fresh = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(order["id"]))
        )).scalar_one()
        assert fresh.control_pass is True
        assert fresh.control_pass_at is not None
        assert fresh.control_pass_by == admin_user.id
        assert fresh.control_gate_block_reason is None


async def test_apply_stage8_writes_block_reason_on_failure(client, admin):
    cust = await _customer(client, admin, "S8 apply fail")
    order = await _order(client, admin, cust)
    # Credit pending (NULL) — blocker should be recorded.
    admin_user = await _admin_user()

    async with SessionLocal() as s:
        await apply_stage8_result(s, uuid.UUID(order["id"]), actor_id=admin_user.id)
        await s.commit()

    async with SessionLocal() as s:
        fresh = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(order["id"]))
        )).scalar_one()
        assert fresh.control_pass is False
        assert fresh.control_gate_block_reason is not None
        assert "credit" in fresh.control_gate_block_reason.lower()


async def test_apply_stage8_idempotent(client, admin):
    """Calling stage8-apply twice on the same inputs produces the same control_pass +
    block_reason. control_pass_at MAY differ across calls (it's a timestamp), but the verdict
    is stable."""
    cust = await _customer(client, admin, "S8 idempotent")
    order = await _order(client, admin, cust)
    await _set_credit_pass(order["id"], "PASS")
    await _set_deposit(order["id"], required=Decimal("500.00"), collected=Decimal("500.00"))
    admin_user = await _admin_user()

    async with SessionLocal() as s:
        await apply_stage8_result(s, uuid.UUID(order["id"]), actor_id=admin_user.id)
        await s.commit()
    async with SessionLocal() as s:
        first = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(order["id"]))
        )).scalar_one()
        first_pass = first.control_pass
        first_reason = first.control_gate_block_reason

    async with SessionLocal() as s:
        await apply_stage8_result(s, uuid.UUID(order["id"]), actor_id=admin_user.id)
        await s.commit()
    async with SessionLocal() as s:
        second = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(order["id"]))
        )).scalar_one()
        assert second.control_pass == first_pass
        assert second.control_gate_block_reason == first_reason
