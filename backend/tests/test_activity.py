"""Coverage for the activity feed / timeline (activity.py).

Read-only over the immutable Event log. Two modes on GET /api/activity:
  - record timeline (entity + record): one record's events chronologically, with actor_name + summary;
    403 when the caller can't view the record.
  - global feed (no record): newest-first events across viewable entities, org-scope filtered.

Shared session DB accumulates; assertions key on ids/records this test creates (newest → in-window).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Tenant, Record, Event, User


async def _feed(client, headers, query=""):
    r = await client.get(f"/api/activity{query}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# ===================== record timeline =====================

async def test_record_timeline_chronological_with_summaries(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "Timeline", "phone": "+37491"})).json()
    lid = lead["id"]
    await client.patch(f"/api/leads/{lid}", headers=admin, json={"email": "t@x.io"})
    await client.post(f"/api/leads/{lid}/transition", headers=admin, json={"to": "validated_lead"})
    await client.post(f"/api/records/leads/{lid}/comments", headers=admin, json={"body": "hi"})

    items = await _feed(client, admin, f"?entity=leads&record={lid}")
    assert [it["type"] for it in items] == ["CREATE", "UPDATE", "TRANSITION", "COMMENT"]
    summaries = {it["type"]: it["summary"] for it in items}
    assert summaries["CREATE"] == "created this lead"
    assert summaries["UPDATE"] == "updated email"
    assert summaries["TRANSITION"] == "moved lead → validated_lead"
    assert summaries["COMMENT"] == "commented"
    assert all(it["actor_name"] == "Demo Admin" for it in items)
    ats = [it["at"] for it in items]
    assert ats == sorted(ats)                                   # chronological


async def test_record_timeline_access(client, admin, agent):
    hq = (await client.post("/api/leads", headers=admin, json={"name": "HQ timeline"})).json()
    # agent can't view a group-owned record → 403
    r = await client.get(f"/api/activity?entity=leads&record={hq['id']}", headers=agent)
    assert r.status_code == 403
    # unknown record → 404
    assert (await client.get(f"/api/activity?entity=leads&record={uuid.uuid4()}", headers=admin)).status_code == 404
    # record without entity → 422
    assert (await client.get(f"/api/activity?record={hq['id']}", headers=admin)).status_code == 422


# ===================== global feed =====================

async def test_global_feed_scope_and_view_gate(client, admin, agent):
    tok = "actfeed"
    hq_lead = (await client.post("/api/leads", headers=admin, json={"name": f"{tok} hq"})).json()["id"]
    team_lead = (await client.post("/api/leads", headers=agent, json={"name": f"{tok} team"})).json()["id"]
    ticket = (await client.post("/api/tickets", headers=admin, json={"subject": f"{tok} tkt"})).json()["id"]

    agent_records = {it["record_id"] for it in await _feed(client, agent)}
    assert team_lead in agent_records                            # own team record
    assert hq_lead not in agent_records                          # out-of-scope (group-owned)
    assert ticket not in agent_records                           # entity it can't view

    admin_records = {it["record_id"] for it in await _feed(client, admin)}
    assert {hq_lead, team_lead, ticket} <= admin_records         # admin sees all of them


async def test_global_feed_newest_first_and_limit(client, admin):
    for i in range(3):
        await client.post("/api/leads", headers=admin, json={"name": f"actorder {i}"})
    feed = await _feed(client, admin)
    ats = [it["at"] for it in feed]
    assert ats == sorted(ats, reverse=True)                      # newest first

    limited = await _feed(client, admin, "?limit=2")
    assert len(limited) == 2                                     # respects limit


async def test_global_feed_tenant_isolated(client, admin):
    tok = "actiso"
    mine = (await client.post("/api/leads", headers=admin, json={"name": f"{tok} mine"})).json()["id"]
    # a foreign-tenant record + event, inserted directly
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        rec = Record(tenant_id=other.id, entity_key="lead", owner_node_id=None, status="lead", data={"name": f"{tok} foreign"})
        s.add(rec)
        await s.flush()
        ev = Event(tenant_id=other.id, type="create", entity_key="lead", record_id=rec.id, actor_user_id=None, data={})
        s.add(ev)
        await s.commit()
        foreign_event_id, foreign_record_id = str(ev.id), str(rec.id)

    feed = await _feed(client, admin)
    ids = {it["id"] for it in feed}
    records = {it["record_id"] for it in feed}
    assert mine in records
    assert foreign_event_id not in ids and foreign_record_id not in records
