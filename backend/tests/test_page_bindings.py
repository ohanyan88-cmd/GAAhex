"""Page-binding CRUD, auth gates, and audit-event emission."""
import pytest

BINDINGS_URL = "/api/page-bindings"


# ── helpers ──────────────────────────────────────────────────────────────────

async def _create(client, headers, component_key="table-1", entity_slug="customers", field_key=None, page_id=None):
    body: dict = {"component_key": component_key, "entity_slug": entity_slug}
    if field_key is not None:
        body["field_key"] = field_key
    if page_id is not None:
        body["page_id"] = page_id
    r = await client.post(BINDINGS_URL, headers=headers, json=body)
    return r


# ── create / list / delete ────────────────────────────────────────────────────

async def test_page_binding_create_list_delete(client, admin):
    # CREATE — with field_key
    r = await _create(client, admin, component_key="kpi-1", entity_slug="leads", field_key="status")
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["component_key"] == "kpi-1"
    assert b["entity_slug"] == "leads"
    assert b["field_key"] == "status"
    assert b["page_id"] is None
    bid = b["id"]

    # LIST — binding appears (no page_id filter → all tenant bindings)
    r = await client.get(BINDINGS_URL, headers=admin)
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert bid in ids

    # DELETE
    r = await client.delete(f"{BINDINGS_URL}/{bid}", headers=admin)
    assert r.status_code == 204

    # LIST — binding gone
    r = await client.get(BINDINGS_URL, headers=admin)
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert bid not in ids


# ── filter by page_id ─────────────────────────────────────────────────────────

async def test_page_binding_filter_by_page_id(client, admin):
    import uuid

    # M1-A Wave 7 (IDOR fix): create_binding now tenant-verifies any body-supplied
    # page_id via _studio_page_or_422. Seed a real StudioPage in the caller's
    # tenant first so the binding insert is allowed through.
    page_resp = await client.post(
        "/api/studio/pages",
        headers=admin,
        json={"key": f"pb-filter-{uuid.uuid4().hex[:8]}", "label": "Filter-by-page test"},
    )
    assert page_resp.status_code == 201, page_resp.text
    page_id = page_resp.json()["id"]

    # Create one with this page_id and one without
    r1 = await _create(client, admin, component_key="table-pg", entity_slug="invoices", page_id=page_id)
    assert r1.status_code == 201, r1.text
    bid_with_page = r1.json()["id"]

    r2 = await _create(client, admin, component_key="table-nopg", entity_slug="invoices")
    assert r2.status_code == 201, r2.text
    bid_no_page = r2.json()["id"]

    # Filter by page_id — only the first should appear
    r = await client.get(BINDINGS_URL, headers=admin, params={"page_id": page_id})
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert bid_with_page in ids
    assert bid_no_page not in ids

    # Cleanup
    await client.delete(f"{BINDINGS_URL}/{bid_with_page}", headers=admin)
    await client.delete(f"{BINDINGS_URL}/{bid_no_page}", headers=admin)


# ── 403 for non-admin (agent has no config.manage) ───────────────────────────

async def test_page_binding_403_for_non_admin(client, agent):
    # POST — must be denied
    r = await _create(client, agent, component_key="table-x", entity_slug="customers")
    assert r.status_code == 403, r.text

    # DELETE — gate fires before lookup, so a fake UUID is sufficient
    fake_id = "00000000-0000-0000-0000-000000000002"
    r = await client.delete(f"{BINDINGS_URL}/{fake_id}", headers=agent)
    assert r.status_code == 403, r.text


# ── audit events emitted on create / delete ───────────────────────────────────

async def test_page_binding_audit_events(client, admin):
    # CREATE
    r = await _create(client, admin, component_key="audit-comp", entity_slug="customers", field_key="email")
    assert r.status_code == 201, r.text
    bid = r.json()["id"]

    # Check create audit event
    r = await client.get(
        "/api/audit-log",
        headers=admin,
        params={"event_type": "page_binding.create", "limit": 50},
    )
    assert r.status_code == 200, r.text
    events = r.json()["items"]
    matching = [e for e in events if e.get("data", {}).get("binding_id") == bid]
    assert len(matching) >= 1, "Expected at least one create audit event"
    assert matching[0]["data"]["component_key"] == "audit-comp"

    # DELETE
    r = await client.delete(f"{BINDINGS_URL}/{bid}", headers=admin)
    assert r.status_code == 204

    # Check delete audit event
    r = await client.get(
        "/api/audit-log",
        headers=admin,
        params={"event_type": "page_binding.delete", "limit": 50},
    )
    assert r.status_code == 200, r.text
    events = r.json()["items"]
    matching = [e for e in events if e.get("data", {}).get("binding_id") == bid]
    assert len(matching) >= 1, "Expected at least one delete audit event"
