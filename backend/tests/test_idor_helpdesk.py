"""M1-A Wave 2 (IDOR) — Hole 1: helpdesk.create_ticket.customer_id.

The audit (M1-A) showed POST /api/helpdesk/tickets accepted a body-supplied
``customer_id`` UUID and dropped it straight onto the new HelpdeskTicket without
verifying the referenced Record lived in the caller's tenant.

Reproduction shape:
    tenant A admin tries to create a ticket pointing at tenant B's customer.

Expected after Wave 2: the new ``_customer_or_422`` helper in routers/helpdesk.py
rejects the cross-tenant UUID with a 422.
"""

import uuid

import pytest
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.helpdesk import HelpdeskTicket
from app.models.record import Record
from app.models.tenant import Tenant


async def _seed_other_tenant_customer() -> uuid.UUID:
    """Insert a Tenant B + a customer Record owned by tenant B directly via the owner
    session (bypasses RLS). Returns the customer Record id — that's the only thing the
    IDOR repro needs (the cross-tenant UUID to dangle in front of tenant A)."""
    async with OwnerSessionLocal() as o:
        other = Tenant(id=uuid.uuid4(), name="IDOR-Helpdesk-OtherTenant", status="active")
        o.add(other)
        await o.flush()
        cust = Record(
            id=uuid.uuid4(),
            tenant_id=other.id,
            entity_key="customer",
            status="ACTIVE",
            data={"name": "Stranger from Tenant B"},
        )
        o.add(cust)
        await o.commit()
        return cust.id


@pytest.mark.asyncio
async def test_create_ticket_rejects_cross_tenant_customer_id(client, admin):
    foreign_customer_id = await _seed_other_tenant_customer()

    res = await client.post(
        "/api/helpdesk/tickets",
        headers=admin,
        json={"subject": "IDOR repro", "customer_id": str(foreign_customer_id)},
    )

    # The new _customer_or_422 helper returns 422 for any customer_id that doesn't
    # live in the caller's tenant.
    assert res.status_code == 422, res.text
    assert "customer_id" in res.text

    # Sanity: no ticket was created on tenant A's side that points at the foreign UUID.
    async with OwnerSessionLocal() as o:
        rows = (await o.execute(
            select(HelpdeskTicket).where(HelpdeskTicket.customer_id == foreign_customer_id)
        )).scalars().all()
        assert rows == []
