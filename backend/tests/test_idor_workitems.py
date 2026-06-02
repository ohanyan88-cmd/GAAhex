"""M1-A Wave 2 (IDOR) — Hole 2: workitems.create_workitem.

POST /api/workitems accepted two body-supplied UUIDs without tenant-checking either:

  * ``assigned_user_id`` — could point at a User in another tenant
  * ``customer_id``      — could point at a customer Record in another tenant

Each is covered by its own test (the audit asked for one per UUID param).
"""

import uuid

import pytest
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.record import Record
from app.models.tenant import Tenant
from app.models.user import User
from app.models.workitem import WorkItem
from app.security import hash_password


async def _seed_other_tenant_user() -> uuid.UUID:
    """Insert tenant B + a User row in tenant B. Returns the user id."""
    async with OwnerSessionLocal() as o:
        other = Tenant(id=uuid.uuid4(), name="IDOR-WI-User-Tenant", status="active")
        o.add(other)
        await o.flush()
        u = User(
            id=uuid.uuid4(),
            tenant_id=other.id,
            email=f"idor-wi-{uuid.uuid4().hex[:8]}@other.isp",
            name="Stranger Agent",
            password_hash=hash_password("irrelevant"),
            status="active",
        )
        o.add(u)
        await o.commit()
        return u.id


async def _seed_other_tenant_customer() -> uuid.UUID:
    """Insert tenant B + a customer Record in tenant B. Returns the Record id."""
    async with OwnerSessionLocal() as o:
        other = Tenant(id=uuid.uuid4(), name="IDOR-WI-Cust-Tenant", status="active")
        o.add(other)
        await o.flush()
        cust = Record(
            id=uuid.uuid4(),
            tenant_id=other.id,
            entity_key="customer",
            status="ACTIVE",
            data={"name": "Stranger Customer"},
        )
        o.add(cust)
        await o.commit()
        return cust.id


@pytest.mark.asyncio
async def test_create_workitem_rejects_cross_tenant_assigned_user_id(client, admin):
    foreign_user_id = await _seed_other_tenant_user()

    res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "IDOR repro (assignee)", "assigned_user_id": str(foreign_user_id)},
    )

    assert res.status_code == 422, res.text
    assert "assigned_user_id" in res.text

    # Sanity: tenant A has no workitem assigned to the foreign user id.
    async with OwnerSessionLocal() as o:
        rows = (await o.execute(
            select(WorkItem).where(WorkItem.assigned_user_id == foreign_user_id)
        )).scalars().all()
        assert rows == []


@pytest.mark.asyncio
async def test_create_workitem_rejects_cross_tenant_customer_id(client, admin):
    foreign_customer_id = await _seed_other_tenant_customer()

    res = await client.post(
        "/api/workitems",
        headers=admin,
        json={"title": "IDOR repro (customer)", "customer_id": str(foreign_customer_id)},
    )

    assert res.status_code == 422, res.text
    assert "customer_id" in res.text

    async with OwnerSessionLocal() as o:
        rows = (await o.execute(
            select(WorkItem).where(WorkItem.customer_id == foreign_customer_id)
        )).scalars().all()
        assert rows == []
