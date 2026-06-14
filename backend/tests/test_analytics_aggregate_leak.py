"""Aggregate-leakage protection on Reporting & Analytics endpoints (file 17 §8).

Counts (COUNT/SUM/AVG) leak existence information if they aggregate rows the caller cannot
view at the detail level. File 17 §8 says field-level + row-level view rules apply to UI, API,
EXPORT, REPORTS, SEARCH and AI views — counts must be gated identically.

This module exercises the `_assert_view_permission` gates + the `deletion_state` filter added
to `routers/analytics.py` and `routers/reports.py`.

Fixture pattern follows tests/test_attachments.py: per-module roles + users seeded into the
ambient demo tenant; unique emails to dodge cross-module contention.
"""
import uuid
from datetime import datetime, timezone

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy_utils import Ltree

from app.db import OwnerSessionLocal
from app.models import (
    Assignment,
    OrgNode,
    Record,
    RoleDef,
    Tenant,
)
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password


# --------------------------------------------------------------------------------------------
# Role profiles
# --------------------------------------------------------------------------------------------
# `al_admin` carries `*` (matches the demo admin's reach for analytics + every entity view).
# `al_customer_only` carries customer.view ONLY — explicitly NOT invoice/payment/workitem/lead.
# Both also carry analytics.view so they clear the outer `_gate(s, user)` and the response we
# care about is the per-entity assert, not the analytics gate.
_PROFILES = {
    "al_admin": ["*"],
    "al_customer_only": ["analytics.view", "customer.view"],
}

_USERS = {
    "alice":      ("alice-al@demo.isp",      "al_admin"),
    "restricted": ("restricted-al@demo.isp", "al_customer_only"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("al-123"), status="active")
        s.add(u)
        await s.flush()
    if not (await s.execute(
        select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id)
    )).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id,
                         region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_al_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
        root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1)
        )).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root", code="grp",
                           path=Ltree("grp"))
            s.add(root)
            await s.flush()

        role_ids = {}
        for rk, perms in _PROFILES.items():
            row = (await s.execute(
                select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == rk)
            )).scalar_one_or_none()
            if row is None:
                row = RoleDef(tenant_id=tenant.id, key=rk, label=rk, permissions=perms,
                              scope="tenant")
                s.add(row)
                await s.flush()
            else:
                row.permissions = perms
                row.scope = "tenant"
            role_ids[rk] = row.id

        for _, (email, rk) in _USERS.items():
            await _ensure(s, tenant_id=tenant.id, node_id=root.id, email=email,
                          role_id=role_ids[rk])
        await s.commit()

    yield

    async with OwnerSessionLocal() as s:
        emails = [e for (e, _) in _USERS.values()]
        users = (await s.execute(select(User).where(User.email.in_(emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "al-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client):
    return await _login(client, _USERS["alice"][0])


@pytest_asyncio.fixture
async def restricted(client):
    return await _login(client, _USERS["restricted"][0])


# ============================================================================================
# 1. Permission gates per entity — restricted user (has customer.view only)
# ============================================================================================

async def test_restricted_user_can_call_customer_aggregate(client, restricted):
    """sales-by-user aggregates Record(entity_key='customer') — gated on customer.view.

    Restricted user holds customer.view → must succeed (200).
    """
    r = await client.get("/api/analytics/sales-by-user", headers=restricted)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), dict)


async def test_restricted_user_blocked_from_invoice_aggregate_ar_aging(client, restricted):
    """ar-aging is a pure Invoice SUM bucket — gated on invoice.view.

    Restricted user lacks invoice.view → must 403, NEVER 200-with-empty (existence leak).
    """
    r = await client.get("/api/analytics/ar-aging", headers=restricted)
    assert r.status_code == 403, r.text
    assert "invoice" in r.json()["detail"].lower()


async def test_restricted_user_blocked_from_payment_aggregate_daily_heatmap(client, restricted):
    """daily-heatmap aggregates Payment — gated on payment.view.

    Restricted user lacks payment.view → 403.
    """
    r = await client.get("/api/analytics/daily-heatmap?days=7", headers=restricted)
    assert r.status_code == 403, r.text
    assert "payment" in r.json()["detail"].lower()


async def test_restricted_user_blocked_from_invoice_overview(client, restricted):
    """Overview aggregates invoices (AR + overdue) — first entity-gate is invoice.view.

    Restricted user lacks it → 403, not 200 with redacted fields.
    """
    r = await client.get("/api/analytics/overview", headers=restricted)
    assert r.status_code == 403, r.text


async def test_restricted_user_blocked_from_workitem_task_aging(client, restricted):
    """task-aging is a pure WorkItem aggregate — gated on workitem.view.

    Restricted user lacks workitem.view → 403.
    """
    r = await client.get("/api/analytics/task-aging", headers=restricted)
    assert r.status_code == 403, r.text
    assert "workitem" in r.json()["detail"].lower()


async def test_restricted_user_blocked_from_payment_weekly_trend(client, restricted):
    """weekly-trend is a Payment SUM + customer COUNT — gated on both payment.view and
    customer.view. Restricted user has customer.view but NOT payment.view → 403.
    """
    r = await client.get("/api/analytics/weekly-trend?weeks=4", headers=restricted)
    assert r.status_code == 403, r.text
    assert "payment" in r.json()["detail"].lower()


async def test_restricted_user_blocked_from_lead_pareto(client, restricted):
    """Generic /pareto/{entity_key} gates on the requested entity's view perm.

    Restricted user requests `lead` Pareto but lacks lead.view → 403.
    """
    r = await client.get("/api/analytics/pareto/lead", headers=restricted)
    assert r.status_code == 403, r.text
    assert "lead" in r.json()["detail"].lower()


# ============================================================================================
# 2. Admin (full perms) can call all endpoints (sanity — gates don't break the happy path)
# ============================================================================================

async def test_admin_can_call_all_aggregates(client, alice):
    for path in [
        "/api/analytics/overview",
        "/api/analytics/ar-aging",
        "/api/analytics/daily-heatmap?days=7",
        "/api/analytics/task-aging",
        "/api/analytics/weekly-trend?weeks=4",
        "/api/analytics/sales-by-user",
        "/api/analytics/leads-by-source",
        "/api/analytics/pareto/lead",
        "/api/analytics/sankey-leads",
    ]:
        r = await client.get(path, headers=alice)
        assert r.status_code == 200, f"{path} → {r.status_code}: {r.text}"


# ============================================================================================
# 3. Reports router — /reports/summary still respects entity gates
# ============================================================================================

async def test_reports_summary_only_lists_viewable_entities(client, restricted):
    """The /reports/summary endpoint skips entities the caller can't view.

    Restricted user has only customer.view → invoice/payment/lead entries must NOT appear.
    """
    r = await client.get("/reports/summary", headers=restricted)
    assert r.status_code == 200, r.text
    keys = {row["entity_key"] for row in r.json()}
    # customer.view is held → customer entity is allowed in the result
    # invoice/payment/lead are NOT held → they must NOT appear in the count list
    assert "invoice" not in keys
    assert "payment" not in keys
    assert "lead" not in keys


# ============================================================================================
# 4. deletion_state filter — soft-deleted Customer is excluded from the count
# ============================================================================================

async def test_soft_deleted_customer_excluded_from_sales_by_user(client, alice):
    """Seed a customer with a unique assigned_to, soft-delete it, and confirm sales-by-user
    excludes it (file 12 — D14 deletion_state filter on the aggregate).
    """
    unique_agent = f"al-agent-{uuid.uuid4().hex[:8]}"

    # Seed two customers under that agent: one ACTIVE, one SOFT_DELETED.
    async with OwnerSessionLocal() as s:
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        active = Record(
            tenant_id=admin.tenant_id, entity_key="customer", owner_node_id=None,
            status="ACTIVE", data={"name": f"AL Active {uuid.uuid4().hex[:6]}",
                                   "assigned_to": unique_agent},
            deletion_state="ACTIVE",
        )
        deleted = Record(
            tenant_id=admin.tenant_id, entity_key="customer", owner_node_id=None,
            status="ACTIVE", data={"name": f"AL Deleted {uuid.uuid4().hex[:6]}",
                                   "assigned_to": unique_agent},
            deletion_state="SOFT_DELETED",
            deleted_at=datetime.now(timezone.utc),
        )
        s.add_all([active, deleted])
        await s.commit()

    r = await client.get("/api/analytics/sales-by-user", headers=alice)
    assert r.status_code == 200, r.text
    by_agent = r.json()
    # Only the ACTIVE customer should be counted — the SOFT_DELETED row must be excluded.
    assert by_agent.get(unique_agent) == 1, (
        f"Expected exactly 1 ACTIVE customer for agent={unique_agent}; "
        f"got {by_agent.get(unique_agent)} (soft-deleted row leaked into count)"
    )


async def test_soft_deleted_lead_excluded_from_leads_by_source(client, alice):
    """leads-by-source must exclude SOFT_DELETED / PURGED lead Records."""
    unique_source = f"al-src-{uuid.uuid4().hex[:8]}"

    async with OwnerSessionLocal() as s:
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        active = Record(
            tenant_id=admin.tenant_id, entity_key="lead", owner_node_id=None,
            status="NEW", data={"name": f"AL Lead Live {uuid.uuid4().hex[:6]}",
                                "source": unique_source},
            deletion_state="ACTIVE",
        )
        purged = Record(
            tenant_id=admin.tenant_id, entity_key="lead", owner_node_id=None,
            status="NEW", data={"name": f"AL Lead Gone {uuid.uuid4().hex[:6]}",
                                "source": unique_source},
            deletion_state="PURGED",
            deleted_at=datetime.now(timezone.utc),
        )
        s.add_all([active, purged])
        await s.commit()

    r = await client.get("/api/analytics/leads-by-source", headers=alice)
    assert r.status_code == 200, r.text
    by_source = r.json()
    assert by_source.get(unique_source) == 1, (
        f"Expected exactly 1 ACTIVE lead for source={unique_source}; "
        f"got {by_source.get(unique_source)} (purged row leaked into count)"
    )
