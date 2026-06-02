"""M1-A Wave 2 (IDOR) — Hole 3: payment_methods.vault_payment_method.

POST /api/payment-methods accepted two body-supplied UUIDs and only checked their
UUID format before persisting the vaulted card row:

  * ``customer_id`` — could link the card to a customer in another tenant
  * ``account_id``  — could link the card to a billing Account in another tenant

Both are PCI-adjacent (the row carries last4 + brand + expiry + gateway_token); a
cross-tenant link is the worst possible IDOR. Each UUID gets its own test.
"""

import uuid

import pytest
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.party import Account, Party
from app.models.payment_method import PaymentMethod
from app.models.record import Record
from app.models.tenant import Tenant


async def _seed_other_tenant_customer() -> uuid.UUID:
    async with OwnerSessionLocal() as o:
        other = Tenant(id=uuid.uuid4(), name="IDOR-PM-Cust-Tenant", status="active")
        o.add(other)
        await o.flush()
        cust = Record(
            id=uuid.uuid4(),
            tenant_id=other.id,
            entity_key="customer",
            status="ACTIVE",
            data={"name": "Stranger PM Customer"},
        )
        o.add(cust)
        await o.commit()
        return cust.id


async def _seed_other_tenant_account_with_local_customer(local_customer_id: str) -> uuid.UUID:
    """Insert tenant B + Party B + Account B. Returns the Account id. The CALLER passes
    a valid LOCAL customer_id so the customer_id check (which runs first) passes — that
    way the test isolates the account_id check."""
    async with OwnerSessionLocal() as o:
        other = Tenant(id=uuid.uuid4(), name="IDOR-PM-Acc-Tenant", status="active")
        o.add(other)
        await o.flush()
        party = Party(
            id=uuid.uuid4(),
            tenant_id=other.id,
            type="organization",
            name="Stranger Org",
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


async def _local_customer(client, admin, name: str) -> str:
    r = await client.post("/api/customers", headers=admin, json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_vault_rejects_cross_tenant_customer_id(client, admin):
    foreign_customer_id = await _seed_other_tenant_customer()

    res = await client.post(
        "/api/payment-methods",
        headers=admin,
        json={
            "customer_id": str(foreign_customer_id),
            "card_number": "4242424242424242",
            "exp_month": 12,
            "exp_year": 2030,
            "cvc": "123",
        },
    )
    assert res.status_code == 422, res.text
    assert "customer_id" in res.text

    # Sanity: nothing got vaulted in tenant A's scope against the foreign UUID.
    async with OwnerSessionLocal() as o:
        rows = (await o.execute(
            select(PaymentMethod).where(PaymentMethod.customer_id == foreign_customer_id)
        )).scalars().all()
        assert rows == []


@pytest.mark.asyncio
async def test_vault_rejects_cross_tenant_account_id(client, admin):
    # Use a LOCAL customer so the customer_id check passes — isolate the account_id check.
    local_cust = await _local_customer(client, admin, f"PMIDOR-{uuid.uuid4().hex[:6]}")
    foreign_account_id = await _seed_other_tenant_account_with_local_customer(local_cust)

    res = await client.post(
        "/api/payment-methods",
        headers=admin,
        json={
            "customer_id": local_cust,
            "account_id": str(foreign_account_id),
            "card_number": "4242424242424242",
            "exp_month": 12,
            "exp_year": 2030,
            "cvc": "123",
        },
    )
    assert res.status_code == 422, res.text
    assert "account_id" in res.text

    async with OwnerSessionLocal() as o:
        rows = (await o.execute(
            select(PaymentMethod).where(PaymentMethod.account_id == foreign_account_id)
        )).scalars().all()
        assert rows == []
