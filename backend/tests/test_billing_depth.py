"""Coverage for billing depth: Product catalog · discount/tax invoice lines · dunning (billing.py).

Money is integer luma. Product writes need config.manage (admin via `*`); reads are open. Invoice
total = Σ(charge) − Σ(discount) + Σ(tax), clamped at 0. Dunning marks past-due ISSUED invoices
OVERDUE (idempotent, global per tenant). Unique product keys per test (shared session DB accumulates).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.models.product import Product


PAST = "2020-01-01T00:00:00+00:00"
FUTURE = "2999-01-01T00:00:00+00:00"


async def _customer(client, admin, name):
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


# ===================== products =====================

async def test_product_create_list_retire(client, admin, agent):
    p = (await client.post("/api/products", headers=admin, json={
        "key": "fiber100", "name": "Fiber 100/100", "default_amount": 25000, "cycle": "monthly"})).json()
    assert p["active"] is True and p["default_amount"] == 25000

    keys = {x["key"] for x in (await client.get("/api/products?active=true", headers=admin)).json()}
    assert "fiber100" in keys

    # duplicate key → 409
    assert (await client.post("/api/products", headers=admin, json={"key": "fiber100", "name": "dup"})).status_code == 409

    # retire → active False, drops from active filter, present in inactive
    assert (await client.post(f"/api/products/{p['id']}/retire", headers=admin)).json()["active"] is False
    assert "fiber100" not in {x["key"] for x in (await client.get("/api/products?active=true", headers=admin)).json()}
    assert "fiber100" in {x["key"] for x in (await client.get("/api/products?active=false", headers=admin)).json()}

    # agent: may list, may not create (config.manage)
    assert (await client.get("/api/products", headers=agent)).status_code == 200
    assert (await client.post("/api/products", headers=agent,
                              json={"key": "x", "name": "n"})).status_code == 403


async def test_subscription_from_product_copies_defaults(client, admin):
    prod = (await client.post("/api/products", headers=admin, json={
        "key": "biz500", "name": "Business 500", "default_amount": 80000, "cycle": "yearly"})).json()
    cust = await _customer(client, admin, "BizCo")
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"product_id": prod["id"], "customer_id": cust})).json()
    assert sub["product_id"] == prod["id"]
    assert sub["amount"] == 80000 and sub["cycle"] == "yearly" and sub["plan_name"] == "Business 500"

    # unknown product → 422
    assert (await client.post("/api/subscriptions", headers=admin,
                              json={"product_id": str(uuid.uuid4()), "plan_name": "X"})).status_code == 422


async def test_product_tenant_stamping(client, admin):
    p = (await client.post("/api/products", headers=admin,
                           json={"key": "tenantprod", "name": "T"})).json()
    async with SessionLocal() as s:
        admin_user = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        row = (await s.execute(select(Product).where(Product.id == uuid.UUID(p["id"])))).scalar_one()
        assert row.tenant_id == admin_user.tenant_id


# ===================== discount / tax lines =====================

async def test_invoice_total_with_discount_and_tax(client, admin):
    inv = (await client.post("/api/invoices", headers=admin, json={"lines": [
        {"kind": "charge", "description": "Plan", "quantity": 1, "unit_amount": 10000},
        {"kind": "discount", "description": "Promo", "unit_amount": 2000},
        {"kind": "tax", "description": "VAT", "unit_amount": 1000},
    ]})).json()
    assert inv["total"] == 10000 - 2000 + 1000              # 9000
    kinds = {l["kind"] for l in inv["lines"]}
    assert kinds == {"charge", "discount", "tax"}


async def test_invoice_total_clamped_at_zero(client, admin):
    inv = (await client.post("/api/invoices", headers=admin, json={"lines": [
        {"kind": "charge", "description": "Small", "unit_amount": 1000},
        {"kind": "discount", "description": "Huge", "unit_amount": 5000},
    ]})).json()
    assert inv["total"] == 0                                # never negative


async def test_invoice_line_validation(client, admin):
    # unknown kind → 422
    assert (await client.post("/api/invoices", headers=admin, json={
        "lines": [{"kind": "weird", "description": "x", "unit_amount": 1}]})).status_code == 422
    # negative money → 422
    assert (await client.post("/api/invoices", headers=admin, json={
        "lines": [{"kind": "charge", "description": "x", "unit_amount": -5}]})).status_code == 422


# ===================== dunning =====================

async def _issued_invoice(client, admin, due_at):
    inv = (await client.post("/api/invoices", headers=admin, json={
        "lines": [{"kind": "charge", "description": "Svc", "unit_amount": 5000}]})).json()
    issued = (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin,
                                json={"due_at": due_at})).json()
    assert issued["status"] == "ISSUED"
    return issued["id"]


async def test_dunning_marks_overdue_idempotent(client, admin):
    overdue_id = await _issued_invoice(client, admin, PAST)
    not_due_id = await _issued_invoice(client, admin, FUTURE)

    res = (await client.post("/api/invoices/run-dunning", headers=admin)).json()
    assert res["marked_overdue"] >= 1 and res["checked"] >= 2

    assert (await client.get(f"/api/invoices/{overdue_id}", headers=admin)).json()["status"] == "OVERDUE"
    assert (await client.get(f"/api/invoices/{not_due_id}", headers=admin)).json()["status"] == "ISSUED"

    # listed under the OVERDUE filter
    overdue_ids = {i["id"] for i in (await client.get("/api/invoices?status=OVERDUE", headers=admin)).json()}
    assert overdue_id in overdue_ids

    # idempotent: a second run leaves it OVERDUE (already-overdue invoices aren't reconsidered)
    await client.post("/api/invoices/run-dunning", headers=admin)
    assert (await client.get(f"/api/invoices/{overdue_id}", headers=admin)).json()["status"] == "OVERDUE"


async def test_dunning_requires_permission(client, agent):
    assert (await client.post("/api/invoices/run-dunning", headers=agent)).status_code == 403
