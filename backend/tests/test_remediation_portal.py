"""Portal + UI hardening remediation tests.

Covers three fixes locked together on 2026-06-04:

  * S3 (D14, CRITICAL) — Portal HTML XSS via dynamic interpolation in
    routers/portal_billing.py (invoice_document, payment_receipt).
  * H6 (D17, HIGH) — Content-Disposition filename injection in
    routers/attachments.py (download endpoint).
  * H5 (D12, HIGH) — IDOR on POST /api/workitems/{id}/assign that allowed a
    body-supplied user_id from another tenant to be written into
    WorkItem.assigned_user_id.

Each test reproduces the attack shape, asserts the fix neutralizes it, and (for
the happy-path case) confirms the legitimate flow still works.
"""
import io
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.billing import Invoice, InvoiceLine, Payment
from app.models.customer_user import CustomerUser
from app.models.record import Record
from app.models.tenant import Tenant
from app.models.user import User
from app.models.workitem import WorkItem
from app.security import hash_password


# ── shared portal-billing fixture ─────────────────────────────────────────────


@pytest_asyncio.fixture(scope="module")
async def xss_setup(client: AsyncClient, admin):
    """One customer with an attacker-controlled name + ISSUED invoice + paid Payment.

    The customer name and an InvoiceLine.description both carry the full XSS
    payload <script>alert(1)</script>. Payment.method is VARCHAR(20) so it
    carries a short tag-based payload (<b>x</b>) — long enough to prove the
    receipt route also escapes.
    """
    payload = "<script>alert(1)</script>"
    short_payload = "<b>x</b>"  # fits in Payment.method's VARCHAR(20)

    # Customer Record (entity_key='customer') with the attacker-controlled name.
    r = await client.post("/api/customers", headers=admin, json={"name": payload})
    assert r.status_code in (200, 201), r.text
    cid = r.json()["id"]

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        tid = tenant.id

        email = "xss_portal@test.isp"
        existing = (await s.execute(
            select(CustomerUser).where(
                CustomerUser.tenant_id == tid,
                CustomerUser.email == email,
            )
        )).scalar_one_or_none()
        if not existing:
            s.add(CustomerUser(
                tenant_id=tid, customer_id=cid, email=email,
                password_hash=hash_password("XssTest123"), is_active=True,
            ))

        inv = Invoice(
            tenant_id=tid, customer_id=uuid.UUID(cid),
            number="INV-XSS-001", status="ISSUED", total=12345,
        )
        s.add(inv)
        await s.flush()
        s.add(InvoiceLine(
            tenant_id=tid, invoice_id=inv.id,
            description=payload, quantity=1,
            unit_amount=12345, line_total=12345,
        ))
        # Payment.method is VARCHAR(20); use the short payload so the insert fits
        # but still exercises the escape path on the receipt.
        pay = Payment(
            tenant_id=tid, invoice_id=inv.id,
            amount=12345, method=short_payload,
        )
        s.add(pay)
        await s.commit()
        inv_id = str(inv.id)
        pay_id = str(pay.id)

    tok = (await client.post("/portal/auth/login", json={
        "email": email, "password": "XssTest123", "tenant_id": str(tid),
    })).json()["access_token"]

    return {
        "payload": payload,
        "short_payload": short_payload,
        "inv_id": inv_id,
        "pay_id": pay_id,
        "tok": tok,
    }


# ── S3: Portal HTML XSS ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_portal_invoice_html_escapes_xss_payload(client: AsyncClient, xss_setup):
    """invoice_document must HTML-escape every dynamic value.

    Raw <script>alert(1)</script> in customer name and line description must NOT
    appear as live markup in the response body. The escaped form &lt;script&gt;...
    is acceptable (and expected).
    """
    d = xss_setup
    r = await client.get(
        f"/portal/me/invoices/{d['inv_id']}/document",
        headers={"Authorization": f"Bearer {d['tok']}"},
    )
    assert r.status_code == 200, r.text
    body = r.text

    # The literal payload must never appear unescaped.
    assert "<script>alert(1)</script>" not in body, (
        "Raw <script> tag found in invoice HTML — XSS escape regression"
    )
    # The escaped form must appear (proves the value was rendered, just safely).
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in body, (
        "Expected HTML-escaped payload not found — render path may have broken"
    )


@pytest.mark.asyncio
async def test_portal_receipt_html_escapes_xss_payload(client: AsyncClient, xss_setup):
    """payment_receipt must HTML-escape every dynamic value (customer name,
    payment method, invoice number)."""
    d = xss_setup
    r = await client.get(
        f"/portal/me/payments/{d['pay_id']}/receipt",
        headers={"Authorization": f"Bearer {d['tok']}"},
    )
    assert r.status_code == 200, r.text
    body = r.text

    # Customer name carries the long payload — must not appear raw.
    assert "<script>alert(1)</script>" not in body, (
        "Raw <script> tag found in receipt HTML — XSS escape regression"
    )
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in body, (
        "Expected HTML-escaped customer name not found in receipt"
    )
    # Payment.method carries the short payload — also must not appear raw.
    assert "<b>x</b>" not in body, (
        "Raw <b> tag from Payment.method found in receipt HTML — XSS escape regression"
    )
    assert "&lt;b&gt;x&lt;/b&gt;" in body, (
        "Expected HTML-escaped payment method not found in receipt"
    )


# ── H6: Content-Disposition filename injection ────────────────────────────────


@pytest.mark.asyncio
async def test_attachment_filename_strips_crlf(client: AsyncClient, admin):
    """A filename carrying CRLF + quote + backslash must be sanitized before it
    lands in the Content-Disposition response header. None of those characters
    may survive in the header value."""
    parent_id = str(uuid.uuid4())
    evil = 'evil"\r\nSet-Cookie: a=1\\.txt'
    files = {"file": (evil, io.BytesIO(b"payload bytes"), "text/plain")}

    upload = await client.post(
        f"/api/ticket/{parent_id}/attachments",
        headers=admin, files=files, data={"category": "DOCUMENT"},
    )
    assert upload.status_code == 201, upload.text
    aid = upload.json()["id"]

    dl = await client.get(f"/api/attachments/{aid}/download", headers=admin)
    assert dl.status_code == 200, dl.text

    cd = dl.headers.get("content-disposition", "")
    # The dangerous characters must all be stripped from the header.
    assert "\r" not in cd
    assert "\n" not in cd
    # The injected Set-Cookie must not appear as a real header.
    assert "set-cookie" not in {k.lower() for k in dl.headers.keys()}
    # Only the quotes that wrap filename="..." may remain — the embedded
    # quote+backslash from the original name must be sanitized to underscores.
    # filename token format is: filename="<safe>"
    assert cd.count('"') == 2, f"Unexpected quote count in Content-Disposition: {cd!r}"


# ── H5: WorkItem /assign IDOR ─────────────────────────────────────────────────


async def _seed_other_tenant_user() -> uuid.UUID:
    """Insert tenant B + a User row in tenant B. Returns the user id."""
    async with OwnerSessionLocal() as o:
        other = Tenant(id=uuid.uuid4(), name="Remediation-Assign-Other", status="active")
        o.add(other)
        await o.flush()
        u = User(
            id=uuid.uuid4(),
            tenant_id=other.id,
            email=f"remediation-assign-{uuid.uuid4().hex[:8]}@other.isp",
            name="Cross-Tenant Stranger",
            password_hash=hash_password("irrelevant"),
            status="active",
        )
        o.add(u)
        await o.commit()
        return u.id


@pytest.mark.asyncio
async def test_workitem_assign_cross_tenant_rejected(client: AsyncClient, admin):
    """POST /api/workitems/{id}/assign with a user_id from another tenant must
    422 and must NOT mutate the workitem."""
    # 1) Create a workitem in tenant A (admin's tenant).
    create = await client.post(
        "/api/workitems", headers=admin,
        json={"title": "Cross-tenant assign repro"},
    )
    assert create.status_code == 201, create.text
    workitem_id = create.json()["id"]

    # 2) Seed a stranger user in tenant B and try to assign them.
    foreign_user_id = await _seed_other_tenant_user()
    res = await client.post(
        f"/api/workitems/{workitem_id}/assign",
        headers=admin,
        json={"user_id": str(foreign_user_id)},
    )
    assert res.status_code == 422, res.text
    assert "assigned_user_id" in res.text or "user" in res.text.lower()

    # 3) The workitem must remain unassigned in the DB.
    async with OwnerSessionLocal() as o:
        w = (await o.execute(
            select(WorkItem).where(WorkItem.id == uuid.UUID(workitem_id))
        )).scalar_one()
        assert w.assigned_user_id is None
        # And nothing in any tenant must be assigned to the stranger.
        leaked = (await o.execute(
            select(WorkItem).where(WorkItem.assigned_user_id == foreign_user_id)
        )).scalars().all()
        assert leaked == []


@pytest.mark.asyncio
async def test_workitem_assign_within_tenant_ok(client: AsyncClient, admin, agent):
    """Happy path: assigning a user from the same tenant still succeeds — the
    H5 guard must not over-block legitimate assignments."""
    # Look up the in-tenant agent user id (same approach as test_workitems.py).
    from app.db import SessionLocal
    async with SessionLocal() as s:
        agent_user = (await s.execute(
            select(User).where(User.email == "agent@demo.isp")
        )).scalar_one()
        agent_user_id = agent_user.id

    create = await client.post(
        "/api/workitems", headers=admin,
        json={"title": "Same-tenant assign happy path"},
    )
    assert create.status_code == 201, create.text
    workitem_id = create.json()["id"]

    res = await client.post(
        f"/api/workitems/{workitem_id}/assign",
        headers=admin,
        json={"user_id": str(agent_user_id)},
    )
    assert res.status_code == 200, res.text
    assert res.json()["assigned_user_id"] == str(agent_user_id)
