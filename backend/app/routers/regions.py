"""SPEC §0.6 canonical region read API.

Read-only list + get for the tenant's regions. WRITE paths (create/update/archive) and
hierarchy editing are deferred to a later step — see `docs/kernel-build/SPEC-0-6-REGIONS.md`
for the full deferred list.

Tenant-scoping: the `region` table's RLS policy filters by the request's `gaahex.tenant_id`
GUC (set by the auth dependency), so a plain `SELECT * FROM region` on the request session
returns only the caller's rows. No manual `tenant_id ==` filter needed (the policy is the
source of truth — adding a manual filter would mask an RLS misconfiguration).

Fixed paths under /api ("/api/regions"), so this router is registered BEFORE
records.router ("/api/{slug}") in `main.py`.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Region, User
from .auth import current_user

router = APIRouter(prefix="/api/regions", tags=["regions"])


def _region(r: Region) -> dict:
    """Serialize a Region row for the wire — flat dict, ISO timestamps, str UUIDs."""
    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "code": r.code,
        "name": r.name,
        "parent_id": str(r.parent_id) if r.parent_id else None,
        "region_type": r.region_type,
        "status": r.status,
        "timezone": r.timezone,
        "locale": r.locale,
        "metadata": r.metadata_,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("")
async def list_regions(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List regions for the caller's tenant. RLS scopes the query — no manual filter."""
    rows = (await s.execute(
        select(Region).order_by(Region.region_type.asc(), Region.code.asc())
    )).scalars().all()
    return [_region(r) for r in rows]


@router.get("/{region_id}")
async def get_region(
    region_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Get one region. 404 if not in the caller's tenant (RLS hides cross-tenant rows)."""
    row = (await s.execute(
        select(Region).where(Region.id == region_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Region not found")
    return _region(row)
