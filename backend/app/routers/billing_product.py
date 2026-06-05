"""Billing — Product / Plan catalog + Product Versioning (split from ``routers/billing.py``).

Reads (list/get) are open to any authenticated tenant user — the catalog isn't sensitive and
agents need it to pick a plan. Writes (create/update/retire) require ``config.manage``.

Phase A.1 — Product versioning. Mint a new version when pricing/spec changes; list history.
Reads open to any tenant user; writes require ``config.manage`` (admin).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.product import Product
from ..models.product_version import ProductVersion
from ..access import load_grants, can
from .. import workflow
from ..kernel import (
    assert_can, AccessDenied,
)
from ..services.product_versions import mint_new_version
from .auth import current_user
from .records import _paginate
from ._billing_shared import (
    _CYCLES, _PRORATION_MODES,
    _deny, _owner_gate, _money,
    _parse_decimal_opt,
    _product, _serialize_version,
    _get_product,
)

router = APIRouter(prefix="/api", tags=["billing"])


# ==========================================================================================
# Product / Plan catalog
#   Reads (list/get) are open to any authenticated tenant user — the catalog isn't sensitive and
#   agents need it to pick a plan. Writes (create/update/retire) require config.manage.
# ==========================================================================================


@router.get("/products")
async def list_products(active: bool | None = None, limit: int = 200, offset: int = 0,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    q = select(Product).where(Product.tenant_id == user.tenant_id)
    if active is not None:
        q = q.where(Product.active.is_(active))
    rows = (await s.execute(q.order_by(Product.name))).scalars().all()
    return [_product(p) for p in _paginate(rows, limit, offset)]


@router.post("/products", status_code=201)
async def create_product(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    # SPEC §0.1 single-owner (first-class) — only Product Catalog may write product.
    await _owner_gate(s, table_name="product", writer_module="Product Catalog")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation (catalog/config).
    try:
        await assert_can(s, user, action="manage", entity_key="product",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    key = (payload.get("key") or "").strip()
    name = (payload.get("name") or "").strip()
    if not key or not name:
        raise HTTPException(422, "key and name are required")
    cycle = payload.get("cycle", "monthly")
    if cycle not in _CYCLES:
        raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")
    clash = (await s.execute(
        select(Product).where(Product.tenant_id == user.tenant_id, Product.key == key)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"A product with key '{key}' already exists")

    # Phase A.1 — optional Decimal pricing + proration mode. Parsed defensively (None passes through).
    rp = _parse_decimal_opt(payload.get("recurring_price"), "recurring_price")
    ot = _parse_decimal_opt(payload.get("one_time_price"), "one_time_price")
    pm = payload.get("proration_mode", "daily")
    if pm not in _PRORATION_MODES:
        raise HTTPException(422, f"proration_mode must be one of {sorted(_PRORATION_MODES)}")

    prod = Product(
        tenant_id=user.tenant_id, key=key, name=name, description=payload.get("description"),
        default_amount=_money(payload.get("default_amount", 0), "default_amount"), cycle=cycle,
        recurring_price=rp, one_time_price=ot, proration_mode=pm,
        active=bool(payload.get("active", True)),
    )
    s.add(prod)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "CREATE", "product", prod.id, user.id, {"key": key, "name": name})
    await s.commit()
    await s.refresh(prod)
    return _product(prod)


@router.patch("/products/{product_id}")
async def update_product(product_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    # SPEC §0.1 single-owner (first-class) — only Product Catalog may write product.
    await _owner_gate(s, table_name="product", writer_module="Product Catalog")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="manage", entity_key="product",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    prod = await _get_product(s, user, product_id)

    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        prod.name = v
    if "description" in payload:
        prod.description = payload["description"]
    if "default_amount" in payload:
        prod.default_amount = _money(payload["default_amount"], "default_amount")
    if "cycle" in payload:
        if payload["cycle"] not in _CYCLES:
            raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")
        prod.cycle = payload["cycle"]
    # Phase A.1 — Decimal pricing + proration mode are PATCH-mutable.
    if "recurring_price" in payload:
        prod.recurring_price = _parse_decimal_opt(payload["recurring_price"], "recurring_price")
    if "one_time_price" in payload:
        prod.one_time_price = _parse_decimal_opt(payload["one_time_price"], "one_time_price")
    if "proration_mode" in payload:
        if payload["proration_mode"] not in _PRORATION_MODES:
            raise HTTPException(422, f"proration_mode must be one of {sorted(_PRORATION_MODES)}")
        prod.proration_mode = payload["proration_mode"]
    if "active" in payload:
        prod.active = bool(payload["active"])

    await workflow.emit(s, user.tenant_id, "UPDATE", "product", prod.id, user.id, {"key": prod.key})
    await s.commit()
    await s.refresh(prod)
    return _product(prod)


@router.post("/products/{product_id}/retire")
async def retire_product(product_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Soft-retire a product (active=False). Existing subscriptions referencing it are untouched."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    # SPEC §0.1 single-owner (first-class) — only Product Catalog may write product.
    await _owner_gate(s, table_name="product", writer_module="Product Catalog")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="manage", entity_key="product",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    prod = await _get_product(s, user, product_id)
    prod.active = False
    await workflow.emit(s, user.tenant_id, "TRANSITION", "product", prod.id, user.id,
                        {"to": "retired", "active": False})
    await s.commit()
    await s.refresh(prod)
    return _product(prod)


# ==========================================================================================
# Phase A.1 — Product versioning. Mint a new version when pricing/spec changes; list history.
# Reads open to any tenant user; writes require `config.manage` (admin).
# ==========================================================================================


@router.get("/products/{product_id}/versions")
async def list_product_versions(
    product_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List every minted version of a product, ordered by ``version_no`` ascending."""
    await _get_product(s, user, product_id)  # 404 + tenant check
    rows = (await s.execute(
        select(ProductVersion)  # noqa: tenant-filter — `_get_product` above 404s on cross-tenant product_id; RLS-bound `s` additionally enforces ProductVersion.tenant_id.
        .where(ProductVersion.product_id == product_id)
        .order_by(ProductVersion.version_no)
    )).scalars().all()
    return [_serialize_version(v) for v in rows]


@router.post("/products/{product_id}/versions", status_code=201)
async def create_product_version(
    product_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Mint a new ProductVersion. Closes the prior open version's ``effective_to`` and chains it."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    prod = await _get_product(s, user, product_id)

    attrs: dict = {
        # If caller didn't supply, snapshot the product's CURRENT values — that's the typical
        # "mint a version after editing the product" flow.
        "recurring_price": payload.get("recurring_price", prod.recurring_price),
        "one_time_price": payload.get("one_time_price", prod.one_time_price),
        "cycle": payload.get("cycle", prod.cycle),
        "spec_json": payload.get("spec_json") or {
            "key": prod.key,
            "name": prod.name,
            "description": prod.description,
            "default_amount": prod.default_amount,
            "cycle": prod.cycle,
            "recurring_price": str(prod.recurring_price) if prod.recurring_price is not None else None,
            "one_time_price": str(prod.one_time_price) if prod.one_time_price is not None else None,
            "proration_mode": prod.proration_mode,
            "active": bool(prod.active),
        },
    }
    v = await mint_new_version(s, product_id, attrs, actor=user.id)
    await s.commit()
    await s.refresh(v)
    return _serialize_version(v)
