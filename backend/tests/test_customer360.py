"""Coverage for Customer 360 (customer360.py): GET /api/customers/{id}/360.

One consolidated read-only view: profile + subscriptions + invoices + money summary + activity +
related counts. Gated on customer.view (+ org scope). Money is integer luma. total_billed counts
ISSUED/PAID/OVERDUE invoices (DRAFT/VOID excluded). Tenant-scoped. Unique names per test.
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Record, OrgNode, User, Tenant


async def _customer(client, admin, name):
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


# ===================== shape + summary correctness =====================

async def test_360_shape_and_summary(client, admin):
    cust = await _customer(client, admin, "C360 Acme")

    # one subscription (30000) → generate + issue an invoice (30000) → partial payment (10000)
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"plan_name": "P", "amount": 30000, "cycle": "monthly", "customer_id": cust})).json()
    inv = (await client.post(f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin)).json()
    await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)
    await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin, json={"amount": 10000, "method": "cash"})

    # plus a manual DRAFT invoice (5000) — must NOT count toward total_billed, but does toward invoice_count
    await client.post("/api/invoices", headers=admin,
                      json={"customer_id": cust, "lines": [{"kind": "charge", "description": "Extra", "unit_amount": 5000}]})

    body = (await client.get(f"/api/customers/{cust}/360", headers=admin)).json()
    assert {"profile", "subscriptions", "invoices", "summary", "activity", "related"} <= set(body)
    assert body["profile"]["name"] == "C360 Acme"
    assert len(body["subscriptions"]) == 1 and body["subscriptions"][0]["amount"] == 30000

    sm = body["summary"]
    assert sm["currency"] == "AMD"
    assert sm["total_billed"] == 30000        # ISSUED invoice only; the DRAFT 5000 is excluded
    assert sm["total_paid"] == 10000
    assert sm["outstanding"] == 20000
    assert sm["overdue_count"] == 0
    assert sm["subscription_count"] == 1
    assert sm["invoice_count"] == 2           # ISSUED + DRAFT both counted here


# ===================== scope =====================

async def test_360_scope_for_agent(client, admin, agent):
    # group-owned customer → agent (node scope) can't view → 403
    hq = await _customer(client, admin, "C360 HQ")
    assert (await client.get(f"/api/customers/{hq}/360", headers=agent)).status_code == 403

    # a team-owned customer (inserted directly) IS viewable by the agent → 200 with the 360 shape
    async with SessionLocal() as s:
        a = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one()
        team = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == a.tenant_id, OrgNode.code == "sales1"))).scalar_one()
        rec = Record(tenant_id=a.tenant_id, entity_key="customer", owner_node_id=team.id,
                     status="PROSPECT", data={"name": "C360 Team"})
        s.add(rec)
        await s.commit()
        team_cust = str(rec.id)
    body = await client.get(f"/api/customers/{team_cust}/360", headers=agent)
    assert body.status_code == 200 and body.json()["profile"]["name"] == "C360 Team"


# ===================== not-found / non-customer / tenant isolation =====================

async def test_360_unknown_and_non_customer_404(client, admin):
    # random id → 404
    assert (await client.get(f"/api/customers/{uuid.uuid4()}/360", headers=admin)).status_code == 404
    # a non-customer record (a lead) under the customer route → 404
    lead = (await client.post("/api/leads", headers=admin, json={"name": "not a customer"})).json()["id"]
    assert (await client.get(f"/api/customers/{lead}/360", headers=admin)).status_code == 404


async def test_360_tenant_isolation(client, admin):
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        rec = Record(tenant_id=other.id, entity_key="customer", owner_node_id=None,
                     status="PROSPECT", data={"name": "Foreign Cust"})
        s.add(rec)
        await s.commit()
        foreign = str(rec.id)
    # not in the caller's tenant → 404, never another tenant's data
    assert (await client.get(f"/api/customers/{foreign}/360", headers=admin)).status_code == 404
