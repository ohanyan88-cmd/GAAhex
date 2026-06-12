"""Lead → Order conversion (iron rule 2026-06-12: lead → ORDER at ORDER_CREATED = sales done).

`POST /api/leads/{lead_id}/convert` turns a sales-complete lead into an ORDER in ONE call: it creates
the first-class order row carrying the lead's identity via `lead_id` (NO customer yet — the customer is
created later at ACTIVATION), links the two ways, and moves the lead to its terminal sales stage
`order_created` via the same workflow status-set path records.py uses. Idempotent — a second call
returns the order already created. The order is born at `order_validated` (its first fulfillment stage).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User, StatusDef
from ..models.order import Order
from ..access import load_grants, can
from .. import workflow
from .auth import current_user
from .records import _entity, _get, _node_path
from ..utils.refnum import next_reference_number

router = APIRouter(prefix="/api", tags=["convert"])

# A sales-complete lead lands at ORDER_CREATED (iron rule stage 6 — sales done; it has just spawned an
# order). Resolved against the entity's configured StatusDefs below — we never invent a status.
_CONVERTED_KEY = "order_created"
# Terminals that are NOT a conversion outcome — excluded from the structural fallback so we never
# accidentally land a converted lead in a loss state.
_LOSS_KEYS = {"lost", "terminated", "rejected", "cancelled", "LOST", "CHURNED", "REJECTED", "CANCELLED"}


async def _converted_status(s: AsyncSession, entity_id) -> str | None:
    """The lifecycle status a successful conversion lands the lead in, read from config.

    Prefer the conventional ORDER_CREATED key when the entity defines it; otherwise fall back to a
    *positive* terminal status (never a transition `from`, and not a loss key). None for a degenerate
    lifecycle with no usable terminal.
    """
    statuses = (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == entity_id)  # tenant-filter-ok: — RLS-scoped session; entity tenant validated by caller via _entity()
    )).scalars().all()
    keys = {st.key for st in statuses}
    if _CONVERTED_KEY in keys:
        return _CONVERTED_KEY
    transitions = await workflow.get_transitions(s, entity_id)
    froms = {t.get("from") for t in transitions}
    tos = {t.get("to") for t in transitions}
    terminals = [st.key for st in statuses
                 if st.key in tos and st.key not in froms and st.key.upper() not in _LOSS_KEYS]
    return terminals[0] if terminals else None


@router.post("/leads/{lead_id}/convert", status_code=201)
async def convert_lead(lead_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Convert a lead into an ORDER (idempotent). See module docstring for the full contract."""
    lead_ent = await _entity(s, user.tenant_id, "leads")
    lead = await _get(s, user.tenant_id, lead_ent.key, lead_id)          # 404 if missing / not a lead

    grants = await load_grants(s, user)
    lead_path = await _node_path(s, lead.owner_node_id)
    if not can(grants, lead_ent.key, "edit", lead_path):                 # we mutate the lead
        raise HTTPException(403, f"Not allowed: {lead_ent.key}.edit")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key=lead_ent.key,
                         region_id=getattr(lead, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # Idempotency: a lead already linked to an order returns that one — never a second order.
    existing = (lead.data or {}).get("converted_order_id")
    if existing:
        return {"order_id": existing, "lead_id": str(lead.id), "already": True}

    if not can(grants, "order", "create", lead_path):                   # we create an order
        raise HTTPException(403, "Not allowed: order.create")
    try:
        await assert_can(s, user, action="create", entity_key="order",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # Create the ORDER carrying the lead's identity via lead_id. No customer yet — the CUSTOMER is
    # created at ACTIVATION (iron rule). The order is born at its first fulfillment stage.
    number = await next_reference_number(s, tenant_id=user.tenant_id, prefix="ORD")
    order = Order(
        tenant_id=user.tenant_id,
        owner_node_id=lead.owner_node_id,                               # keep the lead's org placement
        lead_id=lead.id,
        customer_id=None,
        number=number,
        status="order_validated",                                       # SST stage 7 — order's first stage
        total=0,
    )
    s.add(order)
    await s.flush()                                                      # need the new order id

    # Back-link on the lead, then move it to ORDER_CREATED (its terminal sales stage) via the same
    # workflow path records.py uses (sets status + emits a `transition` Event + runs on-enter actions).
    lead.data = {**(lead.data or {}), "converted_order_id": str(order.id)}
    converted = await _converted_status(s, lead_ent.id)
    if converted and lead.status != converted:
        transitions = await workflow.get_transitions(s, lead_ent.id)
        tr = workflow.find_transition(transitions, lead.status, converted) or {"from": lead.status, "to": converted}
        await workflow.complete_transition(s, tenant_id=user.tenant_id, entity_key=lead_ent.key,
                                           record=lead, transition=tr, actor_user_id=user.id)

    # Audit: a `create` Event for the new order + the `convert` Event on the lead.
    await workflow.emit(s, user.tenant_id, "CREATE", "order", order.id, user.id,
                        {"number": order.number, "status": order.status, "converted_from_lead": str(lead.id)})
    await workflow.emit(s, user.tenant_id, "convert", lead_ent.key, lead.id, user.id,
                        {"order_id": str(order.id), "lead_id": str(lead.id)})

    await s.commit()
    return {"order_id": str(order.id), "lead_id": str(lead.id), "already": False}
