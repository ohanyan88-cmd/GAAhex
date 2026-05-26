"""Coverage for billing core: Subscriptions · Invoices · Payments (billing.py).

Money is integer luma. Permissions are subscription.* / invoice.* / payment.* — the admin holds `*`
(so all pass); the seeded agent has none → 403. Every billing row is tenant + owner-node scoped.
Unique plan/customer names per test (shared session DB accumulates).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.billing import Invoice, Subscription


async def _customer(client, admin, name) -> str:
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _issued_invoice(client, admin, amount, tag):
    """A fresh ISSUED invoice for `amount` luma (customer → subscription → generate → issue)."""
    cust = await _customer(client, admin, f"Cust {tag}")
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"plan_name": f"Plan {tag}", "amount": amount, "cycle": "monthly",
                                   "customer_id": cust})).json()
    inv = (await client.post(f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin)).json()
    issued = (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)).json()
    return issued


# ===================== subscriptions =====================

async def test_create_and_list_subscription(client, admin):
    cust = await _customer(client, admin, "Acme bil1")
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"plan_name": "Fiber 100", "amount": 50000, "cycle": "monthly",
                                   "customer_id": cust})).json()
    assert sub["status"] == "ACTIVE" and sub["amount"] == 50000 and sub["cycle"] == "monthly"
    assert sub["next_invoice_at"]                                   # schedule set

    listed = await client.get(f"/api/subscriptions?customer={cust}", headers=admin)
    ids = {x["id"] for x in listed.json()}
    assert sub["id"] in ids


async def test_invalid_money_and_customer(client, admin):
    # negative amount → 422
    assert (await client.post("/api/subscriptions", headers=admin,
                              json={"plan_name": "Bad", "amount": -1, "cycle": "monthly"})).status_code == 422
    # bad cycle → 422
    assert (await client.post("/api/subscriptions", headers=admin,
                              json={"plan_name": "Bad", "amount": 10, "cycle": "weekly"})).status_code == 422
    # unknown customer_id → 422
    assert (await client.post("/api/subscriptions", headers=admin,
                              json={"plan_name": "Bad", "amount": 10, "cycle": "monthly",
                                    "customer_id": str(uuid.uuid4())})).status_code == 422


# ===================== generate invoice → issue → payment =====================

async def test_generate_invoice_from_subscription(client, admin):
    cust = await _customer(client, admin, "Gen cust")
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"plan_name": "Gen plan", "amount": 12000, "cycle": "monthly",
                                   "customer_id": cust})).json()
    inv = (await client.post(f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin)).json()
    assert inv["number"].startswith("INV-")
    assert inv["status"] == "DRAFT" and inv["total"] == 12000
    assert len(inv["lines"]) == 1 and inv["lines"][0]["line_total"] == 12000


async def test_issue_then_full_payment_flips_paid(client, admin):
    inv = await _issued_invoice(client, admin, 30000, "paid")
    assert inv["status"] == "ISSUED" and inv["due_at"]

    pay = await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                            json={"amount": 30000, "method": "card"})
    assert pay.status_code == 201
    got = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert got["status"] == "PAID"


async def test_partial_payment_leaves_issued(client, admin):
    inv = await _issued_invoice(client, admin, 30000, "partial")
    pay = await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                            json={"amount": 10000, "method": "cash"})
    assert pay.status_code == 201
    got = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert got["status"] == "ISSUED"                               # not yet fully paid


async def test_payment_state_rules_409(client, admin):
    # paying a DRAFT (not issued) → 409
    cust = await _customer(client, admin, "Draft cust")
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"plan_name": "D", "amount": 5000, "cycle": "monthly", "customer_id": cust})).json()
    draft = (await client.post(f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin)).json()
    assert (await client.post(f"/api/invoices/{draft['id']}/payments", headers=admin,
                              json={"amount": 5000, "method": "cash"})).status_code == 409

    # paying again after PAID → 409
    inv = await _issued_invoice(client, admin, 5000, "again")
    assert (await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                              json={"amount": 5000, "method": "cash"})).status_code == 201
    assert (await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                              json={"amount": 1, "method": "cash"})).status_code == 409

    # paying a VOID invoice → 409 (set VOID directly; no void endpoint exists)
    void = await _issued_invoice(client, admin, 5000, "void")
    async with SessionLocal() as s:
        row = (await s.execute(select(Invoice).where(Invoice.id == uuid.UUID(void["id"])))).scalar_one()
        row.status = "VOID"
        await s.commit()
    assert (await client.post(f"/api/invoices/{void['id']}/payments", headers=admin,
                              json={"amount": 5000, "method": "cash"})).status_code == 409


# ===================== manual invoice =====================

async def test_manual_invoice_total_from_lines(client, admin):
    inv = (await client.post("/api/invoices", headers=admin, json={
        "lines": [
            {"description": "Setup", "quantity": 2, "unit_amount": 1500},
            {"description": "Router", "quantity": 1, "unit_amount": 3000},
        ],
    })).json()
    assert inv["status"] == "DRAFT" and inv["total"] == 2 * 1500 + 3000   # 6000

    # negative money on a line → 422
    bad = await client.post("/api/invoices", headers=admin,
                            json={"lines": [{"description": "Bad", "unit_amount": -5}]})
    assert bad.status_code == 422
    # no lines → 422
    assert (await client.post("/api/invoices", headers=admin, json={"lines": []})).status_code == 422


# ===================== scope / permission / tenant =====================

async def test_agent_has_no_billing_access(client, agent):
    assert (await client.get("/api/subscriptions", headers=agent)).status_code == 403
    assert (await client.post("/api/subscriptions", headers=agent,
                              json={"plan_name": "X", "amount": 1, "cycle": "monthly"})).status_code == 403
    assert (await client.get("/api/invoices", headers=agent)).status_code == 403


async def test_tenant_isolation_stamping(client, admin):
    cust = await _customer(client, admin, "Tenant cust")
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"plan_name": "T", "amount": 100, "cycle": "monthly", "customer_id": cust})).json()
    async with SessionLocal() as s:
        admin_user = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        row = (await s.execute(select(Subscription).where(Subscription.id == uuid.UUID(sub["id"])))).scalar_one()
        assert row.tenant_id == admin_user.tenant_id               # row carries the caller's tenant
