"""Service & resource inventory API (doc 19, thin).

Tenant + org scoped like the other modules (`service.*` permission gate), every mutation emits an
audit Event via `workflow.emit`. Lifecycle: PENDING → ACTIVE ↔ SUSPENDED → TERMINATED, with legal
guards (illegal → 409). Resources are freeform inventory (allocate / release-but-keep-for-history).
This is the tail of the chain order → subscription → service.

NOTE on namespacing: fixed paths under /api ("/api/services") → register BEFORE records.router.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..models.service import Service, ServiceResource
from ..models.billing import Subscription
from ..access import load_grants, can
from .. import workflow
from ..kernel import (
    assert_can, AccessDenied,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, find_approved_approval, mark_approval_executed,
)
from .auth import current_user
from .records import _node_path, _node_paths     # reuse the exact records scope primitives

router = APIRouter(prefix="/api", tags=["services"])

_STATUSES = {"PENDING", "ACTIVE", "SUSPENDED", "TERMINATED"}
_RESOURCE_KINDS = {"ip", "mac", "port", "device", "circuit", "other"}


def _deny(perm: str):
    raise HTTPException(403, f"Not allowed: {perm}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat() if dt else None


# ---- serializers ----

def _resource(r: ServiceResource) -> dict:
    return {"id": str(r.id), "service_id": str(r.service_id), "kind": r.kind, "value": r.value,
            "label": r.label, "status": r.status, "created_at": _iso(r.created_at)}


def _service(svc: Service, resources: list[ServiceResource] | None = None) -> dict:
    out = {
        "id": str(svc.id),
        "customer_id": str(svc.customer_id) if svc.customer_id else None,
        "subscription_id": str(svc.subscription_id) if svc.subscription_id else None,
        "owner_node_id": str(svc.owner_node_id) if svc.owner_node_id else None,
        "type": svc.type,
        "name": svc.name,
        "status": svc.status,
        "activated_at": _iso(svc.activated_at),
        "created_at": _iso(svc.created_at),
    }
    if resources is not None:
        out["resources"] = [_resource(r) for r in resources]
    return out


# ---- loaders / shared ----

async def _get_service(s, user: User, service_id) -> Service:
    svc = (await s.execute(
        select(Service).where(Service.id == service_id, Service.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not svc:
        raise HTTPException(404, "Service not found")
    return svc


async def _resources(s, service_id) -> list[ServiceResource]:
    return list((await s.execute(
        select(ServiceResource).where(ServiceResource.service_id == service_id).order_by(ServiceResource.created_at)
    )).scalars().all())


async def _customer_or_422(s, tenant_id, customer_id):
    if customer_id is None:
        return
    rec = (await s.execute(
        select(Record).where(Record.id == customer_id, Record.tenant_id == tenant_id, Record.entity_key == "customer")
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(422, "customer_id does not reference a known customer")


async def _subscription_or_422(s, tenant_id, subscription_id):
    if subscription_id is None:
        return
    sub = (await s.execute(
        select(Subscription).where(Subscription.id == subscription_id, Subscription.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(422, "subscription_id does not reference a known subscription")


# ---- reusable provisioning helper (for the order→service hook; see report) ----

async def provision_service_for_subscription(s, *, tenant_id, subscription: Subscription,
                                             owner_node_id, customer_id, actor_user_id,
                                             status: str = "PENDING") -> Service:
    """Create a Service that fulfills a freshly-provisioned Subscription. Called from the order
    COMPLETE path (orders.py) so the chain is order → subscription → service. Emits an audit Event.
    Defaults to PENDING (provisioning still to be done); pass status="ACTIVE" to go live immediately."""
    svc = Service(
        tenant_id=tenant_id, owner_node_id=owner_node_id, customer_id=customer_id,
        subscription_id=subscription.id, type="service", name=subscription.plan_name,
        status=status, activated_at=_now() if status == "ACTIVE" else None,
    )
    s.add(svc)
    await s.flush()
    await workflow.emit(s, tenant_id, "create", "service", svc.id, actor_user_id,
                        {"name": svc.name, "from_subscription": str(subscription.id)})
    return svc


# ==========================================================================================
# Services CRUD
# ==========================================================================================

@router.get("/services")
async def list_services(customer: uuid.UUID | None = None, status: str | None = None, type: str | None = None,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "service", "view"):
        _deny("service.view")
    paths = await _node_paths(s, user.tenant_id)
    q = select(Service).where(Service.tenant_id == user.tenant_id)
    if customer:
        q = q.where(Service.customer_id == customer)
    if status:
        q = q.where(Service.status == status)
    if type:
        q = q.where(Service.type == type)
    rows = (await s.execute(q.order_by(Service.created_at))).scalars().all()
    visible = [r for r in rows
               if can(grants, "service", "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)]
    return [_service(r) for r in visible]


@router.post("/services", status_code=201)
async def create_service(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "service", "create", owner_path):
        _deny("service.create")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="service",
                         region_id=payload.get("region_id"), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    customer_id = payload.get("customer_id")
    subscription_id = payload.get("subscription_id")
    await _customer_or_422(s, user.tenant_id, customer_id)
    await _subscription_or_422(s, user.tenant_id, subscription_id)
    status = payload.get("status", "PENDING")
    if status not in _STATUSES:
        raise HTTPException(422, f"status must be one of {sorted(_STATUSES)}")

    svc = Service(
        tenant_id=user.tenant_id, owner_node_id=user.primary_node_id, customer_id=customer_id,
        subscription_id=subscription_id, type=(payload.get("type") or "service"), name=name,
        status=status, activated_at=_now() if status == "ACTIVE" else None,
    )
    s.add(svc)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "service", svc.id, user.id, {"name": name, "type": svc.type})
    await s.commit()
    await s.refresh(svc)
    return _service(svc, await _resources(s, svc.id))


@router.get("/services/{service_id}")
async def get_service(service_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    svc = await _get_service(s, user, service_id)
    grants = await load_grants(s, user)
    if not can(grants, "service", "view", await _node_path(s, svc.owner_node_id)):
        _deny("service.view")
    return _service(svc, await _resources(s, svc.id))


@router.patch("/services/{service_id}")
async def update_service(service_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit a service's presentation: name and type. Status changes go through the lifecycle endpoints."""
    svc = await _get_service(s, user, service_id)
    grants = await load_grants(s, user)
    if not can(grants, "service", "edit", await _node_path(s, svc.owner_node_id)):
        _deny("service.edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="service",
                         region_id=getattr(svc, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        svc.name = v
    if "type" in payload:
        svc.type = (payload["type"] or "service")
    await workflow.emit(s, user.tenant_id, "update", "service", svc.id, user.id, {"name": svc.name, "type": svc.type})
    await s.commit()
    await s.refresh(svc)
    return _service(svc, await _resources(s, svc.id))


# ---- lifecycle ----

async def _service_status_change(s, user, service_id, new_status: str, allowed_from: set, set_activated=False):
    svc = await _get_service(s, user, service_id)
    grants = await load_grants(s, user)
    if not can(grants, "service", "edit", await _node_path(s, svc.owner_node_id)):
        _deny("service.edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation (lifecycle transitions).
    try:
        await assert_can(s, user, action="edit", entity_key="service",
                         region_id=getattr(svc, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if svc.status not in allowed_from:
        raise HTTPException(409, f"Cannot move service from {svc.status} to {new_status}")
    frm = svc.status
    svc.status = new_status
    if set_activated and svc.activated_at is None:
        svc.activated_at = _now()
    await workflow.emit(s, user.tenant_id, "transition", "service", svc.id, user.id, {"from": frm, "to": new_status})
    await s.commit()
    await s.refresh(svc)
    return _service(svc, await _resources(s, svc.id))


@router.post("/services/{service_id}/activate")
async def activate_service(service_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """PENDING or SUSPENDED → ACTIVE (sets activated_at on first activation)."""
    return await _service_status_change(s, user, service_id, "ACTIVE", {"PENDING", "SUSPENDED"}, set_activated=True)


@router.post("/services/{service_id}/suspend")
async def suspend_service(service_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """ACTIVE -> SUSPENDED.

    SPEC §4.5 mandatory-approval gate: suspending a customer's service is a high-impact action
    (the customer goes offline) and so requires an APPROVED `service_suspend` Approval row for
    this exact service. On first call we park a PENDING approval and return 202; on the
    follow-up call (after PATCH /api/mandatory-approvals/{id}/decide flips it to APPROVED) the
    suspension proceeds and the approval is marked EXECUTED.
    """
    # SPEC §4.5 — refuse the suspension unless an APPROVED approval row covers it.
    try:
        await assert_approval_or_raise(
            s, tenant_id=user.tenant_id,
            action_type="service_suspend",
            target_entity_key="service",
            target_record_id=service_id,
        )
    except ApprovalRequired:
        approval = await create_approval_request(
            s, tenant_id=user.tenant_id,
            action_type="service_suspend",
            requested_by_user_id=user.id,
            target_entity_key="service",
            target_record_id=service_id,
            payload={"transition": "ACTIVE->SUSPENDED"},
        )
        await s.commit()
        raise HTTPException(202, detail={
            "status": "approval_required",
            "approval_id": str(approval.id),
            "action_type": "service_suspend",
        })

    approved = await find_approved_approval(
        s, tenant_id=user.tenant_id,
        action_type="service_suspend",
        target_entity_key="service",
        target_record_id=service_id,
    )
    result = await _service_status_change(s, user, service_id, "SUSPENDED", {"ACTIVE"})
    # Forward-only: consume the approval so it can't be re-used.
    if approved is not None:
        await mark_approval_executed(s, approval_id=approved.id, actor_user_id=user.id)
        await s.commit()
    return result


@router.post("/services/{service_id}/terminate")
async def terminate_service(service_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return await _service_status_change(s, user, service_id, "TERMINATED", {"PENDING", "ACTIVE", "SUSPENDED"})


# ==========================================================================================
# Resources
# ==========================================================================================

@router.post("/services/{service_id}/resources", status_code=201)
async def allocate_resource(service_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Allocate a resource to a service (freeform inventory)."""
    svc = await _get_service(s, user, service_id)
    grants = await load_grants(s, user)
    if not can(grants, "service", "edit", await _node_path(s, svc.owner_node_id)):
        _deny("service.edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="service",
                         region_id=getattr(svc, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    kind = payload.get("kind")
    if kind not in _RESOURCE_KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(_RESOURCE_KINDS)}")
    value = (payload.get("value") or "").strip()
    if not value:
        raise HTTPException(422, "value is required")

    res = ServiceResource(tenant_id=user.tenant_id, service_id=svc.id, kind=kind, value=value,
                          label=payload.get("label"), status="ALLOCATED")
    s.add(res)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "resource_allocated", "service", svc.id, user.id,
                        {"resource_id": str(res.id), "kind": kind, "value": value})
    await s.commit()
    await s.refresh(res)
    return _resource(res)


@router.delete("/services/{service_id}/resources/{resource_id}")
async def release_resource(service_id: uuid.UUID, resource_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Release a resource (status → RELEASED). The row is kept for history, never hard-deleted."""
    svc = await _get_service(s, user, service_id)
    grants = await load_grants(s, user)
    if not can(grants, "service", "edit", await _node_path(s, svc.owner_node_id)):
        _deny("service.edit")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="service",
                         region_id=getattr(svc, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    res = (await s.execute(
        select(ServiceResource).where(ServiceResource.id == resource_id, ServiceResource.service_id == svc.id)
    )).scalar_one_or_none()
    if not res:
        raise HTTPException(404, "Resource not found")
    if res.status != "RELEASED":
        res.status = "RELEASED"
        await workflow.emit(s, user.tenant_id, "resource_released", "service", svc.id, user.id,
                            {"resource_id": str(res.id), "kind": res.kind, "value": res.value})
        await s.commit()
        await s.refresh(res)
    return _resource(res)
