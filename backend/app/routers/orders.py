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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from decimal import Decimal, InvalidOperation

from ..db import get_session
from ..models import User, Record, Task
from ..models.access import RoleDef
from ..models.order import Order, OrderItem
from ..models.billing import Subscription, Payment
from ..models.payment_method import PaymentMethod
from ..models.product import Product
from ..access import load_grants, can
from ..kernel import (
    assert_can, AccessDenied,
    assert_writer_owns_record_firstclass, OwnerViolation,
)
from .. import workflow, notify_hooks
from ..kernel import events
from ..services.payment_gateway_adapter import get_payment_gateway
from ..services.stage8_gate import compute_stage8_status, apply_stage8_result
from ..services.transition_guards import control_gate_stage8
from ..utils.refnum import next_reference_number
from .auth import current_user
from .records import _node_path, _node_paths, _entity, _fields  # reuse the exact records scope primitives
from .billing import _money, _now, _add_cycle, _customer_or_422, _deny   # reuse billing helpers (DRY)
from .notifications import emit_notification

router = APIRouter(prefix="/api", tags=["orders"])

# Order lifecycle = the fulfillment half of the Customer Lifecycle SST
# (frontend/src/lib/lifecycle.ts LIFECYCLE_STAGES, stages 6-13). Single source of truth — the
# order does NOT carry its own parallel status vocabulary anymore (the legacy
# DRAFT/SUBMITTED/PROVISIONING/COMPLETED set was deleted 2026-06-11). Kept in sync with the SST.
ORDER_INITIAL = "order_created"           # SST #6 — created from a contract-signed lead
ORDER_GATE_FROM, ORDER_GATE_TO = "order_validated", "scheduling"   # SST #7→#8 control gate
ORDER_PROVISION_AT = "activation"         # SST #13 — provisions ACTIVE subscriptions, becomes a monitored customer
ORDER_EDITABLE = ORDER_INITIAL            # only an unvalidated order can be edited

# Legal forward steps for /advance — the SST fulfillment chain. `order_created` is NOT here:
# it advances via /submit (order_created → order_validated), keeping the explicit submit step.
# The order stage sequence is config-driven — read from the order entity's WorkflowDef transitions at
# advance time (seeded/normalized by seed_lifecycle_statuses). This canonical chain is the SAFE FALLBACK
# for environments where the order entity_def/WorkflowDef isn't present or is stale (the order is still a
# first-class table, not yet a full config Record — see Step-4 sub-project). The Stage-8 control gate
# and activation side-effects (provisioning / customer / care-task) remain in-code hooks around it.
_FORWARD_FALLBACK = {
    "order_validated":   "scheduling",
    "scheduling":        "config",
    "config":            "installation",
    "installation":      "connection_test",
    "connection_test":   "payment_confirmed",
    "payment_confirmed": "activation",
}


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
        # Phase B.1 — Stage 8 Control Gate + deposit fields. Surfaced on the list payload so the
        # frontend OrdersView Stage 8 pill can render the real verdict instead of defaulting to
        # "Pending". Decimal → str preserves precision (mirrors Accounts A.2/A.3); UUID → str;
        # datetime → ISO.
        "control_pass": o.control_pass,
        "control_pass_at": _iso(o.control_pass_at),
        "control_pass_by": str(o.control_pass_by) if o.control_pass_by else None,
        "credit_check_status": o.credit_check_status,
        "control_gate_block_reason": o.control_gate_block_reason,
        "deposit_required": str(o.deposit_required) if o.deposit_required is not None else None,
        "deposit_collected": str(o.deposit_collected) if o.deposit_collected is not None else None,
        "deposit_held_until": _iso(o.deposit_held_until),
        "payment_method_id": str(o.payment_method_id) if o.payment_method_id else None,
        "deposit_payment_id": str(o.deposit_payment_id) if o.deposit_payment_id else None,
        "install_substage": o.install_substage,
        "install_substage_at": _iso(o.install_substage_at),
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
        select(OrderItem).where(OrderItem.order_id == order_id)  # noqa: tenant-filter cross-tenant — helper; caller validates order tenant via _get_order
    )).scalars().all())


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
        await workflow.emit(s, user.tenant_id, "CREATE", "subscription", sub.id, user.id,
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


async def _create_customer_from_lead(s: AsyncSession, user: User, order: Order) -> Record | None:
    """Iron rule: at ACTIVATION an order born from a lead conversion (order.lead_id) creates its
    CUSTOMER — the customer joins the active base here, never earlier. Carries the lead's identity
    (intersection of lead.data with the customer entity's fields — invents nothing). Returns the new
    customer Record, or None if the lead is missing.
    """
    lead = (await s.execute(
        select(Record).where(Record.id == order.lead_id, Record.tenant_id == user.tenant_id,
                             Record.entity_key == "lead")
    )).scalar_one_or_none()
    if lead is None:
        return None
    cust_ent = await _entity(s, user.tenant_id, "customers")
    cust_field_keys = {f.key for f in await _fields(s, cust_ent.id) if f.type != "status"}
    lead_data = lead.data or {}
    cust_data = {k: lead_data[k] for k in cust_field_keys if k in lead_data}
    cust_data["source_lead_id"] = str(lead.id)
    cust_data["source_order_id"] = str(order.id)
    cust_data["ref"] = await next_reference_number(s, tenant_id=user.tenant_id, prefix="CUS")
    customer = Record(
        tenant_id=user.tenant_id, entity_key=cust_ent.key,
        owner_node_id=order.owner_node_id,
        status="active",                                                # active base member (not a stage)
        data=cust_data,
    )
    s.add(customer)
    await s.flush()
    # back-link the lead → customer for the full lead → order → customer trail
    lead.data = {**lead_data, "converted_customer_id": str(customer.id)}
    await workflow.emit(s, user.tenant_id, "CREATE", "customer", customer.id, user.id,
                        {"data": cust_data, "status": "active", "from_order": str(order.id),
                         "from_lead": str(lead.id)})
    return customer


async def _create_care_checkcall_task(s: AsyncSession, user: User, order: Order, customer: Record) -> None:
    """Iron rule (the S14 replacement): at ACTIVATION an auto-task FORCES the Customer-Care welcome /
    quality check-call ("services activated? were our people polite?"). Owner + assignee = the
    Customer Care role; parent-linked to the new customer. Skipped (never silently wrong) if the tenant
    has no customer_care role to own it.
    """
    cc = (await s.execute(
        select(RoleDef).where(RoleDef.tenant_id == user.tenant_id, RoleDef.key == "customer_care")
    )).scalar_one_or_none()
    if cc is None:
        return
    name = (customer.data or {}).get("name") or order.number
    ref = await next_reference_number(s, tenant_id=user.tenant_id, prefix="TSK", width=6)
    task = Task(
        tenant_id=user.tenant_id,
        reference_number=ref,
        title=f"Welcome / activation check-call — {name}",
        task_type="CALL_CUSTOMER",
        task_scope="OBJECT_LINKED",
        status="OPEN",
        priority="MEDIUM",
        parent_entity_type="customer",
        parent_entity_id=customer.id,
        owner_type="ROLE", owner_id=cc.id,
        assignee_type="ROLE", assignee_id=cc.id,
        sla_status="NOT_APPLICABLE",
        created_by=user.id,
    )
    s.add(task)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "CREATE", "task", task.id, user.id,
                        {"reference_number": ref, "task_type": "CALL_CUSTOMER",
                         "for_customer": str(customer.id), "from_order": str(order.id)})


# --- order.activated event choreography (PERFECT-TARGET I3) -----------------------------------------
# At ACTIVATION the order publishes `order.activated`; the CRM / Care / Billing domains each subscribe
# and react. orders.advance no longer hand-calls them — it publishes. (Handlers live here for now; the
# follow-up relocates each to its own domain service so orders.py knows nothing about them.)

async def _on_activated_crm(s: AsyncSession, *, order: Order, user: User):
    """CRM domain: the customer joins the active base — created from the lead if the order has none yet."""
    cust = None
    if order.customer_id:
        cust = (await s.execute(
            select(Record).where(Record.id == order.customer_id, Record.tenant_id == user.tenant_id,
                                 Record.entity_key == "customer")
        )).scalar_one_or_none()
    elif order.lead_id:
        cust = await _create_customer_from_lead(s, user, order)
        if cust is not None:
            order.customer_id = cust.id
    if cust is not None and cust.status != "active":
        cust.status = "active"
    return cust


async def _on_activated_care(s: AsyncSession, *, order: Order, user: User):
    """Customer-Care domain: the welcome / quality check-call auto-task on the new active customer."""
    if not order.customer_id:
        return None
    cust = (await s.execute(
        select(Record).where(Record.id == order.customer_id, Record.tenant_id == user.tenant_id,
                             Record.entity_key == "customer")
    )).scalar_one_or_none()
    if cust is not None:
        await _create_care_checkcall_task(s, user, order, cust)
    return None


async def _on_activated_billing(s: AsyncSession, *, order: Order, user: User) -> list[str]:
    """Billing domain: provision ACTIVE subscriptions for the order's product lines."""
    items = await _items(s, order.id)
    return await _provision_subscriptions(s, user, order, items)


# Registration order matters: CRM sets order.customer_id, which Care + Billing then read.
events.subscribe("order.activated", "crm.activate_customer", _on_activated_crm)
events.subscribe("order.activated", "care.welcome_task", _on_activated_care)
events.subscribe("order.activated", "billing.provision", _on_activated_billing)


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

    number = await next_reference_number(s, tenant_id=user.tenant_id, prefix="ORD", width=5)
    order = Order(tenant_id=user.tenant_id, owner_node_id=user.primary_node_id,
                  customer_id=customer_id, number=number, status=ORDER_INITIAL, total=0)
    s.add(order)
    await s.flush()
    order.total = await _replace_items(s, user, order, payload.get("items") or [])
    await workflow.emit(s, user.tenant_id, "CREATE", "order", order.id, user.id,
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
    if order.status != ORDER_EDITABLE:
        raise HTTPException(409, f"Only an unvalidated ({ORDER_EDITABLE}) order can be edited (status is {order.status})")

    if "customer_id" in payload:
        await _customer_or_422(s, user.tenant_id, payload["customer_id"])
        order.customer_id = payload["customer_id"]
    if "items" in payload:
        order.total = await _replace_items(s, user, order, payload["items"])

    await workflow.emit(s, user.tenant_id, "UPDATE", "order", order.id, user.id, {"total": order.total})
    await s.commit()
    await s.refresh(order)
    return _order(order, await _items(s, order.id))


# ---- lifecycle ----

async def _set_status(s, user: User, order: Order, frm: str, to: str):
    # PERFECT-TARGET I3 — the order transitions through the SHARED transition kernel
    # (`workflow.complete_transition`), the same primitive Records and convert.py use. The order is the
    # "OrderAdapter": it quacks like a record (`.id` + `.status`). One transition path for every entity;
    # the kernel sets status, emits the TRANSITION Event, and runs any on-enter actions configured on
    # the order WorkflowDef (the seam where activation side-effects become config actions in a later
    # phase). Falls back to a synthesized transition when the (from→to) isn't declared in config.
    try:
        order_ent = await _entity(s, user.tenant_id, "orders")
        _trs = await workflow.get_transitions(s, order_ent.id)
    except HTTPException:
        _trs = None
    if _trs is not None:
        tr = workflow.find_transition(_trs, frm, to) or {"from": frm, "to": to}
        await workflow.complete_transition(s, tenant_id=user.tenant_id, entity_key="order",
                                           record=order, transition=tr, actor_user_id=user.id)
    else:
        # Transitional fallback: the order entity config (entity_def/WorkflowDef) isn't present in this
        # environment (e.g. the minimal test seed). Apply the transition directly. Drops once the order's
        # config is guaranteed in every env (PERFECT-TARGET I2/I6 — order fully participates in config).
        order.status = to
        await workflow.emit(s, user.tenant_id, "TRANSITION", "order", order.id, user.id, {"from": frm, "to": to})


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
    if order.status != ORDER_INITIAL:
        raise HTTPException(409, f"Only a new ({ORDER_INITIAL}) order can be submitted (status is {order.status})")
    await _set_status(s, user, order, ORDER_INITIAL, "order_validated")
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

    # Config-driven stage sequence: the next forward stage comes from the order entity's WorkflowDef
    # transitions (config), falling back to the canonical chain where that config isn't present/correct.
    # "cancelled" is an off-ramp, never the forward step.
    try:
        order_ent = await _entity(s, user.tenant_id, "orders")
        _trs = await workflow.get_transitions(s, order_ent.id)
    except HTTPException:
        _trs = []
    _forwards = [t.get("to") for t in _trs if t.get("from") == order.status and t.get("to") != "cancelled"]
    nxt = _forwards[0] if _forwards else _FORWARD_FALLBACK.get(order.status)
    if not nxt:
        raise HTTPException(409, f"Cannot advance an order in status {order.status}")

    frm = order.status

    # SPEC §3 / §10.4 — Stage 8 Control Gate, now CONFIG-DECLARED (PERFECT-TARGET I3): the
    # order_validated→scheduling transition references `guard: control_gate:stage8`; the Revenue-Control
    # implementation runs from NAMED_GUARDS. The canonical-fire fallback (frm==ORDER_GATE_FROM →
    # ORDER_GATE_TO) keeps the revenue safety from EVER silently disappearing if the config guard is
    # absent (e.g. minimal test seed). Behaviour identical to the prior inline check.
    _tr = workflow.find_transition(_trs, frm, nxt) if _trs else None
    _guard = (_tr or {}).get("guard")
    if _guard == "control_gate:stage8" or (not _guard and frm == ORDER_GATE_FROM and nxt == ORDER_GATE_TO):
        _ok, _reason = await control_gate_stage8(s, order)
        if not _ok:
            raise HTTPException(status_code=409, detail=_reason)

    await _set_status(s, user, order, frm, nxt)

    provisioned: list[str] = []
    if nxt == ORDER_PROVISION_AT:
        # PERFECT-TARGET I3 — ACTIVATION is event choreography: the order publishes `order.activated`
        # and the CRM (create+activate customer) · Care (welcome check-call task) · Billing (provision
        # subscriptions) domains react independently, in the same transaction. orders.advance no longer
        # hand-calls them. The provisioned list comes back from the Billing subscriber for the response.
        _react = await events.publish(s, "order.activated", order=order, user=user)
        provisioned = _react.get("billing.provision") or []
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
    if nxt == ORDER_PROVISION_AT:
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
    if order.status in (ORDER_PROVISION_AT, "cancelled"):
        raise HTTPException(409, f"Cannot cancel an order in status {order.status}")
    frm = order.status
    await _set_status(s, user, order, frm, "cancelled")
    await s.commit()
    await s.refresh(order)
    return _order(order, await _items(s, order.id))


# ==========================================================================================
# Phase B.1 — Stage 8 Control Gate + deposit collection
# ==========================================================================================


async def _require_admin_or_order_edit(
    s: AsyncSession, user: User, order: Order,
) -> None:
    """Stage 8 mutators are admin-gated. Accept ``order.edit`` (existing scope) or
    ``config.manage`` (super_admin)."""
    grants = await load_grants(s, user)
    if can(grants, "order", "edit", await _node_path(s, order.owner_node_id)) or \
       can(grants, "config", "manage"):
        return
    _deny("order.edit")


def _parse_decimal(value, field: str) -> Decimal:
    """Coerce an incoming amount to Decimal; 422 on garbage. Used for deposit amounts (which
    are Decimal AMD, not luma integers — the collection desk thinks in whole ֏)."""
    if value is None:
        raise HTTPException(422, f"'{field}' is required")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise HTTPException(422, f"'{field}' must be a decimal number")


@router.post("/orders/{order_id}/stage8-check")
async def stage8_check(
    order_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Run the Stage 8 Control Gate predicate read-only.

    Does NOT mutate the order. Returns the structured per-check status so the UI can render
    the "Stage 8 status" panel. Auth: order.view (anyone who can see the order can check it).
    """
    order = await _get_order(s, user, order_id)
    grants = await load_grants(s, user)
    if not can(grants, "order", "view", await _node_path(s, order.owner_node_id)):
        _deny("order.view")
    return await compute_stage8_status(s, order.id)


@router.post("/orders/{order_id}/stage8-apply")
async def stage8_apply(
    order_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Compute Stage 8 + persist the verdict to the order.

    Writes ``control_pass``, ``control_pass_at``, ``control_pass_by`` + ``control_gate_block_reason``.
    Admin-gated (Stage 8 verdict is a Revenue Control decision). Idempotent: re-running on the
    same inputs produces the same result.
    """
    order = await _get_order(s, user, order_id)
    await _require_admin_or_order_edit(s, user, order)
    await _owner_gate(s, table_name="order", writer_module="Orders")

    await apply_stage8_result(s, order.id, actor_id=user.id)
    await s.commit()
    await s.refresh(order)

    # Return the order snapshot + the fresh predicate (handy for the UI without a second call).
    result = _order(order, await _items(s, order.id))
    result["stage8"] = await compute_stage8_status(s, order.id)
    result["control_pass"] = order.control_pass
    result["control_gate_block_reason"] = order.control_gate_block_reason
    return result


@router.post("/orders/{order_id}/release")
async def release_order(
    order_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Advance ``Order.status`` from SUBMITTED → PROVISIONING after enforcing Stage 8.

    Calls ``apply_stage8_result`` first to refresh the verdict, then refuses with 409 +
    ``control_gate_block_reason`` if the gate is closed. Admin-gated.
    """
    order = await _get_order(s, user, order_id)
    await _require_admin_or_order_edit(s, user, order)
    await _owner_gate(s, table_name="order", writer_module="Orders")

    if order.status != ORDER_GATE_FROM:
        raise HTTPException(
            409,
            f"Only an {ORDER_GATE_FROM} order can be released through the gate (status is {order.status})",
        )

    # Run the predicate fresh + persist the verdict (idempotent).
    await apply_stage8_result(s, order.id, actor_id=user.id)
    await s.flush()

    if not order.control_pass:
        raise HTTPException(
            409,
            f"Stage 8 Control Gate not passed: {order.control_gate_block_reason}",
        )

    await _set_status(s, user, order, ORDER_GATE_FROM, ORDER_GATE_TO)
    await s.commit()
    await s.refresh(order)
    return _order(order, await _items(s, order.id))


@router.post("/orders/{order_id}/collect-deposit")
async def collect_deposit(
    order_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Record a deposit collection against the order.

    Body:
      ``amount`` (decimal, required — Decimal AMD, NOT luma)
      ``payment_method_id`` (uuid, optional — when present, simulate a charge through
                              ``LoggingGateway.charge`` and tag the resulting Payment.note)

    Creates a Payment row with:
      * ``method='card'``
      * ``invoice_id=NULL`` (deposits exist BEFORE any invoice for the order)
      * ``customer_id`` + ``account_id`` copied from the order
      * ``note`` carrying the deposit marker + (when card-charged) the synthetic charge_id

    Links the order via ``deposit_payment_id`` (FIRST collection only — subsequent collections
    accumulate ``deposit_collected`` but the link points at the FIRST payment). Updates
    ``deposit_collected += amount``. Admin-gated.
    """
    order = await _get_order(s, user, order_id)
    await _require_admin_or_order_edit(s, user, order)
    await _owner_gate(s, table_name="order", writer_module="Orders")

    amount = _parse_decimal(payload.get("amount"), "amount")
    if amount <= Decimal("0"):
        raise HTTPException(422, "'amount' must be > 0")

    # Optional payment_method_id → simulate the charge through the gateway adapter.
    payment_method_id_raw = payload.get("payment_method_id")
    pm: PaymentMethod | None = None
    charge_marker: str | None = None
    if payment_method_id_raw is not None:
        try:
            pm_uuid = uuid.UUID(str(payment_method_id_raw))
        except ValueError:
            raise HTTPException(422, "'payment_method_id' is not a valid UUID")
        pm = (await s.execute(
            select(PaymentMethod).where(
                PaymentMethod.id == pm_uuid,
                PaymentMethod.tenant_id == user.tenant_id,
            )
        )).scalar_one_or_none()
        if pm is None:
            raise HTTPException(422, "payment_method_id does not reference a known payment method")
        if pm.status != "active":
            raise HTTPException(409, f"payment method status is {pm.status!r}, expected 'active'")

        gw = get_payment_gateway()
        # Deposit amount in cents — Decimal AMD × 100, rounded down to int.
        amount_cents = int(Decimal(amount) * 100)
        charge_result = await gw.charge(
            gateway_token=pm.gateway_token,
            amount_cents=amount_cents,
            currency="AMD",
            description=f"Deposit for order {order.number}",
        )
        charge_marker = charge_result.get("charge_id")
        pm.last_used_at = _now()

    # Persist the Payment row. amount is stored in luma (BigInteger) per billing.py contract:
    # Decimal AMD → luma = int(amount * 100). The deposit marker + synthetic charge_id live in
    # `note` so reads can identify deposit rows + correlate to the gateway charge.
    note_parts = [f"deposit:order:{order.id}"]
    if charge_marker is not None:
        note_parts.append(f"gateway_charge_id={charge_marker}")
    note = " | ".join(note_parts)

    deposit_payment = Payment(
        tenant_id=user.tenant_id,
        invoice_id=None,  # deposits exist before any invoice
        amount=int(Decimal(amount) * 100),
        method="card",
        customer_id=order.customer_id,
        account_id=order.account_id,
        note=note,
    )
    s.add(deposit_payment)
    await s.flush()

    # Accumulate the deposit_collected total + link the FIRST payment.
    current = Decimal(order.deposit_collected) if order.deposit_collected is not None else Decimal("0")
    order.deposit_collected = current + amount
    if order.deposit_payment_id is None:
        order.deposit_payment_id = deposit_payment.id

    await workflow.emit(
        s, user.tenant_id, "collect_deposit", "order", order.id, user.id,
        {"amount": str(amount), "payment_id": str(deposit_payment.id),
         "gateway_charge_id": charge_marker},
    )
    await s.commit()
    await s.refresh(order)
    return {
        "order": _order(order, await _items(s, order.id)),
        "payment_id": str(deposit_payment.id),
        "deposit_collected": str(order.deposit_collected),
        "deposit_required": str(order.deposit_required) if order.deposit_required is not None else None,
        "gateway_charge_id": charge_marker,
    }
