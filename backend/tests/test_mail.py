"""Mail module killer tests (MAILBOX-MODULE-PLAN.md §11) — Phase A.

KT-MAIL-1 — cross-tenant isolation: tenant A configures account A; a foreign tenant B account
            (seeded via the owner role) is never listed/readable by A → 404.
KT-MAIL-3 — notification via tenant's OWN SMTP: a system-sender account's send dials THAT account's
            smtp_host (never a global setting), records an OutboundMessage, emits MAIL_SENT.

Cross-tenant rows are seeded via OwnerSessionLocal (RLS-bypassing owner) so the test is correct under
both the `backend` (owner) and `backend-rls` (gaahex_app NOSUPERUSER) jobs. The SMTP transport is
mocked — no real server.
"""
import uuid
from unittest.mock import patch, AsyncMock

from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import MailAccount, User, Event, OutboundMessage, Tenant


async def _admin() -> tuple[uuid.UUID, uuid.UUID]:
    """(admin tenant_id, admin user_id) for the demo tenant = tenant A."""
    async with OwnerSessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        return u.tenant_id, u.id


async def test_mail_cross_tenant_send_isolation(client, admin):
    _tenant_a, admin_id = await _admin()

    # ── foreign tenant B + a mail account for it, inserted via the owner role (bypasses RLS).
    async with OwnerSessionLocal() as s:
        other = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        b = MailAccount(
            tenant_id=other.id, display_name="B Mail", email_address="ops@ispb.am",
            imap_host="imap.ispb.am", smtp_host="smtp.ispb.am", created_by=admin_id,
        )
        s.add(b)
        await s.commit()
        foreign_id = str(b.id)

    # ── tenant A configures its own account via the API.
    created = await client.post("/api/mail/accounts", headers=admin, json={
        "display_name": "A Support", "email_address": "support@ispa.am",
        "imap_host": "imap.ispa.am", "smtp_host": "smtp.ispa.am", "password": "sekret",
    })
    assert created.status_code == 201, created.text
    a_id = created.json()["id"]
    assert created.json()["has_password"] is True
    # the secret value + the raw column name are never returned (has_password boolean is fine)
    assert "sekret" not in created.text
    assert "secret_password" not in created.text

    # ── A sees A's account, never B's (RLS tenant fence).
    listed = (await client.get("/api/mail/accounts", headers=admin)).json()
    ids = {a["id"] for a in listed}
    assert a_id in ids
    assert foreign_id not in ids
    # ── direct fetch of B's account → 404 (never leak existence).
    assert (await client.get(f"/api/mail/accounts/{foreign_id}", headers=admin)).status_code == 404


async def test_mail_notification_via_tenant_own_smtp(client, admin):
    tenant_a, _admin_id = await _admin()

    # ── tenant A's system-sender account (carries invoice/dunning mail).
    r = await client.post("/api/mail/accounts", headers=admin, json={
        "display_name": "A Billing", "email_address": "billing@ispa.am",
        "imap_host": "imap.ispa.am", "smtp_host": "smtp.ispa.am",
        "smtp_port": 587, "smtp_security": "STARTTLS", "password": "billpass",
        "is_system_sender": True,
    })
    assert r.status_code == 201, r.text
    billing_id = r.json()["id"]

    try:
        # ── send with the SMTP transport mocked — assert it dialed A's OWN host.
        with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
            sent = await client.post("/api/mail/messages/send", headers=admin, json={
                "to": "customer@example.com", "subject": "Your invoice is overdue",
                "text": "Please settle invoice INV-000123.",
            })
        assert sent.status_code == 200, sent.text
        assert sent.json()["smtp_host"] == "smtp.ispa.am"
        assert mock_send.await_count == 1
        assert mock_send.await_args.kwargs["hostname"] == "smtp.ispa.am"   # NOT a global settings.smtp_host
        assert mock_send.await_args.kwargs["port"] == 587

        # ── OutboundMessage logged + MAIL_SENT emitted, scoped to tenant A.
        async with OwnerSessionLocal() as s:
            om = (await s.execute(
                select(OutboundMessage).where(
                    OutboundMessage.tenant_id == tenant_a,
                    OutboundMessage.channel == "email",
                    OutboundMessage.to_addr == "customer@example.com",
                )
            )).scalars().first()
            assert om is not None and om.status == "SENT"
            ev = (await s.execute(
                select(Event).where(Event.tenant_id == tenant_a, Event.type == "MAIL_SENT")
            )).scalars().first()
            assert ev is not None
            assert ev.data.get("smtp_host") == "smtp.ispa.am"
    finally:
        # Soft-delete the system sender so it never contaminates later tests' email dispatch
        # (_tenant_system_sender filters deletion_state='ACTIVE').
        await client.delete(f"/api/mail/accounts/{billing_id}", headers=admin)


async def test_mail_notification_dispatch_routes_via_tenant_system_sender(client):
    """The notification path itself (channels.dispatch, channel='email') routes through the tenant's
    own SMTP when a system-sender mailbox exists. Uses a throwaway tenant so it never touches the demo
    tenant's dispatch behavior."""
    from app.db import SessionLocal, set_tenant_guc
    from app.channels import dispatch

    # throwaway tenant + a system-sender account (owner role; created_by reuses the demo admin id).
    _ta, admin_id = await _admin()
    async with OwnerSessionLocal() as s:
        t = Tenant(name=f"Dispatch ISP {uuid.uuid4().hex[:6]}")
        s.add(t)
        await s.flush()
        s.add(MailAccount(
            tenant_id=t.id, display_name="Notify", email_address="notify@ispc.am",
            imap_host="imap.ispc.am", smtp_host="smtp.ispc.am", is_system_sender=True,
            secret_password="pw", created_by=admin_id,
        ))
        await s.commit()
        tc = t.id

    with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
        async with SessionLocal() as s:
            await set_tenant_guc(s, tc)
            msg = await dispatch(s, tenant_id=tc, channel="email",
                                 to="cust@example.com", subject="Receipt", body="thanks")
            await s.commit()
    assert mock_send.await_count == 1
    assert mock_send.await_args.kwargs["hostname"] == "smtp.ispc.am"   # routed via the tenant's own SMTP
    assert msg is not None and msg.status == "SENT"


async def test_mail_inbound_sync_attachment_and_flag_roundtrip():
    """KT-MAIL-2 — ingest one message with one attachment: MailMessage + MailAttachment persisted,
    attachment bytes round-trip through the StorageBackend, and a re-poll of the SAME (uidvalidity,
    uid) is idempotent (no duplicate row) with the locally-set seen flag preserved."""
    from email.message import EmailMessage as _EmailMessage
    from app.services.mail_sync import ingest_message, set_message_flag
    from app.services.storage.factory import get_storage_backend
    from app.models import MailFolder, MailMessage, MailAttachment

    _ta, admin_id = await _admin()
    em = _EmailMessage()
    em["From"] = "sender@example.com"
    em["To"] = "me@ispd.am"
    em["Subject"] = "Your statement"
    em["Message-ID"] = "<stmt-1@example.com>"
    em["Date"] = "Tue, 10 Jun 2026 10:00:00 +0000"
    em.set_content("Please find your statement attached.")
    em.add_attachment(b"%PDF-1.4 fake bytes", maintype="application", subtype="pdf", filename="statement.pdf")
    raw = em.as_bytes()

    # ── set up a throwaway tenant + account + INBOX folder (owner role).
    async with OwnerSessionLocal() as s:
        t = Tenant(name=f"Sync ISP {uuid.uuid4().hex[:6]}")
        s.add(t)
        await s.flush()
        acc = MailAccount(tenant_id=t.id, display_name="D", email_address="me@ispd.am",
                          imap_host="imap.ispd.am", smtp_host="smtp.ispd.am", created_by=admin_id)
        s.add(acc)
        await s.flush()
        fol = MailFolder(tenant_id=t.id, account_id=acc.id, imap_path="INBOX",
                         display_name="Inbox", role="INBOX")
        s.add(fol)
        await s.flush()
        acc_id, fol_id, tenant_id = acc.id, fol.id, t.id

        # ── ingest #1
        m1 = await ingest_message(s, account=acc, folder=fol, uid=101, uidvalidity=42, flags=[], raw_bytes=raw)
        await s.commit()
        mid = m1.id

    async with OwnerSessionLocal() as s:
        atts = (await s.execute(select(MailAttachment).where(MailAttachment.message_id == mid))).scalars().all()
        assert len(atts) == 1 and atts[0].filename == "statement.pdf"
        assert (await get_storage_backend().retrieve(storage_key=atts[0].storage_key)) == b"%PDF-1.4 fake bytes"
        m = (await s.execute(select(MailMessage).where(MailMessage.id == mid))).scalar_one()
        assert m.has_attachments is True
        assert (m.body_text or "").strip() == "Please find your statement attached."
        assert m.seen is False
        # ── set seen locally (the router PATCH path)
        await set_message_flag(s, m, flag="seen", value=True)
        await s.commit()

    # ── re-poll the SAME uid (now carrying \Seen): idempotent, no duplicate, flag preserved.
    async with OwnerSessionLocal() as s:
        acc = (await s.execute(select(MailAccount).where(MailAccount.id == acc_id))).scalar_one()
        fol = (await s.execute(select(MailFolder).where(MailFolder.id == fol_id))).scalar_one()
        m2 = await ingest_message(s, account=acc, folder=fol, uid=101, uidvalidity=42,
                                  flags=[b"\\Seen"], raw_bytes=raw)
        await s.commit()
        rows = (await s.execute(
            select(MailMessage).where(MailMessage.account_id == acc_id, MailMessage.uid == 101)
        )).scalars().all()
        assert len(rows) == 1, "re-poll must not duplicate the message"
        assert m2.id == mid
        assert m2.seen is True, "locally-set seen flag must survive the re-poll"


async def test_mail_phase_c2_contract(client, admin):
    """Phase C.2 — the reconciled backend↔frontend contract end-to-end: secret_password create,
    PATCH update, attachment upload, send with MailAddress[] + attachment, and the inbound list/read
    field shapes (from_addr/from_name/to_addrs[]/flag_*/unseen_count) the UI consumes."""
    from email.message import EmailMessage as _EM
    from app.services.mail_sync import ingest_message
    from app.models import MailFolder

    tenant_a, _admin_id = await _admin()
    created = await client.post("/api/mail/accounts", headers=admin, json={
        "display_name": "C2", "email_address": "c2@ispa.am",
        "imap_host": "imap.ispa.am", "smtp_host": "smtp.ispa.am",
        "imap_port": 993, "smtp_port": 465, "imap_security": "SSL", "smtp_security": "SSL",
        "auth_type": "PASSWORD", "secret_password": "pw",   # frontend field name
    })
    assert created.status_code == 201, created.text
    acc_id = created.json()["id"]
    assert created.json()["has_password"] is True

    try:
        # PATCH (updateAccount)
        patched = await client.patch(f"/api/mail/accounts/{acc_id}", headers=admin, json={"display_name": "C2 Renamed"})
        assert patched.status_code == 200 and patched.json()["display_name"] == "C2 Renamed"

        # upload an attachment → opaque id (storage key)
        up = await client.post("/api/mail/attachments", headers=admin,
                               files={"file": ("note.txt", b"hello-bytes", "text/plain")})
        assert up.status_code == 200, up.text
        att_id = up.json()["attachment_id"]

        # send with to = MailAddress[] + the uploaded attachment (SMTP mocked)
        with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
            sent = await client.post("/api/mail/messages/send", headers=admin, json={
                "account_id": acc_id,
                "to": [{"name": "Cust", "email": "cust@example.com"}],
                "subject": "Hi", "text": "body", "attachment_ids": [att_id],
            })
        assert sent.status_code == 200, sent.text
        assert sent.json()["status"] == "SENT" and sent.json()["message_id"]
        assert mock_send.await_args.kwargs["hostname"] == "smtp.ispa.am"
        mime = mock_send.await_args.args[0]
        assert any(p.get_filename() for p in mime.iter_attachments()), "uploaded attachment must be on the MIME"

        # ingest an inbound message, then read it back through the API with the new field shapes
        em = _EM()
        em["From"] = "Bob <bob@x.com>"; em["To"] = "c2@ispa.am"; em["Subject"] = "Inbound"
        em["Date"] = "Tue, 10 Jun 2026 10:00:00 +0000"; em.set_content("inbound body")
        async with OwnerSessionLocal() as s:
            acc = (await s.execute(select(MailAccount).where(MailAccount.id == uuid.UUID(acc_id)))).scalar_one()
            fol = MailFolder(tenant_id=acc.tenant_id, account_id=acc.id, imap_path="INBOX",
                             display_name="Inbox", role="INBOX")
            s.add(fol); await s.flush()
            msg = await ingest_message(s, account=acc, folder=fol, uid=5, uidvalidity=1, flags=[], raw_bytes=em.as_bytes())
            await s.commit(); msg_id = str(msg.id)

        lst = await client.get(f"/api/mail/messages?account_id={acc_id}", headers=admin)
        assert lst.status_code == 200
        row = next(m for m in lst.json() if m["id"] == msg_id)
        assert row["from_addr"] == "bob@x.com" and row["from_name"] == "Bob"
        assert row["to_addrs"] == [{"name": None, "email": "c2@ispa.am"}]
        assert row["flag_seen"] is False and row["account_id"] == acc_id

        folders = await client.get(f"/api/mail/accounts/{acc_id}/folders", headers=admin)
        assert all("unseen_count" in f and "account_id" in f for f in folders.json())

        full = await client.get(f"/api/mail/messages/{msg_id}", headers=admin)   # marks seen
        assert (full.json()["body_text"] or "").strip() == "inbound body"
        assert "cc_addrs" in full.json() and "attachments" in full.json()

        pf = await client.patch(f"/api/mail/messages/{msg_id}", headers=admin, json={"flagged": True})
        assert pf.json()["flag_flagged"] is True

        assert (await client.delete(f"/api/mail/messages/{msg_id}", headers=admin)).status_code == 204
    finally:
        await client.delete(f"/api/mail/accounts/{acc_id}", headers=admin)
