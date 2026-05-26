"""Coverage for notification channel adapters + the outbound delivery log (channels.py + notifications.py).

A NotificationDef whose `channel` is non-inapp ALSO fans out through channels.dispatch, which records
an OutboundMessage (SENT on adapter success, FAILED on raise). in-app defs record NO outbound row
(the inbox Notification is the delivery). GET /api/outbound is config.manage-gated and tenant-scoped.

Delivery is driven through real events: admin creates+transitions a group-owned record, so the
resolved recipient is the AGENT (its team node is under `grp`); the admin actor is excluded. Unique
def/entity keys per test (shared session DB accumulates).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, Tenant
from app.models.notification import NotificationDef
from app.models.outbound import OutboundMessage


async def _seed_def(tenant_id, key, *, channel, category):
    async with SessionLocal() as s:
        s.add(NotificationDef(tenant_id=tenant_id, key=key, label=key, channel=channel,
                              category=category, priority="info",
                              title_template="Hi {name}", body_template="Body {status}", enabled=True))
        await s.commit()


async def _tenant_id():
    async with SessionLocal() as s:
        return (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one().tenant_id


async def _mk_entity(client, admin, key, slug):
    body = {
        "key": key, "label": key.title(), "label_plural": f"{key}s", "route_slug": slug, "icon": "x",
        "fields": [{"key": "name", "label": "Name", "type": "text", "required": True},
                   {"key": "status", "label": "Status", "type": "status"}],
        "statuses": [{"key": "OPEN", "label": "Open", "is_initial": True}, {"key": "DONE", "label": "Done"}],
        "transitions": [{"from": "OPEN", "to": "DONE", "guard": None}],
    }
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201


async def _drive(client, admin, slug):
    rid = (await client.post(f"/api/{slug}", headers=admin, json={"name": "Thing"})).json()["id"]
    assert (await client.post(f"/api/{slug}/{rid}/transition", headers=admin, json={"to": "DONE"})).status_code == 200
    return rid


async def _outbound_for(def_key):
    async with SessionLocal() as s:
        return (await s.execute(
            select(OutboundMessage).where(OutboundMessage.def_key == def_key)
        )).scalars().all()


# ===================== channel → outbound row =====================

async def test_email_channel_records_outbound_sent(client, admin):
    tenant = await _tenant_id()
    await _seed_def(tenant, "chemail.done", channel="email", category="chcat_email")
    await _mk_entity(client, admin, "chemail", "ch-email")
    await _drive(client, admin, "ch-email")

    rows = await _outbound_for("chemail.done")
    assert len(rows) == 1
    msg = rows[0]
    assert msg.channel == "email" and msg.status == "SENT"      # email adapter logs + recipient has an address
    assert msg.to_addr == "agent@demo.isp"                      # resolved from User.email


async def test_sms_without_address_records_failed(client, admin):
    tenant = await _tenant_id()
    await _seed_def(tenant, "chsms.done", channel="sms", category="chcat_sms")
    await _mk_entity(client, admin, "chsms", "ch-sms")
    await _drive(client, admin, "ch-sms")

    rows = await _outbound_for("chsms.done")
    assert len(rows) == 1
    assert rows[0].channel == "sms" and rows[0].status == "FAILED"   # no phone on User → graceful FAILED
    assert "phone" in (rows[0].error or "")


async def test_inapp_records_no_outbound(client, admin):
    tenant = await _tenant_id()
    await _seed_def(tenant, "chinapp.done", channel="inapp", category="chcat_inapp")
    await _mk_entity(client, admin, "chinapp", "ch-inapp")
    await _drive(client, admin, "ch-inapp")
    assert await _outbound_for("chinapp.done") == []            # inbox row is the delivery; no outbound log


# ===================== GET /api/outbound =====================

async def test_outbound_list_filters_and_tenant_scope(client, admin):
    tenant = await _tenant_id()
    await _seed_def(tenant, "chlist.done", channel="email", category="chcat_list")
    await _mk_entity(client, admin, "chlist", "ch-list")
    await _drive(client, admin, "ch-list")

    # a foreign-tenant outbound row that must never appear here
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        s.add(OutboundMessage(tenant_id=other.id, channel="email", to_addr="x@y.z",
                              body="foreign", status="SENT", def_key="foreign.def"))
        await s.commit()

    by_channel = (await client.get("/api/outbound?channel=email", headers=admin)).json()
    assert all(m["channel"] == "email" for m in by_channel)
    assert "chlist.done" in {m["def_key"] for m in by_channel}
    assert "foreign.def" not in {m["def_key"] for m in by_channel}   # tenant-scoped

    by_status = (await client.get("/api/outbound?status=SENT", headers=admin)).json()
    assert all(m["status"] == "SENT" for m in by_status)


async def test_outbound_requires_config_manage(client, agent):
    assert (await client.get("/api/outbound", headers=agent)).status_code == 403
