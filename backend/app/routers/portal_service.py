"""Portal service (B37) — customer view of services, subscriptions, usage + service requests.

SECURITY invariant: every query is filtered by customer_id == cu.customer_id.
- Service requests create a WorkItem with customer_id FORCED from the token.
- Customers cannot self-provision: they can only request via WorkItem (staff picks it up).
- Usage is read-only.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models.service import Service
from ..models.billing import Subscription
from ..models.usage import UsageRecord
from ..models.workitem import WorkItem
from ..models.customer_user import CustomerUser
from .portal_auth import current_customer

router = APIRouter(prefix="/portal", tags=["portal-service"])


def _iso(dt):
    return dt.isoformat() if dt else None


def _service_out(s: Service) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "type": s.type,
        "status": s.status,
        "activated_at": _iso(s.activated_at),
        "subscription_id": str(s.subscription_id) if s.subscription_id else None,
    }


def _sub_out(s: Subscription) -> dict:
    return {
        "id": str(s.id),
        "plan_name": s.plan_name,
        "amount": s.amount,
        "cycle": s.cycle,
        "status": s.status,
        "started_at": _iso(s.started_at),
        "next_invoice_at": _iso(s.next_invoice_at),
    }


def _usage_out(u: UsageRecord) -> dict:
    return {
        "id": str(u.id),
        "metric": u.metric,
        "quantity": float(u.quantity),
        "amount": u.amount,
        "period_start": _iso(u.period_start),
        "period_end": _iso(u.period_end),
    }


class ServiceRequestIn(BaseModel):
    message: str
    service_id: str | None = None


@router.get("/me/services")
async def list_services(
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    services = (await s.execute(
        select(Service).where(Service.customer_id == cu.customer_id)
        .order_by(Service.created_at.desc())
    )).scalars().all()
    return [_service_out(svc) for svc in services]


@router.get("/me/subscriptions")
async def list_subscriptions(
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    subs = (await s.execute(
        select(Subscription).where(Subscription.customer_id == cu.customer_id)
        .order_by(Subscription.created_at.desc())
    )).scalars().all()
    return [_sub_out(sub) for sub in subs]


@router.get("/me/usage")
async def list_usage(
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    # Scope to this customer's subscriptions
    sub_ids = (await s.execute(
        select(Subscription.id).where(Subscription.customer_id == cu.customer_id)
    )).scalars().all()

    if not sub_ids:
        return []

    q = select(UsageRecord).where(UsageRecord.subscription_id.in_(sub_ids))

    if from_:
        try:
            q = q.where(UsageRecord.period_start >= datetime.fromisoformat(from_.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(422, "Invalid 'from' date format")
    if to:
        try:
            q = q.where(UsageRecord.period_end <= datetime.fromisoformat(to.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(422, "Invalid 'to' date format")

    records = (await s.execute(q.order_by(UsageRecord.created_at.desc()).limit(200))).scalars().all()
    return [_usage_out(u) for u in records]


@router.post("/me/service-requests", status_code=201)
async def create_service_request(
    body: ServiceRequestIn,
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """File a service request as a WorkItem. Staff picks it up from the WorkItems board.
    customer_id FORCED from auth — customers cannot self-provision."""
    title = f"Portal service request: {body.message[:80]}"

    wi = WorkItem(
        tenant_id=cu.tenant_id,
        title=title,
        description=body.message,
        kind="service_request",
        status="TODO",
        priority="NORMAL",
        customer_id=cu.customer_id,   # FORCED
    )
    s.add(wi)
    await s.commit()
    await s.refresh(wi)
    return {"id": str(wi.id), "title": wi.title, "status": wi.status}
