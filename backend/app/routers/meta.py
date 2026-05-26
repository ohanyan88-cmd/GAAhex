from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, FieldDef, StatusDef, WorkflowDef, User
from .auth import current_user

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/entities")
async def list_entities(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ents = (await s.execute(select(EntityDef).where(EntityDef.tenant_id == user.tenant_id))).scalars().all()
    return [
        {"key": e.key, "label": e.label, "label_plural": e.label_plural, "route_slug": e.route_slug, "icon": e.icon}
        for e in ents
    ]


@router.get("/entities/{slug}")
async def get_entity_def(slug: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The full definition the Runtime Interpreter renders from — fields + statuses."""
    ent = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == user.tenant_id, EntityDef.route_slug == slug)
    )).scalar_one_or_none()
    if not ent:
        raise HTTPException(404, f"Unknown entity '{slug}'")
    fields = (await s.execute(select(FieldDef).where(FieldDef.entity_def_id == ent.id).order_by(FieldDef.order))).scalars().all()
    statuses = (await s.execute(select(StatusDef).where(StatusDef.entity_def_id == ent.id).order_by(StatusDef.order))).scalars().all()
    wf = (await s.execute(select(WorkflowDef).where(WorkflowDef.entity_def_id == ent.id))).scalars().first()
    transitions = (wf.config or {}).get("transitions", []) if wf else []
    return {
        "key": ent.key,
        "label": ent.label,
        "label_plural": ent.label_plural,
        "route_slug": ent.route_slug,
        "icon": ent.icon,
        "fields": [
            {"key": f.key, "label": f.label, "type": f.type, "required": f.required, "order": f.order, "config": f.config}
            for f in fields
        ],
        "statuses": [
            {"key": st.key, "label": st.label, "order": st.order, "is_initial": st.is_initial}
            for st in statuses
        ],
        "transitions": [{"from": t.get("from"), "to": t.get("to")} for t in transitions],
    }
