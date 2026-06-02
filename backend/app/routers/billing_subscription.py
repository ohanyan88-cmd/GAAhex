"""Billing — Subscription endpoints (split from the original ``routers/billing.py``).

Tenant + org scoped exactly like the generic record router (org-scope filter + entity-style
permission gate ``subscription.*``), and every mutation emits an audit Event through
``workflow.emit`` (the same chokepoint records use). Money is integer luma — see
models/billing.py.

NOTE on namespacing: these are FIXED paths under /api ("/api/subscriptions"). The generic
record router serves "/api/{slug}", so this router MUST be registered BEFORE records.router
in main.py.
"""
import uuid
from datetime import date, datetime, time, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.billing import Subscription, Invoice, InvoiceLine
from ..models.product import Product
from ..access import load_grants, can
from .. import workflow
from ..kernel import (
    assert_can, AccessDenied,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, find_approved_approval, mark_approval_executed,
)
from .auth import current_user
from .records import _node_path, _node_paths, _paginate     # reuse the exact records scope primitives + paging
from ._billing_shared import (
    _CYCLES,
    _deny, _owner_gate, _money, _now, _add_cycle, _customer_or_422,
    _iso, _sub, _invoice,
    _get_sub, _invoice_lines, _next_invoice_number,
    _parse_dt,
)

router = APIRouter(prefix="/api", tags=["billing"])


# ==========================================================================================
# Subscriptions
# ==========================================================================================

@router.get("/subscriptions")
async def list_subscriptions(customer: uuid.UUID | None = None, status: str | None = None,
                             since: Optional[date] = None,
                             limit: int = 200, offset: int = 0,
                             user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "view"):
        _deny("subscription.view")
    paths = await _node_paths(s, user.tenant_id)
    q = select(Subscription).where(Subscription.tenant_id == user.tenant_id)
    if customer:
        q = q.where(Subscription.customer_id == customer)
    if status:
        q = q.where(Subscription.status == status)
    if since is not None:
        since_dt = datetime.combine(since, time.min, tzinfo=timezone.utc)
        q = q.where(Subscription.created_at >= since_dt)
    rows = (await s.execute(q.order_by(Subscription.created_at))).scalars().all()
    visible = [r for r in rows
               if can(grants, "subscription", "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)]
    return [_sub(r) for r in _paginate(visible, limit, offset)]


@router.post("/subscriptions", status_code=201)
async def create_subscription(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "subscription", "create", owner_path):
        _deny("subscription.create")
    # SPEC §0.1 single-owner (first-class) — only Billing Accounts may write subscription.
    await _owner_gate(s, table_name="subscription", writer_module="Billing Accounts")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="subscription",
                         region_id=payload.get("region_id"), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # optional catalog plan: copies name/amount/cycle defaults, all still overridable per subscription
    product_id = payload.get("product_id")
    prod = None
    if product_id:
        prod = (await s.execute(
            select(Product).where(Product.id == product_id, Product.tenant_id == user.tenant_id)
        )).scalar_one_or_none()
        if not prod:
            raise HTTPException(422, "product_id does not reference a known product")

    plan_name = (payload.get("plan_name") or (prod.name if prod else "") or "").strip()
    if not plan_name:
        raise HTTPException(422, "plan_name is required")
    cycle = payload.get("cycle") or (prod.cycle if prod else "monthly")
    if cycle not in _CYCLES:
        raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")
    amount_in = payload.get("amount")
    if amount_in is None and prod is not None:
        amount = prod.default_amount
    else:
        amount = _money(amount_in if amount_in is not None else 0, "amount")
    customer_id = payload.get("customer_id")
    await _customer_or_422(s, user.tenant_id, customer_id)

    started = _now()
    sub = Subscription(
        tenant_id=user.tenant_id, owner_node_id=user.primary_node_id, customer_id=customer_id,
        product_id=product_id, plan_name=plan_name, amount=amount, cycle=cycle, status="ACTIVE",
        started_at=started, next_invoice_at=_add_cycle(started, cycle),
    )
    s.add(sub)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "CREATE", "subscription", sub.id, user.id,
                        {"plan_name": plan_name, "amount": amount, "cycle": cycle,
                         "product_id": str(product_id) if product_id else None})
    await s.commit()
    await s.refresh(sub)
    return _sub(sub)


@router.get("/subscriptions/{sub_id}")
async def get_subscription(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "view", await _node_path(s, sub.owner_node_id)):
        _deny("subscription.view")
    return _sub(sub)


@router.patch("/subscriptions/{sub_id}")
async def update_subscription(sub_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit plan presentation/pricing. Status moves go through cancel/suspend/resume, not here.

    SPEC §4.5 mandatory-approval gate: a subscription PATCH that mutates the tariff
    (plan_name / amount / cycle) is a `contract_change` per SPEC §4.5 and requires an
    APPROVED Approval row covering this subscription. The next_invoice_at-only edit
    (a billing schedule tweak — does not change what the customer is paying) is exempt.
    First call parks a PENDING approval and returns 202; the follow-up after the
    `/decide` flips it APPROVED performs the mutation and consumes the approval.
    """
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "edit", await _node_path(s, sub.owner_node_id)):
        _deny("subscription.edit")
    # SPEC §0.1 single-owner (first-class) — only Billing Accounts may write subscription.
    await _owner_gate(s, table_name="subscription", writer_module="Billing Accounts")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="subscription",
                         region_id=getattr(sub, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # SPEC §4.5 — `contract_change`. Trigger when the tariff changes (plan_name, amount or
    # cycle). Pure next_invoice_at tweaks are not a contract change, so they pass through.
    tariff_change = any(k in payload for k in ("plan_name", "amount", "cycle"))
    approved_approval = None
    if tariff_change:
        try:
            await assert_approval_or_raise(
                s, tenant_id=user.tenant_id,
                action_type="contract_change",
                target_entity_key="subscription",
                target_record_id=sub.id,
            )
        except ApprovalRequired:
            approval = await create_approval_request(
                s, tenant_id=user.tenant_id,
                action_type="contract_change",
                requested_by_user_id=user.id,
                target_entity_key="subscription",
                target_record_id=sub.id,
                payload={k: payload[k] for k in ("plan_name", "amount", "cycle") if k in payload},
            )
            await s.commit()
            raise HTTPException(202, detail={
                "status": "approval_required",
                "approval_id": str(approval.id),
                "action_type": "contract_change",
            })
        approved_approval = await find_approved_approval(
            s, tenant_id=user.tenant_id,
            action_type="contract_change",
            target_entity_key="subscription",
            target_record_id=sub.id,
        )

    changed: dict = {}
    if "plan_name" in payload:
        v = (payload["plan_name"] or "").strip()
        if not v:
            raise HTTPException(422, "plan_name cannot be empty")
        sub.plan_name = v
        changed["plan_name"] = v
    if "amount" in payload:
        sub.amount = _money(payload["amount"], "amount")
        changed["amount"] = sub.amount
    if "cycle" in payload:
        if payload["cycle"] not in _CYCLES:
            raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")
        sub.cycle = payload["cycle"]
        changed["cycle"] = sub.cycle
    if "next_invoice_at" in payload:
        sub.next_invoice_at = _parse_dt(payload["next_invoice_at"], "next_invoice_at")
        changed["next_invoice_at"] = _iso(sub.next_invoice_at)

    await workflow.emit(s, user.tenant_id, "UPDATE", "subscription", sub.id, user.id, {"changed": changed})
    if approved_approval is not None:
        await mark_approval_executed(s, approval_id=approved_approval.id, actor_user_id=user.id)
    await s.commit()
    await s.refresh(sub)
    return _sub(sub)


async def _sub_status_change(s, user, sub_id, new_status: str, allowed_from: set):
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "edit", await _node_path(s, sub.owner_node_id)):
        _deny("subscription.edit")
    # SPEC §0.1 single-owner (first-class) — only Billing Accounts may write subscription.
    await _owner_gate(s, table_name="subscription", writer_module="Billing Accounts")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation; covers cancel/suspend/resume.
    try:
        await assert_can(s, user, action="edit", entity_key="subscription",
                         region_id=getattr(sub, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if sub.status not in allowed_from:
        raise HTTPException(409, f"Cannot move subscription from {sub.status} to {new_status}")
    frm = sub.status
    sub.status = new_status
    await workflow.emit(s, user.tenant_id, "TRANSITION", "subscription", sub.id, user.id,
                        {"from": frm, "to": new_status})
    await s.commit()
    await s.refresh(sub)
    return _sub(sub)


@router.post("/subscriptions/{sub_id}/cancel")
async def cancel_subscription(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return await _sub_status_change(s, user, sub_id, "CANCELLED", {"ACTIVE", "SUSPENDED"})


@router.post("/subscriptions/{sub_id}/suspend")
async def suspend_subscription(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return await _sub_status_change(s, user, sub_id, "SUSPENDED", {"ACTIVE"})


@router.post("/subscriptions/{sub_id}/resume")
async def resume_subscription(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return await _sub_status_change(s, user, sub_id, "ACTIVE", {"SUSPENDED"})


@router.post("/subscriptions/{sub_id}/generate-invoice", status_code=201)
async def generate_invoice(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a DRAFT invoice for the subscription's current period and advance its next_invoice_at.
    Requires invoice.create (this mints an invoice)."""
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "create", await _node_path(s, sub.owner_node_id)):
        _deny("invoice.create")
    # SPEC §0.1 single-owner (first-class) — only Invoices may write invoice. The subscription's
    # next_invoice_at is bumped below as the canonical Billing-Run side-effect on the
    # Billing-Accounts-owned subscription (SPEC §2.2 "Invoice — Created From: Billing Run").
    await _owner_gate(s, table_name="invoice", writer_module="Invoices")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="invoice",
                         region_id=getattr(sub, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if sub.status == "CANCELLED":
        raise HTTPException(409, "Cannot generate an invoice for a CANCELLED subscription")

    period_start = sub.next_invoice_at or sub.started_at or _now()
    period_end = _add_cycle(period_start, sub.cycle)
    number = await _next_invoice_number(s, user.tenant_id)
    inv = Invoice(
        tenant_id=user.tenant_id, owner_node_id=sub.owner_node_id, customer_id=sub.customer_id,
        number=number, period_start=period_start, period_end=period_end, status="DRAFT", total=sub.amount,
    )
    s.add(inv)
    await s.flush()
    line = InvoiceLine(tenant_id=user.tenant_id, invoice_id=inv.id, description=sub.plan_name,
                       quantity=1, unit_amount=sub.amount, line_total=sub.amount)
    s.add(line)
    sub.next_invoice_at = period_end                      # advance the schedule
    await workflow.emit(s, user.tenant_id, "CREATE", "invoice", inv.id, user.id,
                        {"number": number, "total": sub.amount, "from_subscription": str(sub.id)})
    await s.commit()
    await s.refresh(inv)
    return _invoice(inv, await _invoice_lines(s, inv.id))
