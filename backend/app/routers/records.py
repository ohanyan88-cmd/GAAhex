import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, FieldDef, StatusDef, Record, OrgNode, User, Event
from ..access import load_grants, can
from .. import workflow, gxl, notify_hooks
from .auth import current_user

router = APIRouter(prefix="/api", tags=["records"])


# ---- helpers (the generic engine — no per-entity code) ----

async def _entity(s: AsyncSession, tenant_id, slug: str) -> EntityDef:
    ent = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == tenant_id, EntityDef.route_slug == slug)
    )).scalar_one_or_none()
    if not ent:
        raise HTTPException(404, f"Unknown entity '{slug}'")
    return ent


async def _fields(s: AsyncSession, entity_id) -> list[FieldDef]:
    return list((await s.execute(
        select(FieldDef).where(FieldDef.entity_def_id == entity_id).order_by(FieldDef.order)
    )).scalars().all())


async def _initial_status(s: AsyncSession, entity_id) -> str | None:
    st = (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == entity_id, StatusDef.is_initial == True)  # noqa: E712
    )).scalar_one_or_none()
    return st.key if st else None


async def _node_paths(s: AsyncSession, tenant_id) -> dict[str, str]:
    rows = (await s.execute(select(OrgNode.id, OrgNode.path).where(OrgNode.tenant_id == tenant_id))).all()
    return {str(i): str(p) for i, p in rows}


async def _node_path(s: AsyncSession, node_id) -> str | None:
    if not node_id:
        return None
    p = (await s.execute(select(OrgNode.path).where(OrgNode.id == node_id))).scalar_one_or_none()
    return str(p) if p is not None else None


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^\+?[\d \-]{5,20}$")


def _check_type(field: FieldDef, value):
    """Type-aware validation for a present, non-empty field value (raises 422 if invalid)."""
    t = field.type
    if t == "email":
        if not isinstance(value, str) or not _EMAIL_RE.match(value):
            raise HTTPException(422, f"Invalid email for '{field.key}'")
    elif t == "phone":
        if not isinstance(value, str) or not _PHONE_RE.match(value.strip()):
            raise HTTPException(422, f"Invalid phone number for '{field.key}'")
    elif t in ("number", "money"):
        try:
            float(value)
        except (TypeError, ValueError):
            raise HTTPException(422, f"'{field.key}' must be a number")
    elif t == "select":
        opts = (field.config or {}).get("options")
        if opts and value not in opts:
            raise HTTPException(422, f"'{field.key}' must be one of {opts}")


def _validate(fields: list[FieldDef], payload: dict, partial: bool):
    by_key = {f.key: f for f in fields}
    for k in payload:
        if k not in by_key:
            raise HTTPException(422, f"Unknown field '{k}'")
    data: dict = {}
    status_value = None
    has_status = any(f.type == "status" for f in fields)
    for f in fields:
        present = f.key in payload
        if f.type == "status":
            if present:
                status_value = payload[f.key]
            continue
        if present:
            v = payload[f.key]
            if v is not None and v != "":
                _check_type(f, v)
            if f.type == "boolean" and v is not None:
                v = bool(v)
            data[f.key] = v
        elif not partial and f.required:
            raise HTTPException(422, f"Missing required field '{f.key}'")
    return data, status_value, has_status


def _serialize(rec: Record) -> dict:
    out = {
        "id": str(rec.id),
        "owner_node_id": str(rec.owner_node_id) if rec.owner_node_id else None,
        "status": rec.status,
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
    }
    out.update(rec.data or {})
    return out


async def _get(s, tenant_id, entity_key, rec_id) -> Record:
    rec = (await s.execute(
        select(Record).where(
            Record.id == rec_id, Record.tenant_id == tenant_id, Record.entity_key == entity_key
        )
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(404, "Record not found")
    return rec


def _deny(entity_key: str, verb: str):
    raise HTTPException(403, f"Not allowed: {entity_key}.{verb}")


# ---- generic CRUD (access-enforced) ----

@router.get("/{slug}")
async def list_records(slug: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view"):           # no view permission on this entity at all
        _deny(ent.key, "view")
    paths = await _node_paths(s, user.tenant_id)
    rows = (await s.execute(
        select(Record).where(Record.tenant_id == user.tenant_id, Record.entity_key == ent.key).order_by(Record.created_at)
    )).scalars().all()
    visible = [
        r for r in rows
        if can(grants, ent.key, "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)
    ]
    return [_serialize(r) for r in visible]


@router.post("/{slug}", status_code=201)
async def create_record(slug: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    if ent.status == "retired":
        raise HTTPException(409, f"Entity '{slug}' is retired; new records cannot be created")
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, ent.key, "create", owner_path):
        _deny(ent.key, "create")
    fields = await _fields(s, ent.id)
    data, _ignored_status, has_status = _validate(fields, payload, partial=False)
    # status is lifecycle-managed: new records always start at the initial status
    status = (await _initial_status(s, ent.id)) if has_status else None
    rec = Record(
        tenant_id=user.tenant_id, entity_key=ent.key,
        owner_node_id=user.primary_node_id, status=status, data=data,
    )
    s.add(rec)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", ent.key, rec.id, user.id, {"data": data, "status": status})
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="create", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"status": status})
    await s.commit()
    await s.refresh(rec)
    return _serialize(rec)


@router.get("/{slug}/{rec_id}")
async def get_record(slug: str, rec_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "view")
    return _serialize(rec)


@router.patch("/{slug}/{rec_id}")
async def update_record(slug: str, rec_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "edit", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "edit")
    fields = await _fields(s, ent.id)
    data, _status_ignored, _ = _validate(fields, payload, partial=True)
    # status changes go through /transition (guarded), never via free PATCH
    before = dict(rec.data or {})
    merged = dict(before)
    merged.update(data)
    rec.data = merged
    await workflow.emit(s, user.tenant_id, "update", ent.key, rec.id, user.id,
                        {"changed": data, "before": {k: before.get(k) for k in data}})
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="update", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"changed": data})
    await s.commit()
    await s.refresh(rec)
    return _serialize(rec)


@router.delete("/{slug}/{rec_id}", status_code=204)
async def delete_record(slug: str, rec_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "delete", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "delete")
    await workflow.emit(s, user.tenant_id, "delete", ent.key, rec.id, user.id,
                        {"data": dict(rec.data or {}), "status": rec.status})
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="delete", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"status": rec.status})
    await s.delete(rec)
    await s.commit()


@router.post("/{slug}/{rec_id}/transition")
async def transition(slug: str, rec_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Move a record's status along a workflow transition, gated by a GXL guard."""
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "edit", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "edit")

    to = payload.get("to")
    if not to:
        raise HTTPException(422, "Missing 'to' status")

    transitions = await workflow.get_transitions(s, ent.id)
    tr = workflow.find_transition(transitions, rec.status, to)
    if not tr:
        raise HTTPException(409, f"No transition from '{rec.status}' to '{to}'")

    ctx = await workflow.guard_context(s, ent.id, rec)
    if not gxl.evaluate(tr.get("guard"), ctx):
        raise HTTPException(422, f"Guard failed for {rec.status} -> {to}: {tr.get('guard')}")

    frm = rec.status
    rec.status = to
    await workflow.emit(s, user.tenant_id, "transition", ent.key, rec.id, user.id, {"from": frm, "to": to})
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="transition", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"from": frm, "to": to})
    await s.commit()
    await s.refresh(rec)
    return _serialize(rec)


@router.get("/{slug}/{rec_id}/history")
async def record_history(slug: str, rec_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The audit trail for one record — every create/update/transition/delete event."""
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view", await _node_path(s, rec.owner_node_id)):
        _deny(ent.key, "view")
    rows = (await s.execute(
        select(Event).where(Event.tenant_id == user.tenant_id, Event.record_id == rec_id).order_by(Event.created_at)
    )).scalars().all()
    return [
        {"type": e.type, "data": e.data, "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
         "at": e.created_at.isoformat() if e.created_at else None}
        for e in rows
    ]
