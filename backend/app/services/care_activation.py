"""Customer-Care domain reaction to ``order.activated`` (PERFECT-TARGET I3).

The iron-rule S14 replacement: at ACTIVATION an auto-task FORCES the Customer-Care welcome / quality
check-call ("services activated? were our people polite?"). Owner + assignee = the ``customer_care``
role; parent-linked to the new customer. orders.py knows nothing about this handler.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..kernel import events
from ..models import Record, Task, User
from ..models.access import RoleDef
from ..models.order import Order
from ..utils.refnum import next_reference_number


async def create_care_checkcall_task(s: AsyncSession, user: User, order: Order, customer: Record) -> None:
    """The welcome / quality check-call auto-task. Owner + assignee = the Customer Care role; parent-
    linked to the new customer. Skipped (never silently wrong) if the tenant has no customer_care role."""
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


async def on_order_activated(s: AsyncSession, *, order: Order, user: User):
    """Customer-Care domain: the welcome / quality check-call auto-task on the new active customer."""
    if not order.customer_id:
        return None
    cust = (await s.execute(
        select(Record).where(Record.id == order.customer_id, Record.tenant_id == user.tenant_id,
                             Record.entity_key == "customer")
    )).scalar_one_or_none()
    if cust is not None:
        await create_care_checkcall_task(s, user, order, cust)
    return None


events.subscribe("order.activated", "care.welcome_task", on_order_activated)
