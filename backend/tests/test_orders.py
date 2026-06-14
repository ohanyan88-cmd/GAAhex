"""Coverage for Orders / provisioning (orders.py).

Lifecycle DRAFT → SUBMITTED → PROVISIONING → COMPLETED (or CANCELLED), each step audited via
workflow.emit (entity_key "order"). On COMPLETED, each item with a product_id provisions an ACTIVE
Subscription copying the PRODUCT's amount/cycle (not the order line price). Permissions order.* —
admin via `*`, the seeded agent has none → 403. Money is integer luma; unique keys per test.

SPEC §3 Stage 8 Control Gate: SUBMITTED → PROVISIONING refuses unless `order.control_pass` is
TRUE (Step 4 kernel enforcement). Tests that drive an order across that boundary set
`control_pass=True` directly on the row via `_pass_control_gate` — that's the Revenue Control
verdict stand-in until the dedicated /control-pass endpoint lands.
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, Event


async def _pass_control_gate(order_id: str) -> None:
    """SPEC §3 Stage 8 stand-in: flip the order's `control_pass` to TRUE so the kernel gate
    permits the SUBMITTED → PROVISIONING transition. The real flow has Revenue Control set this
    via its own (not-yet-built) endpoint; tests poke it directly on the row."""
    from app.models.order import Order
    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order_id)))).scalar_one()
        o.control_pass = True
        await s.commit()


async def _product(client, admin, key, *, default_amount, cycle="monthly"):
    return (await client.post("/api/products", headers=admin, json={
        "key": key, "name": key.title(), "default_amount": default_amount, "cycle": cycle})).json()


async def _customer(client, admin, name):
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _order_events(order_id):
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(Event).where(Event.record_id == uuid.UUID(order_id), Event.entity_key == "order")
            .order_by(Event.created_at)
        )).scalars().all()
        return [e.type for e in rows]


# ===================== create =====================

async def test_create_order_total_and_status(client, admin):
    prod = await _product(client, admin, "ord_p1", default_amount=25000)
    cust = await _customer(client, admin, "Order Cust 1")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"product_id": prod["id"], "description": "Fiber", "quantity": 2, "unit_amount": 12000}],
    })).json()
    assert order["status"] == "ORDER_CREATED" and order["number"].startswith("ORD-")
    assert order["total"] == 2 * 12000                              # sum(line_total)
    assert len(order["items"]) == 1


# ===================== lifecycle + provisioning bridge =====================

async def test_lifecycle_and_provisioning(client, admin):
    # product default (30000) differs from the order line price (99999) on purpose
    prod = await _product(client, admin, "ord_p2", default_amount=30000, cycle="monthly")
    cust = await _customer(client, admin, "Order Cust 2")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"product_id": prod["id"], "description": "Plan", "quantity": 1, "unit_amount": 99999}],
    })).json()
    oid = order["id"]

    # no subscriptions for this fresh customer yet
    assert (await client.get(f"/api/subscriptions?customer={cust}", headers=admin)).json() == []

    assert (await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "ORDER_VALIDATED"})).json()["status"] == "ORDER_VALIDATED"
    # Control gate (SST #7→#8): must be passed before order_validated → scheduling
    await _pass_control_gate(oid)
    assert (await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "SCHEDULING"})).json()["status"] == "SCHEDULING"
    # walk the rest of the SST fulfillment chain; subscriptions provision on `activation`
    completed = None
    for expected in ["CONFIG", "INSTALLATION", "CONNECTION_TEST", "PAYMENT_CONFIRMED", "ACTIVATION"]:
        completed = (await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": expected})).json()
        assert completed["status"] == expected, completed
    assert completed["status"] == "ACTIVATION"
    assert len(completed["provisioned_subscriptions"]) == 1

    # the customer now has one ACTIVE subscription with PRODUCT terms (30000/monthly), not the line price
    subs = (await client.get(f"/api/subscriptions?customer={cust}", headers=admin)).json()
    assert len(subs) == 1
    assert subs[0]["status"] == "ACTIVE" and subs[0]["amount"] == 30000 and subs[0]["cycle"] == "monthly"
    assert subs[0]["plan_name"] == prod["name"]

    # audit trail: create + 7 transitions (submit + 6 advances through the fulfillment chain)
    types = await _order_events(oid)
    assert types[0] == "CREATE" and types.count("TRANSITION") == 7


# ===================== illegal transitions =====================

async def test_illegal_transitions_409(client, admin):
    cust = await _customer(client, admin, "Order Cust 3")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust, "items": [{"description": "One-off", "quantity": 1, "unit_amount": 1000}]})).json()
    oid = order["id"]

    # cannot advance a fresh order_created order (must submit first)
    assert (await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "SCHEDULING"})).status_code == 409
    # submit, then submitting again is illegal
    assert (await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "ORDER_VALIDATED"})).status_code == 200
    assert (await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "ORDER_VALIDATED"})).status_code == 409
    # drive to activation, then cancel is illegal
    # Control gate (SST #7→#8): must be passed before order_validated → scheduling
    await _pass_control_gate(oid)
    for to in ["SCHEDULING", "CONFIG", "INSTALLATION", "CONNECTION_TEST", "PAYMENT_CONFIRMED", "ACTIVATION"]:   # order_validated → scheduling → … → activation
        await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": to})
    assert (await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "CANCELLED"})).status_code == 409


async def test_cancel_from_allowed_state(client, admin):
    cust = await _customer(client, admin, "Order Cust 4")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust, "items": [{"description": "X", "quantity": 1, "unit_amount": 500}]})).json()
    oid = order["id"]
    await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "ORDER_VALIDATED"})
    cancelled = await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "CANCELLED"})
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"


# ===================== scope / permission / tenant =====================

async def test_agent_has_no_order_access(client, agent):
    assert (await client.get("/api/orders", headers=agent)).status_code == 403
    assert (await client.post("/api/orders", headers=agent, json={"items": []})).status_code == 403


async def test_order_tenant_stamping(client, admin):
    cust = await _customer(client, admin, "Order Cust 5")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust, "items": [{"description": "Y", "quantity": 1, "unit_amount": 100}]})).json()
    async with SessionLocal() as s:
        from app.models.order import Order
        admin_user = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        row = (await s.execute(select(Order).where(Order.id == uuid.UUID(order["id"])))).scalar_one()
        assert row.tenant_id == admin_user.tenant_id
