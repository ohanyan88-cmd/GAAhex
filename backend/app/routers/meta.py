from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, FieldDef, StatusDef, WorkflowDef, PermissionDef, Record, User
from ..access import load_grants, can, role_keys, can_view_field, can_edit_field
from ..kernel import assert_can, AccessDenied
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/meta", tags=["meta"])

ALLOWED_TYPES = {
    "text", "textarea", "number", "money", "boolean", "date", "datetime", "email", "phone",
    "select", "multiselect", "status", "ref", "ref_user", "ref_orgnode", "file", "formula",
}


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    """Default-deny gate for all config-management endpoints — same check as POST /meta/entities.

    SPEC §0.2 (Step 7): in addition to the legacy `config.manage` role check, run the kernel's
    Role × Department × Region × Ownership AND-evaluator on `entity_def.manage` so config writes
    flow through the same default-deny matrix as data writes.
    """
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")
    try:
        await assert_can(s, user, action="manage", entity_key="entity_def",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


async def _get_entity(s: AsyncSession, user: User, slug: str) -> EntityDef:
    ent = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == user.tenant_id, EntityDef.route_slug == slug)
    )).scalar_one_or_none()
    if not ent:
        raise HTTPException(404, f"Unknown entity '{slug}'")
    return ent


@router.get("/entities")
async def list_entities(
    include_retired: bool = False,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Live entities for the tenant. Soft-retired entities are hidden by default; pass
    `?include_retired=true` to include them (e.g. for Studio admin views)."""
    q = select(EntityDef).where(EntityDef.tenant_id == user.tenant_id)
    if not include_retired:
        q = q.where(EntityDef.status != "retired")
    ents = (await s.execute(q.order_by(EntityDef.order, EntityDef.label))).scalars().all()
    return [
        {"key": e.key, "label": e.label, "label_plural": e.label_plural,
         "route_slug": e.route_slug, "icon": e.icon, "status": e.status, "order": e.order}
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

    # field-level access for THIS caller: hide fields they can't view, annotate `editable` so the
    # interpreter can render the rest read-only where needed. config.manage holders see all + editable.
    grants = await load_grants(s, user)
    rkeys = role_keys(grants)
    admin = can(grants, "config", "manage")
    visible_fields = [f for f in fields if can_view_field(f.config, rkeys, admin)]
    return {
        "key": ent.key,
        "label": ent.label,
        "label_plural": ent.label_plural,
        "route_slug": ent.route_slug,
        "icon": ent.icon,
        "fields": [
            {"key": f.key, "label": f.label, "type": f.type, "required": f.required, "order": f.order,
             "config": f.config, "editable": can_edit_field(f.config, rkeys, admin)}
            for f in visible_fields
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

    await workflow.emit(
        s, user.tenant_id, "create", "entity_def", ent.id, user.id,
        {"key": key, "label": label, "route_slug": slug,
         "field_count": len(fields), "status_count": len(statuses)},
    )
    await s.commit()
    return {"key": key, "route_slug": slug, "label_plural": ent.label_plural}


# ===========================================================================================
# Studio lifecycle: edit & (soft) delete existing config. All gated by config.manage.
# Every handler mutates inside the request's single transaction → atomic; a validation failure
# raises before commit, so nothing is partially applied.
# ===========================================================================================

# ---- Entity-level ----

@router.patch("/entities/{slug}")
async def update_entity(slug: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit an entity's presentation: label, label_plural, icon, order. Unknown keys are rejected.
    (`key`/`route_slug` are immutable — they anchor records and routes.)"""
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)

    allowed = {"label", "label_plural", "icon", "order"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(422, f"Cannot patch {sorted(unknown)}; allowed: {sorted(allowed)}")

    changed: list[str] = []
    if "label" in payload:
        v = (payload["label"] or "").strip()
        if not v:
            raise HTTPException(422, "label cannot be empty")
        ent.label = v; changed.append("label")
    if "label_plural" in payload:
        v = (payload["label_plural"] or "").strip()
        if not v:
            raise HTTPException(422, "label_plural cannot be empty")
        ent.label_plural = v; changed.append("label_plural")
    if "icon" in payload:
        ent.icon = payload["icon"]                      # nullable — allow clearing
        changed.append("icon")
    if "order" in payload:
        ent.order = int(payload["order"])               # DEPENDS ON EntityDef.order (see report)
        changed.append("order")

    if changed:
        await workflow.emit(
            s, user.tenant_id, "update", "entity_def", ent.id, user.id,
            {"key": ent.key, "changed": changed},
        )
    await s.commit()
    return {"key": ent.key, "label": ent.label, "label_plural": ent.label_plural,
            "route_slug": ent.route_slug, "icon": ent.icon, "status": ent.status}


@router.delete("/entities/{slug}")
async def retire_entity(slug: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Soft-retire an entity (status='retired'). Never hard-deletes — its records and audit events
    must be preserved. Retired entities drop out of the default /meta/entities listing, and writes
    via POST /api/{slug} must be refused (that check belongs in records.py — see report)."""
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)
    ent.status = "retired"
    await workflow.emit(
        s, user.tenant_id, "delete", "entity_def", ent.id, user.id,
        {"key": ent.key, "route_slug": ent.route_slug},
    )
    await s.commit()
    return {"key": ent.key, "status": ent.status}


# ---- Field-level (additive + safe edits only) ----

@router.post("/entities/{slug}/fields", status_code=201)
async def add_field(slug: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Add a field to a live entity — it renders immediately, no restart."""
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)

    key = (payload.get("key") or "").strip()
    if not key:
        raise HTTPException(422, "field key is required")
    ftype = payload.get("type")
    if ftype not in ALLOWED_TYPES:
        raise HTTPException(422, f"Unknown field type '{ftype}'")
    clash = (await s.execute(
        select(FieldDef).where(FieldDef.entity_def_id == ent.id, FieldDef.key == key)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"Field '{key}' already exists on '{ent.key}'")

    if payload.get("order") is not None:
        order = int(payload["order"])
    else:
        maxord = (await s.execute(select(func.max(FieldDef.order)).where(FieldDef.entity_def_id == ent.id))).scalar() or 0
        order = maxord + 1

    fld = FieldDef(tenant_id=user.tenant_id, entity_def_id=ent.id, key=key,
                   label=payload.get("label", key), type=ftype,
                   required=bool(payload.get("required")), order=order, config=payload.get("config"))
    s.add(fld)
    await s.flush()
    await workflow.emit(
        s, user.tenant_id, "create", "field_def", fld.id, user.id,
        {"entity_key": ent.key, "key": fld.key, "type": fld.type, "label": fld.label,
         "required": fld.required},
    )
    await s.commit()
    return {"key": fld.key, "label": fld.label, "type": fld.type,
            "required": fld.required, "order": fld.order, "config": fld.config}


@router.delete("/entities/{slug}/fields/{field_key}", status_code=204)
async def delete_field(slug: str, field_key: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Hard-delete a field definition. The field's key will vanish from the schema; any data
    previously stored under it in records remains in the JSONB `data` column but is no longer
    surfaced. Gated by config.manage."""
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)
    fld = (await s.execute(
        select(FieldDef).where(FieldDef.entity_def_id == ent.id, FieldDef.key == field_key)
    )).scalar_one_or_none()
    if not fld:
        raise HTTPException(404, f"Unknown field '{field_key}' on '{ent.key}'")
    fid = fld.id
    fkey = fld.key
    await s.delete(fld)
    await workflow.emit(
        s, user.tenant_id, "delete", "field_def", fid, user.id,
        {"entity_key": ent.key, "key": fkey},
    )
    await s.commit()


@router.patch("/entities/{slug}/fields/{field_key}")
async def update_field(slug: str, field_key: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit a field's SAFE attributes only: label, required, order, and (for select/multiselect)
    its `options`.

    Renaming the field `key` or changing its `type` is REFUSED (409): records already store values
    in JSONB `data` under the current key and shaped for the current type — a rename would orphan
    that data and a type change would corrupt it. Add a new field instead.
    """
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)
    fld = (await s.execute(
        select(FieldDef).where(FieldDef.entity_def_id == ent.id, FieldDef.key == field_key)
    )).scalar_one_or_none()
    if not fld:
        raise HTTPException(404, f"Unknown field '{field_key}' on '{ent.key}'")

    if "key" in payload and payload["key"] != fld.key:
        raise HTTPException(409, "Renaming a field key is not allowed — it would orphan data stored "
                                 "under the old key. Add a new field instead.")
    if "type" in payload and payload["type"] != fld.type:
        raise HTTPException(409, "Changing a field type is not allowed — existing values were stored "
                                 "as the old type. Add a new field instead.")

    allowed = {"key", "type", "label", "required", "order", "options", "config"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(422, f"Cannot patch {sorted(unknown)}; editable: ['label','required','order','options']")

    changed: list[str] = []
    if "label" in payload:
        v = (payload["label"] or "").strip()
        if not v:
            raise HTTPException(422, "label cannot be empty")
        fld.label = v; changed.append("label")
    if "required" in payload:
        fld.required = bool(payload["required"]); changed.append("required")
    if "order" in payload:
        fld.order = int(payload["order"]); changed.append("order")

    new_opts = payload.get("options")
    if new_opts is None and isinstance(payload.get("config"), dict):
        new_opts = payload["config"].get("options")
    if new_opts is not None:
        if fld.type not in ("select", "multiselect"):
            raise HTTPException(422, f"options only apply to select/multiselect fields, not '{fld.type}'")
        if not isinstance(new_opts, list) or not all(isinstance(o, str) for o in new_opts):
            raise HTTPException(422, "options must be a list of strings")
        cfg = dict(fld.config or {})
        cfg["options"] = new_opts
        fld.config = cfg                                # reassign so SQLAlchemy detects the JSONB change
        changed.append("options")

    if changed:
        await workflow.emit(
            s, user.tenant_id, "update", "field_def", fld.id, user.id,
            {"entity_key": ent.key, "key": fld.key, "changed": changed},
        )
    await s.commit()
    return {"key": fld.key, "label": fld.label, "type": fld.type,
            "required": fld.required, "order": fld.order, "config": fld.config}


# ---- Status / transition-level ----

@router.post("/entities/{slug}/statuses", status_code=201)
async def add_status(slug: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Add a lifecycle status (UPPER_SNAKE key + label). Marking it initial clears any other initial."""
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)

    key = (payload.get("key") or "").strip()
    if not key:
        raise HTTPException(422, "status key is required")
    clash = (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == ent.id, StatusDef.key == key)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"Status '{key}' already exists on '{ent.key}'")

    is_initial = bool(payload.get("is_initial"))
    if is_initial:
        for o in (await s.execute(
            select(StatusDef).where(StatusDef.entity_def_id == ent.id, StatusDef.is_initial.is_(True))
        )).scalars().all():
            o.is_initial = False

    if payload.get("order") is not None:
        order = int(payload["order"])
    else:
        maxord = (await s.execute(select(func.max(StatusDef.order)).where(StatusDef.entity_def_id == ent.id))).scalar() or 0
        order = maxord + 1

    st = StatusDef(tenant_id=user.tenant_id, entity_def_id=ent.id, key=key,
                   label=payload.get("label", key), order=order, is_initial=is_initial)
    s.add(st)
    await s.flush()
    await workflow.emit(
        s, user.tenant_id, "create", "status_def", st.id, user.id,
        {"entity_key": ent.key, "key": st.key, "label": st.label, "is_initial": st.is_initial},
    )
    await s.commit()
    return {"key": st.key, "label": st.label, "order": st.order, "is_initial": st.is_initial}


@router.patch("/entities/{slug}/statuses/reorder")
async def reorder_statuses(slug: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Reorder statuses. Body: {order: [STATUS_KEY, ...]} — every key must exist; order becomes the
    list index (1-based)."""
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)

    order = payload.get("order")
    if not isinstance(order, list) or not order:
        raise HTTPException(422, "body must be {order: [STATUS_KEY, ...]}")
    statuses = {st.key: st for st in (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == ent.id)
    )).scalars().all()}
    unknown = [k for k in order if k not in statuses]
    if unknown:
        raise HTTPException(422, f"Unknown statuses: {unknown}")

    for i, k in enumerate(order, start=1):
        statuses[k].order = i
    await workflow.emit(
        s, user.tenant_id, "update", "status_def", ent.id, user.id,
        {"entity_key": ent.key, "reorder": order},
    )
    await s.commit()
    return {"order": order}


@router.patch("/entities/{slug}/statuses/{status_key}")
async def update_status(slug: str, status_key: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit a status's label and/or is_initial flag. Setting is_initial=true clears any other initial
    status (only one is allowed). Gated by config.manage."""
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)
    st = (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == ent.id, StatusDef.key == status_key)
    )).scalar_one_or_none()
    if not st:
        raise HTTPException(404, f"Unknown status '{status_key}' on '{ent.key}'")

    changed: list[str] = []
    if "label" in payload:
        v = (payload["label"] or "").strip()
        if not v:
            raise HTTPException(422, "label cannot be empty")
        st.label = v; changed.append("label")

    if "is_initial" in payload:
        new_initial = bool(payload["is_initial"])
        if new_initial:
            for o in (await s.execute(
                select(StatusDef).where(StatusDef.entity_def_id == ent.id, StatusDef.is_initial.is_(True))
            )).scalars().all():
                o.is_initial = False
        st.is_initial = new_initial
        changed.append("is_initial")

    if changed:
        await workflow.emit(
            s, user.tenant_id, "update", "status_def", st.id, user.id,
            {"entity_key": ent.key, "key": st.key, "changed": changed},
        )
    await s.commit()
    return {"key": st.key, "label": st.label, "order": st.order, "is_initial": st.is_initial}


@router.delete("/entities/{slug}/statuses/{status_key}")
async def delete_status(slug: str, status_key: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a status — but only if it is safe to. Blocked (409) if any record currently sits in it
    (with the affected count) or if any transition still references it (edit transitions first)."""
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)
    st = (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == ent.id, StatusDef.key == status_key)
    )).scalar_one_or_none()
    if not st:
        raise HTTPException(404, f"Unknown status '{status_key}' on '{ent.key}'")

    in_use = (await s.execute(
        select(func.count()).select_from(Record).where(
            Record.tenant_id == user.tenant_id, Record.entity_key == ent.key, Record.status == status_key)
    )).scalar_one()
    if in_use:
        raise HTTPException(409, f"Cannot delete status '{status_key}': {in_use} record(s) are in it. "
                                 "Move them to another status first.")

    wf = (await s.execute(select(WorkflowDef).where(WorkflowDef.entity_def_id == ent.id))).scalars().first()
    if wf and wf.config:
        refs = [t for t in wf.config.get("transitions", []) if status_key in (t.get("from"), t.get("to"))]
        if refs:
            raise HTTPException(409, f"Cannot delete status '{status_key}': {len(refs)} transition(s) "
                                     "reference it. Edit transitions first.")

    sid = st.id
    skey = st.key
    await s.delete(st)
    await workflow.emit(
        s, user.tenant_id, "delete", "status_def", sid, user.id,
        {"entity_key": ent.key, "key": skey},
    )
    await s.commit()
    return {"deleted": status_key}


@router.put("/entities/{slug}/transitions")
async def set_transitions(slug: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Replace the entity's transition set atomically (add/remove edges, change guards in one call).
    Body: {transitions: [{from, to, guard?}, ...]}. Every from/to must be a defined status (422
    otherwise) so no edge can dangle. `from: null` means an initial-state entry edge."""
    await _require_config_manage(s, user)
    ent = await _get_entity(s, user, slug)

    transitions = payload.get("transitions")
    if not isinstance(transitions, list):
        raise HTTPException(422, "body must be {transitions: [{from, to, guard?}, ...]}")
    valid = {st.key for st in (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == ent.id)
    )).scalars().all()}

    cleaned = []
    for t in transitions:
        frm, to = t.get("from"), t.get("to")
        if to not in valid:
            raise HTTPException(422, f"Transition target '{to}' is not a defined status")
        if frm is not None and frm not in valid:
            raise HTTPException(422, f"Transition source '{frm}' is not a defined status")
        cleaned.append({"from": frm, "to": to, "guard": t.get("guard")})

    wf = (await s.execute(select(WorkflowDef).where(WorkflowDef.entity_def_id == ent.id))).scalars().first()
    if wf:
        cfg = dict(wf.config or {})
        cfg["transitions"] = cleaned
        wf.config = cfg                                 # reassign so the JSONB change is detected
        wf_id = wf.id
    else:
        new_wf = WorkflowDef(tenant_id=user.tenant_id, entity_def_id=ent.id,
                             key=f"{ent.key}_lifecycle", label=f"{ent.label} Lifecycle",
                             config={"transitions": cleaned})
        s.add(new_wf)
        await s.flush()
        wf_id = new_wf.id
    await workflow.emit(
        s, user.tenant_id, "update", "workflow_def", wf_id, user.id,
        {"entity_key": ent.key, "transition_count": len(cleaned)},
    )
    await s.commit()
    return {"transitions": [{"from": t["from"], "to": t["to"]} for t in cleaned]}
