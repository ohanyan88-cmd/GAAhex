"""Coverage for the governance audit log (audit_log.py).

Read-only admin view over the immutable Event log. Distinct from /api/activity:
gated on `audit.view` (SuperAdmin-tier); returns ALL tenant events the admin
can see (cross-entity, cross-actor), not org-scope filtered.

Shared session DB accumulates events from prior tests, so assertions key on
ids/values this test creates (or on filter narrowing rather than exact totals).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Tenant, Record, Event


async def _get(client, headers, query=""):
    r = await client.get(f"/api/audit-log{query}", headers=headers)
    assert r.status_code == 200, r.text
    return r


# ===================== happy path =====================

async def test_happy_path_returns_items_total_and_header(client, admin):
    # Generate at least one fresh event so the log is non-empty regardless of run order.
    lead = (await client.post("/api/leads", headers=admin, json={"name": "AuditHappy"})).json()
    lid = lead["id"]

    r = await _get(client, admin)
    body = r.json()
    assert isinstance(body, dict) and "items" in body and "total" in body
    assert isinstance(body["items"], list)
    assert isinstance(body["total"], int)
    assert body["total"] >= 1
    # X-Total-Count mirrors body.total for pagination compat with list views.
    assert int(r.headers.get("X-Total-Count") or r.headers.get("x-total-count")) == body["total"]

    # Default page size is 50 — never returns more than the cap.
    assert len(body["items"]) <= 50

    # Item shape matches the spec.
    sample = next(it for it in body["items"] if it["record_id"] == lid)
    assert set(sample) >= {
        "id", "type", "entity_key", "record_id",
        "actor_user_id", "actor_name", "data", "created_at",
    }
    # The create event came from the admin user — actor_name resolved via the User join.
    assert sample["type"] == "create"
    assert sample["entity_key"] == "lead"
    assert sample["actor_name"] == "Demo Admin"
    assert sample["actor_user_id"] is not None

    # Sort: newest first (created_at desc).
    ats = [it["created_at"] for it in body["items"]]
    assert ats == sorted(ats, reverse=True)


# ===================== filters =====================

async def test_entity_filter_narrows_results(client, admin):
    # Seed one lead + one ticket so both entity_keys exist in the log.
    await client.post("/api/leads", headers=admin, json={"name": "AuditEntLead"})
    await client.post("/api/tickets", headers=admin, json={"subject": "AuditEntTkt"})

    unfiltered = (await _get(client, admin, "?limit=500")).json()
    leads_only = (await _get(client, admin, "?entity=lead&limit=500")).json()
    tickets_only = (await _get(client, admin, "?entity=ticket&limit=500")).json()

    # Filter actually narrows (strict subset semantics): every item in the filtered
    # response carries that entity_key, and none of the OTHER-entity items leak in.
    assert leads_only["total"] >= 1
    assert tickets_only["total"] >= 1
    assert all(it["entity_key"] == "lead" for it in leads_only["items"])
    assert all(it["entity_key"] == "ticket" for it in tickets_only["items"])
    # Sanity: filtered totals are <= the unfiltered total.
    assert leads_only["total"] <= unfiltered["total"]
    assert tickets_only["total"] <= unfiltered["total"]


async def test_event_type_filter_supports_csv(client, admin):
    # Generate distinct event types: create + update + transition on the same lead.
    lead = (await client.post("/api/leads", headers=admin, json={"name": "AuditTypeF"})).json()
    lid = lead["id"]
    await client.patch(f"/api/leads/{lid}", headers=admin, json={"email": "t@x.io"})
    await client.post(f"/api/leads/{lid}/transition", headers=admin, json={"to": "CONTACTED"})

    creates = (await _get(client, admin, "?event_type=create&limit=500")).json()
    assert all(it["type"] == "create" for it in creates["items"])

    multi = (await _get(client, admin, "?event_type=create,update&limit=500")).json()
    assert all(it["type"] in {"create", "update"} for it in multi["items"])
    assert multi["total"] >= creates["total"]    # csv union is at least as large as a single type


async def test_pagination_and_limit_cap(client, admin):
    # limit/offset behave like the records engine; hard cap at 500.
    page = (await _get(client, admin, "?limit=2&offset=0")).json()
    assert len(page["items"]) <= 2
    assert page["total"] >= len(page["items"])

    # Hard cap: asking for > MAX returns a sane page (no 422), never more than MAX.
    capped = (await _get(client, admin, "?limit=99999")).json()
    assert len(capped["items"]) <= 500


async def test_since_until_filters(client, admin):
    # `until` set to far past → no rows; `since` set to far past → all rows.
    none_ish = (await _get(client, admin, "?until=2000-01-01T00:00:00Z")).json()
    assert none_ish["total"] == 0 and none_ish["items"] == []

    all_ish = (await _get(client, admin, "?since=2000-01-01T00:00:00Z&limit=500")).json()
    assert all_ish["total"] >= 1


async def test_invalid_timestamp_rejected(client, admin):
    r = await client.get("/api/audit-log?since=not-a-date", headers=admin)
    assert r.status_code == 422


async def test_unknown_actor_returns_empty(client, admin):
    # A random (well-formed) UUID that is no actor → 0 rows, never errors.
    r = await client.get(f"/api/audit-log?actor={uuid.uuid4()}", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 0 and body["items"] == []


# ===================== permission gate =====================

async def test_403_without_audit_view_permission(client, agent):
    # The seeded sales_agent role does NOT carry audit.view (only super_admin's "*" does).
    r = await client.get("/api/audit-log", headers=agent)
    assert r.status_code == 403
    assert "audit.view" in r.text


# ===================== tenant isolation =====================

async def test_tenant_isolated(client, admin):
    """An event for another tenant must never appear in this tenant's audit log."""
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        rec = Record(tenant_id=other.id, entity_key="lead", owner_node_id=None,
                     status="NEW", data={"name": "foreign audit"})
        s.add(rec)
        await s.flush()
        ev = Event(tenant_id=other.id, type="create", entity_key="lead",
                   record_id=rec.id, actor_user_id=None, data={})
        s.add(ev)
        await s.commit()
        foreign_event_id = str(ev.id)

    body = (await _get(client, admin, "?limit=500")).json()
    ids = {it["id"] for it in body["items"]}
    assert foreign_event_id not in ids


# ===================== permission is in the registry =====================

async def test_audit_view_permission_is_registered(client, admin):
    """The Studio Permissions matrix fetches /api/permissions — audit.view must show up there
    in the 'governance' group, so SuperAdmins can grant it via the UI."""
    r = await client.get("/api/permissions", headers=admin)
    assert r.status_code == 200
    perms = r.json()
    audit = next((p for p in perms if p["key"] == "audit.view"), None)
    assert audit is not None, "audit.view permission must be in the registry"
    assert audit["group"] == "governance"
    assert audit["label"] == "View audit log"
