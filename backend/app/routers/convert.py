"""Lead → Customer conversion (the first glue gap in the ISP daily loop).

`POST /api/leads/{lead_id}/convert` turns a qualified lead into a Customer Record in ONE call:
it copies the sensible fields the lead shares with the customer entity, links the two records both
ways (in JSONB `data`, no new columns), moves the lead to its CONVERTED terminal via the same
workflow status-set path records.py uses, and emits an audit Event. The whole thing runs in one
transaction as the normal authenticated tenant session and is **idempotent** — a second call returns
the customer already created instead of making a duplicate. Purely additive: no EntityDef/StatusDef
config change, no model change, no migration.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User, Record, StatusDef
from ..access import load_grants, can
from .. import workflow
from .auth import current_user
from .records import _entity, _get, _initial_status, _fields, _node_path

router = APIRouter(prefix="/api", tags=["convert"])

# The conventional status key a successful conversion lands the lead in. It's resolved against the
# entity's *configured* StatusDefs below (we never invent a status) — if a tenant renamed it, we
# fall back structurally to a positive terminal, so the lifecycle stays config-driven.
_CONVERTED_KEY = "CONVERTED"
# Terminals that are NOT a conversion outcome — excluded from the structural fallback so we never
# accidentally land a "converted" lead in a loss state.
_LOSS_KEYS = {"LOST", "CHURNED", "REJECTED", "CANCELLED"}


async def _converted_status(s: AsyncSession, entity_id) -> str | None:
    """The lifecycle status a successful conversion lands the lead in, read from config.

    Prefer the conventional CONVERTED key when the entity actually defines it; otherwise fall back to
    a *positive* terminal status (one that is never a transition `from`, and isn't a known loss key).
    Returns None only for a degenerate lifecycle with no usable terminal.
    """
    statuses = (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == entity_id)
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
    """Convert a lead into a customer (idempotent). See module docstring for the full contract."""
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

    # Idempotency: a lead already linked to a customer returns that one — never a second record.
    existing = (lead.data or {}).get("converted_customer_id")
    if existing:
        return {"customer_id": existing, "lead_id": str(lead.id), "already": True}

    cust_ent = await _entity(s, user.tenant_id, "customers")
    cust_path = await _node_path(s, lead.owner_node_id)
    if not can(grants, cust_ent.key, "create", cust_path):              # we create a customer
        raise HTTPException(403, f"Not allowed: {cust_ent.key}.create")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate before customer creation.
    try:
        await assert_can(s, user, action="create", entity_key=cust_ent.key,
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # Copy only fields the customer entity actually defines (intersection with the lead's data) — so
    # we carry name/phone/email/source/address etc. when both sides have them, and invent nothing.
    cust_field_keys = {f.key for f in await _fields(s, cust_ent.id) if f.type != "status"}
    lead_data = lead.data or {}
    cust_data = {k: lead_data[k] for k in cust_field_keys if k in lead_data}
    cust_data["source_lead_id"] = str(lead.id)                           # JSONB link, not a column

    customer = Record(
        tenant_id=user.tenant_id, entity_key=cust_ent.key,
        owner_node_id=lead.owner_node_id,                               # keep the lead's org placement
        status=await _initial_status(s, cust_ent.id),
        data=cust_data,
    )
    s.add(customer)
    await s.flush()                                                      # need the new customer id

    # Back-link on the lead, then move it to the configured CONVERTED terminal via the same status-set
    # path records.py uses (workflow.complete_transition: sets status + emits a `transition` Event +
    # runs the configured on-enter actions). Reuse the configured transition when one exists.
    lead.data = {**lead_data, "converted_customer_id": str(customer.id)}
    converted = await _converted_status(s, lead_ent.id)
    if converted and lead.status != converted:
        transitions = await workflow.get_transitions(s, lead_ent.id)
        tr = workflow.find_transition(transitions, lead.status, converted) or {"from": lead.status, "to": converted}
        await workflow.complete_transition(s, tenant_id=user.tenant_id, entity_key=lead_ent.key,
                                           record=lead, transition=tr, actor_user_id=user.id)

    # Audit: a `create` Event for the new customer (so its 360 activity shows the origin) + the
    # `convert` Event on the lead, consistent with how records.py emits via workflow.emit.
    await workflow.emit(s, user.tenant_id, "create", cust_ent.key, customer.id, user.id,
                        {"data": cust_data, "status": customer.status, "converted_from_lead": str(lead.id)})
    await workflow.emit(s, user.tenant_id, "convert", lead_ent.key, lead.id, user.id,
                        {"customer_id": str(customer.id), "lead_id": str(lead.id)})

    await s.commit()
    return {"customer_id": str(customer.id), "lead_id": str(lead.id), "already": False}
