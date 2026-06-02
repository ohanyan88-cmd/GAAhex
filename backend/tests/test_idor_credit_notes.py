"""M1-A Wave 2 (IDOR) — Hole 4: credit_notes.create_credit_note.account_id.

POST /api/billing/credit-notes tenant-checked ``customer_id`` (and
``original_invoice_id``) but accepted ``account_id`` after only a UUID-format check.
A caller could therefore attach a draft credit note to a billing Account in another
tenant.
"""

import uuid

import pytest
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.credit_note import CreditNote
from app.models.party import Account, Party
from app.models.tenant import Tenant


async def _local_customer(client, admin, name: str) -> str:
    r = await client.post("/api/customers", headers=admin, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _seed_other_tenant_account() -> uuid.UUID:
    """Insert tenant B + Party B + Account B. Returns the Account id."""
    async with OwnerSessionLocal() as o:
        other = Tenant(id=uuid.uuid4(), name="IDOR-CN-Acc-Tenant", status="active")
        o.add(other)
        await o.flush()
        party = Party(
            id=uuid.uuid4(),
            tenant_id=other.id,
            type="organization",
            name="Stranger CN Org",
            status="active",
        )
        o.add(party)
        await o.flush()
        acc = Account(
            id=uuid.uuid4(),
            tenant_id=other.id,
            holder_party_id=party.id,
            type="business",
            currency="AMD",
            billing_cycle="monthly",
            status="active",
        )
        o.add(acc)
        await o.commit()
        return acc.id


@pytest.mark.asyncio
async def test_create_credit_note_rejects_cross_tenant_account_id(client, admin):
    # Use a LOCAL customer so the customer_id check passes — isolate the account_id check.
    local_cust = await _local_customer(client, admin, f"CNIDOR-{uuid.uuid4().hex[:6]}")
    foreign_account_id = await _seed_other_tenant_account()

    res = await client.post(
        "/api/billing/credit-notes",
        headers=admin,
        json={
            "customer_id": local_cust,
            "account_id": str(foreign_account_id),
            "amount": "100",
            "reason": "IDOR repro",
        },
    )
    assert res.status_code == 422, res.text
    assert "account_id" in res.text

    # Sanity: no CreditNote got created against the foreign account.
    async with OwnerSessionLocal() as o:
        rows = (await o.execute(
            select(CreditNote).where(CreditNote.account_id == foreign_account_id)
        )).scalars().all()
        assert rows == []
