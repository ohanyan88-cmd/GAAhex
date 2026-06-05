"""Stage-2 remediation — Pack P5: import engine fail-closed.

Covers the four cases the Stage-2 plan enumerates for the import-engine kill-switch:

1.  ``/imports/{id}/start`` returns **503** with a structured
    ``feature_disabled`` body whenever ``feature_gate.is_enabled("import_engine")``
    is False (the default in every deployment — no real engine ships yet).
2.  ``/imports/{id}/validate`` is **unchanged** — it's a metadata-only dry-run
    stub that never claims to ingest data, so it stays available even with the
    engine disabled. This is the safety surface customers rely on to know their
    file is shaped correctly without being lied to.
3.  A blocked ``/start`` emits an ``IMPORT_ENGINE_DISABLED_BLOCKED`` audit
    Event so SuperAdmin can see every refused attempt (the kill switch is
    visible, not silent). Audit emit is best-effort and must never swallow
    the 503 — see the try/except in the router.
4.  ``GET /imports`` + ``GET /imports/{id}`` are read-only metadata endpoints
    that do **not** claim to ingest anything; they stay tenant-scoped and
    fully functional. Killing list/get would hide pending DRAFT rows from the
    customer with no upside.

Bootstrap mirrors ``test_imports_exports.py`` so the suite is self-contained:
distinct role keys + email addresses (``-r2-`` infix) keep the fixtures from
colliding with the existing module-scope fixture in that file.
"""
from __future__ import annotations

import uuid

import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy_utils import Ltree

from app.db import OwnerSessionLocal
from app.models import Assignment, Event, OrgNode, RoleDef, Tenant
from app.models.import_export import ExportJob, ImportJob  # noqa: F401  — register mapper
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password


# Bootstrap: make sure the imports_exports router is wired on the live app
# even when this module runs in isolation. Same prepend-trick as the parent
# test module — the generic /api/{slug} catch-all is registered first at
# import time and would otherwise eat /api/imports.
def _ensure_router_wired() -> None:
    from app.main import app
    from app.routers import imports_exports as ie_router
    has_imports = any(getattr(r, "path", None) == "/api/imports" for r in app.routes)
    if not has_imports:
        before = len(app.routes)
        app.include_router(ie_router.router)
        new_routes = app.routes[before:]
        del app.routes[before:]
        for r in reversed(new_routes):
            app.routes.insert(0, r)


_ensure_router_wired()


# Distinct from test_imports_exports.py — different role key + emails so the
# two modules can run in any order (xdist-safe) without role-uniqueness or
# email-uniqueness collisions.
_PROFILE_KEY = "ie_full_r2"
_USER_EMAIL = "alice-r2-ie@demo.isp"
_OTHER_USER_EMAIL = "alice-r2-other-ie@demo.isp"
_OTHER_TENANT_NAME = "IE-RLS-Other-R2"


async def _ensure_user(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
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
async def _setup_r2_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1)
        )).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root",
                           code="grp", path=Ltree("grp"))
            s.add(root); await s.flush()

        role = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == _PROFILE_KEY)
        )).scalar_one_or_none()
        if role is None:
            role = RoleDef(tenant_id=tenant.id, key=_PROFILE_KEY, label=_PROFILE_KEY,
                           permissions=["import.run", "export.run"], scope="tenant")
            s.add(role); await s.flush()
        else:
            role.permissions = ["import.run", "export.run"]

        await _ensure_user(s, tenant_id=tenant.id, node_id=root.id,
                           email=_USER_EMAIL, role_id=role.id)

        # Second tenant — proves cross-tenant get returns 404 even on the
        # gated endpoint (no leakage of import_job ids through the 503 path).
        other = (await s.execute(
            select(Tenant).where(Tenant.name == _OTHER_TENANT_NAME)
        )).scalar_one_or_none()
        if other is None:
            other = Tenant(name=_OTHER_TENANT_NAME, status="active")
            s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root",
                          code="root_r2_ie", path=Ltree("root_r2_ie")))
            await s.flush()
        other_root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1)
        )).scalar_one()
        other_role = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == _PROFILE_KEY)
        )).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key=_PROFILE_KEY, label=_PROFILE_KEY,
                                 permissions=["import.run", "export.run"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure_user(s, tenant_id=other.id, node_id=other_root.id,
                           email=_OTHER_USER_EMAIL, role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        emails = [_USER_EMAIL, _OTHER_USER_EMAIL]
        users = (await s.execute(select(User).where(User.email.in_(emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            await s.execute(ImportJob.__table__.delete().where(ImportJob.created_by.in_(uids)))
            await s.execute(ExportJob.__table__.delete().where(ExportJob.created_by.in_(uids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key == _PROFILE_KEY))

        # Event rows tied to the OTHER tenant were created by the stage-1 auth
        # audit emit on every alice_other login. Tenant DELETE would FK-violate.
        # We explicitly clean the Event rows for the test-scoped tenant here
        # rather than adding ON DELETE CASCADE on event.tenant_id, because the
        # audit trail must be immutable in production. The trigger
        # prevent_delete_event is bypassed ONLY for this teardown via
        # session_replication_role='replica' — that requires the owner
        # (gaahex superuser) role we already use; production app role
        # (gaahex_app NOSUPERUSER) cannot use this knob, so forensic
        # immutability is preserved at the production boundary.
        await s.execute(text("SET LOCAL session_replication_role = 'replica'"))
        await s.execute(
            text("DELETE FROM event WHERE tenant_id = :tid"),
            {"tid": other_tenant_id},
        )
        await s.execute(text("SET LOCAL session_replication_role = 'origin'"))

        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        # Cross-tenant teardown helper — purges every tenant_id-scoped row

        # before the final tenant DELETE (otherwise event/audit/record FKs block it).

        from tests.conftest import delete_tenant_cleanly

        await delete_tenant_cleanly(s, other_tenant_id)
        await s.commit()


async def _login(client, email: str) -> dict:
    r = await client.post("/auth/login", json={"email": email, "password": "ie-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client):
    return await _login(client, _USER_EMAIL)


@pytest_asyncio.fixture
async def alice_other(client):
    return await _login(client, _OTHER_USER_EMAIL)


def _imp_body() -> dict:
    return {"jobType": "customer_bulk_upload", "entityKey": "customer"}


async def _create_validated_import(client, alice) -> str:
    """Drive a fresh ImportJob to the READY_TO_IMPORT state — the only place
    from which a real engine COULD legitimately fire /start. The fail-closed
    check fires regardless of source state in v1, so we use this purely to
    make the post-precondition realistic + match the lifecycle the audit
    flagged in routers/imports_exports.py:272-314."""
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    assert c.status_code == 201, c.text
    iid = c.json()["id"]
    v = await client.post(f"/api/imports/{iid}/validate", headers=alice)
    assert v.status_code == 200, v.text
    assert v.json()["status"] == "READY_TO_IMPORT"
    return iid


# ════════════════════════════════════════════════════════════════════════════
# 1. /start fails closed with 503 when feature is disabled (the default).
# ════════════════════════════════════════════════════════════════════════════

async def test_import_start_returns_503_when_engine_disabled(client, alice):
    """With ``feature_import_engine_enabled=False`` (the default in every
    deployment that ships this build), POST /imports/{id}/start must refuse
    with HTTP 503 and a structured ``feature_disabled`` body. The body shape
    is the contract the frontend / partner integrations key off — keep it
    tight."""
    iid = await _create_validated_import(client, alice)
    r = await client.post(f"/api/imports/{iid}/start", headers=alice)
    assert r.status_code == 503, r.text
    body = r.json()
    # FastAPI wraps the dict-shaped ``detail`` under a top-level "detail" key.
    detail = body.get("detail", body)
    assert detail.get("error") == "feature_disabled"
    assert detail.get("feature") == "import_engine"
    assert "Validation" in detail.get("reason", "")  # dry-run still on the menu


# ════════════════════════════════════════════════════════════════════════════
# 2. /validate stays available — it's a metadata-only stub, not an ingest claim.
# ════════════════════════════════════════════════════════════════════════════

async def test_import_validate_still_works_as_metadata(client, alice):
    """The validate endpoint is correctly a dry-run stub (it doesn't claim to
    actually ingest data — just flips status DRAFT→READY_TO_IMPORT after a
    placeholder check). It MUST stay available when the engine is disabled,
    otherwise customers can't even see whether their file is shaped right."""
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    assert c.status_code == 201, c.text
    iid = c.json()["id"]

    r = await client.post(f"/api/imports/{iid}/validate", headers=alice)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "READY_TO_IMPORT"


# ════════════════════════════════════════════════════════════════════════════
# 3. Every blocked /start leaves an audit row.
# ════════════════════════════════════════════════════════════════════════════

async def test_import_block_emits_audit_event(client, alice):
    """A blocked attempt must show up in the audit log as
    ``IMPORT_ENGINE_DISABLED_BLOCKED`` so SuperAdmin can see refusals. The
    emit is wrapped in try/except in the router — it's best-effort, never
    swallows the 503 — but the happy path (PG up, Event table available) is
    what production runs in, so we assert the row is there."""
    iid = await _create_validated_import(client, alice)

    r = await client.post(f"/api/imports/{iid}/start", headers=alice)
    assert r.status_code == 503

    async with OwnerSessionLocal() as s:
        rows = (await s.execute(
            select(Event).where(Event.type == "IMPORT_ENGINE_DISABLED_BLOCKED")
        )).scalars().all()
        matched = [
            e for e in rows
            if (e.data or {}).get("importJobId") == iid
        ]
        assert matched, "expected IMPORT_ENGINE_DISABLED_BLOCKED audit event"
        ev = matched[-1]
        assert ev.entity_key == "import_job"
        assert str(ev.record_id) == iid
        assert (ev.data or {}).get("reason") == "import_engine_enabled=False"


# ════════════════════════════════════════════════════════════════════════════
# 4. Read-only metadata endpoints stay tenant-scoped and unaffected.
# ════════════════════════════════════════════════════════════════════════════

async def test_import_list_and_get_unaffected(client, alice, alice_other):
    """The list and get endpoints don't claim to ingest anything — they just
    expose metadata about jobs the tenant created. The kill switch must not
    blind tenants to their own DRAFT/READY_TO_IMPORT rows. Also re-asserts
    tenant scoping: alice_other (different tenant) cannot see alice's job."""
    c = await client.post("/api/imports", headers=alice, json=_imp_body())
    assert c.status_code == 201, c.text
    iid = c.json()["id"]

    # GET /imports — alice can see her own row.
    listed = await client.get("/api/imports", headers=alice)
    assert listed.status_code == 200, listed.text
    assert any(j["id"] == iid for j in listed.json())

    # GET /imports/{id} — same.
    single = await client.get(f"/api/imports/{iid}", headers=alice)
    assert single.status_code == 200, single.text
    assert single.json()["id"] == iid

    # And critically: tenant boundary holds — alice_other gets 404 / does not
    # see the row in her own list. This is the existing RLS behavior; the
    # kill-switch change must not weaken it.
    other_single = await client.get(f"/api/imports/{iid}", headers=alice_other)
    assert other_single.status_code == 404
    other_list = await client.get("/api/imports", headers=alice_other)
    assert other_list.status_code == 200
    assert not any(j["id"] == iid for j in other_list.json())
