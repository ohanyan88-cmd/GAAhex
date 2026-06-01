"""Phase A.1 — TariffPlan API tests.

Covers:
* CRUD happy-path (create / list / get / patch / soft-delete).
* Uniqueness — duplicate (tenant_id, key) → 409.
* Immutability — ``key`` cannot be mutated via PATCH → 422.
* Tenant isolation — the row is scoped to the caller's tenant_id at the DB layer.
* RBAC — agent (no config.manage) is forbidden from create / patch / delete; can list / get.
"""
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.tariff import TariffPlan


async def test_tariff_plan_crud_happy_path(client, admin):
    """Create → list → get → patch → soft-delete a tariff plan as admin."""
    payload = {
        "key": f"fiber-100-{uuid.uuid4().hex[:8]}",
        "name": "Fiber 100/100",
        "description": "Residential fiber, 100 Mbps symmetric",
        "base_recurring_price": "25.50",
        "included_units": 500,
        "overage_rate": "0.0500",
        "tiers_json": [{"from": 0, "to": 100, "rate": "0.04"}, {"from": 100, "to": None, "rate": "0.06"}],
        "cycle": "monthly",
    }
    r = await client.post("/api/tariff-plans", headers=admin, json=payload)
    assert r.status_code == 201, r.text
    plan = r.json()
    plan_id = plan["id"]
    assert plan["key"] == payload["key"]
    assert plan["base_recurring_price"] == "25.50"
    assert plan["included_units"] == 500
    assert plan["overage_rate"] == "0.0500"
    assert plan["active"] is True

    # list — the new plan must appear
    r = await client.get("/api/tariff-plans?active=true", headers=admin)
    assert r.status_code == 200
    assert any(p["id"] == plan_id for p in r.json())

    # get by id
    r = await client.get(f"/api/tariff-plans/{plan_id}", headers=admin)
    assert r.status_code == 200
    assert r.json()["name"] == "Fiber 100/100"

    # patch — name + description mutate; cycle locks to quarterly
    r = await client.patch(
        f"/api/tariff-plans/{plan_id}",
        headers=admin,
        json={"name": "Fiber 100/100 PRO", "cycle": "quarterly"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Fiber 100/100 PRO"
    assert body["cycle"] == "quarterly"

    # soft-delete — active flips False, row stays
    r = await client.delete(f"/api/tariff-plans/{plan_id}", headers=admin)
    assert r.status_code == 200
    assert r.json()["active"] is False

    # active=true filter must NOT show the deleted plan; active=false must.
    actives = {p["id"] for p in (await client.get("/api/tariff-plans?active=true", headers=admin)).json()}
    inactives = {p["id"] for p in (await client.get("/api/tariff-plans?active=false", headers=admin)).json()}
    assert plan_id not in actives
    assert plan_id in inactives


async def test_tariff_plan_duplicate_key_is_409(client, admin):
    key = f"dup-{uuid.uuid4().hex[:8]}"
    r1 = await client.post("/api/tariff-plans", headers=admin, json={
        "key": key, "name": "First", "base_recurring_price": "10.00",
    })
    assert r1.status_code == 201
    r2 = await client.post("/api/tariff-plans", headers=admin, json={
        "key": key, "name": "Second", "base_recurring_price": "20.00",
    })
    assert r2.status_code == 409


async def test_tariff_plan_key_is_immutable(client, admin):
    """PATCH attempting to change `key` → 422 with explanatory message."""
    key = f"immut-{uuid.uuid4().hex[:8]}"
    plan = (await client.post("/api/tariff-plans", headers=admin, json={
        "key": key, "name": "Imm", "base_recurring_price": "5.00",
    })).json()
    r = await client.patch(f"/api/tariff-plans/{plan['id']}", headers=admin, json={"key": "renamed"})
    assert r.status_code == 422
    assert "immutable" in r.text.lower()


async def test_tariff_plan_validation_422(client, admin):
    """Missing required fields → 422; bad cycle → 422."""
    r = await client.post("/api/tariff-plans", headers=admin, json={"name": "no key", "base_recurring_price": "1"})
    assert r.status_code == 422
    r = await client.post("/api/tariff-plans", headers=admin, json={
        "key": f"bad-cyc-{uuid.uuid4().hex[:6]}", "name": "x", "base_recurring_price": "1", "cycle": "weekly",
    })
    assert r.status_code == 422


async def test_tariff_plan_404_for_unknown_id(client, admin):
    r = await client.get(f"/api/tariff-plans/{uuid.uuid4()}", headers=admin)
    assert r.status_code == 404


async def test_tariff_plan_tenant_stamping(client, admin):
    """Created plan rows carry the caller's tenant_id at the DB layer (tenant isolation gate)."""
    key = f"tenant-{uuid.uuid4().hex[:8]}"
    body = (await client.post("/api/tariff-plans", headers=admin, json={
        "key": key, "name": "T", "base_recurring_price": "9.99",
    })).json()
    async with SessionLocal() as s:
        admin_user = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        row = (await s.execute(select(TariffPlan).where(TariffPlan.id == uuid.UUID(body["id"])))).scalar_one()
        assert row.tenant_id == admin_user.tenant_id


async def test_tariff_plan_list_filters_active(client, admin):
    """active=true / active=false split the universe; both reachable as admin."""
    key_active = f"act-{uuid.uuid4().hex[:8]}"
    p1 = (await client.post("/api/tariff-plans", headers=admin, json={
        "key": key_active, "name": "A", "base_recurring_price": "1.00",
    })).json()
    key_archived = f"arc-{uuid.uuid4().hex[:8]}"
    p2 = (await client.post("/api/tariff-plans", headers=admin, json={
        "key": key_archived, "name": "B", "base_recurring_price": "2.00",
    })).json()
    await client.delete(f"/api/tariff-plans/{p2['id']}", headers=admin)

    actives = {p["id"] for p in (await client.get("/api/tariff-plans?active=true", headers=admin)).json()}
    inactives = {p["id"] for p in (await client.get("/api/tariff-plans?active=false", headers=admin)).json()}
    assert p1["id"] in actives and p1["id"] not in inactives
    assert p2["id"] in inactives and p2["id"] not in actives


async def test_tariff_plan_decimal_precision_round_trip(client, admin):
    """Decimal precision survives the JSON round-trip — 4dp overage_rate, 2dp base price."""
    key = f"prec-{uuid.uuid4().hex[:8]}"
    body = (await client.post("/api/tariff-plans", headers=admin, json={
        "key": key, "name": "Prec",
        "base_recurring_price": "123.45",
        "overage_rate": "0.0125",
    })).json()
    fetched = (await client.get(f"/api/tariff-plans/{body['id']}", headers=admin)).json()
    assert fetched["base_recurring_price"] == "123.45"
    assert fetched["overage_rate"] == "0.0125"


async def test_tariff_plan_agent_write_forbidden(client, admin, agent):
    """Agent (no config.manage) can READ but NOT write."""
    # agent CAN list (reads are open)
    r = await client.get("/api/tariff-plans", headers=agent)
    assert r.status_code == 200

    # agent CANNOT create
    r = await client.post("/api/tariff-plans", headers=agent, json={
        "key": f"agt-{uuid.uuid4().hex[:6]}", "name": "x", "base_recurring_price": "1.00",
    })
    assert r.status_code == 403

    # set up a plan as admin so agent has something to mutate
    plan = (await client.post("/api/tariff-plans", headers=admin, json={
        "key": f"adm-{uuid.uuid4().hex[:6]}", "name": "AdminPlan", "base_recurring_price": "5.00",
    })).json()

    # agent CANNOT patch
    r = await client.patch(f"/api/tariff-plans/{plan['id']}", headers=agent, json={"name": "hack"})
    assert r.status_code == 403

    # agent CANNOT delete
    r = await client.delete(f"/api/tariff-plans/{plan['id']}", headers=agent)
    assert r.status_code == 403
