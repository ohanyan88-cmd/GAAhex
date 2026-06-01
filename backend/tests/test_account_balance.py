"""Phase A.2 — Account balance recompute + endpoint coverage.

Money is signed Decimal in luma. Balance formula:
    payments_collected − outstanding_invoiced (signed; NEGATIVE = customer owes us).

available_credit:
    MAX(0, MIN(credit_limit, credit_limit + current_balance))
    (capped at credit_limit so positive customer credit does not become free borrowing room).

Each test wires invoice.account_id and payment.account_id to its account so the recompute hooks
in billing.py fire; the additive Stage-1 path that leaves account_id NULL is intentionally not
exercised here (covered by the existing billing tests that still resolve via customer_id).
"""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Invoice, Payment
from app.models.party import Account


# ---------- helpers ----------

async def _party(client, admin) -> str:
    name = f"Party {uuid.uuid4().hex[:8]}"
    return (await client.post("/api/parties", headers=admin, json={"name": name, "type": "organization"})).json()["id"]


async def _customer(client, admin) -> str:
    return (await client.post("/api/customers", headers=admin, json={"name": f"Cust {uuid.uuid4().hex[:6]}"})).json()["id"]


async def _account(client, admin, *, credit_limit: str | None = None, parent_id: str | None = None) -> dict:
    pid = await _party(client, admin)
    payload: dict = {"holder_party_id": pid, "type": "business"}
    if credit_limit is not None:
        payload["credit_limit"] = credit_limit
    if parent_id is not None:
        payload["parent_account_id"] = parent_id
    return (await client.post("/api/accounts", headers=admin, json=payload)).json()


async def _link_invoice_to_account(invoice_id: str, account_id: str) -> None:
    """Patch the additive ``Invoice.account_id`` so the billing.py hooks fire on this row."""
    async with SessionLocal() as s:
        inv = (await s.execute(select(Invoice).where(Invoice.id == uuid.UUID(invoice_id)))).scalar_one()
        inv.account_id = uuid.UUID(account_id)
        await s.commit()


async def _link_payment_to_account(payment_id: str, account_id: str) -> None:
    async with SessionLocal() as s:
        pay = (await s.execute(select(Payment).where(Payment.id == uuid.UUID(payment_id)))).scalar_one()
        pay.account_id = uuid.UUID(account_id)
        await s.commit()


async def _issue_invoice_for_account(client, admin, account_id: str, amount: int) -> dict:
    """Create a manual DRAFT invoice with one charge line, link account_id, then ISSUE it.

    Issuing fires the Phase A.2 hook → recompute_account_balance(account_id).
    Returns the issued invoice dict.
    """
    cust = await _customer(client, admin)
    inv = (await client.post("/api/invoices", headers=admin, json={
        "customer_id": cust,
        "lines": [{"kind": "charge", "description": "Plan", "quantity": 1, "unit_amount": amount}],
    })).json()
    await _link_invoice_to_account(inv["id"], account_id)
    issued = (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)).json()
    return issued


# ===================== fresh account: zero balance =====================

async def test_fresh_account_balance_is_zero(client, admin):
    acc = await _account(client, admin)
    bal = (await client.get(f"/api/accounts/{acc['id']}/balance", headers=admin)).json()
    assert Decimal(bal["current_balance"]) == Decimal("0")
    assert Decimal(bal["credit_limit"]) == Decimal("0")
    assert Decimal(bal["available_credit"]) == Decimal("0")


# ===================== issue invoice → balance = -amount =====================

async def test_issue_invoice_drives_balance_negative(client, admin):
    acc = await _account(client, admin)
    await _issue_invoice_for_account(client, admin, acc["id"], 30000)
    bal = (await client.get(f"/api/accounts/{acc['id']}/balance", headers=admin)).json()
    assert Decimal(bal["current_balance"]) == Decimal("-30000"), bal


# ===================== pay full → balance = 0 =====================

async def test_full_payment_zeros_balance(client, admin):
    acc = await _account(client, admin)
    inv = await _issue_invoice_for_account(client, admin, acc["id"], 25000)
    pay = (await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                             json={"amount": 25000, "method": "card"})).json()
    await _link_payment_to_account(pay["id"], acc["id"])

    # Re-trigger via the admin recompute endpoint so the now-linked payment is picked up.
    snap = (await client.post(f"/api/accounts/{acc['id']}/recompute-balance", headers=admin)).json()
    assert Decimal(snap["current_balance"]) == Decimal("0"), snap

    got = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert got["status"] == "PAID"


# ===================== refund → balance back to -amount =====================

async def test_refund_returns_balance_to_negative(client, admin):
    acc = await _account(client, admin)
    inv = await _issue_invoice_for_account(client, admin, acc["id"], 10000)
    pay = (await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                             json={"amount": 10000, "method": "card"})).json()
    await _link_payment_to_account(pay["id"], acc["id"])

    # Park + approve refund.
    first = await client.post(f"/api/payments/{pay['id']}/refund", headers=admin,
                              json={"amount": 4000, "reason": "duplicate"})
    assert first.status_code == 202, first.text
    aid = first.json()["detail"]["approval_id"]
    assert (await client.patch(f"/api/mandatory-approvals/{aid}/decide", headers=admin,
                               json={"decision": "APPROVED"})).status_code == 200
    second = await client.post(f"/api/payments/{pay['id']}/refund", headers=admin,
                               json={"amount": 4000, "reason": "duplicate"})
    assert second.status_code == 200

    # After 10000 charge + 10000 payment + 4000 refund: balance = (10000 - 4000) - 10000 = -4000.
    snap = (await client.post(f"/api/accounts/{acc['id']}/recompute-balance", headers=admin)).json()
    assert Decimal(snap["current_balance"]) == Decimal("-4000"), snap


# ===================== void invoice → balance back to 0 =====================

async def test_void_invoice_reverses_balance(client, admin):
    acc = await _account(client, admin)
    inv = await _issue_invoice_for_account(client, admin, acc["id"], 7000)
    bal_after_issue = (await client.get(f"/api/accounts/{acc['id']}/balance", headers=admin)).json()
    assert Decimal(bal_after_issue["current_balance"]) == Decimal("-7000")

    # Void: gated by SPEC §4.5 invoice_cancel approval. First call → 202, decide APPROVED, retry.
    first = await client.post(f"/api/invoices/{inv['id']}/void", headers=admin)
    assert first.status_code == 202, first.text
    aid = first.json()["detail"]["approval_id"]
    assert (await client.patch(f"/api/mandatory-approvals/{aid}/decide", headers=admin,
                               json={"decision": "APPROVED"})).status_code == 200
    second = await client.post(f"/api/invoices/{inv['id']}/void", headers=admin)
    assert second.status_code == 200, second.text

    bal = (await client.get(f"/api/accounts/{acc['id']}/balance", headers=admin)).json()
    assert Decimal(bal["current_balance"]) == Decimal("0"), bal


# ===================== available_credit math: cap & floor =====================

async def test_available_credit_cap_when_credit_limit_exceeds_owed(client, admin):
    """balance=-50, credit_limit=200 → available_credit=150 (NOT 250 — capped by remaining slack)."""
    acc = await _account(client, admin, credit_limit="200")
    # Direct DB poke: set current_balance to -50 and recompute available_credit via the endpoint
    # logic — we can't easily get balance=-50 without a corresponding invoice. So set both and
    # invoke the service directly.
    async with SessionLocal() as s:
        row = (await s.execute(select(Account).where(Account.id == uuid.UUID(acc["id"])))).scalar_one()
        row.credit_limit = Decimal("200")
        await s.commit()
    inv = await _issue_invoice_for_account(client, admin, acc["id"], 50)
    bal = (await client.get(f"/api/accounts/{acc['id']}/balance", headers=admin)).json()
    assert Decimal(bal["current_balance"]) == Decimal("-50"), bal
    assert Decimal(bal["credit_limit"]) == Decimal("200"), bal
    # credit_limit + balance = 200 + (-50) = 150 → that's the slack, capped at credit_limit (200).
    assert Decimal(bal["available_credit"]) == Decimal("150"), bal


async def test_available_credit_floor_when_balance_blows_limit(client, admin):
    """balance=-300, credit_limit=200 → available_credit=0 (cannot be negative)."""
    acc = await _account(client, admin, credit_limit="200")
    async with SessionLocal() as s:
        row = (await s.execute(select(Account).where(Account.id == uuid.UUID(acc["id"])))).scalar_one()
        row.credit_limit = Decimal("200")
        await s.commit()
    inv = await _issue_invoice_for_account(client, admin, acc["id"], 300)
    bal = (await client.get(f"/api/accounts/{acc['id']}/balance", headers=admin)).json()
    assert Decimal(bal["current_balance"]) == Decimal("-300"), bal
    assert Decimal(bal["available_credit"]) == Decimal("0"), bal
