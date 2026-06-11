"""NOC Phase A — Installation Board API (Order pipeline stages 9-11).

Thin HTTP shell over ``services/install_board.py``. Auth mirrors the dunning/accounts pattern:
reads gated on ``order.view``; writes (allocate / bind / activate) admin-gated via
``config.manage`` (super_admin holds ``*``). Mounted under ``/api`` — note: list endpoints
are at fixed paths (``/api/install-board``, ``/api/splitters/{id}/strands``,
``/api/cpe-bindings``) so this router is registered BEFORE the generic ``records.router``.

Endpoints (all under ``/api``):

  * ``GET    /api/install-board?substage=&page=``
  * ``POST   /api/install-board/orders/{id}/allocate-resources``
  * ``POST   /api/install-board/orders/{id}/bind-cpe``  (body: mac_address, serial, vendor?, model?, firmware?)
  * ``POST   /api/install-board/orders/{id}/activate``
  * ``GET    /api/install-board/orders/{id}/install-summary``
  * ``GET    /api/splitters/{id}/strands``
  * ``GET    /api/cpe-bindings?service_id=&order_id=&page=``
  * ``GET    /api/cpe-bindings/{id}``
"""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import can, load_grants
from ..db import get_session
from ..models import User
from ..models.cpe_binding import CpeBinding
from ..models.order import Order
from ..models.splitter import SplitterStrandAllocation
from ..services import install_board as ib_service
from .auth import current_user
from ..utils.http_errors import deny as _deny  # BL-10


router = APIRouter(prefix="/api", tags=["install-board"])

_PAGE_SIZE = 100


# ==========================================================================================
# helpers
# ==========================================================================================



def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _norm_page(page: int) -> int:
    return page if page >= 1 else 1


async def _require_order_view(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "order", "view"):
        _deny("order.view")


async def _require_admin(s: AsyncSession, user: User) -> None:
    """Writes admin-gated: ``config.manage`` (super_admin via ``*``) OR purpose-built
    ``install_board.edit`` (not seeded yet — reserved for fine-grained NOC roles)."""
    grants = await load_grants(s, user)
    if can(grants, "install_board", "edit") or can(grants, "config", "manage"):
        return
    _deny("install_board.edit")


def _serialize_strand(strand: SplitterStrandAllocation) -> dict:
    return {
        "id": str(strand.id),
        "tenant_id": str(strand.tenant_id),
        "splitter_record_id": str(strand.splitter_record_id),
        "strand_no": strand.strand_no,
        "service_id": str(strand.service_id) if strand.service_id else None,
        "order_id": str(strand.order_id) if strand.order_id else None,
        "status": strand.status,
        "allocated_at": _iso(strand.allocated_at),
        "released_at": _iso(strand.released_at),
    }


def _serialize_cpe(cpe: CpeBinding) -> dict:
    return {
        "id": str(cpe.id),
        "tenant_id": str(cpe.tenant_id),
        "service_id": str(cpe.service_id) if cpe.service_id else None,
        "order_id": str(cpe.order_id) if cpe.order_id else None,
        "mac_address": cpe.mac_address,
        "serial": cpe.serial,
        "vendor": cpe.vendor,
        "model": cpe.model,
        "firmware": cpe.firmware,
        "status": cpe.status,
        "provisioned_at": _iso(cpe.provisioned_at),
        "last_payload_json": dict(cpe.last_payload_json or {}) if cpe.last_payload_json else None,
        "created_at": _iso(cpe.created_at),
    }


def _order_snapshot(o: Order) -> dict:
    return {
        "id": str(o.id),
        "number": o.number,
        "customer_id": str(o.customer_id) if o.customer_id else None,
        "status": o.status,
        "install_substage": o.install_substage,
        "install_substage_at": _iso(o.install_substage_at),
        "splitter_strand_allocation_id": str(o.splitter_strand_allocation_id)
            if o.splitter_strand_allocation_id else None,
        "vlan_assignment_id": str(o.vlan_assignment_id) if o.vlan_assignment_id else None,
        "cpe_binding_id": str(o.cpe_binding_id) if o.cpe_binding_id else None,
    }


async def _get_order(s: AsyncSession, user: User, order_id: uuid.UUID) -> Order:
    o = (await s.execute(
        select(Order).where(Order.id == order_id, Order.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if o is None:
        raise HTTPException(404, "Order not found")
    return o


# ==========================================================================================
# GET /api/install-board (list)
# ==========================================================================================

@router.get("/install-board")
async def list_install_board_endpoint(
    substage: str | None = None,
    page: int = 1,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """List orders currently in PROVISIONING. Optional ``substage`` filter — pass
    'RESOURCE_ALLOC' / 'CPE_BOUND' / 'ACTIVATED' or 'NONE' (orders that haven't started the
    sub-pipeline). Page size 100."""
    await _require_order_view(s, user)
    page = _norm_page(page)
    offset = (page - 1) * _PAGE_SIZE
    items = await ib_service.list_install_board(
        s,
        tenant_id=user.tenant_id,
        substage=substage,
        limit=_PAGE_SIZE,
        offset=offset,
    )
    # Total for the same filter (without pagination).
    total_q = select(func.count()).select_from(Order).where(
        Order.tenant_id == user.tenant_id,
        Order.status == "installation",
    )
    if substage:
        if substage.upper() == "NONE":
            total_q = total_q.where(Order.install_substage.is_(None))
        else:
            total_q = total_q.where(Order.install_substage == substage)
    total = (await s.execute(total_q)).scalar_one()
    return {
        "page": page,
        "page_size": _PAGE_SIZE,
        "total": int(total or 0),
        "items": items,
    }


# ==========================================================================================
# POST /api/install-board/orders/{id}/allocate-resources
# ==========================================================================================

@router.post("/install-board/orders/{order_id}/allocate-resources")
async def allocate_resources_endpoint(
    order_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    result = await ib_service.allocate_resources(
        s, order_id=order_id, tenant_id=user.tenant_id, actor_id=user.id,
    )
    await s.commit()
    order = await _get_order(s, user, order_id)
    return {"result": result, "order": _order_snapshot(order)}


# ==========================================================================================
# POST /api/install-board/orders/{id}/bind-cpe
# ==========================================================================================

@router.post("/install-board/orders/{order_id}/bind-cpe")
async def bind_cpe_endpoint(
    order_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    mac = payload.get("mac_address")
    serial = payload.get("serial")
    if not mac:
        raise HTTPException(400, "mac_address is required")
    if not serial:
        raise HTTPException(400, "serial is required")
    binding = await ib_service.bind_cpe(
        s,
        order_id=order_id,
        mac_address=mac,
        serial=serial,
        vendor=payload.get("vendor"),
        model=payload.get("model"),
        firmware=payload.get("firmware"),
        tenant_id=user.tenant_id,
        actor_id=user.id,
    )
    await s.commit()
    await s.refresh(binding)
    order = await _get_order(s, user, order_id)
    return {"cpe_binding": _serialize_cpe(binding), "order": _order_snapshot(order)}


# ==========================================================================================
# POST /api/install-board/orders/{id}/activate
# ==========================================================================================

@router.post("/install-board/orders/{order_id}/activate")
async def activate_endpoint(
    order_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    result = await ib_service.activate_service(
        s, order_id=order_id, tenant_id=user.tenant_id, actor_id=user.id,
    )
    await s.commit()
    order = await _get_order(s, user, order_id)
    return {"result": result, "order": _order_snapshot(order)}


# ==========================================================================================
# GET /api/install-board/orders/{id}/install-summary
# ==========================================================================================

@router.get("/install-board/orders/{order_id}/install-summary")
async def install_summary_endpoint(
    order_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_order_view(s, user)
    return await ib_service.install_summary(
        s, order_id=order_id, tenant_id=user.tenant_id,
    )


# ==========================================================================================
# GET /api/splitters/{id}/strands
# ==========================================================================================

@router.get("/splitters/{splitter_id}/strands")
async def list_splitter_strands(
    splitter_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """List every strand on a splitter (Record). Returns the strand rows + a per-status count.
    Reads gated on ``order.view`` (the install board is what cares about strand state — the
    splitter Record itself sits behind the generic record-view perms)."""
    await _require_order_view(s, user)
    rows = (await s.execute(
        select(SplitterStrandAllocation)
        .where(
            SplitterStrandAllocation.tenant_id == user.tenant_id,
            SplitterStrandAllocation.splitter_record_id == splitter_id,
        )
        .order_by(SplitterStrandAllocation.strand_no)
    )).scalars().all()
    counts: dict[str, int] = {}
    for r in rows:
        counts[r.status] = counts.get(r.status, 0) + 1
    return {
        "splitter_id": str(splitter_id),
        "total": len(rows),
        "counts": counts,
        "strands": [_serialize_strand(r) for r in rows],
    }


# ==========================================================================================
# GET /api/cpe-bindings
# ==========================================================================================

@router.get("/cpe-bindings")
async def list_cpe_bindings(
    service_id: uuid.UUID | None = None,
    order_id: uuid.UUID | None = None,
    page: int = 1,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_order_view(s, user)
    page = _norm_page(page)
    q = select(CpeBinding).where(CpeBinding.tenant_id == user.tenant_id)
    if service_id:
        q = q.where(CpeBinding.service_id == service_id)
    if order_id:
        q = q.where(CpeBinding.order_id == order_id)
    q = q.order_by(CpeBinding.created_at.desc())
    # DF-3 — count + page via canonical helpers.
    from ..pagination import count_select, Page  # noqa: PLC0415 — co-located with use
    total = (await s.execute(count_select(q))).scalar_one()
    rows = (await s.execute(Page(_PAGE_SIZE, (page - 1) * _PAGE_SIZE).apply(q))).scalars().all()
    return {
        "page": page,
        "page_size": _PAGE_SIZE,
        "total": int(total or 0),
        "items": [_serialize_cpe(r) for r in rows],
    }


@router.get("/cpe-bindings/{cpe_id}")
async def get_cpe_binding(
    cpe_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_order_view(s, user)
    cpe = (await s.execute(
        select(CpeBinding).where(
            CpeBinding.id == cpe_id,
            CpeBinding.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if cpe is None:
        raise HTTPException(404, "CPE binding not found")
    return _serialize_cpe(cpe)
