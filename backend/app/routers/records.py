import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, FieldDef, StatusDef, Record, User
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


# ---- generic CRUD ----

@router.get("/{slug}")
async def list_records(slug: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    rows = (await s.execute(
        select(Record).where(Record.tenant_id == user.tenant_id, Record.entity_key == ent.key).order_by(Record.created_at)
    )).scalars().all()
    return [_serialize(r) for r in rows]


@router.post("/{slug}", status_code=201)
async def create_record(slug: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    fields = await _fields(s, ent.id)
    data, status_value, has_status = _validate(fields, payload, partial=False)
    status = status_value or (await _initial_status(s, ent.id) if has_status else None)
    rec = Record(
        tenant_id=user.tenant_id, entity_key=ent.key,
        owner_node_id=user.primary_node_id, status=status, data=data,
    )
    s.add(rec)
    await s.commit()
    await s.refresh(rec)
    return _serialize(rec)


@router.get("/{slug}/{rec_id}")
async def get_record(slug: str, rec_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    return _serialize(await _get(s, user.tenant_id, ent.key, rec_id))


@router.patch("/{slug}/{rec_id}")
async def update_record(slug: str, rec_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    fields = await _fields(s, ent.id)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    data, status_value, _ = _validate(fields, payload, partial=True)
    merged = dict(rec.data or {})
    merged.update(data)
    rec.data = merged
    if status_value is not None:
        rec.status = status_value
    await s.commit()
    await s.refresh(rec)
    return _serialize(rec)


@router.delete("/{slug}/{rec_id}", status_code=204)
async def delete_record(slug: str, rec_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ent = await _entity(s, user.tenant_id, slug)
    rec = await _get(s, user.tenant_id, ent.key, rec_id)
    await s.delete(rec)
    await s.commit()
