"""Coverage for outbound webhooks (webhooks.py).

A WebhookDef subscribes to kernel event types; workflow.emit fans matching events to dispatch_event,
which records a WebhookDelivery and attempts one signed POST (fail-soft — a bad URL ⇒ FAILED, never
raises). The secret is never returned raw (only `has_secret`). All endpoints are config.manage-gated.

Webhooks that subscribe to common events (e.g. "transition") use a fast-refused URL and are DELETED
in a finally block, so they don't fire on every later transition in the shared session.
"""

import uuid

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Tenant
from app.models.webhook import WebhookDef
from app.config import settings as _settings


@pytest.fixture(autouse=True)
def _allow_private_webhooks():
    """These tests intentionally use a loopback DEAD_URL (fast connection-refused). Opt into the
    E38 webhook_allow_private flag so the SSRF guard (secure-default-OFF) doesn't 422 them at create.
    C38's dedicated SSRF tests live in another module and keep the default (private = blocked)."""
    prev = _settings.webhook_allow_private
    _settings.webhook_allow_private = True
    yield
    _settings.webhook_allow_private = prev


async def _deactivate(client, admin, wid):
    """Stop a webhook firing on later events without deleting it (DELETE 500s once it has deliveries —
    see test_delete_webhook_with_deliveries / the bug report)."""
    await client.patch(f"/api/webhooks/{wid}", headers=admin, json={"active": False})

# A local port nothing listens on → connection refused fast (no 3s timeout stall).
DEAD_URL = "http://127.0.0.1:9/gaahex-hook"


# ===================== CRUD + secret hiding =====================

async def test_webhook_crud_and_secret_never_returned(client, admin):
    created = (await client.post("/api/webhooks", headers=admin, json={
        "name": "hookA", "url": DEAD_URL, "events": ["transition"], "secret": "supersecret"})).json()
    assert created["has_secret"] is True and "secret" not in created
    assert created["events"] == ["transition"] and created["active"] is True
    wid = created["id"]

    # list + get never expose the raw secret
    listed = next(w for w in (await client.get("/api/webhooks", headers=admin)).json() if w["id"] == wid)
    assert "secret" not in listed and listed["has_secret"] is True
    assert "secret" not in (await client.get(f"/api/webhooks/{wid}", headers=admin)).json()

    # patch events/active; unknown key → 422
    patched = (await client.patch(f"/api/webhooks/{wid}", headers=admin,
                                  json={"events": ["create", "transition"], "active": False})).json()
    assert patched["events"] == ["create", "transition"] and patched["active"] is False
    assert (await client.patch(f"/api/webhooks/{wid}", headers=admin, json={"bogus": 1})).status_code == 422

    # delete → gone
    assert (await client.delete(f"/api/webhooks/{wid}", headers=admin)).status_code == 204
    assert (await client.get(f"/api/webhooks/{wid}", headers=admin)).status_code == 404


# ===================== /test records a delivery =====================

async def test_webhook_test_endpoint_records_delivery(client, admin):
    wid = (await client.post("/api/webhooks", headers=admin, json={
        "name": "hookTest", "url": DEAD_URL, "events": ["test"]})).json()["id"]
    try:
        d = (await client.post(f"/api/webhooks/{wid}/test", headers=admin, json={"event_type": "test"})).json()
        assert d["event_type"] == "test" and d["status"] in ("SENT", "FAILED")   # recorded regardless of reachability
        assert d["attempts"] >= 1
        deliveries = (await client.get(f"/api/webhooks/{wid}/deliveries", headers=admin)).json()
        assert d["id"] in {x["id"] for x in deliveries}
    finally:
        await _deactivate(client, admin, wid)


# ===================== real kernel event fires a subscribed webhook =====================

async def test_real_transition_event_records_delivery(client, admin):
    wid = (await client.post("/api/webhooks", headers=admin, json={
        "name": "hookTransition", "url": DEAD_URL, "events": ["transition"]})).json()["id"]
    try:
        lead = (await client.post("/api/leads", headers=admin, json={"name": "wh lead", "phone": "+37411"})).json()
        assert (await client.post(f"/api/leads/{lead['id']}/transition", headers=admin,
                                  json={"to": "VALIDATED_LEAD"})).status_code == 200
        deliveries = (await client.get(f"/api/webhooks/{wid}/deliveries", headers=admin)).json()
        assert any(x["event_type"] == "TRANSITION" for x in deliveries)     # recorded (FAILED is fine)
    finally:
        await _deactivate(client, admin, wid)


async def test_unsubscribed_event_no_delivery(client, admin):
    # subscribed only to "payment" → a lead transition (create/transition events) must not deliver
    wid = (await client.post("/api/webhooks", headers=admin, json={
        "name": "hookPayment", "url": DEAD_URL, "events": ["payment"]})).json()["id"]
    try:
        lead = (await client.post("/api/leads", headers=admin, json={"name": "wh no", "phone": "+37412"})).json()
        await client.post(f"/api/leads/{lead['id']}/transition", headers=admin, json={"to": "VALIDATED_LEAD"})
        assert (await client.get(f"/api/webhooks/{wid}/deliveries", headers=admin)).json() == []
    finally:
        await _deactivate(client, admin, wid)


# ===================== guardrails + tenant isolation =====================

async def test_webhook_guardrails(client, admin, agent):
    # agent has no config.manage
    assert (await client.get("/api/webhooks", headers=agent)).status_code == 403
    assert (await client.post("/api/webhooks", headers=agent,
                              json={"name": "x", "url": DEAD_URL})).status_code == 403
    # unknown id → 404
    assert (await client.get(f"/api/webhooks/{uuid.uuid4()}", headers=admin)).status_code == 404
    # invalid url → 422
    assert (await client.post("/api/webhooks", headers=admin,
                              json={"name": "bad", "url": "ftp://nope"})).status_code == 422


async def test_webhook_tenant_isolation(client, admin):
    # a webhook in another tenant must never be listed/readable here
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        w = WebhookDef(tenant_id=other.id, name="foreign hook", url=DEAD_URL, events=["*"], active=True)
        s.add(w)
        await s.commit()
        foreign_id = str(w.id)

    assert foreign_id not in {w["id"] for w in (await client.get("/api/webhooks", headers=admin)).json()}
    assert (await client.get(f"/api/webhooks/{foreign_id}", headers=admin)).status_code == 404


# ===================== BUG-WHK1 — FIXED 2026-06-10 =====================
# Was xfail: DELETE /api/webhooks/{id} 500'd once the webhook had any WebhookDelivery, because
# the FK webhook_delivery.webhook_id had no ON DELETE action. Fixed by adding ON DELETE CASCADE
# (model `ondelete="CASCADE"` + migration b3c4d5e6f7a8). Now a mandatory green path.

async def test_delete_webhook_with_deliveries(client, admin):
    wid = (await client.post("/api/webhooks", headers=admin, json={
        "name": "hookDel", "url": DEAD_URL, "events": ["test"]})).json()["id"]
    await client.post(f"/api/webhooks/{wid}/test", headers=admin, json={"event_type": "test"})  # creates a delivery
    # a webhook can be deleted even after it has fired — deliveries cascade away.
    assert (await client.delete(f"/api/webhooks/{wid}", headers=admin)).status_code == 204
