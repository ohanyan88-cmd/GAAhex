"""Phase A.3 — PaymentAllocation tests.

Each test wires invoice.account_id + payment.account_id so the recompute_account_balance
hook fires through the allocation path.
"""

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Invoice, Payment
from app.models.party import Account
from app.models.payment_allocation import PaymentAllocation


# ---------- helpers ----------

async def _party(client, admin) -> str:
    return (await client.post("/api/parties", headers=admin,
                              json={"name": f"AllocParty {uuid.uuid4().hex[:6]}",
                                    "type": "organization"})).json()["id"]


async def _customer(client, admin) -> str:
    return (await client.post("/api/customers", headers=admin,
                              json={"name": f"AllocCust {uuid.uuid4().hex[:6]}"})).json()["id"]


async def _account(client, admin) -> dict:
    pid = await _party(client, admin)
    return (await client.post("/api/accounts", headers=admin,
                              json={"holder_party_id": pid, "type": "business"})).json()


async def _link_invoice_to_account(invoice_id: str, account_id: str) -> None:
    async with SessionLocal() as s:
        inv = (await s.execute(select(Invoice).where(Invoice.id == uuid.UUID(invoice_id)))).scalar_one()
        inv.account_id = uuid.UUID(account_id)
        await s.commit()


async def _link_payment_to_account(payment_id: str, account_id: str) -> None:
    async with SessionLocal() as s:
        pay = (await s.execute(select(Payment).where(Payment.id == uuid.UUID(payment_id)))).scalar_one()
        pay.account_id = uuid.UUID(account_id)
        await s.commit()


async def _issued_invoice_for_account(client, admin, account_id: str, amount: int) -> dict:
    cust = await _customer(client, admin)
    inv = (await client.post("/api/invoices", headers=admin, json={
        "customer_id": cust,
        "lines": [{"kind": "charge", "description": "Plan", "quantity": 1, "unit_amount": amount}],
    })).json()
    await _link_invoice_to_account(inv["id"], account_id)
    return (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)).json()


async def _add_unallocated_payment(client, admin, inv_id: str, amount: int, account_id: str) -> dict:
    """Record a payment on the invoice (legacy path), then link account, then RETURN payment dict.

    The legacy /payments endpoint allocates the full amount against the single invoice
    implicitly (via the paid_sum check). For A.3 allocation tests we want a payment with
    NO automatic allocations — we'll record one and rely on the explicit /allocate path.
    Trick: use a fresh invoice we never allocate to; the payment carries amount but
    has no PaymentAllocation rows yet, so we control allocation explicitly.
    """
    pay = (await client.post(f"/api/invoices/{inv_id}/payments", headers=admin,
                             json={"amount": amount, "method": "card"})).json()
    await _link_payment_to_account(pay["id"], account_id)
    return pay


# ===================== outstanding on a fresh issued invoice =====================

async def test_outstanding_equals_total_when_no_allocations(client, admin):
    acc = await _account(client, admin)
    inv = await _issued_invoice_for_account(client, admin, acc["id"], 12000)
    snap = (await client.get(f"/api/invoices/{inv['id']}/outstanding", headers=admin)).json()
    assert snap["total"] == "12000.00", snap
    assert snap["paid"] == "0.00", snap
    assert snap["credited"] == "0.00", snap
    assert snap["outstanding"] == "12000.00", snap


# ===================== single full allocation flips PAID + zero outstanding =====================

async def test_full_allocation_flips_invoice_to_paid(client, admin):
    acc = await _account(client, admin)

    # Make TWO invoices on the same account: one we allocate to (target), one to host the
    # source payment so it lands without auto-allocating against our target.
    target = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    host = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    pay = await _add_unallocated_payment(client, admin, host["id"], 10000, acc["id"])
    # Host invoice is auto-PAID by the legacy payment endpoint — but its payment row is the
    # one we'll allocate FROM. We free the host's payment for re-allocation by allocating
    # to the target. Note: the legacy payment row has SUM(allocations)=0 on it because the
    # legacy endpoint flips paid by paid_sum, NOT by allocation rows. Allocation rows are
    # the A.3 ledger; legacy paid_sum continues to live in invoice.status independently.

    body = {"allocations": [{"invoice_id": target["id"], "amount": "10000"}]}
    r = await client.post(f"/api/payments/{pay['id']}/allocate", headers=admin, json=body)
    assert r.status_code == 200, r.text
    allocs = r.json()["allocations"]
    assert len(allocs) == 1
    assert allocs[0]["invoice_id"] == target["id"]

    # Target outstanding hits zero, status flips to PAID via the auto-PAID hook.
    snap = (await client.get(f"/api/invoices/{target['id']}/outstanding", headers=admin)).json()
    assert snap["outstanding"] == "0.00", snap
    got = (await client.get(f"/api/invoices/{target['id']}", headers=admin)).json()
    assert got["status"] == "PAID"


# ===================== split allocation across two invoices =====================

async def test_split_allocation_settles_two_invoices_partially(client, admin):
    acc = await _account(client, admin)
    a = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    b = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    host = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    pay = await _add_unallocated_payment(client, admin, host["id"], 10000, acc["id"])

    body = {"allocations": [
        {"invoice_id": a["id"], "amount": "4000"},
        {"invoice_id": b["id"], "amount": "6000"},
    ]}
    r = await client.post(f"/api/payments/{pay['id']}/allocate", headers=admin, json=body)
    assert r.status_code == 200, r.text
    assert len(r.json()["allocations"]) == 2

    sa = (await client.get(f"/api/invoices/{a['id']}/outstanding", headers=admin)).json()
    sb = (await client.get(f"/api/invoices/{b['id']}/outstanding", headers=admin)).json()
    assert sa["outstanding"] == "6000.00", sa   # 10000 - 4000
    assert sb["outstanding"] == "4000.00", sb   # 10000 - 6000


# ===================== over-allocation rejected (409) =====================

async def test_over_allocation_rejected(client, admin):
    acc = await _account(client, admin)
    target = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    host = await _issued_invoice_for_account(client, admin, acc["id"], 5000)
    pay = await _add_unallocated_payment(client, admin, host["id"], 5000, acc["id"])

    body = {"allocations": [{"invoice_id": target["id"], "amount": "6000"}]}
    r = await client.post(f"/api/payments/{pay['id']}/allocate", headers=admin, json=body)
    assert r.status_code == 409, r.text


# ===================== atomic batch: 2nd over-allocates → BOTH roll back =====================

async def test_atomic_batch_rolls_back_on_partial_failure(client, admin):
    acc = await _account(client, admin)
    a = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    b = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    host = await _issued_invoice_for_account(client, admin, acc["id"], 5000)
    pay = await _add_unallocated_payment(client, admin, host["id"], 5000, acc["id"])

    body = {"allocations": [
        {"invoice_id": a["id"], "amount": "3000"},   # would succeed alone
        {"invoice_id": b["id"], "amount": "3000"},   # would push total to 6000 > payment 5000 → 409
    ]}
    r = await client.post(f"/api/payments/{pay['id']}/allocate", headers=admin, json=body)
    assert r.status_code == 409, r.text

    # NO allocations persisted (first item rolled back too).
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(PaymentAllocation).where(PaymentAllocation.payment_id == uuid.UUID(pay["id"]))
        )).scalars().all()
    assert len(rows) == 0, f"expected 0 allocations, got {len(rows)}"

    # Both target invoices still fully outstanding.
    sa = (await client.get(f"/api/invoices/{a['id']}/outstanding", headers=admin)).json()
    sb = (await client.get(f"/api/invoices/{b['id']}/outstanding", headers=admin)).json()
    assert sa["outstanding"] == "10000.00", sa
    assert sb["outstanding"] == "10000.00", sb


# ===================== balance_updated_at moves on allocate =====================

async def test_allocate_triggers_account_balance_recompute(client, admin):
    acc = await _account(client, admin)
    target = await _issued_invoice_for_account(client, admin, acc["id"], 5000)
    host = await _issued_invoice_for_account(client, admin, acc["id"], 5000)
    pay = await _add_unallocated_payment(client, admin, host["id"], 5000, acc["id"])

    async with SessionLocal() as s:
        row = (await s.execute(select(Account).where(Account.id == uuid.UUID(acc["id"])))).scalar_one()
        before = row.balance_updated_at
    assert before is not None  # the prior issue+legacy payment already moved it

    r = await client.post(f"/api/payments/{pay['id']}/allocate", headers=admin,
                          json={"allocations": [{"invoice_id": target["id"], "amount": "5000"}]})
    assert r.status_code == 200

    async with SessionLocal() as s:
        row = (await s.execute(select(Account).where(Account.id == uuid.UUID(acc["id"])))).scalar_one()
        after = row.balance_updated_at
    assert after > before, "balance_updated_at must advance on allocate"


# ===================== allocations endpoint lists rows =====================

async def test_list_invoice_allocations(client, admin):
    acc = await _account(client, admin)
    target = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    host = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    pay = await _add_unallocated_payment(client, admin, host["id"], 10000, acc["id"])
    await client.post(f"/api/payments/{pay['id']}/allocate", headers=admin,
                      json={"allocations": [{"invoice_id": target["id"], "amount": "3000"}]})

    listing = (await client.get(f"/api/invoices/{target['id']}/allocations", headers=admin)).json()
    assert isinstance(listing, list)
    assert len(listing) == 1
    assert listing[0]["payment_id"] == pay["id"]
    assert Decimal(listing[0]["amount"]) == Decimal("3000")


# ===================== zero / non-positive allocation amount =====================

async def test_zero_amount_rejected(client, admin):
    acc = await _account(client, admin)
    target = await _issued_invoice_for_account(client, admin, acc["id"], 10000)
    host = await _issued_invoice_for_account(client, admin, acc["id"], 5000)
    pay = await _add_unallocated_payment(client, admin, host["id"], 5000, acc["id"])

    r = await client.post(f"/api/payments/{pay['id']}/allocate", headers=admin,
                          json={"allocations": [{"invoice_id": target["id"], "amount": "0"}]})
    assert r.status_code == 422, r.text
