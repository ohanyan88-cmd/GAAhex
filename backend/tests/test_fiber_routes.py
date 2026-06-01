"""NOC Phase C — Fiber route + outage path tests.

Covers:
  * CRUD round-trip (create, GET, PATCH, soft-delete)
  * Outage path linked to route
  * GET /fiber-routes/{id}/outage-paths returns linked paths
  * Status filter
  * Non-admin gets 403 on write
  * Duplicate soft-delete doesn't error
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.record import Record
from app.models.user import User


# ==========================================================================================
# helpers
# ==========================================================================================

async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u.tenant_id


async def _seed_outage_record(tenant_id: uuid.UUID) -> uuid.UUID:
    """Materialize a Record(entity_key='outage') and return its id."""
    async with SessionLocal() as s:
        rec = Record(
            tenant_id=tenant_id,
            entity_key="outage",
            status="open",
            data={"title": f"Outage-{uuid.uuid4().hex[:6]}"},
        )
        s.add(rec)
        await s.commit()
        return rec.id


# ==========================================================================================
# tests
# ==========================================================================================

@pytest.mark.asyncio
async def test_create_fiber_route(client, admin):
    r = await client.post(
        "/api/fiber-routes", headers=admin,
        json={"name": "Route-Alpha", "status": "active", "capacity_gbps": 100,
              "origin_pop": "POP-A", "destination_pop": "POP-B",
              "geo_path": "LINESTRING(44.5 40.2, 44.6 40.3)"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Route-Alpha"
    assert body["status"] == "active"
    assert body["capacity_gbps"] == 100
    assert body["origin_pop"] == "POP-A"
    assert body["destination_pop"] == "POP-B"
    assert body["geo_path"] == "LINESTRING(44.5 40.2, 44.6 40.3)"
    assert "id" in body


@pytest.mark.asyncio
async def test_get_fiber_route(client, admin):
    # Create
    create_r = await client.post(
        "/api/fiber-routes", headers=admin,
        json={"name": "Route-Beta", "status": "planned"},
    )
    assert create_r.status_code == 200, create_r.text
    route_id = create_r.json()["id"]

    # GET
    r = await client.get(f"/api/fiber-routes/{route_id}", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == route_id
    assert body["name"] == "Route-Beta"


@pytest.mark.asyncio
async def test_patch_fiber_route(client, admin):
    create_r = await client.post(
        "/api/fiber-routes", headers=admin,
        json={"name": "Route-Gamma", "status": "planned"},
    )
    assert create_r.status_code == 200, create_r.text
    route_id = create_r.json()["id"]

    patch_r = await client.patch(
        f"/api/fiber-routes/{route_id}", headers=admin,
        json={"status": "active", "capacity_gbps": 200},
    )
    assert patch_r.status_code == 200, patch_r.text
    body = patch_r.json()
    assert body["status"] == "active"
    assert body["capacity_gbps"] == 200


@pytest.mark.asyncio
async def test_soft_delete_fiber_route(client, admin):
    create_r = await client.post(
        "/api/fiber-routes", headers=admin,
        json={"name": "Route-Delta-delete", "status": "active"},
    )
    assert create_r.status_code == 200, create_r.text
    route_id = create_r.json()["id"]

    # First delete
    del_r = await client.delete(f"/api/fiber-routes/{route_id}", headers=admin)
    assert del_r.status_code == 200, del_r.text
    assert del_r.json()["status"] == "retired"


@pytest.mark.asyncio
async def test_duplicate_soft_delete_does_not_error(client, admin):
    """Calling DELETE twice on the same route is idempotent (both succeed)."""
    create_r = await client.post(
        "/api/fiber-routes", headers=admin,
        json={"name": "Route-Epsilon-dupe-del", "status": "active"},
    )
    assert create_r.status_code == 200, create_r.text
    route_id = create_r.json()["id"]

    r1 = await client.delete(f"/api/fiber-routes/{route_id}", headers=admin)
    assert r1.status_code == 200, r1.text
    r2 = await client.delete(f"/api/fiber-routes/{route_id}", headers=admin)
    # Already retired but route still exists — should succeed (idempotent)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "retired"


@pytest.mark.asyncio
async def test_outage_path_linked_to_route(client, admin):
    tenant_id = await _admin_tenant_id()
    outage_id = await _seed_outage_record(tenant_id)

    # Create a route
    route_r = await client.post(
        "/api/fiber-routes", headers=admin,
        json={"name": "Route-Zeta", "status": "cut"},
    )
    assert route_r.status_code == 200, route_r.text
    route_id = route_r.json()["id"]

    # Link outage path
    op_r = await client.post(
        "/api/outage-paths", headers=admin,
        json={
            "outage_record_id": str(outage_id),
            "fiber_route_id": route_id,
            "cut_location_wkt": "POINT(44.55 40.25)",
            "cut_distance_from_origin_m": 1500,
            "notes": "Excavation damage at km 1.5",
        },
    )
    assert op_r.status_code == 200, op_r.text
    body = op_r.json()
    assert body["outage_record_id"] == str(outage_id)
    assert body["fiber_route_id"] == route_id
    assert body["cut_location_wkt"] == "POINT(44.55 40.25)"
    assert body["cut_distance_from_origin_m"] == 1500


@pytest.mark.asyncio
async def test_get_fiber_route_outage_paths(client, admin):
    tenant_id = await _admin_tenant_id()
    outage_id = await _seed_outage_record(tenant_id)

    route_r = await client.post(
        "/api/fiber-routes", headers=admin,
        json={"name": "Route-Eta-paths", "status": "cut"},
    )
    route_id = route_r.json()["id"]

    # Add two outage paths
    await client.post("/api/outage-paths", headers=admin,
                      json={"outage_record_id": str(outage_id), "fiber_route_id": route_id,
                            "notes": "cut #1"})
    await client.post("/api/outage-paths", headers=admin,
                      json={"outage_record_id": str(outage_id), "fiber_route_id": route_id,
                            "notes": "cut #2"})

    r = await client.get(f"/api/fiber-routes/{route_id}/outage-paths", headers=admin)
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) >= 2
    assert all(item["fiber_route_id"] == route_id for item in items)


@pytest.mark.asyncio
async def test_status_filter(client, admin):
    # Create one planned and one active route
    await client.post("/api/fiber-routes", headers=admin,
                      json={"name": "Filter-Planned-XZ", "status": "planned"})
    await client.post("/api/fiber-routes", headers=admin,
                      json={"name": "Filter-Active-XZ", "status": "active"})

    r = await client.get("/api/fiber-routes?status=planned", headers=admin)
    assert r.status_code == 200, r.text
    items = r.json()
    assert all(item["status"] == "planned" for item in items)


@pytest.mark.asyncio
async def test_non_admin_create_fiber_route_returns_403(client, agent):
    r = await client.post(
        "/api/fiber-routes", headers=agent,
        json={"name": "Should-Fail", "status": "active"},
    )
    assert r.status_code == 403, r.text
