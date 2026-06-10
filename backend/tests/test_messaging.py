"""Messaging channels killer tests — per-tenant SMS/Telegram/WhatsApp (the Mail pattern).

KT-CHAN-1 — cross-tenant isolation: a foreign tenant's channel account is never listed by another.
KT-CHAN-2 — Telegram send dials the TENANT'S OWN bot token (per-tenant), records OutboundMessage SENT.
KT-CHAN-3 — Viva-SMS stub fails closed (MessagingNotConfigured → OutboundMessage FAILED), never crashes.

Telegram HTTP is mocked. Throwaway tenants (owner-seeded) keep the demo tenant's dispatch uncontaminated.
"""
import uuid
from unittest.mock import patch

from sqlalchemy import select

from app.db import OwnerSessionLocal, SessionLocal, set_tenant_guc
from app.models import TenantChannelAccount, User, Tenant, OutboundMessage
from app import channels


async def _admin():
    async with OwnerSessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        return u.tenant_id, u.id


class _FakeResp:
    def __init__(self, payload): self.status_code = 200; self._p = payload; self.text = ""
    def json(self): return self._p


class _FakeClient:
    """Async-context httpx stand-in capturing the outbound call."""
    def __init__(self, captured): self._cap = captured
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def post(self, url, json=None, **kw):
        self._cap["url"] = url; self._cap["json"] = json
        return _FakeResp({"ok": True, "result": {"message_id": 7}})


async def test_channel_cross_tenant_isolation(client, admin):
    _ta, admin_id = await _admin()
    async with OwnerSessionLocal() as s:
        other = Tenant(name=f"Chan ISP {uuid.uuid4().hex[:6]}")
        s.add(other); await s.flush()
        s.add(TenantChannelAccount(
            tenant_id=other.id, channel="TELEGRAM", provider="telegram_bot",
            display_name="B Bot", secret_token="B-TOKEN", created_by=admin_id))
        await s.commit()
        foreign_id = str((await s.execute(
            select(TenantChannelAccount).where(TenantChannelAccount.tenant_id == other.id)
        )).scalars().first().id)

    created = await client.post("/api/messaging/accounts", headers=admin, json={
        "channel": "TELEGRAM", "display_name": "A Bot", "secret_token": "A-TOKEN", "sender_id": "@a_isp"})
    assert created.status_code == 201, created.text
    assert created.json()["has_token"] is True and "A-TOKEN" not in created.text
    a_id = created.json()["id"]
    try:
        listed = (await client.get("/api/messaging/accounts", headers=admin)).json()
        ids = {a["id"] for a in listed}
        assert a_id in ids and foreign_id not in ids   # RLS tenant fence
    finally:
        await client.delete(f"/api/messaging/accounts/{a_id}", headers=admin)   # avoid demo-tenant contamination


async def test_channel_telegram_send_via_tenant_own_bot():
    """KT-CHAN-2 — a throwaway tenant's Telegram account; dispatch dials ITS bot token."""
    _ta, admin_id = await _admin()
    async with OwnerSessionLocal() as s:
        t = Tenant(name=f"TG ISP {uuid.uuid4().hex[:6]}"); s.add(t); await s.flush()
        s.add(TenantChannelAccount(
            tenant_id=t.id, channel="TELEGRAM", provider="telegram_bot",
            display_name="Notifier", secret_token="BOT-TENANT-XYZ", created_by=admin_id))
        await s.commit(); tid = t.id

    captured = {}
    with patch("app.utils.http_client.get_async_client", lambda **kw: _FakeClient(captured)):
        async with SessionLocal() as s:
            await set_tenant_guc(s, tid)
            msg = await channels.dispatch(s, tenant_id=tid, channel="telegram", to="123456",
                                          subject=None, body="your service is active")
            await s.commit()
    assert "botBOT-TENANT-XYZ" in captured["url"], "must dial the tenant's OWN bot token"
    assert captured["json"]["chat_id"] == "123456"
    assert msg is not None and msg.status == "SENT"


async def test_channel_sms_stub_fails_closed():
    """KT-CHAN-3 — Viva-SMS gateway is a stub; a send is recorded FAILED (not a crash) until creds land."""
    _ta, admin_id = await _admin()
    async with OwnerSessionLocal() as s:
        t = Tenant(name=f"SMS ISP {uuid.uuid4().hex[:6]}"); s.add(t); await s.flush()
        s.add(TenantChannelAccount(
            tenant_id=t.id, channel="SMS", provider="viva_armenia",
            display_name="Viva", sender_id="HouseNet", created_by=admin_id))
        await s.commit(); tid = t.id

    async with SessionLocal() as s:
        await set_tenant_guc(s, tid)
        msg = await channels.dispatch(s, tenant_id=tid, channel="sms", to="+37491000000",
                                      subject=None, body="hi")
        await s.commit()
    assert msg is not None and msg.status == "FAILED"
    assert "stub" in (msg.error or "").lower() or "pending" in (msg.error or "").lower()
