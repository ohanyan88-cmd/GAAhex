from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, FieldDef, StatusDef, WorkflowDef, PermissionDef, User
from ..access import load_grants, can
from .auth import current_user

router = APIRouter(prefix="/meta", tags=["meta"])

ALLOWED_TYPES = {
    "text", "textarea", "number", "money", "boolean", "date", "datetime", "email", "phone",
    "select", "multiselect", "status", "ref", "ref_user", "ref_orgnode", "file", "formula",
}


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


@router.post("/entities", status_code=201)
async def create_entity(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a whole entity AS CONFIG from the UI — fields + statuses + transitions, atomically.
    Requires the config.manage permission (super_admin). This is the no-SQL killer test."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")

    key = (payload.get("key") or "").strip()
    slug = (payload.get("route_slug") or "").strip()
    label = (payload.get("label") or "").strip()
    if not key or not slug or not label:
        raise HTTPException(422, "key, route_slug and label are required")

    clash = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == user.tenant_id,
                                (EntityDef.key == key) | (EntityDef.route_slug == slug))
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"An entity with key '{key}' or slug '{slug}' already exists")

    fields = payload.get("fields") or []
    statuses = payload.get("statuses") or []
    transitions = payload.get("transitions") or []

    for f in fields:
        if f.get("type") not in ALLOWED_TYPES:
            raise HTTPException(422, f"Unknown field type '{f.get('type')}'")
    if sum(1 for st in statuses if st.get("is_initial")) > 1:
        raise HTTPException(422, "Only one status can be initial")

    ent = EntityDef(
        tenant_id=user.tenant_id, key=key, label=label,
        label_plural=(payload.get("label_plural") or f"{label}s"),
        route_slug=slug, icon=payload.get("icon"),
    )
    s.add(ent)
    await s.flush()

    for i, f in enumerate(fields, start=1):
        s.add(FieldDef(tenant_id=user.tenant_id, entity_def_id=ent.id, key=f["key"],
                       label=f.get("label", f["key"]), type=f["type"], required=bool(f.get("required")),
                       order=i, config=f.get("config")))
    for i, st in enumerate(statuses, start=1):
        s.add(StatusDef(tenant_id=user.tenant_id, entity_def_id=ent.id, key=st["key"],
                        label=st.get("label", st["key"]), order=i, is_initial=bool(st.get("is_initial"))))
    if transitions:
        s.add(WorkflowDef(tenant_id=user.tenant_id, entity_def_id=ent.id, key=f"{key}_lifecycle",
                          label=f"{label} Lifecycle", config={"transitions": transitions}))
    for verb in ("view", "create", "edit", "delete"):
        s.add(PermissionDef(tenant_id=user.tenant_id, key=f"{key}.{verb}", label=f"{verb} {key}", group=key))

    await s.commit()
    return {"key": key, "route_slug": slug, "label_plural": ent.label_plural}
