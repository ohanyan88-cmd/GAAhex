"""IPAM / resource-pool API (network depth, doc 19).

Tenant + org scoped (`resource_pool.*` permission gate), audit Events on allocate/release. Pools
are blocks you allocate values from; allocations keep history (release ⇒ status RELEASED). A
partial unique index guarantees a value isn't double-allocated while ALLOCATED.

NOTE on namespacing: fixed paths under /api ("/api/resource-pools") → register BEFORE records.router.
"""
import ipaddress
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.respool import ResourcePool, PoolAllocation
from ..models.service import Service
from ..access import load_grants, can
from ..kernel import assert_can, AccessDenied
from .. import workflow
from .auth import current_user
from .records import _node_path, _node_paths     # reuse the exact records scope primitives

router = APIRouter(prefix="/api", tags=["resource-pools"])

_KINDS = {"ipv4", "ipv6", "vlan", "phone", "other"}


def _deny(perm: str):
    raise HTTPException(403, f"Not allowed: {perm}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat() if dt else None


# ---- serializers ----

def _pool(p: ResourcePool, allocated_count: int | None = None) -> dict:
    out = {
        "id": str(p.id),
        "owner_node_id": str(p.owner_node_id) if p.owner_node_id else None,
        "name": p.name,
        "kind": p.kind,
        "spec": p.spec or {},
        "created_at": _iso(p.created_at),
    }
    if allocated_count is not None:
        out["allocated_count"] = allocated_count
    return out


def _alloc(a: PoolAllocation) -> dict:
    return {"id": str(a.id), "pool_id": str(a.pool_id), "value": a.value,
            "service_id": str(a.service_id) if a.service_id else None, "status": a.status,
            "allocated_at": _iso(a.allocated_at), "released_at": _iso(a.released_at)}


# ---- loaders / helpers ----

async def _get_pool(s, user: User, pool_id) -> ResourcePool:
    p = (await s.execute(
        select(ResourcePool).where(ResourcePool.id == pool_id, ResourcePool.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Resource pool not found")
    return p


async def _allocated_values(s, pool_id) -> set[str]:
    rows = (await s.execute(
        select(PoolAllocation.value).where(
            PoolAllocation.pool_id == pool_id, PoolAllocation.status == "ALLOCATED")
    )).scalars().all()
    return set(rows)


async def _allocated_count(s, pool_id) -> int:
    return (await s.execute(
        select(func.count()).select_from(PoolAllocation).where(
            PoolAllocation.pool_id == pool_id, PoolAllocation.status == "ALLOCATED")
    )).scalar_one()


def _candidates(pool: ResourcePool):
    """Lazy iterator of candidate values for auto-allocation, or None if the pool's spec doesn't
    support it (caller then requires an explicit value). ipv4/ipv6 ⇒ host addresses of the CIDR;
    any spec with from/to ⇒ the inclusive numeric range."""
    spec = pool.spec or {}
    try:
        if pool.kind in ("ipv4", "ipv6") and spec.get("cidr"):
            return (str(h) for h in ipaddress.ip_network(spec["cidr"], strict=False).hosts())
        frm, to = spec.get("from"), spec.get("to")
        if frm is not None and to is not None:
            return (str(i) for i in range(int(frm), int(to) + 1))
    except (ValueError, TypeError):
        raise HTTPException(422, "pool spec is malformed for auto-allocation")
    return None


async def _service_or_422(s, tenant_id, service_id):
    if service_id is None:
        return
    svc = (await s.execute(
        select(Service).where(Service.id == service_id, Service.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not svc:
        raise HTTPException(422, "service_id does not reference a known service")


# ==========================================================================================
# Pools
# ==========================================================================================

@router.get("/resource-pools")
async def list_pools(kind: str | None = None, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "resource_pool", "view"):
        _deny("resource_pool.view")
    paths = await _node_paths(s, user.tenant_id)
    q = select(ResourcePool).where(ResourcePool.tenant_id == user.tenant_id)
    if kind:
        q = q.where(ResourcePool.kind == kind)
    rows = (await s.execute(q.order_by(ResourcePool.name))).scalars().all()
    visible = [r for r in rows
               if can(grants, "resource_pool", "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)]
    return [_pool(p, await _allocated_count(s, p.id)) for p in visible]


@router.post("/resource-pools", status_code=201)
async def create_pool(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "resource_pool", "create", owner_path):
        _deny("resource_pool.create")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="resource_pool",
                         region_id=payload.get("region_id"), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    kind = payload.get("kind")
    if kind not in _KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(_KINDS)}")
    spec = payload.get("spec") or {}
    if not isinstance(spec, dict):
        raise HTTPException(422, "spec must be an object")

    pool = ResourcePool(tenant_id=user.tenant_id, owner_node_id=user.primary_node_id,
                        name=name, kind=kind, spec=spec)
    s.add(pool)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "resource_pool", pool.id, user.id, {"name": name, "kind": kind})
    await s.commit()
    await s.refresh(pool)
    return _pool(pool, 0)


@router.get("/resource-pools/{pool_id}")
async def get_pool(pool_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    pool = await _get_pool(s, user, pool_id)
    grants = await load_grants(s, user)
    if not can(grants, "resource_pool", "view", await _node_path(s, pool.owner_node_id)):
        _deny("resource_pool.view")
    return _pool(pool, await _allocated_count(s, pool.id))


@router.patch("/resource-pools/{pool_id}")
async def update_pool(pool_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit a pool's name and/or spec. `kind` is immutable (existing allocations assume it)."""
    pool = await _get_pool(s, user, pool_id)
    grants = await load_grants(s, user)
    if not can(grants, "resource_pool", "edit", await _node_path(s, pool.owner_node_id)):
        _deny("resource_pool.edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="resource_pool",
                         region_id=getattr(pool, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if "kind" in payload and payload["kind"] != pool.kind:
        raise HTTPException(409, "Changing a pool's kind is not allowed; create a new pool instead.")
    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        pool.name = v
    if "spec" in payload:
        if not isinstance(payload["spec"], dict):
            raise HTTPException(422, "spec must be an object")
        pool.spec = payload["spec"]
    await workflow.emit(s, user.tenant_id, "update", "resource_pool", pool.id, user.id, {"name": pool.name})
    await s.commit()
    await s.refresh(pool)
    return _pool(pool, await _allocated_count(s, pool.id))


@router.delete("/resource-pools/{pool_id}", status_code=204)
async def delete_pool(pool_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a pool only if it has no allocations at all (active or historical) — otherwise 409,
    so we never orphan allocation history."""
    pool = await _get_pool(s, user, pool_id)
    grants = await load_grants(s, user)
    if not can(grants, "resource_pool", "delete", await _node_path(s, pool.owner_node_id)):
        _deny("resource_pool.delete")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="delete", entity_key="resource_pool",
                         region_id=getattr(pool, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    any_alloc = (await s.execute(
        select(func.count()).select_from(PoolAllocation).where(PoolAllocation.pool_id == pool.id)
    )).scalar_one()
    if any_alloc:
        raise HTTPException(409, f"Cannot delete pool: it has {any_alloc} allocation(s). Release history is kept.")
    await workflow.emit(s, user.tenant_id, "delete", "resource_pool", pool.id, user.id, {"name": pool.name})
    await s.delete(pool)
    await s.commit()


# ==========================================================================================
# Allocations
# ==========================================================================================

@router.post("/resource-pools/{pool_id}/allocate", status_code=201)
async def allocate(pool_id: uuid.UUID, payload: dict | None = None, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Allocate a value. Pass `value` for an explicit identifier, or omit it to auto-pick the next
    free one (CIDR hosts / numeric range). 409 if the value is already allocated or the pool is
    exhausted; 422 if auto-allocation isn't supported for this pool's spec."""
    payload = payload or {}
    pool = await _get_pool(s, user, pool_id)
    grants = await load_grants(s, user)
    if not can(grants, "resource_pool", "edit", await _node_path(s, pool.owner_node_id)):
        _deny("resource_pool.edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="resource_pool",
                         region_id=getattr(pool, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    service_id = payload.get("service_id")
    await _service_or_422(s, user.tenant_id, service_id)
    allocated = await _allocated_values(s, pool.id)

    value = payload.get("value")
    if value is not None:
        value = str(value).strip()
        if not value:
            raise HTTPException(422, "value cannot be empty")
        if value in allocated:
            raise HTTPException(409, f"Value '{value}' is already allocated in this pool")
    else:
        cands = _candidates(pool)
        if cands is None:
            raise HTTPException(422, "auto-allocation is not supported for this pool; provide an explicit value")
        value = next((c for c in cands if c not in allocated), None)
        if value is None:
            raise HTTPException(409, "pool is exhausted; no free value available")

    alloc = PoolAllocation(tenant_id=user.tenant_id, pool_id=pool.id, value=value,
                           service_id=service_id, status="ALLOCATED", allocated_at=_now())
    s.add(alloc)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "allocate", "resource_pool", pool.id, user.id,
                        {"allocation_id": str(alloc.id), "value": value, "service_id": str(service_id) if service_id else None})
    await s.commit()
    await s.refresh(alloc)
    return _alloc(alloc)


async def _release(s, user: User, pool: ResourcePool, alloc: PoolAllocation) -> dict:
    if alloc.status != "RELEASED":
        alloc.status = "RELEASED"
        alloc.released_at = _now()
        await workflow.emit(s, user.tenant_id, "release", "resource_pool", pool.id, user.id,
                            {"allocation_id": str(alloc.id), "value": alloc.value})
        await s.commit()
        await s.refresh(alloc)
    return _alloc(alloc)


@router.post("/resource-pools/{pool_id}/release")
async def release_by_value(pool_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Release the currently-ALLOCATED value in this pool (frees it for re-allocation)."""
    pool = await _get_pool(s, user, pool_id)
    grants = await load_grants(s, user)
    if not can(grants, "resource_pool", "edit", await _node_path(s, pool.owner_node_id)):
        _deny("resource_pool.edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="resource_pool",
                         region_id=getattr(pool, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    value = (payload.get("value") or "").strip()
    if not value:
        raise HTTPException(422, "value is required")
    alloc = (await s.execute(
        select(PoolAllocation).where(
            PoolAllocation.pool_id == pool.id, PoolAllocation.value == value, PoolAllocation.status == "ALLOCATED")
    )).scalar_one_or_none()
    if not alloc:
        raise HTTPException(404, f"No active allocation of '{value}' in this pool")
    return await _release(s, user, pool, alloc)


@router.post("/resource-pools/{pool_id}/allocations/{alloc_id}/release")
async def release_by_id(pool_id: uuid.UUID, alloc_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Release a specific allocation by id (idempotent — already-released returns the row)."""
    pool = await _get_pool(s, user, pool_id)
    grants = await load_grants(s, user)
    if not can(grants, "resource_pool", "edit", await _node_path(s, pool.owner_node_id)):
        _deny("resource_pool.edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="resource_pool",
                         region_id=getattr(pool, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    alloc = (await s.execute(
        select(PoolAllocation).where(PoolAllocation.id == alloc_id, PoolAllocation.pool_id == pool.id)
    )).scalar_one_or_none()
    if not alloc:
        raise HTTPException(404, "Allocation not found")
    return await _release(s, user, pool, alloc)


@router.get("/resource-pools/{pool_id}/allocations")
async def list_allocations(pool_id: uuid.UUID, status: str | None = None, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The pool's allocation log (filter by `?status=ALLOCATED|RELEASED`), newest first."""
    pool = await _get_pool(s, user, pool_id)
    grants = await load_grants(s, user)
    if not can(grants, "resource_pool", "view", await _node_path(s, pool.owner_node_id)):
        _deny("resource_pool.view")
    q = select(PoolAllocation).where(PoolAllocation.pool_id == pool.id)
    if status:
        q = q.where(PoolAllocation.status == status)
    rows = (await s.execute(q.order_by(PoolAllocation.allocated_at.desc()))).scalars().all()
    return [_alloc(a) for a in rows]
