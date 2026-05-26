"""Coverage for usage metering + rating (usage.py) and the usage→billing bridge.

amount = round(quantity * unit_rate) in luma; list filters by subscription / service / rated. Rating
(`POST /api/usage/rate`) rolls a subscription's UNRATED usage into charge lines on a DRAFT invoice,
recomputes the total with billing's own rule, and flips each usage rated + linked. Permissions
usage.* (rating also needs invoice.create) — admin via `*`, the seeded agent has none → 403. Money is
integer luma. Unique names per test (the shared session DB accumulates).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, Tenant
from app.models.usage import UsageRecord
from app.models.billing import Subscription


async def _customer(client, admin, name):
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _subscription(client, admin, *, amount=10000):
    tag = uuid.uuid4().hex[:8]
    cust = await _customer(client, admin, f"Usage Cust {tag}")
    return (await client.post("/api/subscriptions", headers=admin, json={
        "plan_name": f"Plan {tag}", "amount": amount, "cycle": "monthly", "customer_id": cust})).json()


# ===================== record + validation =====================

async def test_record_usage_amount_computed(client, admin):
    u = (await client.post("/api/usage", headers=admin,
                           json={"metric": "gb", "quantity": 10, "unit_rate": 50})).json()
    assert u["amount"] == 500 and u["metric"] == "gb" and u["rated"] is False and u["invoice_id"] is None

    # fractional quantity rounds (2.5 * 100 = 250)
    u2 = (await client.post("/api/usage", headers=admin,
                            json={"metric": "minutes", "quantity": 2.5, "unit_rate": 100})).json()
    assert u2["amount"] == 250

    # bad metric / negative quantity / unknown subscription → 422
    assert (await client.post("/api/usage", headers=admin,
                              json={"metric": "smoke", "quantity": 1, "unit_rate": 1})).status_code == 422
    assert (await client.post("/api/usage", headers=admin,
                              json={"metric": "gb", "quantity": -1, "unit_rate": 1})).status_code == 422
    assert (await client.post("/api/usage", headers=admin, json={
        "metric": "gb", "quantity": 1, "unit_rate": 1, "subscription_id": str(uuid.uuid4())})).status_code == 422


# ===================== list filters =====================

async def test_list_filters_subscription_and_rated(client, admin):
    sid = (await _subscription(client, admin))["id"]
    rec = (await client.post("/api/usage", headers=admin, json={
        "metric": "gb", "quantity": 4, "unit_rate": 25, "subscription_id": sid})).json()

    by_sub = (await client.get(f"/api/usage?subscription={sid}", headers=admin)).json()
    assert [x["id"] for x in by_sub] == [rec["id"]]
    # unrated filter includes it; rated filter excludes it (it's still unrated)
    unrated_ids = {x["id"] for x in (await client.get(f"/api/usage?subscription={sid}&rated=false", headers=admin)).json()}
    rated_ids = {x["id"] for x in (await client.get(f"/api/usage?subscription={sid}&rated=true", headers=admin)).json()}
    assert rec["id"] in unrated_ids and rec["id"] not in rated_ids


# ===================== rating bridge =====================

async def test_rating_bridge_creates_invoice_and_flags_usage(client, admin):
    sid = (await _subscription(client, admin))["id"]
    a = (await client.post("/api/usage", headers=admin, json={
        "metric": "gb", "quantity": 10, "unit_rate": 50, "subscription_id": sid})).json()        # 500
    b = (await client.post("/api/usage", headers=admin, json={
        "metric": "minutes", "quantity": 30, "unit_rate": 100, "subscription_id": sid})).json()  # 3000

    rated = await client.post("/api/usage/rate", headers=admin, json={"subscription_id": sid})
    assert rated.status_code == 201
    out = rated.json()
    inv = out["invoice"]
    assert out["usage_rated"] == 2
    assert inv["status"] == "DRAFT" and len(inv["lines"]) == 2
    assert inv["total"] == 500 + 3000                                  # Σ of the charge lines

    # both usage rows now read rated + linked to that invoice
    listed = {x["id"]: x for x in (await client.get(f"/api/usage?subscription={sid}", headers=admin)).json()}
    for uid in (a["id"], b["id"]):
        assert listed[uid]["rated"] is True and listed[uid]["invoice_id"] == inv["id"]

    # re-running with no new unrated usage adds nothing → 409, the invoice is unchanged
    again = await client.post("/api/usage/rate", headers=admin, json={"subscription_id": sid})
    assert again.status_code == 409
    inv_now = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert len(inv_now["lines"]) == 2 and inv_now["total"] == 3500


async def test_rate_into_existing_draft_then_refuse_non_draft(client, admin):
    sid = (await _subscription(client, admin, amount=2000))["id"]
    # a generated DRAFT already carries the plan line (2000 luma)
    draft = (await client.post(f"/api/subscriptions/{sid}/generate-invoice", headers=admin)).json()
    await client.post("/api/usage", headers=admin, json={
        "metric": "gb", "quantity": 1, "unit_rate": 800, "subscription_id": sid})              # 800

    rated = (await client.post("/api/usage/rate", headers=admin,
                               json={"subscription_id": sid, "invoice_id": draft["id"]})).json()
    inv = rated["invoice"]
    assert len(inv["lines"]) == 2 and inv["total"] == 2000 + 800       # plan line + usage line

    # issue it, log fresh usage, then rating into the now-ISSUED invoice is refused → 409
    issued = (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)).json()
    await client.post("/api/usage", headers=admin, json={
        "metric": "gb", "quantity": 1, "unit_rate": 100, "subscription_id": sid})
    assert (await client.post("/api/usage/rate", headers=admin,
                              json={"subscription_id": sid, "invoice_id": issued["id"]})).status_code == 409


# ===================== scope / permission / tenant =====================

async def test_agent_has_no_usage_access(client, admin, agent):
    assert (await client.get("/api/usage", headers=agent)).status_code == 403
    assert (await client.post("/api/usage", headers=agent,
                              json={"metric": "gb", "quantity": 1, "unit_rate": 1})).status_code == 403
    # rating is gated too: the subscription exists in-tenant, but the agent lacks usage.edit → 403
    sid = (await _subscription(client, admin))["id"]
    assert (await client.post("/api/usage/rate", headers=agent,
                              json={"subscription_id": sid})).status_code == 403


async def test_usage_tenant_isolation(client, admin):
    # a usage row belonging to another tenant never surfaces in this tenant's list
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        sub = Subscription(tenant_id=other.id, plan_name="foreign", amount=1, cycle="monthly", status="ACTIVE")
        s.add(sub)
        await s.flush()
        s.add(UsageRecord(tenant_id=other.id, subscription_id=sub.id, metric="gb",
                          quantity=1, unit_rate=1, amount=1, rated=False))
        await s.commit()
        foreign_sub_id = str(sub.id)
    assert (await client.get(f"/api/usage?subscription={foreign_sub_id}", headers=admin)).json() == []
