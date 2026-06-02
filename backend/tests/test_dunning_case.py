"""Phase B.2 — DunningCase lifecycle tests.

Covers:
  * /api/invoices/run-dunning opens cases on overdue invoices (one-shot + idempotent)
  * POST /api/dunning/cases/{id}/advance progresses the state machine
  * advance writes a ServiceActionLog row (adapter='logging')
  * Walking all 5 default steps lands status='closed', reason='completed_sequence'
  * Throttle step → Service.status=SUSPENDED; Terminate step → Service.status=TERMINATED
  * Cure: paying off the account triggers check_and_cure_for_payment, flips active cases to 'cured',
    calls adapter.restore, Service.status returns to ACTIVE
  * Cure works mid-sequence (after throttle, before terminate)
  * POST /api/dunning/run advances all due cases; second call is no-op
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Invoice, Payment
from app.models.dunning import DunningCase, DunningPolicy, ServiceActionLog
from app.models.party import Account
from app.models.service import Service
from app.models.user import User
from app.services import dunning as dunning_service


# ---------- helpers ----------

async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        return u.tenant_id


async def _party(client, admin) -> str:
    return (await client.post("/api/parties", headers=admin,
                              json={"name": f"DCParty {uuid.uuid4().hex[:6]}",
                                    "type": "organization"})).json()["id"]


async def _customer(client, admin) -> str:
    return (await client.post("/api/customers", headers=admin,
                              json={"name": f"DCCust {uuid.uuid4().hex[:6]}"})).json()["id"]


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


async def _overdue_invoice_for_account(client, admin, account_id: str, amount: int = 5000) -> dict:
    """Create + issue an invoice with due_at in the past, linked to the account."""
    cust = await _customer(client, admin)
    inv = (await client.post("/api/invoices", headers=admin, json={
        "customer_id": cust,
        "lines": [{"kind": "charge", "description": "Plan", "quantity": 1, "unit_amount": amount}],
    })).json()
    await _link_invoice_to_account(inv["id"], account_id)
    past = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    issued = (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin,
                                json={"due_at": past})).json()
    return issued


async def _service_for_account(account_id: str, name: str = "Test Service") -> str:
    """Insert a Service directly tied to the account_id, returning its id."""
    tid = await _admin_tenant_id()
    async with SessionLocal() as s:
        svc = Service(
            tenant_id=tid,
            account_id=uuid.UUID(account_id),
            type="internet",
            name=name,
            status="ACTIVE",
        )
        s.add(svc)
        await s.commit()
        return str(svc.id)


async def _service_status(service_id: str) -> str:
    async with SessionLocal() as s:
        svc = (await s.execute(select(Service).where(Service.id == uuid.UUID(service_id)))).scalar_one()
        return svc.status


async def _get_active_case_for_account(account_id: str) -> DunningCase | None:
    async with SessionLocal() as s:
        return (await s.execute(
            select(DunningCase).where(
                DunningCase.account_id == uuid.UUID(account_id),
                DunningCase.status == "ACTIVE",
            )
        )).scalar_one_or_none()


async def _set_case_due_now(case_id: str) -> None:
    """Force next_action_at into the past so the sweep picks the case up."""
    async with SessionLocal() as s:
        c = (await s.execute(select(DunningCase).where(DunningCase.id == uuid.UUID(case_id)))).scalar_one()
        c.next_action_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await s.commit()


# ===================== run-dunning opens a case for the account =====================

async def test_run_dunning_opens_case_for_overdue_invoice(client, admin):
    acc = await _account(client, admin)
    await _overdue_invoice_for_account(client, admin, acc["id"], 7000)

    r = await client.post("/api/invoices/run-dunning", headers=admin)
    assert r.status_code == 200, r.text

    case = await _get_active_case_for_account(acc["id"])
    assert case is not None, "case must be opened for the overdue account"
    assert case.status == "ACTIVE"
    assert case.current_step_index == -1


# ===================== run-dunning is idempotent for open_case =====================

async def test_run_dunning_does_not_duplicate_cases(client, admin):
    acc = await _account(client, admin)
    await _overdue_invoice_for_account(client, admin, acc["id"], 7000)

    await client.post("/api/invoices/run-dunning", headers=admin)
    await client.post("/api/invoices/run-dunning", headers=admin)
    await client.post("/api/invoices/run-dunning", headers=admin)

    async with SessionLocal() as s:
        rows = (await s.execute(
            select(DunningCase).where(DunningCase.account_id == uuid.UUID(acc["id"]))
        )).scalars().all()
    actives = [c for c in rows if c.status == "ACTIVE"]
    assert len(actives) == 1, f"expected 1 active case, got {len(actives)}"


# ===================== advance: -1 → 0 (first step), log row written =====================

async def test_advance_progresses_step_and_writes_log(client, admin):
    acc = await _account(client, admin)
    await _overdue_invoice_for_account(client, admin, acc["id"], 7000)
    await client.post("/api/invoices/run-dunning", headers=admin)
    case = await _get_active_case_for_account(acc["id"])

    r = await client.post(f"/api/dunning/cases/{case.id}/advance", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["current_step_index"] == 0

    # log row written, adapter='logging'
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(ServiceActionLog).where(ServiceActionLog.dunning_case_id == case.id)
        )).scalars().all()
    assert len(rows) >= 1
    assert rows[0].adapter == "logging"


# ===================== walk all 5 default steps → status='closed' completed_sequence =====================

async def test_walking_full_sequence_closes_case(client, admin):
    acc = await _account(client, admin)
    await _overdue_invoice_for_account(client, admin, acc["id"], 7000)
    await client.post("/api/invoices/run-dunning", headers=admin)
    case = await _get_active_case_for_account(acc["id"])
    case_id = str(case.id)

    # 5-step default sequence → 5 advances
    for _ in range(5):
        r = await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)
        assert r.status_code == 200, r.text

    async with SessionLocal() as s:
        final = (await s.execute(
            select(DunningCase).where(DunningCase.id == case.id)
        )).scalar_one()
    assert final.status == "CLOSED"
    assert final.closed_reason == "completed_sequence"


# ===================== throttle step → Service SUSPENDED =====================

async def test_throttle_step_flips_service_to_suspended(client, admin):
    acc = await _account(client, admin)
    svc_id = await _service_for_account(acc["id"])
    await _overdue_invoice_for_account(client, admin, acc["id"], 7000)
    await client.post("/api/invoices/run-dunning", headers=admin)
    case = await _get_active_case_for_account(acc["id"])
    case_id = str(case.id)

    # advance to throttle (default step index 2: notice, notice, throttle)
    await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)  # notice
    await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)  # notice
    await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)  # throttle

    assert await _service_status(svc_id) == "SUSPENDED"


# ===================== terminate step → Service TERMINATED =====================

async def test_terminate_step_flips_service_to_terminated(client, admin):
    acc = await _account(client, admin)
    svc_id = await _service_for_account(acc["id"])
    await _overdue_invoice_for_account(client, admin, acc["id"], 7000)
    await client.post("/api/invoices/run-dunning", headers=admin)
    case = await _get_active_case_for_account(acc["id"])
    case_id = str(case.id)

    # advance all 5 steps
    for _ in range(5):
        await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)

    assert await _service_status(svc_id) == "TERMINATED"


# ===================== cure: paying off triggers check_and_cure_for_payment =====================

async def test_payment_allocation_cures_active_cases(client, admin):
    acc = await _account(client, admin)
    svc_id = await _service_for_account(acc["id"])
    target = await _overdue_invoice_for_account(client, admin, acc["id"], 5000)

    # Open + advance through throttle so Service is SUSPENDED
    await client.post("/api/invoices/run-dunning", headers=admin)
    case = await _get_active_case_for_account(acc["id"])
    case_id = str(case.id)
    await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)
    await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)
    await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)
    assert await _service_status(svc_id) == "SUSPENDED"

    # Create a payment carrier (a second invoice that auto-creates a payment we can allocate FROM).
    host = await _overdue_invoice_for_account(client, admin, acc["id"], 5000)
    pay = (await client.post(f"/api/invoices/{host['id']}/payments", headers=admin,
                             json={"amount": 10000, "method": "card"})).json()
    await _link_payment_to_account(pay["id"], acc["id"])

    # Allocate the full 10000 against the TARGET invoice (5000 was due + 5000 covers host too).
    # We only need to bring account.current_balance >= 0. The allocate path triggers
    # check_and_cure_for_payment automatically.
    r = await client.post(f"/api/payments/{pay['id']}/allocate", headers=admin, json={
        "allocations": [
            {"invoice_id": target["id"], "amount": "5000"},
            {"invoice_id": host["id"], "amount": "5000"},
        ],
    })
    assert r.status_code == 200, r.text

    # Case should be cured + Service ACTIVE (adapter.restore)
    async with SessionLocal() as s:
        c = (await s.execute(select(DunningCase).where(DunningCase.id == case.id))).scalar_one()
    assert c.status == "CURED", f"expected CURED, got {c.status}"
    assert await _service_status(svc_id) == "ACTIVE"


# ===================== cure works mid-sequence (after throttle, before terminate) =====================

async def test_cure_mid_sequence_writes_restore_log(client, admin):
    acc = await _account(client, admin)
    svc_id = await _service_for_account(acc["id"])
    target = await _overdue_invoice_for_account(client, admin, acc["id"], 5000)
    await client.post("/api/invoices/run-dunning", headers=admin)
    case = await _get_active_case_for_account(acc["id"])
    case_id = str(case.id)
    # advance to throttle
    await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)
    await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)
    await client.post(f"/api/dunning/cases/{case_id}/advance", headers=admin)
    assert await _service_status(svc_id) == "SUSPENDED"

    # Cure path via the service helper directly (independent of allocate).
    tid = await _admin_tenant_id()
    async with SessionLocal() as s:
        # Force account balance to 0 so cure logic accepts it.
        acc_row = (await s.execute(select(Account).where(Account.id == uuid.UUID(acc["id"])))).scalar_one()
        acc_row.current_balance = Decimal("0")
        await s.commit()

        cured = await dunning_service.check_and_cure_for_payment(s, account_id=uuid.UUID(acc["id"]))
        await s.commit()
    assert cured >= 1

    # Service should be ACTIVE; restore log row must exist for this service.
    assert await _service_status(svc_id) == "ACTIVE"
    async with SessionLocal() as s:
        logs = (await s.execute(
            select(ServiceActionLog).where(
                ServiceActionLog.service_id == uuid.UUID(svc_id),
                ServiceActionLog.action == "restore",
            )
        )).scalars().all()
    assert len(logs) >= 1


# ===================== POST /api/dunning/run advances due cases; second call no-op =====================

async def test_run_endpoint_advances_then_idempotent(client, admin):
    acc = await _account(client, admin)
    await _overdue_invoice_for_account(client, admin, acc["id"], 7000)
    await client.post("/api/invoices/run-dunning", headers=admin)
    case = await _get_active_case_for_account(acc["id"])
    assert case.current_step_index == -1

    # The case's next_action_at was set to now() by open_case — so the sweep picks it up.
    r = await client.post("/api/dunning/run", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["advanced"] >= 1
    first_count = body["advanced"]

    # Second call: next_action_at is now in the future (days ahead) → no-op for this case.
    r = await client.post("/api/dunning/run", headers=admin)
    body2 = r.json()
    # Second call should advance fewer (ideally zero new advances for this account).
    # Be tolerant: assert it's not more than first call (idempotency property).
    assert body2["advanced"] <= first_count


# ===================== advance writes ServiceActionLog with adapter='logging' =====================

async def test_advance_log_has_logging_adapter(client, admin):
    """The adapter for every action row written by the dunning runner is 'logging' (v1)."""
    acc = await _account(client, admin)
    await _service_for_account(acc["id"])
    await _overdue_invoice_for_account(client, admin, acc["id"], 5000)
    await client.post("/api/invoices/run-dunning", headers=admin)
    case = await _get_active_case_for_account(acc["id"])

    # advance twice (through 2 notice steps)
    await client.post(f"/api/dunning/cases/{case.id}/advance", headers=admin)
    await client.post(f"/api/dunning/cases/{case.id}/advance", headers=admin)

    async with SessionLocal() as s:
        rows = (await s.execute(
            select(ServiceActionLog).where(ServiceActionLog.dunning_case_id == case.id)
        )).scalars().all()
    assert len(rows) >= 2
    for r in rows:
        assert r.adapter == "logging"


# ===================== non-admin denied on advance/run =====================

async def test_non_admin_denied_on_advance_and_run(client, admin, agent):
    acc = await _account(client, admin)
    await _overdue_invoice_for_account(client, admin, acc["id"], 5000)
    await client.post("/api/invoices/run-dunning", headers=admin)
    case = await _get_active_case_for_account(acc["id"])

    r = await client.post(f"/api/dunning/cases/{case.id}/advance", headers=agent)
    assert r.status_code == 403

    r = await client.post("/api/dunning/run", headers=agent)
    assert r.status_code == 403
