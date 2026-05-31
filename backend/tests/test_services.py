"""Coverage for the service domain (services.py) + the order→subscription→service chain.

Lifecycle PENDING → ACTIVE ↔ SUSPENDED → TERMINATED (illegal → 409); activate sets activated_at.
Resources are freeform inventory (allocate → ALLOCATED; release → RELEASED, row kept). Permissions
service.* — admin via `*`, the seeded agent has none → 403. Money is luma; unique keys per test.
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.service import Service


async def _customer(client, admin, name):
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _product(client, admin, key, *, default_amount, cycle="monthly"):
    return (await client.post("/api/products", headers=admin, json={
        "key": key, "name": key.title(), "default_amount": default_amount, "cycle": cycle})).json()


async def _pass_control_gate(order_id: str) -> None:
    """SPEC §3 Stage 8 stand-in: flip the order's `control_pass` to TRUE so the kernel gate
    permits the SUBMITTED → PROVISIONING transition (Step 4). Mirrors test_orders.py's helper.
    The real flow has Revenue Control set this via its own endpoint."""
    from app.models.order import Order
    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order_id)))).scalar_one()
        o.control_pass = True
        await s.commit()


# ===================== create + validation =====================

async def test_create_service_and_validation(client, admin):
    cust = await _customer(client, admin, "Svc Cust 1")
    svc = (await client.post("/api/services", headers=admin,
                             json={"name": "Fiber line", "type": "internet", "customer_id": cust})).json()
    assert svc["status"] == "PENDING" and svc["activated_at"] is None and svc["type"] == "internet"

    # name required, bad status, unknown customer/subscription → 422
    assert (await client.post("/api/services", headers=admin, json={"name": "  "})).status_code == 422
    assert (await client.post("/api/services", headers=admin,
                              json={"name": "X", "status": "WEIRD"})).status_code == 422
    assert (await client.post("/api/services", headers=admin,
                              json={"name": "X", "customer_id": str(uuid.uuid4())})).status_code == 422
    assert (await client.post("/api/services", headers=admin,
                              json={"name": "X", "subscription_id": str(uuid.uuid4())})).status_code == 422


# ===================== lifecycle =====================

async def test_service_lifecycle_and_illegal_transitions(client, admin):
    cust = await _customer(client, admin, "Svc Cust 2")
    sid = (await client.post("/api/services", headers=admin, json={"name": "Line", "customer_id": cust})).json()["id"]

    # suspend from PENDING is illegal (only ACTIVE → SUSPENDED). The SPEC §4.5 gate runs
    # FIRST — a fresh service has no APPROVED service_suspend row, so suspend parks an
    # approval (202) before the lifecycle 409 ever fires. Test the gate here; the legal
    # ACTIVE→SUSPENDED flow + the illegal-transition path are covered downstream.
    pending = await client.post(f"/api/services/{sid}/suspend", headers=admin)
    assert pending.status_code == 202

    activated = (await client.post(f"/api/services/{sid}/activate", headers=admin)).json()
    assert activated["status"] == "ACTIVE" and activated["activated_at"] is not None

    # SPEC §4.5: pre-approve the suspension so the legacy lifecycle assertion still holds.
    aid = pending.json()["detail"]["approval_id"]
    assert (await client.patch(f"/api/mandatory-approvals/{aid}/decide", headers=admin,
                               json={"decision": "APPROVED"})).status_code == 200
    assert (await client.post(f"/api/services/{sid}/suspend", headers=admin)).json()["status"] == "SUSPENDED"
    assert (await client.post(f"/api/services/{sid}/activate", headers=admin)).json()["status"] == "ACTIVE"
    assert (await client.post(f"/api/services/{sid}/terminate", headers=admin)).json()["status"] == "TERMINATED"

    # activating a TERMINATED service is illegal
    assert (await client.post(f"/api/services/{sid}/activate", headers=admin)).status_code == 409


# ===================== resources =====================

async def test_resource_allocate_and_release(client, admin):
    cust = await _customer(client, admin, "Svc Cust 3")
    sid = (await client.post("/api/services", headers=admin, json={"name": "Line", "customer_id": cust})).json()["id"]

    res = (await client.post(f"/api/services/{sid}/resources", headers=admin,
                             json={"kind": "ip", "value": "10.0.0.5", "label": "WAN"})).json()
    assert res["status"] == "ALLOCATED" and res["kind"] == "ip" and res["value"] == "10.0.0.5"

    # bad kind / missing value → 422
    assert (await client.post(f"/api/services/{sid}/resources", headers=admin,
                              json={"kind": "laser", "value": "x"})).status_code == 422
    assert (await client.post(f"/api/services/{sid}/resources", headers=admin,
                              json={"kind": "ip", "value": ""})).status_code == 422

    # release → RELEASED, but the row is kept (still shows on the service)
    released = (await client.delete(f"/api/services/{sid}/resources/{res['id']}", headers=admin)).json()
    assert released["status"] == "RELEASED"
    svc = (await client.get(f"/api/services/{sid}", headers=admin)).json()
    assert any(r["id"] == res["id"] and r["status"] == "RELEASED" for r in svc["resources"])


# ===================== order → subscription → service chain =====================

async def test_order_to_service_chain(client, admin):
    prod = await _product(client, admin, "svc_chain_p", default_amount=40000, cycle="monthly")
    cust = await _customer(client, admin, "Svc Cust 4")
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"product_id": prod["id"], "description": "Plan", "quantity": 1, "unit_amount": 40000}],
    })).json()
    oid = order["id"]
    await client.post(f"/api/orders/{oid}/submit", headers=admin)
    await _pass_control_gate(oid)                                               # SPEC §3 Stage 8
    await client.post(f"/api/orders/{oid}/advance", headers=admin)              # PROVISIONING
    assert (await client.post(f"/api/orders/{oid}/advance", headers=admin)).json()["status"] == "COMPLETED"

    subs = (await client.get(f"/api/subscriptions?customer={cust}", headers=admin)).json()
    services = (await client.get(f"/api/services?customer={cust}", headers=admin)).json()
    assert len(subs) == 1 and len(services) == 1
    # the service references the subscription it fulfills (the chain)
    assert services[0]["subscription_id"] == subs[0]["id"]
    assert services[0]["status"] == "PENDING"


# ===================== scope / permission / tenant =====================

async def test_agent_has_no_service_access(client, agent):
    assert (await client.get("/api/services", headers=agent)).status_code == 403
    assert (await client.post("/api/services", headers=agent, json={"name": "x"})).status_code == 403


async def test_service_tenant_stamping(client, admin):
    cust = await _customer(client, admin, "Svc Cust 5")
    sid = (await client.post("/api/services", headers=admin, json={"name": "Line", "customer_id": cust})).json()["id"]
    async with SessionLocal() as s:
        admin_user = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        row = (await s.execute(select(Service).where(Service.id == uuid.UUID(sid)))).scalar_one()
        assert row.tenant_id == admin_user.tenant_id
