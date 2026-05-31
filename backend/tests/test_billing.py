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


# ===================== SPEC §4.5 mandatory-approval gates =====================
#
# Three high-stakes mutations on this router are gated per SPEC §4.5:
#   - contract_change  on PATCH /api/subscriptions/{id} (when plan_name/amount/cycle change)
#   - payment_adjust   on POST  /api/invoices/{id}/payments  (only when payload.adjust=true)
#   - high_discount    on POST  /api/invoices                (when discount > 20% of charges)
#
# Each test exercises the 3-step protocol:
#   1. first call → 202 with approval_id (PENDING parked)
#   2. PATCH /api/mandatory-approvals/{id}/decide → APPROVED
#   3. second call → 200/201, mutation succeeds, approval consumed (EXECUTED)


async def test_spec_4_5_contract_change_gate_on_subscription_patch(client, admin):
    """PATCH /api/subscriptions/{id} with plan_name/amount/cycle is a contract_change."""
    cust = await _customer(client, admin, "Contract cust")
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"plan_name": "Bronze", "amount": 1000,
                                   "cycle": "monthly", "customer_id": cust})).json()

    # 1. First tariff change parks an approval (202).
    pending = await client.patch(f"/api/subscriptions/{sub['id']}", headers=admin,
                                 json={"plan_name": "Gold", "amount": 5000})
    assert pending.status_code == 202
    body = pending.json()["detail"]
    assert body["status"] == "approval_required"
    assert body["action_type"] == "contract_change"
    aid = body["approval_id"]

    # Subscription is still on the old plan (no mutation happened).
    fetched = (await client.get(f"/api/subscriptions?customer={cust}", headers=admin)).json()
    same = next(s for s in fetched if s["id"] == sub["id"])
    assert same["plan_name"] == "Bronze" and same["amount"] == 1000

    # 2. Approve.
    decided = await client.patch(f"/api/mandatory-approvals/{aid}/decide", headers=admin,
                                 json={"decision": "APPROVED"})
    assert decided.status_code == 200

    # 3. Retry the same PATCH — succeeds, mutation lands.
    retry = await client.patch(f"/api/subscriptions/{sub['id']}", headers=admin,
                               json={"plan_name": "Gold", "amount": 5000})
    assert retry.status_code == 200
    out = retry.json()
    assert out["plan_name"] == "Gold" and out["amount"] == 5000

    # The approval row is now EXECUTED.
    final = (await client.get(f"/api/mandatory-approvals/{aid}", headers=admin)).json()
    assert final["status"] == "EXECUTED"


async def test_spec_4_5_contract_change_next_invoice_only_passes(client, admin):
    """A pure next_invoice_at edit is not a contract change and passes through unchanged."""
    cust = await _customer(client, admin, "Schedule cust")
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"plan_name": "Sched", "amount": 2000,
                                   "cycle": "monthly", "customer_id": cust})).json()
    # Future date — schedule tweak only.
    r = await client.patch(f"/api/subscriptions/{sub['id']}", headers=admin,
                           json={"next_invoice_at": "2099-01-01T00:00:00Z"})
    assert r.status_code == 200
    assert r.json()["next_invoice_at"].startswith("2099-01-01")


async def test_spec_4_5_payment_adjust_gate(client, admin):
    """POST /api/invoices/{id}/payments with adjust=true triggers payment_adjust gate.
    A standard payment (no adjust flag) still passes through."""
    inv = await _issued_invoice(client, admin, 10000, "adjustgate")

    # A normal collected payment (no adjust flag) passes through.
    normal = await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                               json={"amount": 1000, "method": "cash"})
    assert normal.status_code == 201

    # 1. An `adjust=true` payment parks an approval (202).
    pending = await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                                json={"amount": 2000, "method": "cash", "adjust": True,
                                      "note": "write-off"})
    assert pending.status_code == 202
    body = pending.json()["detail"]
    assert body["action_type"] == "payment_adjust"
    aid = body["approval_id"]

    # The adjust payment did NOT post (the normal 1000 above is the only one).
    listed = (await client.get(f"/api/invoices/{inv['id']}/payments", headers=admin)).json()
    assert sum(p["amount"] for p in listed) == 1000

    # 2. Approve.
    assert (await client.patch(f"/api/mandatory-approvals/{aid}/decide", headers=admin,
                               json={"decision": "APPROVED"})).status_code == 200

    # 3. Retry — the adjust payment now lands.
    retry = await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                              json={"amount": 2000, "method": "cash", "adjust": True,
                                    "note": "write-off"})
    assert retry.status_code == 201
    listed = (await client.get(f"/api/invoices/{inv['id']}/payments", headers=admin)).json()
    assert sum(p["amount"] for p in listed) == 3000

    # The approval row is now EXECUTED.
    final = (await client.get(f"/api/mandatory-approvals/{aid}", headers=admin)).json()
    assert final["status"] == "EXECUTED"


async def test_spec_4_5_high_discount_gate(client, admin):
    """POST /api/invoices with discount > 20% of charge subtotal triggers high_discount gate."""
    cust = await _customer(client, admin, "Discount cust")

    # 21% discount → over the threshold → 202.
    lines = [
        {"kind": "charge", "description": "Plan", "quantity": 1, "unit_amount": 10000},
        {"kind": "discount", "description": "Big promo", "unit_amount": 2100},
    ]
    pending = await client.post("/api/invoices", headers=admin,
                                json={"customer_id": cust, "lines": lines})
    assert pending.status_code == 202
    body = pending.json()["detail"]
    assert body["action_type"] == "high_discount"
    aid = body["approval_id"]

    # 2. Approve.
    assert (await client.patch(f"/api/mandatory-approvals/{aid}/decide", headers=admin,
                               json={"decision": "APPROVED"})).status_code == 200

    # 3. Retry — invoice is created.
    inv = (await client.post("/api/invoices", headers=admin,
                             json={"customer_id": cust, "lines": lines})).json()
    assert inv["total"] == 10000 - 2100  # 7900

    # The approval row is now EXECUTED.
    final = (await client.get(f"/api/mandatory-approvals/{aid}", headers=admin)).json()
    assert final["status"] == "EXECUTED"


async def test_spec_4_5_low_discount_not_gated(client, admin):
    """A discount at exactly 20% of charges (the threshold boundary) is NOT gated."""
    cust = await _customer(client, admin, "Low disc cust")
    inv = (await client.post("/api/invoices", headers=admin, json={"customer_id": cust, "lines": [
        {"kind": "charge", "description": "Plan", "quantity": 1, "unit_amount": 10000},
        {"kind": "discount", "description": "Small promo", "unit_amount": 2000},
    ]})).json()
    # Exactly 20% — gate is strictly >20%, so this passes through.
    assert inv["total"] == 8000
