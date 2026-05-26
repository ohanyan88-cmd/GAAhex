import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, User
from ..models.saved_view import SavedViewDef
from ..access import load_grants, can
from .auth import current_user

# NOTE on namespacing: this router owns "/api/views" and "/api/views/{id}". The generic record
# router serves "/api/{slug}", so this MUST be registered BEFORE records.router in main.py, or
# "/api/views" would be swallowed as an entity slug. See the wiring report.
router = APIRouter(prefix="/api/views", tags=["views"])


class ViewIn(BaseModel):
    entity_key: str
    name: str
    config: dict = Field(default_factory=dict)   # {q?, filter?, sort?, columns?}
    shared: bool = False                         # True ⇒ owner_user_id NULL (tenant-wide)


class ViewPatch(BaseModel):
    name: str | None = None
    config: dict | None = None


async def _entity_or_404(s: AsyncSession, tenant_id, entity_key: str) -> EntityDef:
    ent = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == tenant_id, EntityDef.key == entity_key)
    )).scalar_one_or_none()
    if not ent:
        raise HTTPException(404, f"Unknown entity '{entity_key}'")
    return ent


def _serialize(v: SavedViewDef) -> dict:
    return {
        "id": str(v.id),
        "owner_user_id": str(v.owner_user_id) if v.owner_user_id else None,
        "shared": v.owner_user_id is None,
        "entity_key": v.entity_key,
        "name": v.name,
        "config": v.config or {},
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


@router.get("")
async def list_views(entity: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The caller's own views plus shared (tenant-wide) views for one entity. Requires view perm."""
    await _entity_or_404(s, user.tenant_id, entity)
    grants = await load_grants(s, user)
    if not can(grants, entity, "view"):
        raise HTTPException(403, f"Not allowed: {entity}.view")
    rows = (await s.execute(
        select(SavedViewDef).where(
            SavedViewDef.tenant_id == user.tenant_id,
            SavedViewDef.entity_key == entity,
            or_(SavedViewDef.owner_user_id == user.id, SavedViewDef.owner_user_id.is_(None)),
        ).order_by(SavedViewDef.created_at)
    )).scalars().all()
    return [_serialize(v) for v in rows]


@router.post("", status_code=201)
async def create_view(body: ViewIn, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a saved view. Owner = caller unless `shared=true` (then it's tenant-wide). Gated on
    the entity's view permission."""
    await _entity_or_404(s, user.tenant_id, body.entity_key)
    grants = await load_grants(s, user)
    if not can(grants, body.entity_key, "view"):
        raise HTTPException(403, f"Not allowed: {body.entity_key}.view")
    view = SavedViewDef(
        tenant_id=user.tenant_id,
        owner_user_id=None if body.shared else user.id,
        entity_key=body.entity_key,
        name=body.name,
        config=body.config or {},
    )
    s.add(view)
    await s.commit()
    await s.refresh(view)
    return _serialize(view)


async def _own_view_or_404(s: AsyncSession, user: User, view_id: uuid.UUID) -> SavedViewDef:
    """Fetch a view the caller owns. Shared views (no owner) are not editable here → 404."""
    view = (await s.execute(
        select(SavedViewDef).where(
            SavedViewDef.id == view_id,
            SavedViewDef.tenant_id == user.tenant_id,
            SavedViewDef.owner_user_id == user.id,
        )
    )).scalar_one_or_none()
    if not view:
        raise HTTPException(404, "Saved view not found")
    return view


@router.patch("/{view_id}")
async def update_view(view_id: uuid.UUID, body: ViewPatch, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    view = await _own_view_or_404(s, user, view_id)
    if body.name is not None:
        view.name = body.name
    if body.config is not None:
        view.config = body.config
    await s.commit()
    await s.refresh(view)
    return _serialize(view)


@router.delete("/{view_id}", status_code=204)
async def delete_view(view_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    view = await _own_view_or_404(s, user, view_id)
    await s.delete(view)
    await s.commit()
