"""Phase A.3 — Invoice immutability (posted_at + locked_by + ensure_invoice_mutable gate).

DRAFT invoices are freely mutable. Once /issue posts the invoice, only status and paid_at
may change — every other field is frozen. The gate is enforced by
services/invoice_lock.ensure_invoice_mutable wired into routers/billing.py /issue and
covered by direct calls in tests below for the field-by-field whitelist.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Invoice
from app.services.invoice_lock import (
    MUTABLE_AFTER_POST_FIELDS,
    ensure_invoice_mutable,
)
from fastapi import HTTPException


async def _customer(client, admin, name: str) -> str:
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _issued_invoice(client, admin, amount: int, tag: str) -> dict:
    cust = await _customer(client, admin, f"Imm Cust {tag}")
    sub = (await client.post("/api/subscriptions", headers=admin,
                             json={"plan_name": f"Imm Plan {tag}", "amount": amount,
                                   "cycle": "monthly", "customer_id": cust})).json()
    inv = (await client.post(f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin)).json()
    issued = (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)).json()
    return issued


# ===================== posted_at + locked_by set on /issue =====================

async def test_issue_sets_posted_at_and_locked_by(client, admin):
    inv = await _issued_invoice(client, admin, 4000, "post1")
    assert inv["status"] == "ISSUED"
    assert inv["posted_at"], "posted_at must be populated on issue"
    assert inv["locked_by"], "locked_by must be populated on issue (the actor id)"
    # locked_by must be a UUID
    uuid.UUID(inv["locked_by"])


# ===================== posted_at is immutable once set =====================

async def test_posted_at_is_set_once_not_clobbered_by_later_transitions(client, admin):
    """A second transition (PAID via full payment) must NOT touch posted_at."""
    inv = await _issued_invoice(client, admin, 5000, "post2")
    initial_posted = inv["posted_at"]
    initial_locked = inv["locked_by"]
    assert initial_posted

    pay = await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                            json={"amount": 5000, "method": "card"})
    assert pay.status_code == 201

    got = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert got["status"] == "PAID", got
    # posted_at must be unchanged.
    assert got["posted_at"] == initial_posted, got
    assert got["locked_by"] == initial_locked, got


# ===================== status flips after post are allowed =====================

async def test_status_can_flip_to_paid_after_posted_at(client, admin):
    inv = await _issued_invoice(client, admin, 6000, "post3")
    assert inv["posted_at"]
    pay = await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                            json={"amount": 6000, "method": "card"})
    assert pay.status_code == 201
    got = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert got["status"] == "PAID"


# ===================== ensure_invoice_mutable: unit tests for the gate =====================

async def test_ensure_invoice_mutable_unposted_invoice_allows_any_field():
    """DRAFT (posted_at IS NULL) → gate is always a no-op."""
    fake = type("Inv", (), {"posted_at": None})()
    # Should not raise for ANY field name.
    for f in ("total", "customer_id", "due_at", "status", "paid_at", "anything_else"):
        ensure_invoice_mutable(fake, f)


async def test_ensure_invoice_mutable_posted_invoice_blocks_non_whitelist_fields():
    """posted_at set → only `status` and `paid_at` are allowed; others 409."""
    fake = type("Inv", (), {"posted_at": datetime.now(timezone.utc)})()
    # Whitelist: no raise.
    ensure_invoice_mutable(fake, "status")
    ensure_invoice_mutable(fake, "paid_at")
    # Anything else: 409.
    for f in ("total", "customer_id", "due_at", "period_start", "number"):
        with pytest.raises(HTTPException) as exc:
            ensure_invoice_mutable(fake, f)
        assert exc.value.status_code == 409
        assert "locked" in exc.value.detail.lower()


async def test_mutable_whitelist_is_exactly_status_and_paid_at():
    """Locks the API surface — adding to the whitelist requires conscious test update."""
    assert MUTABLE_AFTER_POST_FIELDS == frozenset({"status", "paid_at"})


# ===================== direct DB-level guard: write a frozen field after post =====================

async def test_direct_total_mutation_via_gate_after_post_raises(client, admin):
    """End-to-end check: an issued invoice's posted_at is in the DB; ensure_invoice_mutable
    against the loaded row would block a non-whitelist field."""
    inv = await _issued_invoice(client, admin, 7000, "post4")
    async with SessionLocal() as s:
        row = (await s.execute(select(Invoice).where(Invoice.id == uuid.UUID(inv["id"])))).scalar_one()
        assert row.posted_at is not None
        # Status flip — allowed.
        ensure_invoice_mutable(row, "status")
        # Total mutation — forbidden.
        with pytest.raises(HTTPException) as exc:
            ensure_invoice_mutable(row, "total")
        assert exc.value.status_code == 409


# ===================== void after post — status is whitelisted, so void works =====================

async def test_void_after_post_keeps_posted_at(client, admin):
    """Voiding an issued invoice (status flip → VOID) does not unlock or wipe posted_at."""
    inv = await _issued_invoice(client, admin, 8000, "post5")
    initial = inv["posted_at"]
    # SPEC §4.5 invoice_cancel approval: 2-call dance.
    first = await client.post(f"/api/invoices/{inv['id']}/void", headers=admin)
    assert first.status_code == 202, first.text
    aid = first.json()["detail"]["approval_id"]
    assert (await client.patch(f"/api/mandatory-approvals/{aid}/decide", headers=admin,
                               json={"decision": "APPROVED"})).status_code == 200
    second = await client.post(f"/api/invoices/{inv['id']}/void", headers=admin)
    assert second.status_code == 200

    got = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert got["status"] == "VOID"
    assert got["posted_at"] == initial, "posted_at must NOT be cleared on void"


# ===================== draft invoice has no posted_at =====================

async def test_draft_invoice_has_null_posted_at(client, admin):
    """Manual DRAFT invoice (not yet issued) reports posted_at=null."""
    cust = await _customer(client, admin, "Draft Imm")
    inv = (await client.post("/api/invoices", headers=admin, json={
        "customer_id": cust,
        "lines": [{"kind": "charge", "description": "X", "quantity": 1, "unit_amount": 1000}],
    })).json()
    assert inv["status"] == "DRAFT"
    assert inv["posted_at"] is None, inv
    assert inv["locked_by"] is None, inv
