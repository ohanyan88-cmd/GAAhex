"""Import / Export Standard (file 08) — gate + lifecycle coverage.

20+ tests covering the v1 metadata-only job tracking surface (10 for imports,
10 for exports, plus the shared RLS / permission gate matrix).

Import lifecycle: DRAFT -> VALIDATING -> READY_TO_IMPORT -> IMPORTING.
v1's /validate stub auto-passes; the execution engine is a future addition.

Export lifecycle in v1: REQUESTED -> CANCELLED (the engine's RUNNING/COMPLETED
transitions ship with the execution batch).

Both surfaces share: per-tenant IMP-/EXP- reference numbers, RLS isolation,
substrate event emission, and tight permission gates (`import.run` for /imports,
`export.run` for /exports).
"""
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy_utils import Ltree

from app.db import OwnerSessionLocal
from app.models import Assignment, Event, OrgNode, RoleDef, Tenant
from app.models.import_export import ExportJob, ImportJob  # noqa: F401  — register mapper
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password


# Parallel-agent bootstrap: include the router on the live app if the orchestrator
# hasn't wired it in main.py yet. No-op once main.py imports it. Tests pass in
# either order, so this batch can land alongside other parallel batches without
# blocking on the main.py integration line.
#
# IMPORTANT: routes must be PREPENDED (not appended). The generic /api/{slug}
# records router is already registered at module import time and would otherwise
# swallow /api/imports + /api/exports as entity slugs (404 "Unknown entity").
def _ensure_router_wired() -> None:
    from app.main import app
    from app.routers import imports_exports as ie_router
    has_imports = any(getattr(r, "path", None) == "/api/imports" for r in app.routes)
    if not has_imports:
        # Build the routes list as include_router would, then prepend to app.routes
        # so they win over the catch-all /api/{slug} records routes.
        before = len(app.routes)
        app.include_router(ie_router.router)
        new_routes = app.routes[before:]
        del app.routes[before:]
        for r in reversed(new_routes):
            app.routes.insert(0, r)


_ensure_router_wired()


_PROFILES = {
    "ie_full": ["import.run", "export.run"],
    "ie_none": [],
}
_USERS = {
    "alice": ("alice-ie@demo.isp", "ie_full"),
    "nada":  ("nada-ie@demo.isp",  "ie_none"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(
        select(User).where(User.tenant_id == tenant_id, User.email == email)
    )).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("ie-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(
        select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id)
    )).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id,
                         node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_ie_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1)
        )).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root",
                           code="grp", path=Ltree("grp"))
            s.add(root); await s.flush()

        role_ids: dict[str, uuid.UUID] = {}
        for rk, perms in _PROFILES.items():
            row = (await s.execute(
                select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == rk)
            )).scalar_one_or_none()
            if row is None:
                row = RoleDef(tenant_id=tenant.id, key=rk, label=rk,
                              permissions=perms, scope="tenant")
                s.add(row); await s.flush()
            else:
                row.permissions = perms
            role_ids[rk] = row.id

        for _, (email, rk) in _USERS.items():
            await _ensure(s, tenant_id=tenant.id, node_id=root.id,
                          email=email, role_id=role_ids[rk])

        # Other tenant for RLS isolation
        other = (await s.execute(
            select(Tenant).where(Tenant.name == "IE-RLS-Other")
        )).scalar_one_or_none()
        if other is None:
            other = Tenant(name="IE-RLS-Other", status="active")
            s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root",
                          code="root_ie", path=Ltree("root_ie"))); await s.flush()
        other_root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1)
        )).scalar_one()
        other_role = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "ie_full")
        )).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="ie_full", label="full",
                                 permissions=_PROFILES["ie_full"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id,
                      email="alice-other-ie@demo.isp", role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-ie@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            # Teardown ORDER (matters): ImportJob + ExportJob BEFORE Assignment, RefreshToken, User
            await s.execute(ImportJob.__table__.delete().where(ImportJob.created_by.in_(uids)))
            await s.execute(ExportJob.__table__.delete().where(ExportJob.created_by.in_(uids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        # Cross-tenant teardown helper — purges every tenant_id-scoped row

        # before the final tenant DELETE (otherwise event/audit/record FKs block it).

        from tests.conftest import delete_tenant_cleanly

        await delete_tenant_cleanly(s, other_tenant_id)
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "ie-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])


@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])


@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-ie@demo.isp")


def _imp_body(**over):
    body = {"jobType": "customer_bulk_upload", "entityKey": "customer"}
    body.update(over)
    return body


def _exp_body(**over):
    body = {"jobType": "customer_full_export", "entityKey": "customer", "outputFormat": "csv"}
    body.update(over)
    return body


# ════════════════════════════════════════════════════════════════════════════
# IMPORT — happy paths + lifecycle
# ════════════════════════════════════════════════════════════════════════════

async def test_import_create_returns_201_with_imp_reference(client, alice):
    r = await client.post("/api/imports", headers=alice, json=_imp_body())
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "DRAFT"
    assert b["referenceNumber"].startswith("IMP-")
    assert b["entityKey"] == "customer"
    assert b["totalRows"] == 0


async def test_import_list_returns_created(client, alice):
    await client.post("/api/imports", headers=alice, json=_imp_body())
    r = await client.get("/api/imports", headers=alice)
    assert r.status_code == 200 and len(r.json()) >= 1


async def test_import_list_filter_by_status(client, alice):
    await client.post("/api/imports", headers=alice, json=_imp_body())
    r = await client.get("/api/imports?status=DRAFT", headers=alice)
    assert r.status_code == 200
    assert all(j["status"] == "DRAFT" for j in r.json())


async def test_import_list_filter_invalid_status_422(client, alice):
    r = await client.get("/api/imports?status=BOGUS", headers=alice)
    assert r.status_code == 422


async def test_import_get_single(client, alice):
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    r = await client.get(f"/api/imports/{iid}", headers=alice)
    assert r.status_code == 200 and r.json()["id"] == iid


async def test_import_validate_draft_to_ready(client, alice):
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    r = await client.post(f"/api/imports/{iid}/validate", headers=alice)
    assert r.status_code == 200
    assert r.json()["status"] == "READY_TO_IMPORT"


async def test_import_start_ready_to_importing(client, alice):
    """READY_TO_IMPORT -> IMPORTING transition.

    The import engine is intentionally fail-closed (FEATURE_IMPORT_ENGINE_ENABLED
    default False + IMPORT_ENGINE_IMPLEMENTED=False). /start returns 503 with a
    structured `feature_disabled` body until a real engine lands. This test
    documents that current correct behavior; once the engine ships, the assertions
    will need to flip to 200 + status IMPORTING (and the test name then matches).
    """
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    await client.post(f"/api/imports/{iid}/validate", headers=alice)
    r = await client.post(f"/api/imports/{iid}/start", headers=alice)
    assert r.status_code == 503
    body = r.json()
    assert body["detail"]["error"] == "feature_disabled"
    assert body["detail"]["feature"] == "import_engine"


async def test_import_cancel_from_draft(client, alice):
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    r = await client.post(f"/api/imports/{iid}/cancel", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"


async def test_import_cannot_start_from_draft_422(client, alice):
    """Must validate before starting — direct DRAFT->IMPORTING is rejected.

    Currently the fail-closed feature gate triggers BEFORE the status check, so
    a DRAFT/start hits 503 (feature_disabled) before we'd hit the 422 (wrong
    status). Once the import engine lands and the gate flips on, this test
    will need to be revisited to verify the status guard still bites first.
    """
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    r = await client.post(f"/api/imports/{iid}/start", headers=alice)
    assert r.status_code == 503
    body = r.json()
    assert body["detail"]["error"] == "feature_disabled"


async def test_import_create_missing_field_422(client, alice):
    r = await client.post("/api/imports", headers=alice, json={"jobType": "x"})
    assert r.status_code == 422


async def test_import_cancel_terminal_rejected_422(client, alice):
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    await client.post(f"/api/imports/{iid}/cancel", headers=alice)
    r = await client.post(f"/api/imports/{iid}/cancel", headers=alice)
    assert r.status_code == 422


async def test_import_create_emits_event(client, alice):
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "IMPORT_CREATED")
        )).scalars().all()
        assert any(e.data.get("importJobId") == iid for e in evs)


async def test_import_status_change_emits_event(client, alice):
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    await client.post(f"/api/imports/{iid}/validate", headers=alice)
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "IMPORT_STATUS_CHANGED")
        )).scalars().all()
        found = [e for e in evs if e.data.get("importJobId") == iid]
        assert found, "expected status-change events from validate"


# ── permission gates ──

async def test_import_create_denied_without_import_run(client, nada):
    r = await client.post("/api/imports", headers=nada, json=_imp_body())
    assert r.status_code == 403


async def test_import_list_denied_without_import_run(client, nada):
    r = await client.get("/api/imports", headers=nada)
    assert r.status_code == 403


# ── multi-tenant RLS ──

async def test_import_cross_tenant_get_404(client, alice, alice_other):
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    r = await client.get(f"/api/imports/{iid}", headers=alice_other)
    assert r.status_code == 404


async def test_import_rls_list_isolation(client, alice, alice_other):
    """Other-tenant alice never sees this tenant's import."""
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    iid = c.json()["id"]
    r = await client.get("/api/imports", headers=alice_other)
    assert r.status_code == 200
    assert not any(j["id"] == iid for j in r.json())


# ════════════════════════════════════════════════════════════════════════════
# EXPORT — happy paths + lifecycle
# ════════════════════════════════════════════════════════════════════════════

async def test_export_create_returns_201_with_exp_reference(client, alice):
    r = await client.post("/api/exports", headers=alice, json=_exp_body())
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "REQUESTED"
    assert b["referenceNumber"].startswith("EXP-")
    assert b["outputFormat"] == "csv"
    assert b["fileAttachmentId"] is None  # nullable until COMPLETED


async def test_export_list_returns_created(client, alice):
    await client.post("/api/exports", headers=alice, json=_exp_body())
    r = await client.get("/api/exports", headers=alice)
    assert r.status_code == 200 and len(r.json()) >= 1


async def test_export_list_filter_by_status(client, alice):
    await client.post("/api/exports", headers=alice, json=_exp_body())
    r = await client.get("/api/exports?status=REQUESTED", headers=alice)
    assert r.status_code == 200
    assert all(j["status"] == "REQUESTED" for j in r.json())


async def test_export_list_filter_by_entity_key(client, alice):
    await client.post("/api/exports", headers=alice, json=_exp_body(entityKey="invoice"))
    r = await client.get("/api/exports?entity_key=invoice", headers=alice)
    assert r.status_code == 200
    assert all(j["entityKey"] == "invoice" for j in r.json())


async def test_export_get_single(client, alice):
    c = await client.post("/api/exports", headers=alice, json=_exp_body())
    eid = c.json()["id"]
    r = await client.get(f"/api/exports/{eid}", headers=alice)
    assert r.status_code == 200 and r.json()["id"] == eid


async def test_export_cancel_from_requested(client, alice):
    c = await client.post("/api/exports", headers=alice, json=_exp_body())
    eid = c.json()["id"]
    r = await client.post(f"/api/exports/{eid}/cancel", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"


async def test_export_cancel_terminal_rejected_422(client, alice):
    c = await client.post("/api/exports", headers=alice, json=_exp_body())
    eid = c.json()["id"]
    await client.post(f"/api/exports/{eid}/cancel", headers=alice)
    r = await client.post(f"/api/exports/{eid}/cancel", headers=alice)
    assert r.status_code == 422


async def test_export_create_with_expires_at_persists(client, alice):
    """expires_at is present (nullable in v1) — accept ISO 8601 and round-trip."""
    body = _exp_body(expiresAt="2026-12-31T23:59:59+00:00")
    c = await client.post("/api/exports", headers=alice, json=body)
    assert c.status_code == 201
    assert c.json()["expiresAt"] is not None


async def test_export_create_with_filter_spec_json(client, alice):
    body = _exp_body(filterSpec={"status": "ACTIVE", "limit": 100})
    c = await client.post("/api/exports", headers=alice, json=body)
    assert c.status_code == 201
    assert c.json()["filterSpec"] == {"status": "ACTIVE", "limit": 100}


async def test_export_invalid_filter_spec_422(client, alice):
    body = _exp_body(filterSpec="not-a-dict")
    r = await client.post("/api/exports", headers=alice, json=body)
    assert r.status_code == 422


async def test_export_list_filter_invalid_status_422(client, alice):
    r = await client.get("/api/exports?status=BOGUS", headers=alice)
    assert r.status_code == 422


async def test_export_create_emits_event(client, alice):
    c = await client.post("/api/exports", headers=alice, json=_exp_body())
    eid = c.json()["id"]
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "EXPORT_CREATED")
        )).scalars().all()
        assert any(e.data.get("exportJobId") == eid for e in evs)


async def test_export_cancel_emits_event(client, alice):
    c = await client.post("/api/exports", headers=alice, json=_exp_body())
    eid = c.json()["id"]
    await client.post(f"/api/exports/{eid}/cancel", headers=alice)
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "EXPORT_STATUS_CHANGED")
        )).scalars().all()
        found = [e for e in evs if e.data.get("exportJobId") == eid]
        assert found and found[-1].data["next"] == "CANCELLED"


# ── permission gates ──

async def test_export_create_denied_without_export_run(client, nada):
    r = await client.post("/api/exports", headers=nada, json=_exp_body())
    assert r.status_code == 403


async def test_export_list_denied_without_export_run(client, nada):
    r = await client.get("/api/exports", headers=nada)
    assert r.status_code == 403


# ── multi-tenant RLS ──

async def test_export_cross_tenant_get_404(client, alice, alice_other):
    c = await client.post("/api/exports", headers=alice, json=_exp_body())
    eid = c.json()["id"]
    r = await client.get(f"/api/exports/{eid}", headers=alice_other)
    assert r.status_code == 404


async def test_export_rls_list_isolation(client, alice, alice_other):
    c = await client.post("/api/exports", headers=alice, json=_exp_body())
    eid = c.json()["id"]
    r = await client.get("/api/exports", headers=alice_other)
    assert r.status_code == 200
    assert not any(j["id"] == eid for j in r.json())
