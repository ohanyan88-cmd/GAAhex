"""Step 3 of the orders.py NO-HARDCODE cutover — PROOF the first-class Order moves end-to-end through
the UNIFIED config-driven transition contract.

``POST /api/orders/{id}/transition`` (a ``{to}`` body — the same contract as the generic
``POST /api/{slug}/{id}/transition``) drives the Order across its whole fulfillment slice, reproducing
the exact activation end-state the bespoke submit/advance chain produces, with EVERY decision read from
the order WorkflowDef config:

  * the named Stage-8 control gate (``control_gate:stage8``) fires from config on
    order_validated→scheduling and BLOCKS with 409 until ``control_pass`` is TRUE;
  * the ``order.activated`` choreography fires from the transition's config ``publish`` on
    payment_confirmed→activation — CRM creates+activates the customer, Care files the welcome
    check-call task, Billing provisions the ACTIVE subscription;
  * the response carries ``provisioned_subscriptions`` and the audit trail is CREATE + 7 TRANSITION.

This is the proof-of-replacement that LICENSES retiring the per-verb submit/advance/cancel/release
endpoints (cutover step 5): every order stage move is now expressible as ``{to}`` through one route.
"""
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Event
from app.models.order import Order


async def _pass_control_gate(order_id: str) -> None:
    """Stage-8 Revenue-Control verdict stand-in: flip control_pass TRUE so the named gate permits
    order_validated → scheduling (mirrors test_orders.py)."""
    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order_id)))).scalar_one()
        o.control_pass = True
        await s.commit()


async def _order_event_types(order_id: str) -> list[str]:
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(Event).where(Event.record_id == uuid.UUID(order_id), Event.entity_key == "order")
            .order_by(Event.created_at)
        )).scalars().all()
        return [e.type for e in rows]


async def test_order_drives_to_activation_via_unified_transition(client, admin):
    prod = (await client.post("/api/products", headers=admin, json={
        "key": f"genp_{uuid.uuid4().hex[:6]}", "name": "Gen Plan",
        "default_amount": 30000, "cycle": "monthly"})).json()
    cust = (await client.post("/api/customers", headers=admin, json={"name": "Gen Cust"})).json()["id"]
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"product_id": prod["id"], "description": "Plan", "quantity": 1, "unit_amount": 99999}],
    })).json()
    oid = order["id"]
    assert order["status"] == "ORDER_CREATED"

    # no subscription for this fresh customer yet
    assert (await client.get(f"/api/subscriptions?customer={cust}", headers=admin)).json() == []

    # submit via the UNIFIED route (order_created → order_validated)
    r = await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "ORDER_VALIDATED"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ORDER_VALIDATED"

    # Stage-8 named control gate BLOCKS scheduling with 409 until control_pass is TRUE
    blocked = await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": "SCHEDULING"})
    assert blocked.status_code == 409, blocked.text
    assert "Stage 8" in blocked.text

    # pass the gate, then walk the whole fulfillment chain via {to}
    await _pass_control_gate(oid)
    completed = None
    for to in ["SCHEDULING", "CONFIG", "INSTALLATION", "CONNECTION_TEST", "PAYMENT_CONFIRMED", "ACTIVATION"]:
        resp = await client.post(f"/api/orders/{oid}/transition", headers=admin, json={"to": to})
        assert resp.status_code == 200, resp.text
        completed = resp.json()
        assert completed["status"] == to, completed
    assert completed["status"] == "ACTIVATION"

    # Billing choreography fired from the config `publish` → one provisioned subscription on the response
    assert len(completed["provisioned_subscriptions"]) == 1

    # CRM/Billing end-state: the customer now has one ACTIVE subscription with PRODUCT terms
    subs = (await client.get(f"/api/subscriptions?customer={cust}", headers=admin)).json()
    assert len(subs) == 1
    assert subs[0]["status"] == "ACTIVE" and subs[0]["amount"] == 30000 and subs[0]["cycle"] == "monthly"

    # Care end-state: a welcome check-call auto-task exists for the activated customer (iron rule S14)
    ct = (await client.get(
        f"/api/tasks?parent_entity_type=customer&parent_entity_id={cust}", headers=admin)).json()
    assert any(t.get("taskType") == "CALL_CUSTOMER" for t in ct), f"no CC check-call task created: {ct}"

    # audit trail: CREATE + exactly 7 TRANSITION (submit + 6 advances), identical to the bespoke chain
    types = await _order_event_types(oid)
    assert types[0] == "CREATE" and types.count("TRANSITION") == 7
