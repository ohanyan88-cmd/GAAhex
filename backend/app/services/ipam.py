"""NOC Phase C — IPAM service: per-address IP assignment management.

Sits on top of PoolAllocation rows; handles assign / release / query operations
with validation (format + uniqueness) and idempotent release semantics.
"""
from __future__ import annotations

import ipaddress
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.ipam import IpAssignment


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _validate_ip(address: str, family: int) -> None:
    """Raise 400 if address is not a valid IP address of the declared family."""
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        raise HTTPException(400, f"Invalid IP address: {address!r}")
    if parsed.version != family:
        raise HTTPException(
            400,
            f"Address {address!r} is IPv{parsed.version} but family={family} was declared",
        )


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------

async def assign_ip(
    session: AsyncSession,
    *,
    pool_allocation_id: uuid.UUID,
    address: str,
    family: int,
    tenant_id: uuid.UUID,
    service_id: Optional[uuid.UUID] = None,
    asset_record_id: Optional[uuid.UUID] = None,
    mac: Optional[str] = None,
    lease_expires_at: Optional[datetime] = None,
) -> IpAssignment:
    """Create an IpAssignment row.

    Validates:
    - address string format (valid IPv4/IPv6, correct family)
    - address not already active-assigned in this tenant (partial-unique guard)

    Raises 409 on duplicate active assignment.
    """
    _validate_ip(address, family)

    row = IpAssignment(
        tenant_id=tenant_id,
        pool_allocation_id=pool_allocation_id,
        address=address,
        family=family,
        service_id=service_id,
        asset_record_id=asset_record_id,
        mac=mac,
        assigned_at=_now(),
        lease_expires_at=lease_expires_at,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, f"Address {address!r} already has an active assignment in this tenant")
    return row


async def release_ip(
    session: AsyncSession,
    assignment_id: uuid.UUID,
    *,
    tenant_id: uuid.UUID,
) -> IpAssignment:
    """Set released_at = now() on the IpAssignment. Idempotent (already-released is fine)."""
    row = (await session.execute(
        select(IpAssignment).where(
            IpAssignment.id == assignment_id,
            IpAssignment.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "IP assignment not found")
    if row.released_at is None:
        row.released_at = _now()
        await session.flush()
    return row


async def current_assignment_for(
    session: AsyncSession,
    address: str,
    *,
    tenant_id: uuid.UUID,
) -> Optional[IpAssignment]:
    """Return the active (released_at IS NULL) assignment for an address, or None."""
    return (await session.execute(
        select(IpAssignment).where(
            IpAssignment.tenant_id == tenant_id,
            IpAssignment.address == address,
            IpAssignment.released_at.is_(None),
        )
    )).scalar_one_or_none()


async def assignments_for_service(
    session: AsyncSession,
    service_id: uuid.UUID,
    *,
    tenant_id: uuid.UUID,
) -> list[IpAssignment]:
    """All active + historical assignments for a service, newest first."""
    rows = (await session.execute(
        select(IpAssignment).where(
            IpAssignment.tenant_id == tenant_id,
            IpAssignment.service_id == service_id,
        ).order_by(IpAssignment.assigned_at.desc())
    )).scalars().all()
    return list(rows)
