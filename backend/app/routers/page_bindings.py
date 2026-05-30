"""Page-binding persistence — connect Studio components to entity fields.

Endpoints under /api/page-bindings:
  GET    /api/page-bindings?page_id=<uuid>  → list bindings for a page (tenant-scoped)
  POST   /api/page-bindings                 → create a binding
  DELETE /api/page-bindings/{binding_id}    → delete a binding

Auth gate: config.manage for POST / DELETE. GET requires any authenticated user.
POST and DELETE emit audit Events.
Register BEFORE records.router in main.py (fixed path avoids slug collision).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Event
from ..models.page_binding import PageBinding
from ..access import load_grants, can
from .auth import current_user

router = APIRouter(prefix="/api/page-bindings", tags=["page-bindings"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _out(b: PageBinding) -> dict:
    return {
        "id": str(b.id),
        "page_id": str(b.page_id) if b.page_id else None,
        "component_key": b.component_key,
        "entity_slug": b.entity_slug,
        "field_key": b.field_key,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed: config.manage required")


# ── schemas ───────────────────────────────────────────────────────────────────

class BindingCreate(BaseModel):
    page_id: Optional[uuid.UUID] = None
    component_key: str
    entity_slug: str
    field_key: Optional[str] = None


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_bindings(
    page_id: Optional[uuid.UUID] = Query(None),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List bindings for a page (or all tenant bindings when page_id is omitted).
    Readable by any authenticated tenant user.
    """
    q = select(PageBinding).where(PageBinding.tenant_id == user.tenant_id)
    if page_id is not None:
        q = q.where(PageBinding.page_id == page_id)
    rows = (await s.execute(q.order_by(PageBinding.created_at))).scalars().all()
    return [_out(r) for r in rows]


@router.post("", status_code=201)
async def create_binding(
    body: BindingCreate,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a component→entity binding. Requires config.manage. Emits an audit Event."""
    await _require_config_manage(s, user)

    if not body.component_key.strip():
        raise HTTPException(422, "component_key is required")
    if not body.entity_slug.strip():
        raise HTTPException(422, "entity_slug is required")

    now = datetime.now(timezone.utc)
    binding = PageBinding(
        id=uuid.uuid4(),
        tenant_id=user.tenant_id,
        page_id=body.page_id,
        component_key=body.component_key.strip(),
        entity_slug=body.entity_slug.strip(),
        field_key=(body.field_key.strip() if body.field_key else None) or None,
        created_at=now,
        updated_at=now,
    )
    s.add(binding)

    # Audit event
    s.add(Event(
        tenant_id=user.tenant_id,
        type="page_binding.create",
        entity_key="page_binding",
        actor_user_id=user.id,
        data={
            "binding_id": str(binding.id),
            "page_id": str(body.page_id) if body.page_id else None,
            "component_key": binding.component_key,
            "entity_slug": binding.entity_slug,
            "field_key": binding.field_key,
        },
    ))

    await s.commit()
    return _out(binding)


@router.delete("/{binding_id}", status_code=204)
async def delete_binding(
    binding_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Delete a binding. Requires config.manage. Emits an audit Event."""
    await _require_config_manage(s, user)

    binding = (await s.execute(
        select(PageBinding).where(
            PageBinding.tenant_id == user.tenant_id,
            PageBinding.id == binding_id,
        )
    )).scalar_one_or_none()

    if not binding:
        raise HTTPException(404, f"Binding '{binding_id}' not found")

    # Audit event before deletion (so we still have attribute values)
    s.add(Event(
        tenant_id=user.tenant_id,
        type="page_binding.delete",
        entity_key="page_binding",
        actor_user_id=user.id,
        data={
            "binding_id": str(binding.id),
            "page_id": str(binding.page_id) if binding.page_id else None,
            "component_key": binding.component_key,
            "entity_slug": binding.entity_slug,
            "field_key": binding.field_key,
        },
    ))

    await s.delete(binding)
    await s.commit()
