"""Deeper coverage of workflow transitions + the audit trail.

Exercises the seeded Lead lifecycle (NEW→CONTACTED→QUALIFIED→CONVERTED, guarded NEW→CONTACTED by a
phone GXL guard) and asserts every mutation emits exactly one chronologically-ordered Event with the
right type/from/to/actor. Delete events are read straight from the Event table via SessionLocal,
since the record (and thus /history) is gone after a delete.
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, Event


async def _admin_id() -> str:
    async with SessionLocal() as s:
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        return str(admin.id)


async def _events_for(record_id: str):
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(Event).where(Event.record_id == uuid.UUID(record_id)).order_by(Event.created_at)
        )).scalars().all()
        return [(e.type, e.data, str(e.actor_user_id) if e.actor_user_id else None) for e in rows]


# ---- multi-step happy path across the full lifecycle ----

async def test_full_lifecycle_and_history(client, admin):
    admin_id = await _admin_id()
    lead = (await client.post("/api/leads", headers=admin, json={"name": "Lifecycle", "phone": "+37491000"})).json()
    lid = lead["id"]
    assert lead["status"] == "NEW"

    steps = ["CONTACTED", "QUALIFIED", "CONVERTED"]
    prev = "NEW"
    for to in steps:
        r = await client.post(f"/api/leads/{lid}/transition", headers=admin, json={"to": to})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == to
        prev = to

    history = (await client.get(f"/api/leads/{lid}/history", headers=admin)).json()
    # one create + three transitions, in order
    assert [e["type"] for e in history] == ["CREATE", "TRANSITION", "TRANSITION", "TRANSITION"]
    transitions = [e for e in history if e["type"] == "TRANSITION"]
    assert [(e["data"]["from"], e["data"]["to"]) for e in transitions] == [
        ("NEW", "CONTACTED"), ("CONTACTED", "QUALIFIED"), ("QUALIFIED", "CONVERTED"),
    ]
    # actor is the admin on every event
    assert all(e["actor_user_id"] == admin_id for e in history)


# ---- guard pass vs fail on the SAME edge ----

async def test_guard_pass_and_fail_same_edge(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "Guarded"})).json()
    lid = lead["id"]
    # no phone yet → NEW->CONTACTED guard fails → 422
    fail = await client.post(f"/api/leads/{lid}/transition", headers=admin, json={"to": "CONTACTED"})
    assert fail.status_code == 422
    # add a phone, same edge now passes
    assert (await client.patch(f"/api/leads/{lid}", headers=admin, json={"phone": "+37499123"})).status_code == 200
    ok = await client.post(f"/api/leads/{lid}/transition", headers=admin, json={"to": "CONTACTED"})
    assert ok.status_code == 200 and ok.json()["status"] == "CONTACTED"

    # the failed attempt emitted NO transition event; only the successful one did
    history = (await client.get(f"/api/leads/{lid}/history", headers=admin)).json()
    transition_events = [e for e in history if e["type"] == "TRANSITION"]
    assert len(transition_events) == 1
    assert (transition_events[0]["data"]["from"], transition_events[0]["data"]["to"]) == ("NEW", "CONTACTED")


# ---- a transition emits exactly one event ----

async def test_transition_emits_single_event(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "Single", "phone": "+37411"})).json()
    lid = lead["id"]
    before = sum(1 for t, _, _ in await _events_for(lid) if t == "TRANSITION")
    assert (await client.post(f"/api/leads/{lid}/transition", headers=admin, json={"to": "CONTACTED"})).status_code == 200
    after = sum(1 for t, _, _ in await _events_for(lid) if t == "TRANSITION")
    assert after - before == 1


# ---- create / update / delete each emit their event type ----

async def test_crud_event_types_and_actor(client, admin):
    admin_id = await _admin_id()
    lead = (await client.post("/api/leads", headers=admin, json={"name": "CRUD"})).json()
    lid = lead["id"]
    await client.patch(f"/api/leads/{lid}", headers=admin, json={"phone": "+37412"})
    assert (await client.delete(f"/api/leads/{lid}", headers=admin)).status_code == 204

    # record is gone, so read events directly from the audit table
    events = await _events_for(lid)
    assert [t for t, _, _ in events] == ["CREATE", "UPDATE", "DELETE"]
    assert all(actor == admin_id for _, _, actor in events)


# ---- history ordering is chronological ----

async def test_history_chronological_ordering(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "Ordered"})).json()
    lid = lead["id"]
    await client.patch(f"/api/leads/{lid}", headers=admin, json={"phone": "+37413"})
    await client.patch(f"/api/leads/{lid}", headers=admin, json={"email": "o@x.io"})
    await client.post(f"/api/leads/{lid}/transition", headers=admin, json={"to": "CONTACTED"})

    history = (await client.get(f"/api/leads/{lid}/history", headers=admin)).json()
    assert [e["type"] for e in history] == ["CREATE", "UPDATE", "UPDATE", "TRANSITION"]
    ats = [e["at"] for e in history]
    assert ats == sorted(ats)   # non-decreasing timestamps
