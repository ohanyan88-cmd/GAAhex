"""Webhook Standard (file 12, standard 70) — extension coverage.

Tests cover the new columns + endpoint behavior layered on top of the existing webhook
module without breaking the legacy `active` / `status` paths:

  - subscription_status server-default = 'ACTIVE' on create
  - GET /api/webhooks/{id}/deliveries?status=&from=&to= filters by delivery_status + date
  - idempotency_key UNIQUE (partial) prevents duplicates within a tenant
  - event_name / correlation_id / causation_id round-trip on the delivery row
  - permission gate: nada (no config.manage) → 403 on the deliveries endpoint
  - cross-tenant 404: foreign tenant cannot list this tenant's webhook deliveries

Teardown order: WebhookDelivery → WebhookDef → Assignment → RefreshToken → User →
other-tenant RoleDef + OrgNode + Tenant.

Fixtures follow the test_attachments.py / test_relationships.py pattern verbatim — the
orchestrator runs this; we never run pytest here.
"""
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import OwnerSessionLocal
from app.models import Tenant, OrgNode, RoleDef, Assignment
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.webhook import WebhookDef, WebhookDelivery
from app.security import hash_password
from app.config import settings as _settings
from sqlalchemy_utils import Ltree


# These tests intentionally use a loopback DEAD_URL so the SSRF guard's secure-default
# would reject create. test_webhooks.py uses this same opt-in switch.
@pytest.fixture(autouse=True)
def _allow_private_webhooks():
    prev = _settings.webhook_allow_private
    _settings.webhook_allow_private = True
    yield
    _settings.webhook_allow_private = prev


# A local port nothing listens on → connection refused fast (no 3s timeout stall).
DEAD_URL = "http://127.0.0.1:9/gaahex-hook"


_PROFILES = {
    "whkx_full":     ["*"],
    "whkx_no_perm":  [],
}
_USERS = {
    "alice": ("alice-whkx@demo.isp", "whkx_full"),
    "nada":  ("nada-whkx@demo.isp",  "whkx_no_perm"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("whkx-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id))).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_whkx_users():
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
        other = (await s.execute(select(Tenant).where(Tenant.name == "Whkx-RLS-Other"))).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Whkx-RLS-Other", status="active"); s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root", code="rootW", path=Ltree("rootW")))
            await s.flush()
        other_root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1))).scalar_one()
        other_role = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "whkx_full")
        )).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="whkx_full", label="full",
                                 permissions=_PROFILES["whkx_full"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id,
                       email="alice-other-whkx@demo.isp", role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-whkx@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        # Wipe webhook deliveries + defs belonging to these tenants before the user delete.
        tenants_involved = {u.tenant_id for u in users}
        if tenants_involved:
            await s.execute(
                WebhookDelivery.__table__.delete().where(WebhookDelivery.tenant_id.in_(tenants_involved))
            )
            await s.execute(
                WebhookDef.__table__.delete().where(WebhookDef.tenant_id.in_(tenants_involved))
            )
        if uids:
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
    r = await client.post("/auth/login", json={"email": email, "password": "whkx-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])
@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])
@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-whkx@demo.isp")


# ── helpers ─────────────────────────────────────────────────────────────────

async def _create_webhook(client, hdr, *, name="whkx", events=("test",)):
    r = await client.post("/api/webhooks", headers=hdr, json={
        "name": name, "url": DEAD_URL, "events": list(events),
    })
    assert r.status_code == 201, r.text
    return r.json()


async def _resolve_tenant_id(client, hdr) -> uuid.UUID:
    """Return the tenant_id of the calling user by reading any WebhookDef they create."""
    w = await _create_webhook(client, hdr, name="whkx-tenant-probe")
    async with OwnerSessionLocal() as s:
        row = (await s.execute(
            select(WebhookDef).where(WebhookDef.id == uuid.UUID(w["id"]))
        )).scalar_one()
        return row.tenant_id


# ── subscription_status server-default ──────────────────────────────────────

async def test_create_webhook_defaults_subscription_status_active(client, alice):
    w = await _create_webhook(client, alice, name="whkx-default-status")
    # Server-default applies on insert — surfaced via the (extended) GET serializer.
    assert w["subscription_status"] == "ACTIVE"
    # Legacy `active` boolean is preserved for back-compat.
    assert w["active"] is True


# ── deliveries list endpoint: filter by delivery_status + date range ────────

async def test_list_deliveries_filters_by_delivery_status(client, alice):
    w = await _create_webhook(client, alice, name="whkx-list-status")
    wid = uuid.UUID(w["id"])
    # Insert 3 deliveries directly via the model so we control delivery_status.
    async with OwnerSessionLocal() as s:
        wh = (await s.execute(select(WebhookDef).where(WebhookDef.id == wid))).scalar_one()
        for ds in ("PENDING", "SENT", "FAILED"):
            s.add(WebhookDelivery(
                tenant_id=wh.tenant_id, webhook_id=wh.id, event_type="test",
                payload={}, status="QUEUED", attempts=0,
                delivery_status=ds, event_name="test.event", attempt_number=1,
            ))
        await s.commit()

    # No filter → all 3.
    r = await client.get(f"/api/webhooks/{wid}/deliveries", headers=alice)
    assert r.status_code == 200
    statuses = {d["delivery_status"] for d in r.json()}
    assert {"PENDING", "SENT", "FAILED"}.issubset(statuses)

    # Filter to SENT only.
    r = await client.get(f"/api/webhooks/{wid}/deliveries?status=SENT", headers=alice)
    assert r.status_code == 200
    rows = r.json()
    assert rows and all(d["delivery_status"] == "SENT" for d in rows)


async def test_list_deliveries_rejects_invalid_status(client, alice):
    w = await _create_webhook(client, alice, name="whkx-bad-status")
    r = await client.get(f"/api/webhooks/{w['id']}/deliveries?status=NONSENSE", headers=alice)
    assert r.status_code == 422


async def test_list_deliveries_filters_by_date_range(client, alice):
    w = await _create_webhook(client, alice, name="whkx-date-range")
    wid = uuid.UUID(w["id"])
    far_past = datetime(2000, 1, 1, tzinfo=timezone.utc)
    future = datetime.now(timezone.utc) + timedelta(days=365)
    # "from" in the far future yields zero rows even after inserting one.
    async with OwnerSessionLocal() as s:
        wh = (await s.execute(select(WebhookDef).where(WebhookDef.id == wid))).scalar_one()
        s.add(WebhookDelivery(
            tenant_id=wh.tenant_id, webhook_id=wh.id, event_type="test",
            payload={}, status="QUEUED", attempts=0, delivery_status="PENDING",
        ))
        await s.commit()
    r = await client.get(
        f"/api/webhooks/{wid}/deliveries", params={"from": future.isoformat()}, headers=alice
    )
    assert r.status_code == 200 and r.json() == []
    # "from" in the far past returns at least one row.
    r = await client.get(
        f"/api/webhooks/{wid}/deliveries", params={"from": far_past.isoformat()}, headers=alice
    )
    assert r.status_code == 200 and len(r.json()) >= 1


# ── idempotency_key partial UNIQUE ──────────────────────────────────────────

async def test_idempotency_key_unique_prevents_duplicates(client, alice):
    w = await _create_webhook(client, alice, name="whkx-idem-unique")
    wid = uuid.UUID(w["id"])
    key = f"idem-{uuid.uuid4()}"
    async with OwnerSessionLocal() as s:
        wh = (await s.execute(select(WebhookDef).where(WebhookDef.id == wid))).scalar_one()
        s.add(WebhookDelivery(
            tenant_id=wh.tenant_id, webhook_id=wh.id, event_type="test",
            payload={}, status="QUEUED", attempts=0,
            delivery_status="PENDING", idempotency_key=key,
        ))
        await s.commit()

    # Second insert with the same (tenant_id, idempotency_key) blows up.
    with pytest.raises(IntegrityError):
        async with OwnerSessionLocal() as s2:
            wh2 = (await s2.execute(select(WebhookDef).where(WebhookDef.id == wid))).scalar_one()
            s2.add(WebhookDelivery(
                tenant_id=wh2.tenant_id, webhook_id=wh2.id, event_type="test",
                payload={}, status="QUEUED", attempts=0,
                delivery_status="PENDING", idempotency_key=key,
            ))
            await s2.commit()


async def test_idempotency_key_null_does_not_collide(client, alice):
    """Partial INDEX WHERE idempotency_key IS NOT NULL → multiple NULL rows are fine."""
    w = await _create_webhook(client, alice, name="whkx-idem-null")
    wid = uuid.UUID(w["id"])
    async with OwnerSessionLocal() as s:
        wh = (await s.execute(select(WebhookDef).where(WebhookDef.id == wid))).scalar_one()
        for _ in range(3):
            s.add(WebhookDelivery(
                tenant_id=wh.tenant_id, webhook_id=wh.id, event_type="test",
                payload={}, status="QUEUED", attempts=0, delivery_status="PENDING",
                idempotency_key=None,
            ))
        await s.commit()  # No IntegrityError → partial index honors WHERE clause.


# ── event_name / correlation_id / causation_id round-trip ───────────────────

async def test_correlation_and_causation_round_trip(client, alice):
    w = await _create_webhook(client, alice, name="whkx-corr")
    wid = uuid.UUID(w["id"])
    corr = uuid.uuid4()
    caus = uuid.uuid4()
    async with OwnerSessionLocal() as s:
        wh = (await s.execute(select(WebhookDef).where(WebhookDef.id == wid))).scalar_one()
        s.add(WebhookDelivery(
            tenant_id=wh.tenant_id, webhook_id=wh.id, event_type="test",
            payload={}, status="QUEUED", attempts=0,
            delivery_status="PENDING",
            event_name="invoice.paid",
            correlation_id=corr,
            causation_id=caus,
            attempt_number=2,
        ))
        await s.commit()
    r = await client.get(f"/api/webhooks/{wid}/deliveries", headers=alice)
    assert r.status_code == 200
    rows = r.json()
    found = [d for d in rows if d["event_name"] == "invoice.paid"]
    assert found
    d = found[0]
    assert d["correlation_id"] == str(corr)
    assert d["causation_id"] == str(caus)
    assert d["attempt_number"] == 2


# ── permission gate ─────────────────────────────────────────────────────────

async def test_deliveries_denied_without_perm(client, alice, nada):
    w = await _create_webhook(client, alice, name="whkx-perm")
    r = await client.get(f"/api/webhooks/{w['id']}/deliveries", headers=nada)
    assert r.status_code == 403


# ── cross-tenant 404 (RLS) ──────────────────────────────────────────────────

async def test_cross_tenant_deliveries_404(client, alice, alice_other):
    w = await _create_webhook(client, alice, name="whkx-rls")
    # Other-tenant user must not see this webhook → _load() raises 404.
    r = await client.get(f"/api/webhooks/{w['id']}/deliveries", headers=alice_other)
    assert r.status_code == 404
