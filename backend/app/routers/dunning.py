"""Phase B.2 — Dunning API: policies + cases + run-sweep.

Thin HTTP shell over ``services/dunning.py``. The router enforces auth/tenant scope and
admin-gated writes; the service module owns the lifecycle math (open / advance / cure /
sweep). Mirrors the auth pattern of ``routers/accounts.py`` and ``routers/tariff_plans.py``.

Endpoints (all under ``/api`` prefix):

  * ``GET    /api/dunning/policies``       — paginated list (``?active=true&page=N``)
  * ``POST   /api/dunning/policies``       — create (admin: ``config.manage``)
  * ``GET    /api/dunning/policies/{id}``
  * ``PATCH  /api/dunning/policies/{id}``  — admin; steps_json / active / is_default updates.
                                              ``is_default=True`` flips the prior default off
                                              (single-default invariant per tenant).
  * ``DELETE /api/dunning/policies/{id}``  — soft-delete (admin); 409 if active cases reference it.
  * ``GET    /api/dunning/cases``          — paginated list (filters: status, account_id)
  * ``GET    /api/dunning/cases/{id}``
  * ``POST   /api/dunning/cases/{id}/advance``  — admin; calls services.advance_case
  * ``POST   /api/dunning/cases/{id}/close``    — admin; body ``{closed_reason}``
  * ``POST   /api/dunning/run``            — admin; tenant-wide sweep via JobRun idempotency
  * ``GET    /api/services/{id}/action-log`` — list ServiceActionLog rows for a service
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.dunning import DunningPolicy, DunningCase, ServiceActionLog
from ..models.service import Service
from ..models.job import JobRun
from ..access import load_grants, can
from ..services import dunning as dunning_service
from .auth import current_user

router = APIRouter(prefix="/api", tags=["dunning"])


# ---- helpers --------------------------------------------------------------------------

def _deny(perm: str) -> None:
    raise HTTPException(403, f"Not allowed: {perm}")


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _require_admin(s: AsyncSession, user: User) -> None:
    """Admin-gate writes on ``config.manage`` (held by super_admin via ``*``)."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")


async def _get_policy(s: AsyncSession, user: User, policy_id: uuid.UUID) -> DunningPolicy:
    p = (await s.execute(
        select(DunningPolicy).where(
            DunningPolicy.id == policy_id, DunningPolicy.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "Dunning policy not found")
    return p


async def _get_case(s: AsyncSession, user: User, case_id: uuid.UUID) -> DunningCase:
    c = (await s.execute(
        select(DunningCase).where(
            DunningCase.id == case_id, DunningCase.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, "Dunning case not found")
    return c


# ---- serializers ----------------------------------------------------------------------

def _policy(p: DunningPolicy) -> dict:
    return {
        "id": str(p.id),
        "tenant_id": str(p.tenant_id),
        "name": p.name,
        "description": p.description,
        "is_default": bool(p.is_default),
        "active": bool(p.active),
        "steps_json": list(p.steps_json or []),
        "applies_to_tariff_plan_ids": list(p.applies_to_tariff_plan_ids or [])
            if p.applies_to_tariff_plan_ids is not None else None,
        "created_at": _iso(p.created_at),
        "updated_at": _iso(p.updated_at),
    }


def _case(c: DunningCase) -> dict:
    return {
        "id": str(c.id),
        "tenant_id": str(c.tenant_id),
        "account_id": str(c.account_id),
        "triggering_invoice_id": str(c.triggering_invoice_id),
        "policy_id": str(c.policy_id),
        "current_step_index": int(c.current_step_index),
        "step_entered_at": _iso(c.step_entered_at),
        "next_action_at": _iso(c.next_action_at),
        "status": c.status,
        "opened_at": _iso(c.opened_at),
        "cured_at": _iso(c.cured_at),
        "closed_at": _iso(c.closed_at),
        "closed_reason": c.closed_reason,
    }


def _action_log(row: ServiceActionLog) -> dict:
    return {
        "id": str(row.id),
        "tenant_id": str(row.tenant_id),
        "service_id": str(row.service_id) if row.service_id else None,
        "dunning_case_id": str(row.dunning_case_id) if row.dunning_case_id else None,
        "action": row.action,
        "adapter": row.adapter,
        "request_payload": dict(row.request_payload or {}),
        "response_payload": dict(row.response_payload or {}),
        "status": row.status,
        "requested_at": _iso(row.requested_at),
        "completed_at": _iso(row.completed_at),
        "error_message": row.error_message,
    }


# ==========================================================================================
# Policies
# ==========================================================================================

_PAGE_SIZE = 100


def _norm_page(page: int) -> int:
    return page if page >= 1 else 1


@router.get("/dunning/policies")
async def list_dunning_policies(
    active: bool | None = None,
    page: int = 1,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Paginated list of dunning policies for the caller's tenant. ``active`` filters by the
    soft-delete flag. Reads are open to any authenticated tenant user."""
    page = _norm_page(page)
    q = select(DunningPolicy).where(DunningPolicy.tenant_id == user.tenant_id)
    if active is not None:
        q = q.where(DunningPolicy.active.is_(active))
    q = q.order_by(DunningPolicy.created_at)

    total = (await s.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()
    q = q.offset((page - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return {
        "page": page,
        "page_size": _PAGE_SIZE,
        "total": int(total or 0),
        "items": [_policy(p) for p in rows],
    }


@router.post("/dunning/policies", status_code=201)
async def create_dunning_policy(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Create a new dunning policy. Admin-gated (``config.manage``).

    Validates ``steps_json`` via :func:`services.dunning.validate_steps_json` — bad shape
    surfaces as 422. ``is_default=True`` flips any pre-existing default off.
    """
    await _require_admin(s, user)

    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")

    raw_steps = payload.get("steps_json")
    if raw_steps is None:
        raise HTTPException(422, "steps_json is required")
    try:
        steps = dunning_service.validate_steps_json(raw_steps)
    except ValueError as e:
        raise HTTPException(422, str(e))

    # Reject name clash within the tenant.
    clash = (await s.execute(
        select(DunningPolicy).where(
            DunningPolicy.tenant_id == user.tenant_id,
            DunningPolicy.name == name,
        )
    )).scalar_one_or_none()
    if clash is not None:
        raise HTTPException(409, f"A dunning policy named '{name}' already exists")

    is_default = bool(payload.get("is_default", False))
    if is_default:
        # Flip the prior default off in the same transaction.
        prior = (await s.execute(
            select(DunningPolicy).where(
                DunningPolicy.tenant_id == user.tenant_id,
                DunningPolicy.is_default.is_(True),
            )
        )).scalars().all()
        for row in prior:
            row.is_default = False

    policy = DunningPolicy(
        tenant_id=user.tenant_id,
        name=name,
        description=payload.get("description"),
        is_default=is_default,
        active=bool(payload.get("active", True)),
        steps_json=steps,
        applies_to_tariff_plan_ids=payload.get("applies_to_tariff_plan_ids"),
    )
    s.add(policy)
    await s.commit()
    await s.refresh(policy)
    return _policy(policy)


@router.get("/dunning/policies/{policy_id}")
async def get_dunning_policy(
    policy_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    policy = await _get_policy(s, user, policy_id)
    return _policy(policy)


@router.patch("/dunning/policies/{policy_id}")
async def update_dunning_policy(
    policy_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Update mutable fields: ``name``, ``description``, ``steps_json``, ``active``,
    ``is_default``, ``applies_to_tariff_plan_ids``.

    Setting ``is_default=True`` flips the prior default off (single-default per tenant).
    """
    await _require_admin(s, user)
    policy = await _get_policy(s, user, policy_id)

    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        policy.name = v
    if "description" in payload:
        policy.description = payload["description"]
    if "steps_json" in payload:
        try:
            policy.steps_json = dunning_service.validate_steps_json(payload["steps_json"])
        except ValueError as e:
            raise HTTPException(422, str(e))
    if "active" in payload:
        policy.active = bool(payload["active"])
    if "applies_to_tariff_plan_ids" in payload:
        policy.applies_to_tariff_plan_ids = payload["applies_to_tariff_plan_ids"]
    if "is_default" in payload:
        new_default = bool(payload["is_default"])
        if new_default and not policy.is_default:
            # Flip ALL other policies' defaults off for this tenant.
            prior = (await s.execute(
                select(DunningPolicy).where(
                    DunningPolicy.tenant_id == user.tenant_id,
                    DunningPolicy.is_default.is_(True),
                    DunningPolicy.id != policy.id,
                )
            )).scalars().all()
            for row in prior:
                row.is_default = False
        policy.is_default = new_default

    await s.commit()
    await s.refresh(policy)
    return _policy(policy)


@router.delete("/dunning/policies/{policy_id}", status_code=200)
async def delete_dunning_policy(
    policy_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Soft-delete: flip ``active`` to False. 409 if any active cases still reference it."""
    await _require_admin(s, user)
    policy = await _get_policy(s, user, policy_id)

    referenced = (await s.execute(
        select(func.count()).select_from(DunningCase).where(
            DunningCase.policy_id == policy.id,
            DunningCase.status == "active",
        )
    )).scalar_one()
    if int(referenced or 0) > 0:
        raise HTTPException(409, f"Policy has {int(referenced)} active case(s); cannot retire")

    policy.active = False
    await s.commit()
    await s.refresh(policy)
    return _policy(policy)


# ==========================================================================================
# Cases
# ==========================================================================================

@router.get("/dunning/cases")
async def list_dunning_cases(
    status: str | None = None,
    account_id: uuid.UUID | None = None,
    page: int = 1,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Paginated case list. Filters: ``status``, ``account_id``."""
    page = _norm_page(page)
    q = select(DunningCase).where(DunningCase.tenant_id == user.tenant_id)
    if status:
        q = q.where(DunningCase.status == status)
    if account_id:
        q = q.where(DunningCase.account_id == account_id)
    q = q.order_by(DunningCase.opened_at.desc())

    total = (await s.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()
    q = q.offset((page - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return {
        "page": page,
        "page_size": _PAGE_SIZE,
        "total": int(total or 0),
        "items": [_case(c) for c in rows],
    }


@router.get("/dunning/cases/{case_id}")
async def get_dunning_case(
    case_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    case = await _get_case(s, user, case_id)
    return _case(case)


@router.post("/dunning/cases/{case_id}/advance")
async def advance_dunning_case(
    case_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Advance the case to its next step. Admin-gated."""
    await _require_admin(s, user)
    case = await _get_case(s, user, case_id)
    await dunning_service.advance_case(s, case)
    await s.commit()
    await s.refresh(case)
    return _case(case)


@router.post("/dunning/cases/{case_id}/close")
async def close_dunning_case(
    case_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Manually close a case. Admin-gated. Body: ``{"closed_reason": str}``."""
    await _require_admin(s, user)
    case = await _get_case(s, user, case_id)
    reason = ""
    if payload is not None:
        reason = str(payload.get("closed_reason") or "").strip()[:80]
    case.status = "closed"
    case.closed_at = _now()
    case.next_action_at = None
    case.closed_reason = reason or "manual_close"
    await s.commit()
    await s.refresh(case)
    return _case(case)


# ==========================================================================================
# Sweep
# ==========================================================================================

@router.post("/dunning/run")
async def run_dunning_sweep_endpoint(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Run the tenant-wide dunning sweep. Admin-gated; logs a JobRun row.

    Idempotency mirrors ``routers/billing.py::run_dunning``: a JobRun row is appended per call
    with the summary the sweep returned. The sweep itself is idempotent — advanced cases have
    ``next_action_at`` moved forward, so a second call moments later is a no-op.
    """
    await _require_admin(s, user)

    started = _now()
    try:
        summary = await dunning_service.run_dunning_sweep(s, tenant_id=user.tenant_id)
        s.add(JobRun(
            tenant_id=user.tenant_id,
            owner_node_id=None,
            job_key="billing.run_dunning_sweep",
            status="SUCCESS",
            summary=dict(summary),
            actor_user_id=user.id,
            started_at=started,
            finished_at=_now(),
        ))
        await s.commit()
    except Exception as e:
        await s.rollback()
        s.add(JobRun(
            tenant_id=user.tenant_id,
            owner_node_id=None,
            job_key="billing.run_dunning_sweep",
            status="ERROR",
            summary={"message": str(e)},
            actor_user_id=user.id,
            started_at=started,
            finished_at=_now(),
        ))
        await s.commit()
        raise
    return summary


# ==========================================================================================
# ServiceActionLog read
# ==========================================================================================

@router.get("/services/{service_id}/action-log")
async def list_service_action_log(
    service_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> list[dict]:
    """List every ``ServiceActionLog`` row for one service (chronological).

    Auth mirrors ``service.view`` — same gate the dedicated services router uses for reads.
    """
    grants = await load_grants(s, user)
    if not can(grants, "service", "view"):
        _deny("service.view")

    # Tenant-scoped sanity check on the service id (404 if absent).
    svc = (await s.execute(
        select(Service).where(Service.id == service_id, Service.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if svc is None:
        raise HTTPException(404, "Service not found")

    rows = (await s.execute(
        select(ServiceActionLog)
        .where(
            ServiceActionLog.tenant_id == user.tenant_id,
            ServiceActionLog.service_id == service_id,
        )
        .order_by(ServiceActionLog.requested_at)
    )).scalars().all()
    return [_action_log(r) for r in rows]
