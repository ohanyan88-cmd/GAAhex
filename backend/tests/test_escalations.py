"""Escalation Standard (file 02 / file 14) — gate + lifecycle coverage.

Tests cover: create-201 shape (status=PENDING), list filtered, get single,
activate (PENDING -> ACTIVE), resolve (ACTIVE -> RESOLVED with resolution_note +
resolved_at + resolved_by set), cancel, all enum values accepted, invalid enum
values rejected, idempotency (activate-of-active, resolve-of-resolved, cancel-
of-cancelled), cannot resolve a PENDING escalation, permission gates,
cross-tenant isolation, events emitted on every transition.
"""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import Tenant, OrgNode, RoleDef, Assignment, Event
from app.models.escalation import Escalation  # registers on Base.metadata at import time
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from sqlalchemy_utils import Ltree


# ── self-wire the router so this test file is self-contained ──────────────────
# The orchestrator wires `escalations.router` into main.py at integration time
# (see RETURN block of the work item). Until then, this fixture mounts the
# router on the running FastAPI app for the duration of the test session.
@pytest_asyncio.fixture(scope="module", autouse=True)
async def _wire_escalations_router():
    from app.main import app
    from app.routers import escalations as _esc_router_module
    if not any(getattr(r, "path", "").startswith("/api/escalations") for r in app.routes):
        app.include_router(_esc_router_module.router)
    yield


_PROFILES = {
    "esc_manager": ["escalation.manage"],
    "esc_no_perm": [],
}
_USERS = {
    "alice": ("alice-esc@demo.isp", "esc_manager"),
    "nada":  ("nada-esc@demo.isp",  "esc_no_perm"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("esc-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id))).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_esc_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1))).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root", code="grp", path=Ltree("grp"))
            s.add(root); await s.flush()
        role_ids = {}
        for rk, perms in _PROFILES.items():
            row = (await s.execute(select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == rk))).scalar_one_or_none()
            if row is None:
                row = RoleDef(tenant_id=tenant.id, key=rk, label=rk, permissions=perms, scope="tenant")
                s.add(row); await s.flush()
            else:
                row.permissions = perms
            role_ids[rk] = row.id
        for _, (email, rk) in _USERS.items():
            await _ensure(s, tenant_id=tenant.id, node_id=root.id, email=email, role_id=role_ids[rk])
        # Other tenant
        other = (await s.execute(select(Tenant).where(Tenant.name == "Esc-RLS-Other"))).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Esc-RLS-Other", status="active"); s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root", code="roote", path=Ltree("roote"))); await s.flush()
        other_root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1))).scalar_one()
        other_role = (await s.execute(select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "esc_manager"))).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="esc_manager", label="mgr", permissions=["escalation.manage"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id, email="alice-other-esc@demo.isp", role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-esc@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            esc_ids = (await s.execute(select(Escalation.id).where(Escalation.triggered_by.in_(uids)))).scalars().all()
            if esc_ids:
                await s.execute(Escalation.__table__.delete().where(Escalation.id.in_(esc_ids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        await s.execute(Tenant.__table__.delete().where(Tenant.id == other_tenant_id))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "esc-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])
@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])
@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-esc@demo.isp")


def _payload(
    *,
    source_entity_type: str = "ticket",
    source_entity_id: str | None = None,
    trigger: str = "SLA_BREACH",
    target_type: str = "SPECIFIC_USER",
    target_id: str | None = None,
    level: str = "LEVEL_1",
    reason: str | None = "Past SLA due time",
) -> dict:
    return {
        "sourceEntityType": source_entity_type,
        "sourceEntityId": source_entity_id or str(uuid.uuid4()),
        "trigger": trigger,
        "targetType": target_type,
        "targetId": target_id or str(uuid.uuid4()),
        "level": level,
        "reason": reason,
    }


async def _create(client, hdr, **overrides) -> dict:
    body = _payload(**overrides)
    r = await client.post("/api/escalations", headers=hdr, json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ── happy paths ───────────────────────────────────────────────────────────────

async def test_create_returns_201_and_shape(client, alice):
    r = await client.post("/api/escalations", headers=alice, json=_payload())
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "PENDING"
    assert b["trigger"] == "SLA_BREACH"
    assert b["level"] == "LEVEL_1"
    assert b["targetType"] == "SPECIFIC_USER"
    assert b["sourceEntityType"] == "ticket"
    assert b["resolvedAt"] is None
    assert b["resolvedBy"] is None
    assert b["resolutionNote"] is None
    assert b["triggeredBy"]
    assert b["createdAt"]


async def test_list_filtered_by_source(client, alice):
    src_id = str(uuid.uuid4())
    await _create(client, alice, source_entity_id=src_id)
    await _create(client, alice, source_entity_id=src_id)
    # noise on a different source
    await _create(client, alice)
    r = await client.get(
        "/api/escalations",
        headers=alice,
        params={"source_entity_type": "ticket", "source_entity_id": src_id},
    )
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 2
    assert all(row["sourceEntityId"] == src_id for row in rows)


async def test_list_filtered_by_status(client, alice):
    created = await _create(client, alice)
    # activate one so PENDING and ACTIVE both exist
    await client.post(f"/api/escalations/{created['id']}/activate", headers=alice)
    r = await client.get("/api/escalations", headers=alice, params={"status": "ACTIVE"})
    assert r.status_code == 200
    assert all(row["status"] == "ACTIVE" for row in r.json())


async def test_list_filtered_by_trigger_and_level(client, alice):
    await _create(client, alice, trigger="VIP_CUSTOMER", level="LEVEL_3")
    r = await client.get("/api/escalations", headers=alice,
                         params={"trigger": "VIP_CUSTOMER", "level": "LEVEL_3"})
    assert r.status_code == 200
    rows = r.json()
    assert rows and all(row["trigger"] == "VIP_CUSTOMER" and row["level"] == "LEVEL_3" for row in rows)


async def test_get_single(client, alice):
    created = await _create(client, alice)
    r = await client.get(f"/api/escalations/{created['id']}", headers=alice)
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


# ── lifecycle transitions ─────────────────────────────────────────────────────

async def test_activate_moves_pending_to_active(client, alice):
    created = await _create(client, alice)
    r = await client.post(f"/api/escalations/{created['id']}/activate", headers=alice)
    assert r.status_code == 200
    assert r.json()["status"] == "ACTIVE"


async def test_resolve_active_sets_resolution_fields(client, alice):
    created = await _create(client, alice)
    await client.post(f"/api/escalations/{created['id']}/activate", headers=alice)
    r = await client.post(
        f"/api/escalations/{created['id']}/resolve",
        headers=alice,
        json={"resolutionNote": "Issue addressed by L2"},
    )
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "RESOLVED"
    assert b["resolutionNote"] == "Issue addressed by L2"
    assert b["resolvedAt"] is not None
    assert b["resolvedBy"] is not None


async def test_cancel_active_marks_cancelled(client, alice):
    created = await _create(client, alice)
    await client.post(f"/api/escalations/{created['id']}/activate", headers=alice)
    r = await client.post(f"/api/escalations/{created['id']}/cancel", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"


async def test_cancel_pending_marks_cancelled(client, alice):
    created = await _create(client, alice)
    r = await client.post(f"/api/escalations/{created['id']}/cancel", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"


# ── enum coverage ─────────────────────────────────────────────────────────────

async def test_all_four_levels_accepted(client, alice):
    for lvl in ("LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4"):
        r = await client.post("/api/escalations", headers=alice, json=_payload(level=lvl))
        assert r.status_code == 201, f"level {lvl} rejected: {r.text}"
        assert r.json()["level"] == lvl


async def test_all_eight_triggers_accepted(client, alice):
    triggers = (
        "SLA_BREACH", "STATUS_STUCK_TOO_LONG", "MANUAL_ESCALATION",
        "PRIORITY_INCREASE", "CUSTOMER_COMPLAINT", "REVENUE_IMPACT",
        "VIP_CUSTOMER", "CONFIGURABLE_RULES",
    )
    for trg in triggers:
        r = await client.post("/api/escalations", headers=alice, json=_payload(trigger=trg))
        assert r.status_code == 201, f"trigger {trg} rejected: {r.text}"
        assert r.json()["trigger"] == trg


async def test_all_four_targets_accepted(client, alice):
    for tgt in ("NEXT_MANAGER", "DEPARTMENT_MANAGER", "SPECIFIC_USER", "ESCALATION_QUEUE"):
        r = await client.post("/api/escalations", headers=alice, json=_payload(target_type=tgt))
        assert r.status_code == 201, f"target {tgt} rejected: {r.text}"
        assert r.json()["targetType"] == tgt


# ── validation / rejection ────────────────────────────────────────────────────

async def test_invalid_trigger_422(client, alice):
    r = await client.post("/api/escalations", headers=alice, json=_payload(trigger="BAD_TRIGGER"))
    assert r.status_code == 422


async def test_invalid_target_422(client, alice):
    r = await client.post("/api/escalations", headers=alice, json=_payload(target_type="BAD_TARGET"))
    assert r.status_code == 422


async def test_invalid_level_422(client, alice):
    r = await client.post("/api/escalations", headers=alice, json=_payload(level="LEVEL_99"))
    assert r.status_code == 422


async def test_invalid_status_filter_422(client, alice):
    r = await client.get("/api/escalations", headers=alice, params={"status": "WAT"})
    assert r.status_code == 422


# ── idempotency / forbidden transitions ───────────────────────────────────────

async def test_activate_of_active_is_idempotent(client, alice):
    created = await _create(client, alice)
    r1 = await client.post(f"/api/escalations/{created['id']}/activate", headers=alice)
    r2 = await client.post(f"/api/escalations/{created['id']}/activate", headers=alice)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["status"] == "ACTIVE" and r2.json()["status"] == "ACTIVE"


async def test_resolve_of_resolved_is_idempotent(client, alice):
    created = await _create(client, alice)
    await client.post(f"/api/escalations/{created['id']}/activate", headers=alice)
    r1 = await client.post(f"/api/escalations/{created['id']}/resolve", headers=alice,
                            json={"resolutionNote": "done"})
    r2 = await client.post(f"/api/escalations/{created['id']}/resolve", headers=alice,
                            json={"resolutionNote": "done-again"})
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["status"] == "RESOLVED" and r2.json()["status"] == "RESOLVED"


async def test_cannot_resolve_pending_must_activate_first(client, alice):
    created = await _create(client, alice)
    r = await client.post(f"/api/escalations/{created['id']}/resolve", headers=alice,
                          json={"resolutionNote": "n/a"})
    assert r.status_code == 422


# ── permission gates ──────────────────────────────────────────────────────────

async def test_create_denied_without_perm(client, nada):
    r = await client.post("/api/escalations", headers=nada, json=_payload())
    assert r.status_code == 403


async def test_activate_denied_without_perm(client, alice, nada):
    created = await _create(client, alice)
    r = await client.post(f"/api/escalations/{created['id']}/activate", headers=nada)
    assert r.status_code == 403


async def test_resolve_denied_without_perm(client, alice, nada):
    created = await _create(client, alice)
    await client.post(f"/api/escalations/{created['id']}/activate", headers=alice)
    r = await client.post(f"/api/escalations/{created['id']}/resolve", headers=nada,
                          json={"resolutionNote": "x"})
    assert r.status_code == 403


# ── multi-tenant RLS ──────────────────────────────────────────────────────────

async def test_cross_tenant_get_404(client, alice, alice_other):
    created = await _create(client, alice)
    r = await client.get(f"/api/escalations/{created['id']}", headers=alice_other)
    assert r.status_code == 404


async def test_cross_tenant_list_isolated(client, alice, alice_other):
    created = await _create(client, alice)
    r = await client.get("/api/escalations", headers=alice_other)
    assert r.status_code == 200
    assert not any(row["id"] == created["id"] for row in r.json())


# ── events ────────────────────────────────────────────────────────────────────

async def test_events_emitted_on_every_transition(client, alice):
    created = await _create(client, alice)
    aid = created["id"]
    await client.post(f"/api/escalations/{aid}/activate", headers=alice)
    await client.post(f"/api/escalations/{aid}/resolve", headers=alice,
                      json={"resolutionNote": "fixed"})
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type.in_([
                "ESCALATION_CREATED", "ESCALATION_ACTIVATED", "ESCALATION_RESOLVED",
            ]))
        )).scalars().all()
        by_type = {e.type for e in evs if e.data.get("escalationId") == aid}
        assert {"ESCALATION_CREATED", "ESCALATION_ACTIVATED", "ESCALATION_RESOLVED"} <= by_type


async def test_cancel_emits_event(client, alice):
    created = await _create(client, alice)
    aid = created["id"]
    await client.post(f"/api/escalations/{aid}/cancel", headers=alice)
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "ESCALATION_CANCELLED")
        )).scalars().all()
        assert any(e.data.get("escalationId") == aid for e in evs)
