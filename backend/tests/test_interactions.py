"""Coverage for interaction as a config-driven entity (entity_key='interaction').

Interactions are now stored in the generic `record` table and served by the generic
/api/{slug} records router at /api/interactions. The dedicated bespoke router has been
retired. Tests verify CRUD via the generic API and that the config entity was seeded.
"""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import EntityDef, FieldDef, Tenant
from app.seed_catalog import seed_entity_if_missing


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _seed_interaction_entity():
    """Seed only the interaction config entity before running these tests. Idempotent."""
    await seed_entity_if_missing("interaction")


# ===================== entity config =====================

async def test_interaction_entity_seeded(client, admin):
    """The interaction EntityDef must exist for every tenant after seed_catalog runs."""
    async with OwnerSessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()
        for tenant in tenants:
            ent = (await s.execute(
                select(EntityDef).where(
                    EntityDef.tenant_id == tenant.id,
                    EntityDef.key == "interaction",
                )
            )).scalar_one_or_none()
            assert ent is not None, f"interaction EntityDef missing for tenant {tenant.id}"
            assert ent.route_slug == "interactions"
            fields = (await s.execute(
                select(FieldDef).where(FieldDef.entity_def_id == ent.id)
            )).scalars().all()
            field_keys = {f.key for f in fields}
            assert {"channel", "direction", "body", "customer", "occurred_at"}.issubset(field_keys)


# ===================== CRUD via generic records API =====================

async def _customer(client, admin, name):
    r = await client.post("/api/customers", headers=admin, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_create_and_list_interaction(client, admin):
    """POST /api/interactions creates a record; GET /api/interactions lists it."""
    cust = await _customer(client, admin, "IntGenCust1")
    r = await client.post("/api/interactions", headers=admin, json={
        "channel": "call",
        "direction": "inbound",
        "body": "Called about billing.",
        "customer": cust,
        "occurred_at": "2026-01-01T10:00:00+00:00",
    })
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["channel"] == "call"
    assert created["body"] == "Called about billing."
    assert created["customer"] == cust

    listed = (await client.get("/api/interactions", headers=admin)).json()
    ids = [x["id"] for x in listed]
    assert created["id"] in ids


async def test_filter_by_customer(client, admin):
    """GET /api/interactions?filter=customer=='<id>' returns only that customer's interactions."""
    cust_a = await _customer(client, admin, "IntGenCustA")
    cust_b = await _customer(client, admin, "IntGenCustB")

    r_a = await client.post("/api/interactions", headers=admin, json={
        "channel": "email", "direction": "outbound", "body": "Note for A", "customer": cust_a,
    })
    assert r_a.status_code == 201
    r_b = await client.post("/api/interactions", headers=admin, json={
        "channel": "chat", "direction": "inbound", "body": "Note for B", "customer": cust_b,
    })
    assert r_b.status_code == 201

    import urllib.parse
    filt = urllib.parse.quote(f"customer == '{cust_a}'")
    listed = (await client.get(f"/api/interactions?filter={filt}", headers=admin)).json()
    assert all(x.get("customer") == cust_a for x in listed)
    ids = [x["id"] for x in listed]
    assert r_a.json()["id"] in ids
    assert r_b.json()["id"] not in ids


async def test_body_required(client, admin):
    """Creating an interaction without the required `body` field returns 422."""
    r = await client.post("/api/interactions", headers=admin, json={
        "channel": "call", "direction": "inbound",
    })
    assert r.status_code == 422, r.text


async def test_get_and_patch_interaction(client, admin):
    """GET and PATCH a single interaction record."""
    r = await client.post("/api/interactions", headers=admin, json={
        "channel": "note", "direction": "internal", "body": "initial note",
    })
    assert r.status_code == 201
    rid = r.json()["id"]

    got = (await client.get(f"/api/interactions/{rid}", headers=admin)).json()
    assert got["id"] == rid
    assert got["body"] == "initial note"

    patched = await client.patch(f"/api/interactions/{rid}", headers=admin, json={"body": "updated note"})
    assert patched.status_code == 200
    assert patched.json()["body"] == "updated note"


async def test_delete_interaction(client, admin):
    """DELETE removes the record; subsequent GET returns 404."""
    r = await client.post("/api/interactions", headers=admin, json={
        "channel": "sms", "direction": "outbound", "body": "to delete",
    })
    assert r.status_code == 201
    rid = r.json()["id"]

    del_r = await client.delete(f"/api/interactions/{rid}", headers=admin)
    assert del_r.status_code == 204

    assert (await client.get(f"/api/interactions/{rid}", headers=admin)).status_code == 404
