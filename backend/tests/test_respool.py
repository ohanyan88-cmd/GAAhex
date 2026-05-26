"""Coverage for IPAM / resource pools (respool.py).

A pool is a block (CIDR / range) you hand values out of; each allocation is one value, optionally
bound to a service. A partial unique index keeps a value single-ALLOCATED — re-allocating the same
value while live → 409; release flips it RELEASED (the row is KEPT for history) and frees the value
for re-use. Permissions resource_pool.* — admin via `*`, the seeded agent has none → 403. Tenant +
org scoped. Unique pool names per test (the shared session DB accumulates).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, Tenant
from app.models.respool import ResourcePool


async def _pool(client, admin, *, kind="ipv4", spec=None):
    name = f"Pool {uuid.uuid4().hex[:8]}"
    return await client.post("/api/resource-pools", headers=admin,
                             json={"name": name, "kind": kind, "spec": spec or {"cidr": "10.20.0.0/24"}})


# ===================== create + validation =====================

async def test_create_pool_and_validation(client, admin):
    r = await _pool(client, admin)
    assert r.status_code == 201
    p = r.json()
    assert p["kind"] == "ipv4" and p["spec"] == {"cidr": "10.20.0.0/24"} and p["allocated_count"] == 0

    # name required, bad kind, non-object spec → 422
    assert (await client.post("/api/resource-pools", headers=admin,
                              json={"name": "  ", "kind": "ipv4"})).status_code == 422
    assert (await client.post("/api/resource-pools", headers=admin,
                              json={"name": "X", "kind": "laser"})).status_code == 422
    assert (await client.post("/api/resource-pools", headers=admin,
                              json={"name": "X", "kind": "ipv4", "spec": "nope"})).status_code == 422


# ===================== allocate → dup → release → re-allocate =====================

async def test_allocate_dup_release_reallocate_and_log(client, admin):
    pid = (await _pool(client, admin)).json()["id"]

    a1 = await client.post(f"/api/resource-pools/{pid}/allocate", headers=admin, json={"value": "10.20.0.5"})
    assert a1.status_code == 201 and a1.json()["status"] == "ALLOCATED" and a1.json()["value"] == "10.20.0.5"

    # same value WHILE ALLOCATED → 409 (unique-while-allocated); empty value → 422
    assert (await client.post(f"/api/resource-pools/{pid}/allocate", headers=admin,
                              json={"value": "10.20.0.5"})).status_code == 409
    assert (await client.post(f"/api/resource-pools/{pid}/allocate", headers=admin,
                              json={"value": "  "})).status_code == 422

    # release → RELEASED (row kept)
    rel = await client.post(f"/api/resource-pools/{pid}/release", headers=admin, json={"value": "10.20.0.5"})
    assert rel.status_code == 200 and rel.json()["status"] == "RELEASED" and rel.json()["released_at"]

    # value is free again → re-allocate succeeds as a NEW row
    a2 = await client.post(f"/api/resource-pools/{pid}/allocate", headers=admin, json={"value": "10.20.0.5"})
    assert a2.status_code == 201 and a2.json()["status"] == "ALLOCATED"
    assert a2.json()["id"] != a1.json()["id"]

    # the allocation log keeps BOTH rows (released one is history), newest first
    log = (await client.get(f"/api/resource-pools/{pid}/allocations", headers=admin)).json()
    assert log[0]["id"] == a2.json()["id"]                              # newest first
    by_id = {x["id"]: x["status"] for x in log}
    assert by_id[a1.json()["id"]] == "RELEASED" and by_id[a2.json()["id"]] == "ALLOCATED"

    # filter the log by status
    released = (await client.get(f"/api/resource-pools/{pid}/allocations?status=RELEASED", headers=admin)).json()
    assert [x["id"] for x in released] == [a1.json()["id"]]


# ===================== scope / permission / tenant =====================

async def test_agent_has_no_pool_access(client, agent):
    assert (await client.get("/api/resource-pools", headers=agent)).status_code == 403
    assert (await client.post("/api/resource-pools", headers=agent,
                              json={"name": "x", "kind": "ipv4"})).status_code == 403


async def test_pool_tenant_stamping_and_isolation(client, admin):
    pid = (await _pool(client, admin)).json()["id"]
    async with SessionLocal() as s:
        admin_user = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        row = (await s.execute(select(ResourcePool).where(ResourcePool.id == uuid.UUID(pid)))).scalar_one()
        assert row.tenant_id == admin_user.tenant_id                   # stamped with the caller's tenant

        # a pool living in another tenant is invisible (404) — never leaks across tenants
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        foreign = ResourcePool(tenant_id=other.id, name="foreign", kind="ipv4", spec={})
        s.add(foreign)
        await s.commit()
        foreign_id = str(foreign.id)
    assert (await client.get(f"/api/resource-pools/{foreign_id}", headers=admin)).status_code == 404
