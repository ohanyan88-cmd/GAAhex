"""Coverage for the SuperAdmin Studio config-write: POST /meta/entities.

A super_admin defines a whole entity (fields + statuses + transitions) from the API; the engine
creates the EntityDef + FieldDefs + StatusDefs + WorkflowDef + the permission catalog, so CRUD,
workflow, audit and access all work immediately with NO server restart. The killer test via API.

The session DB persists across files, so every entity here uses a UNIQUE key/slug (and must avoid
'project'/'projects', which test_api.py already creates).
"""

from sqlalchemy import select

# app modules are import-safe here: conftest set DATABASE_URL to the test DB before any app import,
# so SessionLocal is bound to gaahex_test.
from app.db import SessionLocal
from app.models import PermissionDef


def _entity_body(key, slug, label):
    return {
        "key": key, "label": label, "label_plural": f"{label}s", "route_slug": slug, "icon": "file",
        "fields": [
            {"key": "number", "label": "Number", "type": "text", "required": True},
            {"key": "kind", "label": "Kind", "type": "select", "required": False,
             "config": {"options": ["Standard", "Credit"]}},
            {"key": "status", "label": "Status", "type": "status"},
        ],
        "statuses": [
            {"key": "DRAFT", "label": "Draft", "is_initial": True},
            {"key": "SENT", "label": "Sent"},
        ],
        "transitions": [{"from": "DRAFT", "to": "SENT", "guard": None}],
    }


# ---- create entity end-to-end ----

async def test_create_entity_shows_in_meta(client, admin):
    body = _entity_body("invoice", "invoices", "Invoice")
    r = await client.post("/meta/entities", headers=admin, json=body)
    assert r.status_code == 201, r.text

    # it now appears in the entity list
    slugs = {e["route_slug"] for e in (await client.get("/meta/entities", headers=admin)).json()}
    assert "invoices" in slugs

    # and its full definition is renderable by the interpreter
    d = (await client.get("/meta/entities/invoices", headers=admin)).json()
    assert d["key"] == "invoice"
    assert {f["key"] for f in d["fields"]} == {"number", "kind", "status"}
    assert {s["key"] for s in d["statuses"]} == {"DRAFT", "SENT"}
    assert any(s["is_initial"] and s["key"] == "DRAFT" for s in d["statuses"])
    assert {"from": "DRAFT", "to": "SENT"} in d["transitions"]


# ---- it immediately works across all kernel engines ----

async def test_new_entity_full_lifecycle_no_restart(client, admin):
    assert (await client.post("/meta/entities", headers=admin,
                              json=_entity_body("shipment", "shipments", "Shipment"))).status_code == 201

    # create — initial status forced to DRAFT
    rec = (await client.post("/api/shipments", headers=admin, json={"number": "SHP-1", "kind": "Standard"})).json()
    assert rec["status"] == "DRAFT" and rec["number"] == "SHP-1"

    # list — the new record is there
    ids = {r["id"] for r in (await client.get("/api/shipments", headers=admin)).json()}
    assert rec["id"] in ids

    # transition along the defined edge
    moved = await client.post(f"/api/shipments/{rec['id']}/transition", headers=admin, json={"to": "SENT"})
    assert moved.status_code == 200 and moved.json()["status"] == "SENT"

    # audit trail captured both mutations
    history = (await client.get(f"/api/shipments/{rec['id']}/history", headers=admin)).json()
    assert [e["type"] for e in history] == ["CREATE", "TRANSITION"]

    # validation from config still applies (bad select value rejected)
    bad = await client.post("/api/shipments", headers=admin, json={"number": "X", "kind": "Telepathy"})
    assert bad.status_code == 422


# ---- permission catalog wired ----

async def test_permission_catalog_created_and_enforced(client, admin, agent):
    assert (await client.post("/meta/entities", headers=admin,
                              json=_entity_body("asset", "assets", "Asset"))).status_code == 201

    # the four-verb permission catalog now exists in the DB
    async with SessionLocal() as s:
        keys = {p.key for p in (await s.execute(
            select(PermissionDef).where(PermissionDef.key.like("asset.%"))
        )).scalars().all()}
    assert {"asset.view", "asset.create", "asset.edit", "asset.delete"} <= keys

    # super_admin (perms ["*"]) can act on it
    created = await client.post("/api/assets", headers=admin, json={"number": "A-1"})
    assert created.status_code == 201

    # a non-privileged user (agent) has no grant for it → default-deny
    assert (await client.get("/api/assets", headers=agent)).status_code == 403
    assert (await client.post("/api/assets", headers=agent, json={"number": "A-2"})).status_code == 403


# ---- guardrails ----

async def test_agent_cannot_create_entity(client, agent):
    body = _entity_body("forbidden_thing", "forbidden-things", "ForbiddenThing")
    assert (await client.post("/meta/entities", headers=agent, json=body)).status_code == 403


async def test_invalid_field_type_rejected(client, admin):
    body = _entity_body("badtype", "bad-types", "BadType")
    body["fields"].append({"key": "weird", "label": "Weird", "type": "rocketship"})
    r = await client.post("/meta/entities", headers=admin, json=body)
    assert r.status_code == 422
    # and the entity must NOT have been partially created
    assert "bad-types" not in {e["route_slug"] for e in (await client.get("/meta/entities", headers=admin)).json()}


async def test_duplicate_slug_rejected(client, admin):
    body = _entity_body("gizmo", "gizmos", "Gizmo")
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201
    # same key/slug again → conflict
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 409
