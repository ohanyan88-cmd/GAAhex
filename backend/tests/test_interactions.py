"""Coverage for contact-center interactions (interactions.py).

Logged touchpoints (channel/direction/customer), tenant + org scoped (`interaction.*`), each write
emits an audit Event. List is newest-first and gated on customer.view when filtered by a customer.
Edit is author-only. Unique markers per test (shared session DB accumulates).
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, OrgNode, RoleDef, Assignment, Event, Tenant
from app.models.interaction import Interaction


async def _customer(client, admin, name):
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _grant_agent_interaction():
    """Give the agent interaction.view+create at its team node (isolated; only affects interactions).
    Idempotent — safe to call from multiple tests."""
    async with SessionLocal() as s:
        agent = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one()
        existing = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == agent.tenant_id, RoleDef.key == "interaction_agent_role")
        )).scalar_one_or_none()
        if existing:
            return
        team = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == agent.tenant_id, OrgNode.code == "sales1"))).scalar_one()
        role = RoleDef(tenant_id=agent.tenant_id, key="interaction_agent_role", label="interaction agent",
                       scope="node", permissions=["interaction.view", "interaction.create"])
        s.add(role)
        await s.flush()
        s.add(Assignment(tenant_id=agent.tenant_id, user_id=agent.id, role_id=role.id, node_id=team.id))
        await s.commit()


# ===================== log + list + audit =====================

async def test_log_list_filter_newest_first_and_audit(client, admin):
    cust = await _customer(client, admin, "Int Cust 1")
    first = (await client.post("/api/interactions", headers=admin, json={
        "channel": "call", "direction": "inbound", "customer_id": cust, "body": "first",
        "occurred_at": "2026-01-01T10:00:00+00:00"})).json()
    second = (await client.post("/api/interactions", headers=admin, json={
        "channel": "email", "direction": "outbound", "customer_id": cust, "body": "second",
        "occurred_at": "2026-01-01T11:00:00+00:00"})).json()

    listed = (await client.get(f"/api/interactions?customer={cust}", headers=admin)).json()
    assert [x["id"] for x in listed] == [second["id"], first["id"]]      # newest first

    by_channel = (await client.get(f"/api/interactions?customer={cust}&channel=call", headers=admin)).json()
    assert [x["id"] for x in by_channel] == [first["id"]]

    # an audit Event was emitted
    async with SessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.record_id == uuid.UUID(first["id"]), Event.entity_key == "interaction")
        )).scalars().all()
    assert any(e.type == "create" for e in evs)


async def test_bad_channel_direction_body_422(client, admin):
    cust = await _customer(client, admin, "Int Cust 2")
    assert (await client.post("/api/interactions", headers=admin, json={
        "channel": "smoke", "direction": "inbound", "body": "x", "customer_id": cust})).status_code == 422
    assert (await client.post("/api/interactions", headers=admin, json={
        "channel": "call", "direction": "sideways", "body": "x", "customer_id": cust})).status_code == 422
    assert (await client.post("/api/interactions", headers=admin, json={
        "channel": "call", "direction": "inbound", "body": "   ", "customer_id": cust})).status_code == 422


# ===================== edit (author only) + delete =====================

async def test_edit_author_only_and_delete(client, admin, agent):
    cust = await _customer(client, admin, "Int Cust 3")
    x = (await client.post("/api/interactions", headers=admin, json={
        "channel": "note", "direction": "internal", "customer_id": cust, "body": "draft"})).json()
    xid = x["id"]

    # author edits subject/body
    edited = await client.patch(f"/api/interactions/{xid}", headers=admin, json={"subject": "Sub", "body": "final"})
    assert edited.status_code == 200 and edited.json()["body"] == "final"
    # unknown key / empty body → 422
    assert (await client.patch(f"/api/interactions/{xid}", headers=admin, json={"channel": "call"})).status_code == 422
    assert (await client.patch(f"/api/interactions/{xid}", headers=admin, json={"body": " "})).status_code == 422
    # a non-author cannot edit (author check is independent of perms)
    assert (await client.patch(f"/api/interactions/{xid}", headers=agent, json={"body": "hax"})).status_code == 403

    # author deletes
    assert (await client.delete(f"/api/interactions/{xid}", headers=admin)).status_code == 204
    assert (await client.get(f"/api/interactions/{xid}", headers=admin)).status_code == 404


# ===================== scope (customer view gate) + tenant isolation =====================

async def test_list_for_unviewable_customer_403(client, admin, agent):
    await _grant_agent_interaction()                       # agent now has interaction.view, but not customer.view @ grp
    hq_cust = await _customer(client, admin, "Int HQ Cust")
    # listing interactions for a customer the agent can't view → 403 (customer.view gate)
    assert (await client.get(f"/api/interactions?customer={hq_cust}", headers=agent)).status_code == 403


@pytest.mark.xfail(reason="BUG: create_interaction gates interaction.create but never checks "
                          "customer.view, so an agent can LOG an interaction against a customer "
                          "outside its scope (list IS gated — the two are inconsistent).",
                   strict=False)
async def test_log_for_unviewable_customer_403(client, admin, agent):
    await _grant_agent_interaction()
    hq_cust = await _customer(client, admin, "Int HQ Cust 2")
    # logging against a customer the caller can't view should be refused (403), same as listing
    r = await client.post("/api/interactions", headers=agent, json={
        "channel": "call", "direction": "inbound", "body": "x", "customer_id": hq_cust})
    assert r.status_code == 403


async def test_tenant_isolation(client, admin):
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        u2 = User(tenant_id=other.id, email=f"u2-{uuid.uuid4().hex[:8]}@x.io", name="U2", password_hash="x")
        s.add(u2)
        await s.flush()
        x = Interaction(tenant_id=other.id, agent_user_id=u2.id, channel="call", direction="inbound",
                        body="foreign", occurred_at=datetime.now(timezone.utc))
        s.add(x)
        await s.commit()
        foreign_id = str(x.id)
    # never another tenant's data
    assert (await client.get(f"/api/interactions/{foreign_id}", headers=admin)).status_code == 404
