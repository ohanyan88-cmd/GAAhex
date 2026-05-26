"""Coverage for record comments + threads (comm.py).

Comments are gated on the record's VIEW permission (same scope as records.py). A comment emits a
`comment` audit Event. Threads: a user sees threads they created or record-linked threads whose
record they can view. The shared session DB accumulates, so assertions key on ids we create.

Seeded recap: admin = super_admin (records owned by group `grp`); agent = sales_agent @ node
`grp.yerevan.sales1` (can view leads in its own subtree only). admin name "Demo Admin".
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Tenant, Record


def _ids(items):
    return {x["id"] for x in items}


# ---- add + list comments ----

async def test_add_and_list_comments_chronological(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "Commented"})).json()
    lid = lead["id"]

    c1 = await client.post(f"/api/records/leads/{lid}/comments", headers=admin, json={"body": "first"})
    assert c1.status_code == 201
    assert c1.json()["body"] == "first" and c1.json()["author_name"] == "Demo Admin"
    assert (await client.post(f"/api/records/leads/{lid}/comments", headers=admin, json={"body": "second"})).status_code == 201

    listing = (await client.get(f"/api/records/leads/{lid}/comments", headers=admin)).json()
    assert [m["body"] for m in listing] == ["first", "second"]          # chronological
    assert all(m["author_name"] == "Demo Admin" for m in listing)


async def test_blank_body_rejected(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "NoBody"})).json()
    lid = lead["id"]
    for bad in ({"body": ""}, {"body": "   "}, {}):
        assert (await client.post(f"/api/records/leads/{lid}/comments", headers=admin, json=bad)).status_code == 422


async def test_comment_emits_history_event(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "AuditComment"})).json()
    lid = lead["id"]
    await client.post(f"/api/records/leads/{lid}/comments", headers=admin, json={"body": "noted"})
    types = [e["type"] for e in (await client.get(f"/api/leads/{lid}/history", headers=admin)).json()]
    assert "comment" in types


# ---- scope ----

async def test_comments_respect_record_scope(client, admin, agent):
    # group-owned lead — agent (node scope) cannot view it
    hq = (await client.post("/api/leads", headers=admin, json={"name": "HQ thread"})).json()
    assert (await client.get(f"/api/records/leads/{hq['id']}/comments", headers=agent)).status_code == 403
    assert (await client.post(f"/api/records/leads/{hq['id']}/comments", headers=agent, json={"body": "x"})).status_code == 403

    # agent CAN comment on its own (team-owned) record
    own = (await client.post("/api/leads", headers=agent, json={"name": "Team thread"})).json()
    assert (await client.post(f"/api/records/leads/{own['id']}/comments", headers=agent, json={"body": "mine"})).status_code == 201


async def test_comments_tenant_isolated(client, admin):
    # a record in another tenant is invisible here → 404 (never another tenant's data)
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        rec = Record(tenant_id=other.id, entity_key="lead", owner_node_id=None, status="NEW", data={"name": "foreign"})
        s.add(rec)
        await s.commit()
        foreign_id = str(rec.id)
    assert (await client.get(f"/api/records/leads/{foreign_id}/comments", headers=admin)).status_code == 404
    assert (await client.post(f"/api/records/leads/{foreign_id}/comments", headers=admin, json={"body": "x"})).status_code == 404


# ---- threads ----

async def test_threads_visibility_and_messages(client, admin, agent):
    # admin creates a group-owned lead and comments → a record-thread (created_by admin)
    hq = (await client.post("/api/leads", headers=admin, json={"name": "ThreadOwner"})).json()
    await client.post(f"/api/records/leads/{hq['id']}/comments", headers=admin, json={"body": "kickoff"})

    admin_threads = (await client.get("/api/threads", headers=admin)).json()
    th = next(t for t in admin_threads if t["record_id"] == hq["id"])
    tid = th["id"]

    # agent cannot see that thread (can't view the record, didn't create it)
    assert tid not in {t["id"] for t in (await client.get("/api/threads", headers=agent)).json()}

    # admin can read + post messages on its own accessible thread
    msgs = (await client.get(f"/api/threads/{tid}/messages", headers=admin)).json()
    assert [m["body"] for m in msgs] == ["kickoff"]
    assert (await client.post(f"/api/threads/{tid}/messages", headers=admin, json={"body": "more"})).status_code == 201

    # agent is denied on that thread; blank body still 422 for the owner
    assert (await client.get(f"/api/threads/{tid}/messages", headers=agent)).status_code == 403
    assert (await client.post(f"/api/threads/{tid}/messages", headers=agent, json={"body": "x"})).status_code == 403
    assert (await client.post(f"/api/threads/{tid}/messages", headers=admin, json={"body": "  "})).status_code == 422

    # unknown thread id → 404
    assert (await client.get(f"/api/threads/{uuid.uuid4()}/messages", headers=admin)).status_code == 404


async def test_thread_visible_to_its_creator(client, agent):
    # an agent commenting on its own record gets a thread it created → visible in its thread list
    own = (await client.post("/api/leads", headers=agent, json={"name": "AgentOwnThread"})).json()
    await client.post(f"/api/records/leads/{own['id']}/comments", headers=agent, json={"body": "hi"})
    agent_threads = (await client.get("/api/threads", headers=agent)).json()
    assert any(t["record_id"] == own["id"] for t in agent_threads)
