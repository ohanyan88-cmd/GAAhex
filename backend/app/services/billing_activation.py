"""Billing domain reaction to ``order.activated`` (PERFECT-TARGET I3).

At ACTIVATION, provision an ACTIVE Subscription for each product line (the order → provision → billing
bridge, amount/cycle copied from the product), then a Service fulfilling each subscription. Items
without a product (one-off charges) and since-removed products are skipped rather than failing.
orders.py knows nothing about this handler. The publisher reads the returned subscription ids back
(events.publish returns ``{"billing.provision": [...]}``) for the API response.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..kernel import events
from ..models import User
from ..models.billing import Subscription
from ..models.order import Order, OrderItem
from ..models.product import Product


async def _order_items(s: AsyncSession, order_id) -> list[OrderItem]:
    return list((await s.execute(
        select(OrderItem).where(OrderItem.order_id == order_id)  # tenant-filter-ok: order tenant validated by the publisher (advance is order-scoped)
    )).scalars().all())


async def provision_subscriptions(s: AsyncSession, user: User, order: Order, items: list[OrderItem]) -> list[str]:
    """For each item with a product_id, create an ACTIVE Subscription (amount/cycle from the product)
    + a Service fulfilling it. Returns the created subscription ids."""
    # Lazy router imports — these date/cycle + service-provisioning helpers live in the billing/services
    # routers; importing lazily keeps this domain service free of a service↔router import cycle.
    from ..routers.billing import _now, _add_cycle
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
        # order → subscription → service: provision a Service fulfilling this subscription (fail-soft so
        # a service hiccup never blocks activation).
        try:
            from ..routers.services import provision_service_for_subscription
            await provision_service_for_subscription(
                s, tenant_id=user.tenant_id, subscription=sub, owner_node_id=order.owner_node_id,
                customer_id=order.customer_id, actor_user_id=user.id,
            )
        except Exception:
            pass
    return created


async def on_order_activated(s: AsyncSession, *, order: Order, user: User) -> list[str]:
    """Billing domain: provision ACTIVE subscriptions for the order's product lines."""
    items = await _order_items(s, order.id)
    return await provision_subscriptions(s, user, order, items)


events.subscribe("order.activated", "billing.provision", on_order_activated)
