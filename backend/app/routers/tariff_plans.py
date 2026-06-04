"""Phase A.1 — TariffPlan CRUD API.

Reads (``list`` / ``get``) are open to any authenticated tenant user — the catalog isn't
sensitive and agents need to see plans to quote them. Writes (``create`` / ``patch`` / ``delete``)
require ``config.manage`` (admin tier; agent role lacks it).

Soft-delete: ``DELETE /api/tariff-plans/{id}`` flips ``active`` to False; the row stays in the
table. This matches the BSS convention used by ``products`` and preserves historical references
from subscriptions / invoices.

Money: rate-card values are Decimal (the model uses Numeric(12,2/4)). The router accepts JSON
numbers or numeric strings and parses through ``Decimal(str(value))`` to avoid the float
round-trip — see ``_to_decimal``.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import can, load_grants
from ..db import get_session
from ..models import User
from ..models.tariff import TariffPlan
from .auth import current_user
from .records import _paginate
from ..utils.http_errors import deny as _deny  # BL-10


router = APIRouter(prefix="/api", tags=["tariff_plans"])


_CYCLES = {"monthly", "quarterly", "yearly"}




def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _to_decimal(value: Any, field: str) -> Decimal:
    """Parse a JSON number / string into Decimal. Raises 422 on garbage."""
    if value is None:
        raise HTTPException(422, f"'{field}' is required")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise HTTPException(422, f"'{field}' must be a decimal number")


def _to_decimal_opt(value: Any, field: str) -> Decimal | None:
    """Optional Decimal — None passes through."""
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise HTTPException(422, f"'{field}' must be a decimal number")


def _serialize(t: TariffPlan) -> dict:
    return {
        "id": str(t.id),
        "key": t.key,
        "name": t.name,
        "description": t.description,
        "base_recurring_price": str(t.base_recurring_price) if t.base_recurring_price is not None else None,
        "included_units": t.included_units,
        "overage_rate": str(t.overage_rate) if t.overage_rate is not None else None,
        "tiers_json": list(t.tiers_json or []),
        "cycle": t.cycle,
        "active": bool(t.active),
        "created_at": _iso(t.created_at),
    }


async def _get_or_404(s: AsyncSession, user: User, plan_id: uuid.UUID) -> TariffPlan:
    plan = (await s.execute(
        select(TariffPlan).where(TariffPlan.id == plan_id, TariffPlan.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if plan is None:
        raise HTTPException(404, "Tariff plan not found")
    return plan


async def _require_admin_write(s: AsyncSession, user: User) -> None:
    """Gate writes on ``config.manage`` (admin tier). Agents (no `*` perm) are denied."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")


@router.get("/tariff-plans")
async def list_tariff_plans(
    active: bool | None = None,
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> list[dict]:
    """List tariff plans visible to the caller's tenant. ``active`` filters by the soft-delete flag."""
    q = select(TariffPlan).where(TariffPlan.tenant_id == user.tenant_id)
    if active is not None:
        q = q.where(TariffPlan.active.is_(active))
    rows = (await s.execute(q.order_by(TariffPlan.name))).scalars().all()
    return [_serialize(r) for r in _paginate(rows, limit, offset)]


@router.post("/tariff-plans", status_code=201)
async def create_tariff_plan(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Create a new tariff plan. Requires ``config.manage``."""
    await _require_admin_write(s, user)

    key = (payload.get("key") or "").strip()
    name = (payload.get("name") or "").strip()
    if not key or not name:
        raise HTTPException(422, "key and name are required")

    cycle = payload.get("cycle", "monthly")
    if cycle not in _CYCLES:
        raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")

    clash = (await s.execute(
        select(TariffPlan).where(
            TariffPlan.tenant_id == user.tenant_id,
            TariffPlan.key == key,
        )
    )).scalar_one_or_none()
    if clash is not None:
        raise HTTPException(409, f"A tariff plan with key '{key}' already exists")

    plan = TariffPlan(
        tenant_id=user.tenant_id,
        key=key,
        name=name,
        description=payload.get("description"),
        base_recurring_price=_to_decimal(payload.get("base_recurring_price"), "base_recurring_price"),
        included_units=payload.get("included_units"),
        overage_rate=_to_decimal_opt(payload.get("overage_rate"), "overage_rate"),
        tiers_json=list(payload.get("tiers_json") or []),
        cycle=cycle,
        active=bool(payload.get("active", True)),
    )
    s.add(plan)
    await s.commit()
    await s.refresh(plan)
    return _serialize(plan)


@router.get("/tariff-plans/{plan_id}")
async def get_tariff_plan(
    plan_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    plan = await _get_or_404(s, user, plan_id)
    return _serialize(plan)


@router.patch("/tariff-plans/{plan_id}")
async def update_tariff_plan(
    plan_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Patch mutable fields. ``key`` is immutable once set."""
    await _require_admin_write(s, user)
    plan = await _get_or_404(s, user, plan_id)

    if "key" in payload and payload["key"] != plan.key:
        raise HTTPException(422, "key is immutable")

    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        plan.name = v
    if "description" in payload:
        plan.description = payload["description"]
    if "base_recurring_price" in payload:
        plan.base_recurring_price = _to_decimal(payload["base_recurring_price"], "base_recurring_price")
    if "included_units" in payload:
        plan.included_units = payload["included_units"]
    if "overage_rate" in payload:
        plan.overage_rate = _to_decimal_opt(payload["overage_rate"], "overage_rate")
    if "tiers_json" in payload:
        plan.tiers_json = list(payload["tiers_json"] or [])
    if "cycle" in payload:
        if payload["cycle"] not in _CYCLES:
            raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")
        plan.cycle = payload["cycle"]
    if "active" in payload:
        plan.active = bool(payload["active"])

    await s.commit()
    await s.refresh(plan)
    return _serialize(plan)


@router.delete("/tariff-plans/{plan_id}", status_code=200)
async def delete_tariff_plan(
    plan_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Soft-delete: flip ``active`` to False; the row stays for historical references."""
    await _require_admin_write(s, user)
    plan = await _get_or_404(s, user, plan_id)
    plan.active = False
    await s.commit()
    await s.refresh(plan)
    return _serialize(plan)
