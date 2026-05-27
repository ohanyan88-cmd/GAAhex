"""Customer 360 (doc 17) — one consolidated, read-only view of a customer across modules.

`GET /api/customers/{customer_id}/360` pulls the CRM customer Record together with its Billing
(subscriptions, invoices, a money summary), its audit activity, and best-effort counts of related
CRM records — in a single payload a 360 UI can render. Permission + org-scope enforced: the caller
must be able to view that customer Record (reuses the records `can(grants,"customer","view",path)`
check). Tenant-scoped throughout. Money is integer **luma** (1 ֏ = 100 luma) — clients ÷100 to display.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Record, Event, User, Service
from ..models.billing import Subscription, Invoice, Payment
from ..access import load_grants, can
from .auth import current_user
from .records import _serialize as _serialize_record, _get, _node_path, _node_paths
from .activity import _item as _activity_item, _actor_names

router = APIRouter(prefix="/api/customers", tags=["customer-360"])

# ---- portal provisioning ----
from pydantic import BaseModel
from ..models.customer_user import CustomerUser
from ..security import hash_password as _hash_password
from ..db import OwnerSessionLocal


class PortalUserIn(BaseModel):
    email: str
    password: str | None = None
    name: str | None = None

SUBS_CAP = 50
INVOICE_CAP = 20
SERVICE_CAP = 50
ACTIVITY_CAP = 15
BILLED_STATUSES = ("ISSUED", "PAID", "OVERDUE")     # DRAFT/VOID don't count toward billed
RELATED_ENTITIES = ("deal", "contact", "ticket")


def _iso(dt):
    return dt.isoformat() if dt else None


def _sub_out(x: Subscription) -> dict:
    return {
        "id": str(x.id),
        "plan_name": x.plan_name,
        "amount": x.amount,                  # luma per cycle
        "cycle": x.cycle,
        "status": x.status,
        "started_at": _iso(x.started_at),
        "next_invoice_at": _iso(x.next_invoice_at),
    }


def _svc_out(x: Service) -> dict:
    return {
        "id": str(x.id),
        "name": x.name,
        "type": x.type,
        "status": x.status,
        "activated_at": _iso(x.activated_at),
        "subscription_id": str(x.subscription_id) if x.subscription_id else None,
    }


def _inv_out(x: Invoice) -> dict:
    return {
        "id": str(x.id),
        "number": x.number,
        "status": x.status,
        "total": x.total,                    # luma
        "period_start": _iso(x.period_start),
        "period_end": _iso(x.period_end),
        "issued_at": _iso(x.issued_at),
        "due_at": _iso(x.due_at),
    }


@router.get("/{customer_id}/360")
async def customer_360(customer_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    # ---- the customer Record, permission + scope enforced ----
    rec = await _get(s, user.tenant_id, "customer", customer_id)        # 404 if not a customer / missing
    grants = await load_grants(s, user)
    if not can(grants, "customer", "view", await _node_path(s, rec.owner_node_id)):
        raise HTTPException(403, "Not allowed: customer.view")

    # ---- subscriptions ----
    subs = (await s.execute(
        select(Subscription).where(
            Subscription.tenant_id == user.tenant_id, Subscription.customer_id == customer_id
        ).order_by(Subscription.created_at.desc()).limit(SUBS_CAP)
    )).scalars().all()

    # ---- services (what the ISP actually delivers to this customer, most-recent first) ----
    services = (await s.execute(
        select(Service).where(
            Service.tenant_id == user.tenant_id, Service.customer_id == customer_id
        ).order_by(Service.created_at.desc()).limit(SERVICE_CAP)
    )).scalars().all()

    # ---- invoices (+ money summary over ALL of them, list shows recent) ----
    all_invoices = (await s.execute(
        select(Invoice).where(
            Invoice.tenant_id == user.tenant_id, Invoice.customer_id == customer_id
        ).order_by(Invoice.created_at.desc())
    )).scalars().all()

    billed = sum(inv.total for inv in all_invoices if inv.status in BILLED_STATUSES)
    overdue_count = sum(1 for inv in all_invoices if inv.status == "OVERDUE")
    invoice_ids = [inv.id for inv in all_invoices]
    paid = 0
    if invoice_ids:
        paid = (await s.execute(
            select(Payment).where(Payment.tenant_id == user.tenant_id, Payment.invoice_id.in_(invoice_ids))
        )).scalars().all()
        paid = sum(p.amount for p in paid)
    summary = {
        "currency": "AMD",
        "total_billed": billed,
        "total_paid": paid,
        "outstanding": billed - paid,
        "overdue_count": overdue_count,
        "subscription_count": len(subs),
        "invoice_count": len(all_invoices),
        "service_count": len(services),
    }

    # ---- activity (the customer record's audit trail, newest first) ----
    events = (await s.execute(
        select(Event).where(Event.tenant_id == user.tenant_id, Event.record_id == customer_id)
        .order_by(Event.created_at.desc()).limit(ACTIVITY_CAP)
    )).scalars().all()
    names = await _actor_names(s, user.tenant_id, events)
    activity = [_activity_item(ev, names) for ev in events]

    # ---- related CRM records that reference this customer via a ref field (best-effort) ----
    cust_str = str(customer_id)
    paths = await _node_paths(s, user.tenant_id)
    related = {}
    for ek in RELATED_ENTITIES:
        if not can(grants, ek, "view"):          # don't leak counts for entities the caller can't view
            continue
        rows = (await s.execute(
            select(Record).where(Record.tenant_id == user.tenant_id, Record.entity_key == ek)
        )).scalars().all()
        count = 0
        for r in rows:
            rp = paths.get(str(r.owner_node_id)) if r.owner_node_id else None
            if not can(grants, ek, "view", rp):
                continue
            if any(isinstance(v, str) and v == cust_str for v in (r.data or {}).values()):
                count += 1
        related[ek] = count

    return {
        "profile": _serialize_record(rec),
        "subscriptions": [_sub_out(x) for x in subs],
        "services": [_svc_out(x) for x in services],
        "invoices": [_inv_out(x) for x in all_invoices[:INVOICE_CAP]],
        "summary": summary,
        "activity": activity,
        "related": related,
    }


@router.post("/{customer_id}/portal-users", status_code=201)
async def provision_portal_user(
    customer_id: uuid.UUID,
    body: PortalUserIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Staff-only: create a portal login for a customer. Gated by customer.edit permission."""
    rec = await _get(s, user.tenant_id, "customer", customer_id)
    grants = await load_grants(s, user)
    if not can(grants, "customer", "edit", await _node_path(s, rec.owner_node_id)):
        raise HTTPException(403, "Not allowed: customer.edit")

    if not body.password or len(body.password) < 6:
        raise HTTPException(422, "Password must be at least 6 characters")

    # check uniqueness (tenant + email) via owner session to bypass RLS
    async with OwnerSessionLocal() as o:
        existing = (await o.execute(
            select(CustomerUser).where(
                CustomerUser.tenant_id == user.tenant_id,
                CustomerUser.email == body.email,
            )
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(409, "A portal user with that email already exists for this tenant")

        cu = CustomerUser(
            tenant_id=user.tenant_id,
            customer_id=customer_id,
            email=body.email,
            password_hash=_hash_password(body.password),
            name=body.name,
            is_active=True,
        )
        o.add(cu)
        await o.commit()
        await o.refresh(cu)

    return {
        "id": str(cu.id),
        "email": cu.email,
        "name": cu.name,
        "customer_id": str(cu.customer_id),
        "tenant_id": str(cu.tenant_id),
    }
