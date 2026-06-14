"""CRM domain reaction to ``order.activated`` (PERFECT-TARGET I3).

At ACTIVATION the order publishes ``order.activated`` on the kernel event bus; the CRM domain reacts
here — the customer joins the active base (created from the source lead if the order has none yet). The
customer is born HERE, never earlier (iron rule). orders.py, the publisher, knows nothing about this
handler — importing this module is what wires it.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..kernel import events
from ..models import Record, User
from ..models.meta import EntityDef, FieldDef
from ..models.order import Order
from ..utils.refnum import next_reference_number


async def create_customer_from_lead(s: AsyncSession, user: User, order: Order) -> Record | None:
    """Iron rule: at ACTIVATION an order born from a lead conversion (``order.lead_id``) creates its
    CUSTOMER. Carries the lead's identity (intersection of ``lead.data`` with the customer entity's
    fields — invents nothing). Returns the new customer Record, or None if the lead is missing."""
    lead = (await s.execute(
        select(Record).where(Record.id == order.lead_id, Record.tenant_id == user.tenant_id,
                             Record.entity_key == "lead")
    )).scalar_one_or_none()
    if lead is None:
        return None
    cust_ent = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == user.tenant_id, EntityDef.route_slug == "customers")
    )).scalar_one_or_none()
    if cust_ent is None:
        return None
    cust_fields = (await s.execute(
        select(FieldDef).where(FieldDef.entity_def_id == cust_ent.id)
    )).scalars().all()
    cust_field_keys = {f.key for f in cust_fields if f.type != "status"}
    lead_data = lead.data or {}
    cust_data = {k: lead_data[k] for k in cust_field_keys if k in lead_data}
    cust_data["source_lead_id"] = str(lead.id)
    cust_data["source_order_id"] = str(order.id)
    cust_data["ref"] = await next_reference_number(s, tenant_id=user.tenant_id, prefix="CUS")
    customer = Record(
        tenant_id=user.tenant_id, entity_key=cust_ent.key, owner_node_id=order.owner_node_id,
        status="ACTIVE",                                                # active base member (not a stage); SPEC §7 UPPER_SNAKE
        data=cust_data,
    )
    s.add(customer)
    await s.flush()
    # back-link the lead → customer for the full lead → order → customer trail
    lead.data = {**lead_data, "converted_customer_id": str(customer.id)}
    await workflow.emit(s, user.tenant_id, "CREATE", "customer", customer.id, user.id,
                        {"data": cust_data, "status": "ACTIVE", "from_order": str(order.id),
                         "from_lead": str(lead.id)})
    return customer


async def on_order_activated(s: AsyncSession, *, order: Order, user: User):
    """CRM domain: the customer joins the active base — created from the lead if the order has none yet."""
    cust = None
    if order.customer_id:
        cust = (await s.execute(
            select(Record).where(Record.id == order.customer_id, Record.tenant_id == user.tenant_id,
                                 Record.entity_key == "customer")
        )).scalar_one_or_none()
    elif order.lead_id:
        cust = await create_customer_from_lead(s, user, order)
        if cust is not None:
            order.customer_id = cust.id
    if cust is not None and cust.status != "ACTIVE":
        cust.status = "ACTIVE"   # SPEC §7 UPPER_SNAKE (active base member)
    return cust


# Registration order matters (CRM sets order.customer_id, which Care + Billing then read) — see the
# services/order_activation bootstrap, which imports CRM → Care → Billing in that order.
events.subscribe("order.activated", "crm.activate_customer", on_order_activated)
