"""Orders / provisioning API (Phase-2, doc 28).

Tenant + org scoped like the other modules (org-scope filter + `order.*` permission gate), every
mutation emits an audit Event via `workflow.emit`. The lifecycle is DRAFT → SUBMITTED →
PROVISIONING → COMPLETED (or CANCELLED), with legal-transition guards. On COMPLETED each item that
references a catalog Product provisions an ACTIVE Subscription for the customer — copying the
product's amount/cycle (the order→billing bridge). Money is integer luma.

NOTE on namespacing: fixed paths under /api ("/api/orders") → register BEFORE records.router.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.order import Order, OrderItem
from ..models.billing import Subscription
from ..models.product import Product
from ..access import load_grants, can
from ..kernel import (
    assert_can_advance_to_scheduling, ControlGateNotPassed,
    assert_can, AccessDenied,
    assert_writer_owns_record_firstclass, OwnerViolation,
)
from .. import workflow, notify_hooks
from .auth import current_user
from .records import _node_path, _node_paths              # reuse the exact records scope primitives
from .billing import _money, _now, _add_cycle, _customer_or_422, _deny   # reuse billing helpers (DRY)
from .notifications import emit_notification

router = APIRouter(prefix="/api", tags=["orders"])

# legal forward steps for /advance
_ADVANCE = {"SUBMITTED": "PROVISIONING", "PROVISIONING": "COMPLETED"}


# ---- serializers ----

def _iso(dt):
    return dt.isoformat() if dt else None


def _item(it: OrderItem) -> dict:
    return {"id": str(it.id), "product_id": str(it.product_id) if it.product_id else None,
            "description": it.description, "quantity": it.quantity,
            "unit_amount": it.unit_amount, "line_total": it.line_total}


def _order(o: Order, items: list[OrderItem] | None = None) -> dict:
    out = {
        "id": str(o.id),
        "number": o.number,
        "customer_id": str(o.customer_id) if o.customer_id else None,
        "owner_node_id": str(o.owner_node_id) if o.owner_node_id else None,
        "status": o.status,
        "total": o.total,
        "created_at": _iso(o.created_at),
    }
    if items is not None:
        out["items"] = [_item(it) for it in items]
    return out


# ---- loaders / helpers ----

async def _get_order(s, user: User, order_id) -> Order:
    o = (await s.execute(
        select(Order).where(Order.id == order_id, Order.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not o:
        raise HTTPException(404, "Order not found")
    return o


async def _items(s, order_id) -> list[OrderItem]:
    return list((await s.execute(
        select(OrderItem).where(OrderItem.order_id == order_id)
    )).scalars().all())


async def _next_order_number(s, tenant_id) -> str:
    n = (await s.execute(
        select(func.count()).select_from(Order).where(Order.tenant_id == tenant_id)
    )).scalar_one()
    return f"ORD-{n + 1:05d}"


async def _owner_gate(s: AsyncSession, *, table_name: str, writer_module: str) -> None:
    """SPEC §0.1 first-class table owner check (helper). OwnerViolation → 409."""
    try:
        await assert_writer_owns_record_firstclass(
            s, table_name=table_name, writer_module=writer_module,
        )
    except OwnerViolation as e:
        raise HTTPException(409, detail=str(e))


async def _replace_items(s, user: User, order: Order, lines_in) -> int:
    """Replace the order's items from a payload list; returns the recomputed total (luma)."""
    if not isinstance(lines_in, list):
        raise HTTPException(422, "items must be a list")
    for it in await _items(s, order.id):
        await s.delete(it)
    total = 0
    for li in lines_in:
        desc = (li.get("description") or "").strip()
        if not desc:
            raise HTTPException(422, "each item needs a description")
        qty = int(li.get("quantity", 1))
        if qty <= 0:
            raise HTTPException(422, "item quantity must be >= 1")
        unit = _money(li.get("unit_amount", 0), "unit_amount")
        product_id = li.get("product_id")
        if product_id is not None:
            prod = (await s.execute(
                select(Product).where(Product.id == product_id, Product.tenant_id == user.tenant_id)
            )).scalar_one_or_none()
            if not prod:
                raise HTTPException(422, "item product_id does not reference a known product")
        line_total = qty * unit
        total += line_total
        s.add(OrderItem(tenant_id=user.tenant_id, order_id=order.id, product_id=product_id,
                        description=desc, quantity=qty, unit_amount=unit, line_total=line_total))
    return total


async def _provision_subscriptions(s, user: User, order: Order, items: list[OrderItem]) -> list[str]:
    """On COMPLETED: for each item with a product_id, create an ACTIVE Subscription for the
    customer (amount/cycle copied from the product). Items without a product (one-off charges) are
    skipped, and a since-removed product is skipped rather than failing provisioning."""
    created: list[str] = []
    for it in items:
        if not it.product_id:
            continue
        prod = (await s.execute(
            select(Product).where(Product.id == it.product_id, Product.tenant_id == user.tenant_id)
        )).scalar_one_or_none()
        if not prod:
            continue
        started = _now()
        sub = Subscription(
            tenant_id=user.tenant_id, owner_node_id=order.owner_node_id, customer_id=order.customer_id,
            product_id=prod.id, plan_name=prod.name, amount=prod.default_amount, cycle=prod.cycle,
            status="ACTIVE", started_at=started, next_invoice_at=_add_cycle(started, prod.cycle),
        )
        s.add(sub)
        await s.flush()
        await workflow.emit(s, user.tenant_id, "create", "subscription", sub.id, user.id,
                            {"plan_name": prod.name, "amount": prod.default_amount, "from_order": str(order.id)})
        created.append(str(sub.id))
        # order → subscription → service: provision a Service fulfilling this subscription (lazy
        # import avoids any router import cycle; fail-soft so a service hiccup never blocks the order).
        try:
            from .services import provision_service_for_subscription
            await provision_service_for_subscription(
                s, tenant_id=user.tenant_id, subscription=sub, owner_node_id=order.owner_node_id,
                customer_id=order.customer_id, actor_user_id=user.id,
            )
        except Exception:
            pass
    return created


# ---- CRUD ----

@router.get("/orders")
async def list_orders(customer: uuid.UUID | None = None, status: str | None = None,
                      user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "order", "view"):
        _deny("order.view")
    paths = await _node_paths(s, user.tenant_id)
    q = select(Order).where(Order.tenant_id == user.tenant_id)
    if customer:
        q = q.where(Order.customer_id == customer)
    if status:
        q = q.where(Order.status == status)
    rows = (await s.execute(q.order_by(Order.created_at))).scalars().all()
    visible = [r for r in rows
               if can(grants, "order", "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)]
    return [_order(r) for r in visible]


@router.post("/orders", status_code=201)
async def create_order(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a DRAFT order with items; total computed from items."""
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "order", "create", owner_path):
        _deny("order.create")

    # SPEC §0.1 single-owner (first-class) — only Orders may write order.
    await _owner_gate(s, table_name="order", writer_module="Orders")

    # SPEC §0.2 default-deny (Step 7) — kernel gate before any DB mutation. Region is None on
    # create (the order has no row yet); ownership is None (the order has no current owner).
    try:
        await assert_can(
            s, user,
            action="create",
            entity_key="order",
            region_id=payload.get("region_id"),
            owner_user_id=None,
        )
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    customer_id = payload.get("customer_id")
    await _customer_or_422(s, user.tenant_id, customer_id)

    number = await _next_order_number(s, user.tenant_id)
    order = Order(tenant_id=user.tenant_id, owner_node_id=user.primary_node_id,
                  customer_id=customer_id, number=number, status="DRAFT", total=0)
    s.add(order)
    await s.flush()
    order.total = await _replace_items(s, user, order, payload.get("items") or [])
    await workflow.emit(s, user.tenant_id, "create", "order", order.id, user.id,
                        {"number": number, "total": order.total})
    await s.commit()
    await s.refresh(order)
    return _order(order, await _items(s, order.id))


@router.get("/orders/{order_id}")
async def get_order(order_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    order = await _get_order(s, user, order_id)
    grants = await load_grants(s, user)
    if not can(grants, "order", "view", await _node_path(s, order.owner_node_id)):
        _deny("order.view")
    return _order(order, await _items(s, order.id))


@router.patch("/orders/{order_id}")
async def update_order(order_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit a DRAFT order: replace items and/or set customer_id. Refused once SUBMITTED (409)."""
    order = await _get_order(s, user, order_id)
    grants = await load_grants(s, user)
    if not can(grants, "order", "edit", await _node_path(s, order.owner_node_id)):
        _deny("order.edit")
    # SPEC §0.1 single-owner (first-class) — only Orders may write order.
    await _owner_gate(s, table_name="order", writer_module="Orders")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(
            s, user,
            action="edit",
            entity_key="order",
            region_id=getattr(order, "region_id", None),
            owner_user_id=order.control_pass_by,
        )
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if order.status != "DRAFT":
        raise HTTPException(409, f"Only a DRAFT order can be edited (status is {order.status})")

    if "customer_id" in payload:
        await _customer_or_422(s, user.tenant_id, payload["customer_id"])
        order.customer_id = payload["customer_id"]
    if "items" in payload:
        order.total = await _replace_items(s, user, order, payload["items"])

    await workflow.emit(s, user.tenant_id, "update", "order", order.id, user.id, {"total": order.total})
    await s.commit()
    await s.refresh(order)
    return _order(order, await _items(s, order.id))


# ---- lifecycle ----

async def _set_status(s, user: User, order: Order, frm: str, to: str):
    order.status = to
    await workflow.emit(s, user.tenant_id, "transition", "order", order.id, user.id, {"from": frm, "to": to})


@router.post("/orders/{order_id}/submit")
async def submit_order(order_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    order = await _get_order(s, user, order_id)
    grants = await load_grants(s, user)
    if not can(grants, "order", "edit", await _node_path(s, order.owner_node_id)):
        _deny("order.edit")
    # SPEC §0.1 single-owner (first-class) — only Orders may write order.
    await _owner_gate(s, table_name="order", writer_module="Orders")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(
            s, user,
            action="edit",
            entity_key="order",
            region_id=getattr(order, "region_id", None),
            owner_user_id=order.control_pass_by,
        )
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if order.status != "DRAFT":
        raise HTTPException(409, f"Only a DRAFT order can be submitted (status is {order.status})")
    await _set_status(s, user, order, "DRAFT", "SUBMITTED")
    await s.commit()
    await s.refresh(order)
    return _order(order, await _items(s, order.id))


@router.post("/orders/{order_id}/advance")
async def advance_order(order_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Move the order one legal step forward: SUBMITTED→PROVISIONING→COMPLETED. Illegal → 409.

    SPEC §3 Stage 8 Control Gate: SUBMITTED→PROVISIONING is the Sales→Fulfillment boundary in this
    codebase (the closest analog to SPEC's stage 7→9 "Order Created → Scheduling" transition while
    the explicit Scheduling/Dispatch module is still pending). Refuses the advance unless
    `order.control_pass` is TRUE. PROVISIONING→COMPLETED is post-gate and unaffected.

    On reaching COMPLETED, provisions ACTIVE Subscriptions for each item with a product.
    """
    order = await _get_order(s, user, order_id)
    grants = await load_grants(s, user)
    if not can(grants, "order", "edit", await _node_path(s, order.owner_node_id)):
        _deny("order.edit")

    # SPEC §0.1 single-owner (first-class) — only Orders may write order. Note: advance also
    # creates Subscriptions on COMPLETED (Billing Accounts side-effect); that's the canonical
    # SPEC §2.2 cross-module trigger (Order COMPLETE → Billing Accounts provisions Subscription).
    await _owner_gate(s, table_name="order", writer_module="Orders")

    # SPEC §4 default-deny — proof-of-life wire-up of the kernel permissions engine. The legacy
    # role check above is preserved (Studio/M0 has roles to keep working); this kernel call
    # additionally evaluates Role × Department × Region × Ownership and raises AccessDenied →
    # 403 if any layer denies. Step 6 wires this ONE touchpoint; a full router sweep lands later.
    try:
        await assert_can(
            s, user,
            action="edit",
            entity_key="order",
            region_id=getattr(order, "region_id", None),
            owner_user_id=order.control_pass_by,  # closest stand-in until order.created_by lands
        )
    except AccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))

    nxt = _ADVANCE.get(order.status)
    if not nxt:
        raise HTTPException(409, f"Cannot advance an order in status {order.status}")

    frm = order.status

    # SPEC §3 / §10.4 — Stage 8 Control Gate. Fires on the Sales→Fulfillment crossing only
    # (SUBMITTED → PROVISIONING here; the explicit Scheduling stage isn't modeled yet).
    if frm == "SUBMITTED" and nxt == "PROVISIONING":
        try:
            await assert_can_advance_to_scheduling(s, order_id=order.id, control_pass=order.control_pass)
        except ControlGateNotPassed as e:
            # Router boundary maps the kernel exception to HTTP 409 per the SPEC §0 contract.
            raise HTTPException(status_code=409, detail=str(e))

    await _set_status(s, user, order, frm, nxt)

    provisioned: list[str] = []
    if nxt == "COMPLETED":
        items = await _items(s, order.id)
        provisioned = await _provision_subscriptions(s, user, order, items)
        # best-effort completion notification (no-op unless an `order.completed` def is seeded)
        try:
            recipients = await notify_hooks.resolve_recipients(s, tenant_id=user.tenant_id, record=order)
            for uid in recipients:
                if uid == user.id:
                    continue
                await emit_notification(s, tenant_id=user.tenant_id, def_key="order.completed", user_id=uid,
                                        entity_key="order", record_id=order.id,
                                        context={"number": order.number, "total": order.total,
                                                 "provisioned": len(provisioned)})
        except Exception:
            pass

    await s.commit()
    await s.refresh(order)
    result = _order(order, await _items(s, order.id))
    if nxt == "COMPLETED":
        result["provisioned_subscriptions"] = provisioned
    return result


@router.post("/orders/{order_id}/cancel")
async def cancel_order(order_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Cancel an order. A COMPLETED order cannot be cancelled (its subscriptions already exist)."""
    order = await _get_order(s, user, order_id)
    grants = await load_grants(s, user)
    if not can(grants, "order", "edit", await _node_path(s, order.owner_node_id)):
        _deny("order.edit")
    # SPEC §0.1 single-owner (first-class) — only Orders may write order.
    await _owner_gate(s, table_name="order", writer_module="Orders")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(
            s, user,
            action="edit",
            entity_key="order",
            region_id=getattr(order, "region_id", None),
            owner_user_id=order.control_pass_by,
        )
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if order.status in ("COMPLETED", "CANCELLED"):
        raise HTTPException(409, f"Cannot cancel an order in status {order.status}")
    frm = order.status
    await _set_status(s, user, order, frm, "CANCELLED")
    await s.commit()
    await s.refresh(order)
    return _order(order, await _items(s, order.id))
