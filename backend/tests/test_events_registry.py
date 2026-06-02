"""Coverage for the /api/events registry — the Studio event picker source of truth.

The registry has to stay in lockstep with automations.ALLOWED_EVENT_TYPES; if a new generic
event type is added to the executor without a friendly label here, the WHEN dropdown would
show a blank option. Hence the explicit equality assertion below.
"""
from app.routers.automations import ALLOWED_EVENT_TYPES


# ---- /api/events/types ----

async def test_event_types_lists_all_generic_types(client, admin):
    r = await client.get("/api/events/types", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list) and len(body) == 4
    # every row has the contract shape, no nulls
    for row in body:
        assert set(row.keys()) >= {"type", "label", "description"}
        assert row["label"] and row["description"]
    # the surfaced types exactly mirror the executor's allow-list
    assert {row["type"] for row in body} == set(ALLOWED_EVENT_TYPES)


async def test_event_types_requires_auth(client):
    # no Authorization header → 401, not 200
    r = await client.get("/api/events/types")
    assert r.status_code == 401


# ---- /api/events/registry ----

async def test_event_registry_combines_generic_and_entity_transitions(client, admin):
    r = await client.get("/api/events/registry", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) == {"generic", "entities"}
    # generic mirrors /types
    assert {row["type"] for row in body["generic"]} == set(ALLOWED_EVENT_TYPES)
    # entities is a list (may be empty in a fresh tenant, but the shape is fixed)
    assert isinstance(body["entities"], list)
    for ent in body["entities"]:
        assert {"entity_key", "label", "transitions"} <= set(ent.keys())
        for t in ent["transitions"]:
            assert t["event_type"] == "TRANSITION"
            assert t["to"]   # every transition must land on a real status
            assert t["key"]
