"""B35 — Portal Billing — security invariant tests.

Security assertions (mirrors B34 pattern):
  - Own invoices list scoped to customer.
  - Customer A cannot GET customer B's invoice/document (404).
  - Pay own ISSUED invoice → order created.
  - Cannot pay another customer's invoice (404).
  - Receipt only for own payment (404 if not theirs).
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.billing import Invoice, InvoiceLine, Payment
from app.models.customer_user import CustomerUser
from app.models.tenant import Tenant
from app.security import hash_password


@pytest_asyncio.fixture(scope="module")
async def billing_setup(client: AsyncClient, admin):
    """Two customers A and B, each with a portal user + one ISSUED invoice."""
    # Create customers
    ra = await client.post("/api/customers", headers=admin, json={"name": "Billing Portal A"})
    assert ra.status_code in (200, 201), ra.text
    cid_a = ra.json()["id"]

    rb = await client.post("/api/customers", headers=admin, json={"name": "Billing Portal B"})
    assert rb.status_code in (200, 201), rb.text
    cid_b = rb.json()["id"]

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        tid = tenant.id

        for email, pw, cid in [
            ("billing_a@test.isp", "BillA123", cid_a),
            ("billing_b@test.isp", "BillB123", cid_b),
        ]:
            existing = (await s.execute(
                select(CustomerUser).where(CustomerUser.tenant_id == tid, CustomerUser.email == email)
            )).scalar_one_or_none()
            if not existing:
                s.add(CustomerUser(tenant_id=tid, customer_id=cid, email=email,
                                   password_hash=hash_password(pw), is_active=True))

        # Create ISSUED invoice for A
        import uuid as _uuid
        inv_a = Invoice(tenant_id=tid, customer_id=_uuid.UUID(cid_a),
                        number="INV-PORTAL-A", status="ISSUED", total=5000)
        s.add(inv_a)
        await s.flush()
        s.add(InvoiceLine(tenant_id=tid, invoice_id=inv_a.id, description="Service fee",
                          quantity=1, unit_amount=5000, line_total=5000))

        # Create ISSUED invoice for B
        inv_b = Invoice(tenant_id=tid, customer_id=_uuid.UUID(cid_b),
                        number="INV-PORTAL-B", status="ISSUED", total=3000)
        s.add(inv_b)
        await s.flush()
        s.add(InvoiceLine(tenant_id=tid, invoice_id=inv_b.id, description="Portal fee",
                          quantity=1, unit_amount=3000, line_total=3000))

        await s.commit()
        inv_a_id = str(inv_a.id)
        inv_b_id = str(inv_b.id)

    # Login
    tok_a = (await client.post("/portal/auth/login", json={"email": "billing_a@test.isp", "password": "BillA123", "tenant_id": str(tid)})).json()["access_token"]
    tok_b = (await client.post("/portal/auth/login", json={"email": "billing_b@test.isp", "password": "BillB123", "tenant_id": str(tid)})).json()["access_token"]

    return {
        "cid_a": cid_a, "cid_b": cid_b,
        "inv_a_id": inv_a_id, "inv_b_id": inv_b_id,
        "tok_a": tok_a, "tok_b": tok_b,
    }


@pytest.mark.asyncio
async def test_invoice_list_scoped(client: AsyncClient, billing_setup):
    """Customer A's invoice list contains A's invoice, not B's."""
    d = billing_setup
    r = await client.get("/portal/me/invoices", headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 200
    ids = [inv["id"] for inv in r.json()]
    assert d["inv_a_id"] in ids
    assert d["inv_b_id"] not in ids


@pytest.mark.asyncio
async def test_cross_customer_invoice_denied(client: AsyncClient, billing_setup):
    """Customer A cannot fetch customer B's invoice."""
    d = billing_setup
    r = await client.get(f"/portal/me/invoices/{d['inv_b_id']}",
                         headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cross_customer_document_denied(client: AsyncClient, billing_setup):
    """Customer A cannot get customer B's invoice document."""
    d = billing_setup
    r = await client.get(f"/portal/me/invoices/{d['inv_b_id']}/document",
                         headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_pay_own_invoice(client: AsyncClient, billing_setup):
    """Customer A can initiate payment on their own ISSUED invoice."""
    d = billing_setup
    r = await client.post(f"/portal/me/invoices/{d['inv_a_id']}/pay",
                          headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert "order_id" in body
    assert "redirect_url" in body


@pytest.mark.asyncio
async def test_pay_other_customer_invoice_denied(client: AsyncClient, billing_setup):
    """Customer A cannot pay customer B's invoice."""
    d = billing_setup
    r = await client.post(f"/portal/me/invoices/{d['inv_b_id']}/pay",
                          headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_payments_list_scoped(client: AsyncClient, billing_setup):
    """Payment list only returns own payments."""
    d = billing_setup
    r = await client.get("/portal/me/payments", headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_receipt_own_payment(client: AsyncClient, billing_setup):
    """Create a payment for A, then fetch the receipt — must work."""
    d = billing_setup
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        import uuid as _uuid
        pay = Payment(
            tenant_id=tenant.id,
            invoice_id=_uuid.UUID(d["inv_a_id"]),
            amount=5000, method="card",
        )
        s.add(pay)
        await s.commit()
        pay_id = str(pay.id)

    r = await client.get(f"/portal/me/payments/{pay_id}/receipt",
                         headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


@pytest.mark.asyncio
async def test_receipt_other_payment_denied(client: AsyncClient, billing_setup):
    """Customer A cannot get customer B's payment receipt."""
    d = billing_setup
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        import uuid as _uuid
        pay = Payment(
            tenant_id=tenant.id,
            invoice_id=_uuid.UUID(d["inv_b_id"]),
            amount=3000, method="transfer",
        )
        s.add(pay)
        await s.commit()
        pay_b_id = str(pay.id)

    r = await client.get(f"/portal/me/payments/{pay_b_id}/receipt",
                         headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 404
