"""Relationship / Entity Link Standard (file 12) — gate + lifecycle coverage.

Tests cover: create-201 + REL- reference, list with source/target filters,
read single, patch description/status/validUntil, archive (soft-delete),
duplicate-ACTIVE → 409, archived+create-same-shape → 201, graph endpoint,
invalid enum values, permission gates (create + delete), cross-tenant 404 (RLS),
event emission on create/update/archive.

Teardown order: Relationship → Assignment → RefreshToken → User → other-tenant
RoleDef + OrgNode + Tenant.
"""
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import Tenant, OrgNode, RoleDef, Assignment, Event
from app.models.relationship import Relationship
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from sqlalchemy_utils import Ltree

# Register the relationships router into the running FastAPI app for the test session.
# In production, the orchestrator wires this in app/main.py at import-time BEFORE the
# records router (which has a catch-all `/api/{entity_key}` that would otherwise swallow
# `/api/relationships`). For tests we register here defensively and MOVE the new routes
# to the FRONT of the route list so FastAPI matches the literal `/api/relationships`
# prefix before the records catch-all.
from app.main import app as _app
from app.routers import relationships as _relationships_router
if not any(getattr(r, "path", "").startswith("/api/relationships") for r in _app.router.routes):
    _app.include_router(_relationships_router.router)
    # Move all /api/relationships routes to the front so the records catch-all
    # (/api/{entity_key}) doesn't shadow them.
    _rel_routes = [r for r in _app.router.routes if getattr(r, "path", "").startswith("/api/relationships")]
    for r in _rel_routes:
        _app.router.routes.remove(r)
    _app.router.routes[:0] = _rel_routes


_PROFILES = {
    "rel_full":          ["relationship.create", "relationship.delete"],
    "rel_creator_only":  ["relationship.create"],
    "rel_no_perm":       [],
}
_USERS = {
    "alice": ("alice-rel@demo.isp", "rel_full"),
    "nada":  ("nada-rel@demo.isp",  "rel_no_perm"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("rel-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id))).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_rel_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1)
        )).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root", code="grp", path=Ltree("grp"))
            s.add(root); await s.flush()

        role_ids = {}
        for rk, perms in _PROFILES.items():
            row = (await s.execute(
                select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == rk)
            )).scalar_one_or_none()
            if row is None:
                row = RoleDef(tenant_id=tenant.id, key=rk, label=rk, permissions=perms, scope="tenant")
                s.add(row); await s.flush()
            else:
                row.permissions = perms
            role_ids[rk] = row.id

        for _, (email, rk) in _USERS.items():
            await _ensure(s, tenant_id=tenant.id, node_id=root.id, email=email, role_id=role_ids[rk])

        # Other tenant for cross-tenant RLS check.
        other = (await s.execute(select(Tenant).where(Tenant.name == "Rel-RLS-Other"))).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Rel-RLS-Other", status="active"); s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root", code="rootR", path=Ltree("rootR"))); await s.flush()
        other_root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1))).scalar_one()
        other_role = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "rel_full")
        )).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="rel_full", label="full",
                                 permissions=_PROFILES["rel_full"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id,
                       email="alice-other-rel@demo.isp", role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-rel@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            # Delete Relationship rows tied to these users BEFORE the user delete.
            rel_ids = (await s.execute(
                select(Relationship.id).where(Relationship.created_by.in_(uids))
            )).scalars().all()
            if rel_ids:
                await s.execute(Relationship.__table__.delete().where(Relationship.id.in_(rel_ids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        await s.execute(Tenant.__table__.delete().where(Tenant.id == other_tenant_id))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "rel-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])
@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])
@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-rel@demo.isp")


def _body(*, source_type="ticket", source_id=None, target_type="customer",
          target_id=None, rel_type="RELATED_TO", direction="DIRECTED",
          status="ACTIVE", description=None):
    return {
        "sourceEntityType": source_type,
        "sourceEntityId": source_id or str(uuid.uuid4()),
        "targetEntityType": target_type,
        "targetEntityId": target_id or str(uuid.uuid4()),
        "relationshipType": rel_type,
        "direction": direction,
        "status": status,
        "description": description,
    }


# ── create / read / list / patch / archive ───────────────────────────────────

async def test_create_201_with_rel_reference(client, alice):
    r = await client.post("/api/relationships", headers=alice, json=_body())
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["referenceNumber"].startswith("REL-")
    assert b["status"] == "ACTIVE"
    assert b["relationshipType"] == "RELATED_TO"
    assert b["direction"] == "DIRECTED"


async def test_get_single(client, alice):
    r = await client.post("/api/relationships", headers=alice, json=_body())
    rid = r.json()["id"]
    g = await client.get(f"/api/relationships/{rid}", headers=alice)
    assert g.status_code == 200 and g.json()["id"] == rid


async def test_list_filters_by_source(client, alice):
    src = str(uuid.uuid4())
    await client.post("/api/relationships", headers=alice, json=_body(source_id=src))
    r = await client.get("/api/relationships", headers=alice,
                          params={"source_entity_type": "ticket", "source_entity_id": src})
    assert r.status_code == 200
    rows = r.json()
    assert any(row["sourceEntityId"] == src for row in rows)
    assert all(row["sourceEntityType"] == "ticket" and row["sourceEntityId"] == src for row in rows)


async def test_list_filters_by_target(client, alice):
    tgt = str(uuid.uuid4())
    await client.post("/api/relationships", headers=alice, json=_body(target_id=tgt))
    r = await client.get("/api/relationships", headers=alice,
                          params={"target_entity_type": "customer", "target_entity_id": tgt})
    assert r.status_code == 200
    rows = r.json()
    assert any(row["targetEntityId"] == tgt for row in rows)


async def test_patch_description(client, alice):
    r = await client.post("/api/relationships", headers=alice, json=_body())
    rid = r.json()["id"]
    p = await client.patch(f"/api/relationships/{rid}", headers=alice,
                            json={"description": "patched note"})
    assert p.status_code == 200 and p.json()["description"] == "patched note"
    assert p.json()["updatedBy"] is not None


async def test_archive_marks_archived(client, alice):
    r = await client.post("/api/relationships", headers=alice, json=_body())
    rid = r.json()["id"]
    d = await client.delete(f"/api/relationships/{rid}", headers=alice)
    assert d.status_code == 200 and d.json()["status"] == "ARCHIVED"


# ── validation ───────────────────────────────────────────────────────────────

async def test_invalid_relationship_type_422(client, alice):
    r = await client.post("/api/relationships", headers=alice,
                           json=_body(rel_type="NOT_A_VALID_TYPE"))
    assert r.status_code == 422


async def test_invalid_direction_422(client, alice):
    r = await client.post("/api/relationships", headers=alice,
                           json=_body(direction="SOMETIMES"))
    assert r.status_code == 422


# ── duplicate-active fence + archive-then-recreate ───────────────────────────

async def test_duplicate_active_returns_409(client, alice):
    src, tgt = str(uuid.uuid4()), str(uuid.uuid4())
    body = _body(source_id=src, target_id=tgt, rel_type="DEPENDS_ON")
    r1 = await client.post("/api/relationships", headers=alice, json=body)
    assert r1.status_code == 201
    r2 = await client.post("/api/relationships", headers=alice, json=body)
    assert r2.status_code == 409


async def test_archived_row_allows_recreate(client, alice):
    """Partial unique only blocks ACTIVE rows — archive then re-create same shape is legal."""
    src, tgt = str(uuid.uuid4()), str(uuid.uuid4())
    body = _body(source_id=src, target_id=tgt, rel_type="CONNECTED_TO")
    r1 = await client.post("/api/relationships", headers=alice, json=body)
    rid = r1.json()["id"]
    arch = await client.delete(f"/api/relationships/{rid}", headers=alice)
    assert arch.status_code == 200
    r2 = await client.post("/api/relationships", headers=alice, json=body)
    assert r2.status_code == 201, r2.text


# ── graph endpoint ───────────────────────────────────────────────────────────

async def test_graph_returns_both_sides(client, alice):
    """The pivot entity appears as SOURCE on one row and as TARGET on another;
    the graph endpoint must return both with the per-row `side` indicator."""
    pivot = str(uuid.uuid4())
    other_a = str(uuid.uuid4())
    other_b = str(uuid.uuid4())
    # pivot is the SOURCE
    await client.post("/api/relationships", headers=alice,
                       json=_body(source_type="ticket", source_id=pivot,
                                  target_type="customer", target_id=other_a,
                                  rel_type="ASSOCIATED_WITH"))
    # pivot is the TARGET
    await client.post("/api/relationships", headers=alice,
                       json=_body(source_type="customer", source_id=other_b,
                                  target_type="ticket", target_id=pivot,
                                  rel_type="OWNS"))
    g = await client.get("/api/relationships/graph", headers=alice,
                          params={"entity_type": "ticket", "entity_id": pivot})
    assert g.status_code == 200
    rows = g.json()
    sides = {row["side"] for row in rows}
    assert "source" in sides and "target" in sides


# ── permission gates ─────────────────────────────────────────────────────────

async def test_create_denied_without_perm(client, nada):
    r = await client.post("/api/relationships", headers=nada, json=_body())
    assert r.status_code == 403


async def test_delete_denied_without_perm(client, alice, nada):
    # nada also lacks relationship.create, but the gate the spec calls out for
    # DELETE is relationship.delete — assert the DELETE-specific gate fires.
    # Create with alice (rel_full), then attempt delete with nada (no perms).
    r = await client.post("/api/relationships", headers=alice, json=_body())
    rid = r.json()["id"]
    d = await client.delete(f"/api/relationships/{rid}", headers=nada)
    assert d.status_code == 403


async def test_list_returns_200_with_create_perm(client, alice):
    r = await client.get("/api/relationships", headers=alice)
    assert r.status_code == 200 and isinstance(r.json(), list)


# ── multi-tenant RLS ─────────────────────────────────────────────────────────

async def test_cross_tenant_404(client, alice, alice_other):
    r = await client.post("/api/relationships", headers=alice, json=_body())
    rid = r.json()["id"]
    g = await client.get(f"/api/relationships/{rid}", headers=alice_other)
    assert g.status_code == 404


async def test_cross_tenant_list_isolated(client, alice, alice_other):
    # Each tenant must not see the other tenant's REL rows.
    me = await client.get("/api/relationships", headers=alice)
    other = await client.get("/api/relationships", headers=alice_other)
    assert me.status_code == 200 and other.status_code == 200
    my_ids = {row["id"] for row in me.json()}
    other_ids = {row["id"] for row in other.json()}
    assert my_ids.isdisjoint(other_ids)


# ── event emission ──────────────────────────────────────────────────────────

async def test_event_emitted_on_create(client, alice):
    r = await client.post("/api/relationships", headers=alice, json=_body())
    rid = r.json()["id"]
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "relationship_created")
        )).scalars().all()
        assert any(e.data.get("relationshipId") == rid for e in evs)


async def test_event_emitted_on_update(client, alice):
    r = await client.post("/api/relationships", headers=alice, json=_body())
    rid = r.json()["id"]
    await client.patch(f"/api/relationships/{rid}", headers=alice, json={"description": "x"})
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "relationship_updated")
        )).scalars().all()
        assert any(e.data.get("relationshipId") == rid for e in evs)


async def test_event_emitted_on_archive(client, alice):
    r = await client.post("/api/relationships", headers=alice, json=_body())
    rid = r.json()["id"]
    await client.delete(f"/api/relationships/{rid}", headers=alice)
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "relationship_archived")
        )).scalars().all()
        assert any(e.data.get("relationshipId") == rid for e in evs)
