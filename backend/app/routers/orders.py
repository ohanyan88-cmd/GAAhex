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
from ..models import User
from ..models.order import Order, OrderItem
from ..models.billing import Payment
from ..models.payment_method import PaymentMethod
from ..models.product import Product
from ..access import load_grants, can
from ..kernel import (
    assert_can, AccessDenied,
    assert_writer_owns_record_firstclass, OwnerViolation,
)
from .. import workflow
from ..services.payment_gateway_adapter import get_payment_gateway
from ..services.stage8_gate import compute_stage8_status, apply_stage8_result
from ..utils.refnum import next_reference_number
from .auth import current_user
from .records import _node_path, _node_paths, _entity  # reuse the exact records scope primitives
from .billing import _money, _now, _customer_or_422, _deny   # reuse billing helpers (DRY)

router = APIRouter(prefix="/api", tags=["orders"])

# Order lifecycle = the fulfillment half of the Customer Lifecycle SST
# (frontend/src/lib/lifecycle.ts LIFECYCLE_STAGES, stages 6-13). Single source of truth — the
# order does NOT carry its own parallel status vocabulary anymore (the legacy
# DRAFT/SUBMITTED/PROVISIONING/COMPLETED set was deleted 2026-06-11). Kept in sync with the SST.
ORDER_INITIAL = "ORDER_CREATED"           # SST #6 — created from a contract-signed lead
ORDER_EDITABLE = ORDER_INITIAL            # only an unvalidated order can be edited



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
        select(OrderItem).where(OrderItem.order_id == order_id)  # tenant-filter-ok: cross-tenant — helper; caller validates order tenant via _get_order
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

async def _set_status(s, user: User, order: Order, frm: str, to: str) -> dict:
    # PERFECT-TARGET I3 — the order transitions through the SHARED transition kernel
    # (`workflow.complete_transition`), the same primitive Records and convert.py use. The order is the
    # "OrderAdapter": it quacks like a record (`.id` + `.status`). One transition path for every entity;
    # the kernel sets status, emits the TRANSITION Event, runs any on-enter actions, and fires the
    # transition's config-declared `publish` domain event (e.g. activation → `order.activated`). The
    # publish context carries the order + user so the CRM/Care/Billing subscribers have what they need.
    # Returns the choreography reactions ({handler_name: result}, e.g. {"billing.provision": [...]}); {}
    # for transitions that declare no `publish`. Falls back to a direct set when the order config is
    # absent (minimal env) — no choreography there.
    try:
        order_ent = await _entity(s, user.tenant_id, "orders")
        _trs = await workflow.get_transitions(s, order_ent.id)
    except HTTPException:
        _trs = None
    if _trs is not None:
        tr = workflow.find_transition(_trs, frm, to) or {"from": frm, "to": to}
        result = await workflow.complete_transition(
            s, tenant_id=user.tenant_id, entity_key="order", record=order, transition=tr,
            actor_user_id=user.id, publish_context={"order": order, "user": user})
        return (result or {}).get("reactions") or {}
    # Transitional fallback: the order entity config (entity_def/WorkflowDef) isn't present in this
    # environment (e.g. the minimal test seed). Apply the transition directly. Drops once the order's
    # config is guaranteed in every env (PERFECT-TARGET I2/I6 — order fully participates in config).
    order.status = to
    await workflow.emit(s, user.tenant_id, "TRANSITION", "order", order.id, user.id, {"from": frm, "to": to})
    return {}


async def _apply_order_transition(s, user: User, order: Order, to: str) -> dict:
    """Config-driven order stage move — the single decision point shared by the unified `/transition`
    route (explicit ``{to}``). Resolve the legal ``{from→to}`` edge from the order WorkflowDef, evaluate
    its guard (named, e.g. ``control_gate:stage8``, or GXL) via the SHARED kernel evaluator (the same
    one the generic Record endpoint uses), then apply it through ``_set_status`` (which fires the
    transition's config-declared ``publish`` choreography). Returns the choreography reactions. Raises
    409 for an undefined edge or a blocked named gate, 422 for a failed GXL guard. NO hardcoded business
    logic — every decision is read from config."""
    order_ent = await _entity(s, user.tenant_id, "orders")
    trs = await workflow.get_transitions(s, order_ent.id)
    tr = workflow.find_transition(trs, order.status, to)
    if not tr:
        raise HTTPException(409, f"No transition from '{order.status}' to '{to}'")
    guard = tr.get("guard")
    if guard:
        ok, reason = await workflow.evaluate_guard(s, entity_id=order_ent.id, record=order, guard=guard)
        if not ok:
            raise HTTPException(409 if workflow.is_named_guard(guard) else 422,
                                reason or f"Guard blocked {order.status} -> {to}")
    return await _set_status(s, user, order, order.status, to)


@router.post("/orders/{order_id}/transition")
async def transition_order(order_id: uuid.UUID, payload: dict, user: User = Depends(current_user),
                           s: AsyncSession = Depends(get_session)):
    """Unified config-driven order stage move — the SAME contract as the generic
    ``POST /api/{slug}/{id}/transition`` (a ``{to}`` body), for the first-class Order. NO hardcoded
    stage chain and NO per-verb endpoints: the legal edge, its guard (named, e.g. ``control_gate:stage8``),
    and its on-enter ``publish`` (the ``order.activated`` choreography) all come from the order
    WorkflowDef config. This is the surface the frontend points at; submit/advance/cancel/release
    collapse into it (one ``{to}`` per move)."""
    to = payload.get("to")
    if not to:
        raise HTTPException(422, "Missing 'to' status")
    order = await _get_order(s, user, order_id)
    grants = await load_grants(s, user)
    if not can(grants, "order", "edit", await _node_path(s, order.owner_node_id)):
        _deny("order.edit")
    # SPEC §0.1 single-owner (first-class) — only Orders may write order.
    await _owner_gate(s, table_name="order", writer_module="Orders")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="order",
                         region_id=getattr(order, "region_id", None), owner_user_id=order.control_pass_by)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    reactions = await _apply_order_transition(s, user, order, to)
    provisioned = reactions.get("billing.provision") or []
    await s.commit()
    await s.refresh(order)
    result = _order(order, await _items(s, order.id))
    if provisioned:
        result["provisioned_subscriptions"] = provisioned
    return result


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
