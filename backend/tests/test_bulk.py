"""Coverage for bulk operations: POST /api/{slug}/bulk (bulk.py).

Each id is processed + committed independently (partial-failure model): a forbidden / guard-failed /
not-found id fails only itself with a reason, the rest proceed — never an all-or-nothing 500. The
response carries per-id results + a {requested, succeeded, failed} summary. Unique markers per test.
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Event


def _by_id(resp_json):
    return {str(r["id"]): r for r in resp_json["results"]}


async def _events_for(record_id, type_):
    async with SessionLocal() as s:
        return (await s.execute(
            select(Event).where(Event.record_id == uuid.UUID(record_id), Event.type == type_)
        )).scalars().all()


# ===================== bulk delete =====================

async def test_bulk_delete_subset(client, admin):
    ids = [(await client.post("/api/leads", headers=admin, json={"name": f"bulkdel {i}"})).json()["id"]
           for i in range(4)]
    target = ids[:2]

    r = await client.post("/api/leads/bulk", headers=admin, json={"action": "delete", "ids": target})
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == {"requested": 2, "succeeded": 2, "failed": 0}
    assert all(e["ok"] for e in body["results"])

    # deleted ones are gone (+ a delete Event each); the rest remain
    for d in target:
        assert (await client.get(f"/api/leads/{d}", headers=admin)).status_code == 404
        assert len(await _events_for(d, "DELETE")) == 1
    for keep in ids[2:]:
        assert (await client.get(f"/api/leads/{keep}", headers=admin)).status_code == 200


# ===================== bulk transition (partial failure) =====================

async def test_bulk_transition_partial_failure(client, admin):
    p1 = (await client.post("/api/leads", headers=admin, json={"name": "bt ok1", "phone": "+37411"})).json()["id"]
    p2 = (await client.post("/api/leads", headers=admin, json={"name": "bt ok2", "phone": "+37412"})).json()["id"]
    np = (await client.post("/api/leads", headers=admin, json={"name": "bt noguard"})).json()["id"]   # no phone → guard fails
    missing = str(uuid.uuid4())

    r = await client.post("/api/leads/bulk", headers=admin,
                          json={"action": "transition", "to": "CONTACTED", "ids": [p1, p2, np, missing, "not-a-uuid"]})
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == {"requested": 5, "succeeded": 2, "failed": 3}
    res = _by_id(body)
    assert res[p1]["ok"] is True and res[p2]["ok"] is True
    assert res[np]["ok"] is False and "Guard" in res[np]["error"]       # guard failure, only this id
    assert res[missing]["ok"] is False                                  # not found
    assert res["not-a-uuid"]["ok"] is False                             # invalid id

    # the two valid ones actually moved; the guard-failed one stayed put
    assert (await client.get(f"/api/leads/{p1}", headers=admin)).json()["status"] == "CONTACTED"
    assert (await client.get(f"/api/leads/{np}", headers=admin)).json()["status"] == "NEW"


# ===================== guardrails =====================

async def test_bulk_guardrails(client, admin):
    # unknown action → 422
    assert (await client.post("/api/leads/bulk", headers=admin,
                              json={"action": "frobnicate", "ids": []})).status_code == 422
    # transition without `to` → 422
    assert (await client.post("/api/leads/bulk", headers=admin,
                              json={"action": "transition", "ids": []})).status_code == 422
    # ids not a list → 422
    assert (await client.post("/api/leads/bulk", headers=admin,
                              json={"action": "delete", "ids": "nope"})).status_code == 422
    # > 200 ids → 422
    too_many = [str(uuid.uuid4()) for _ in range(201)]
    assert (await client.post("/api/leads/bulk", headers=admin,
                              json={"action": "delete", "ids": too_many})).status_code == 422
    # unknown entity slug → 404
    assert (await client.post("/api/not-an-entity/bulk", headers=admin,
                              json={"action": "delete", "ids": []})).status_code == 404


# ===================== agent scope: per-id 403, not a global 500 =====================

async def test_bulk_agent_forbidden_per_id(client, admin, agent):
    # admin-owned (group) leads; the agent has no lead.delete and is out of scope
    ids = [(await client.post("/api/leads", headers=admin, json={"name": f"bulkfb {i}"})).json()["id"]
           for i in range(2)]
    r = await client.post("/api/leads/bulk", headers=agent, json={"action": "delete", "ids": ids})
    assert r.status_code == 200                                         # batch itself doesn't 500
    body = r.json()
    assert body["summary"]["succeeded"] == 0 and body["summary"]["failed"] == 2
    assert all((not e["ok"]) and "Not allowed" in e["error"] for e in body["results"])
    # and nothing was actually deleted
    for i in ids:
        assert (await client.get(f"/api/leads/{i}", headers=admin)).status_code == 200


# ===================== approval-flagged transition parks per id =====================

async def test_bulk_transition_parks_on_approval(client, admin):
    body = {
        "key": "bulkappr", "label": "BulkAppr", "label_plural": "BulkApprs", "route_slug": "bulk-appr", "icon": "x",
        "fields": [{"key": "name", "label": "Name", "type": "text", "required": True},
                   {"key": "status", "label": "Status", "type": "status"}],
        "statuses": [{"key": "OPEN", "label": "Open", "is_initial": True}, {"key": "DONE", "label": "Done"}],
        "transitions": [{"from": "OPEN", "to": "DONE", "guard": None, "approval": True}],
    }
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201

    ids = [(await client.post("/api/bulk-appr", headers=admin, json={"name": f"a{i}"})).json()["id"] for i in range(2)]
    r = await client.post("/api/bulk-appr/bulk", headers=admin,
                          json={"action": "transition", "to": "DONE", "ids": ids})
    assert r.status_code == 200
    body_r = r.json()
    assert body_r["summary"]["succeeded"] == 2
    for e in body_r["results"]:
        assert e["ok"] is True and e["pending_approval"]["status"] == "PENDING"
    # records are parked, not moved
    for i in ids:
        assert (await client.get(f"/api/bulk-appr/{i}", headers=admin)).json()["status"] == "OPEN"
