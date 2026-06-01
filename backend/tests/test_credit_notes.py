"""Phase A.3 — CreditNote tests (physical table at /api/billing/credit-notes).

Distinct from the legacy /api/credit-notes endpoint in routers/billing.py (which writes
Record rows under entity_key='credit_note' for the SPEC §4.5 approval flow). The new
endpoints serve the A.3 financial-ledger contract: DRAFT/ISSUED/APPLIED/VOID lifecycle,
per-tenant monotonic CN-XXXXX numbering, applied_to_invoice_id link feeding the
outstanding_for_invoice math, A.2 recompute integration.
"""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Invoice
from app.models.credit_note import CreditNote
from app.models.party import Account


# ---------- helpers ----------

async def _party(client, admin) -> str:
    return (await client.post("/api/parties", headers=admin,
                              json={"name": f"CNParty {uuid.uuid4().hex[:6]}",
                                    "type": "organization"})).json()["id"]


async def _customer(client, admin) -> str:
    return (await client.post("/api/customers", headers=admin,
                              json={"name": f"CNCust {uuid.uuid4().hex[:6]}"})).json()["id"]


async def _account(client, admin) -> dict:
    pid = await _party(client, admin)
    return (await client.post("/api/accounts", headers=admin,
                              json={"holder_party_id": pid, "type": "business"})).json()


async def _link_invoice_to_account(invoice_id: str, account_id: str) -> None:
    async with SessionLocal() as s:
        inv = (await s.execute(select(Invoice).where(Invoice.id == uuid.UUID(invoice_id)))).scalar_one()
        inv.account_id = uuid.UUID(account_id)
        await s.commit()


async def _issued_invoice_for_account(client, admin, account_id: str, amount: int) -> dict:
    cust = await _customer(client, admin)
    inv = (await client.post("/api/invoices", headers=admin, json={
        "customer_id": cust,
        "lines": [{"kind": "charge", "description": "Plan", "quantity": 1, "unit_amount": amount}],
    })).json()
    await _link_invoice_to_account(inv["id"], account_id)
    return (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)).json()


# ===================== create DRAFT =====================

async def test_create_draft_credit_note(client, admin):
    cust = await _customer(client, admin)
    r = await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "amount": "500", "reason": "goodwill",
    })
    assert r.status_code == 201, r.text
    cn = r.json()
    assert cn["status"] == "DRAFT"
    assert cn["number"].startswith("CN-")
    assert cn["amount"] == "500.00" or cn["amount"] == "500"
    assert cn["customer_id"] == cust
    assert cn["issued_at"] is None
    assert cn["applied_at"] is None
    assert cn["applied_to_invoice_id"] is None


# ===================== issue DRAFT → ISSUED =====================

async def test_issue_draft_credit_note(client, admin):
    cust = await _customer(client, admin)
    cn = (await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "amount": "300",
    })).json()

    r = await client.post(f"/api/billing/credit-notes/{cn['id']}/issue", headers=admin)
    assert r.status_code == 200, r.text
    issued = r.json()
    assert issued["status"] == "ISSUED"
    assert issued["issued_at"] is not None


# ===================== apply ISSUED → APPLIED + decreases invoice outstanding =====================

async def test_apply_credit_note_reduces_invoice_outstanding(client, admin):
    acc = await _account(client, admin)
    cust = await _customer(client, admin)
    inv = await _issued_invoice_for_account(client, admin, acc["id"], 10000)

    cn = (await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "account_id": acc["id"], "amount": "3000",
        "original_invoice_id": inv["id"], "reason": "service outage",
    })).json()
    iss = await client.post(f"/api/billing/credit-notes/{cn['id']}/issue", headers=admin)
    assert iss.status_code == 200

    app_r = await client.post(f"/api/billing/credit-notes/{cn['id']}/apply", headers=admin,
                              json={"invoice_id": inv["id"]})
    assert app_r.status_code == 200, app_r.text
    applied = app_r.json()
    assert applied["status"] == "APPLIED"
    assert applied["applied_to_invoice_id"] == inv["id"]
    assert applied["applied_at"] is not None

    # outstanding now reduced by 3000.
    snap = (await client.get(f"/api/invoices/{inv['id']}/outstanding", headers=admin)).json()
    assert snap["credited"] == "3000.00", snap
    assert snap["outstanding"] == "7000.00", snap


# ===================== cannot apply VOID =====================

async def test_cannot_apply_void_credit_note(client, admin):
    cust = await _customer(client, admin)
    cn = (await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "amount": "100",
    })).json()
    # Mark VOID directly in the DB (no /void endpoint in this scope).
    async with SessionLocal() as s:
        row = (await s.execute(select(CreditNote).where(CreditNote.id == uuid.UUID(cn["id"])))).scalar_one()
        row.status = "VOID"
        await s.commit()

    # Make an invoice to apply against.
    acc = await _account(client, admin)
    inv = await _issued_invoice_for_account(client, admin, acc["id"], 5000)

    r = await client.post(f"/api/billing/credit-notes/{cn['id']}/apply", headers=admin,
                          json={"invoice_id": inv["id"]})
    assert r.status_code == 409, r.text


# ===================== cannot apply DRAFT (must issue first) =====================

async def test_cannot_apply_draft_credit_note(client, admin):
    cust = await _customer(client, admin)
    cn = (await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "amount": "100",
    })).json()
    acc = await _account(client, admin)
    inv = await _issued_invoice_for_account(client, admin, acc["id"], 5000)
    r = await client.post(f"/api/billing/credit-notes/{cn['id']}/apply", headers=admin,
                          json={"invoice_id": inv["id"]})
    assert r.status_code == 409, r.text


# ===================== monotonic per-tenant CN-XXXXX numbering =====================

async def test_credit_note_numbers_are_monotonic_per_tenant(client, admin):
    cust = await _customer(client, admin)
    nums = []
    for _ in range(3):
        cn = (await client.post("/api/billing/credit-notes", headers=admin, json={
            "customer_id": cust, "amount": "10",
        })).json()
        nums.append(cn["number"])
    # All formatted CN-XXXXX
    for n in nums:
        assert n.startswith("CN-")
        assert len(n) >= 8  # CN- + at least 5 digits

    # Strictly increasing as integers (parsing the suffix).
    seq = [int(n.split("-")[1]) for n in nums]
    assert seq == sorted(seq)
    assert seq[2] - seq[0] == 2 or len(set(seq)) == 3   # all distinct, ordered


# ===================== amount must be > 0 =====================

async def test_create_rejects_non_positive_amount(client, admin):
    cust = await _customer(client, admin)
    r = await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "amount": "0",
    })
    assert r.status_code == 422

    r2 = await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "amount": "-50",
    })
    assert r2.status_code == 422


# ===================== customer_id is required and must exist =====================

async def test_create_rejects_unknown_customer(client, admin):
    r = await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": str(uuid.uuid4()),
        "amount": "50",
    })
    assert r.status_code == 422


# ===================== list with filters =====================

async def test_list_credit_notes_with_status_filter(client, admin):
    cust = await _customer(client, admin)
    a = (await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "amount": "10",
    })).json()
    b = (await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "amount": "20",
    })).json()
    await client.post(f"/api/billing/credit-notes/{b['id']}/issue", headers=admin)

    r = await client.get("/api/billing/credit-notes?status=DRAFT", headers=admin)
    assert r.status_code == 200
    body = r.json()
    ids = {item["id"] for item in body["items"]}
    assert a["id"] in ids
    assert b["id"] not in ids

    r2 = await client.get("/api/billing/credit-notes?status=ISSUED", headers=admin)
    body2 = r2.json()
    ids2 = {item["id"] for item in body2["items"]}
    assert b["id"] in ids2


# ===================== apply triggers account balance recompute =====================

async def test_apply_triggers_account_balance_recompute(client, admin):
    acc = await _account(client, admin)
    cust = await _customer(client, admin)
    inv = await _issued_invoice_for_account(client, admin, acc["id"], 10000)

    async with SessionLocal() as s:
        row = (await s.execute(select(Account).where(Account.id == uuid.UUID(acc["id"])))).scalar_one()
        before = row.balance_updated_at

    cn = (await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": cust, "account_id": acc["id"], "amount": "1500",
        "original_invoice_id": inv["id"],
    })).json()
    await client.post(f"/api/billing/credit-notes/{cn['id']}/issue", headers=admin)
    r = await client.post(f"/api/billing/credit-notes/{cn['id']}/apply", headers=admin,
                          json={"invoice_id": inv["id"]})
    assert r.status_code == 200

    async with SessionLocal() as s:
        row = (await s.execute(select(Account).where(Account.id == uuid.UUID(acc["id"])))).scalar_one()
        after = row.balance_updated_at
    assert after > before, "balance_updated_at must advance on apply"
