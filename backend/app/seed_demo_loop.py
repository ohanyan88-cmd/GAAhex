"""Demo-loop seed — stand up ONE believable sample customer with the WHOLE daily loop already run,
so a fresh boot demonstrates a real ISP day (docs/specs/DAILY-LOOP.md §5 "Demo-loop seed SPEC").

This is purely ADDITIVE business data on top of the three config seeders in `seed.py`
(`seed_if_empty` + `seed_meta_if_empty` + `seed_access_if_empty`). It inserts data rows only
(a Product, a Customer Record, an Order, a Subscription, a Service, an Invoice + Payment, a Ticket),
linked by the same real foreign keys the live endpoints use, and REUSES the live flows/helpers
rather than duplicating their logic:

  - `routers.services.provision_service_for_subscription` — the order→subscription→service hook
    (called with status="ACTIVE" so the demo shows a live service, not PENDING).
  - `routers.billing._now` / `_add_cycle` — the same time + cycle math billing uses.
  - `workflow.emit` — the same audit chokepoint, so Customer 360's `activity` / `/history` populate.

Runs as OWNER (RLS-bypass) exactly like the other `*_if_empty` seeders — seeding is a privileged
boot-time op. It must be called from `main.py`'s lifespan AFTER the three config seeders.

IDEMPOTENT: guarded on Subscription emptiness (the loop's centre of gravity). A second boot finds a
subscription and returns immediately, creating nothing. It also no-ops cleanly (returns) if the
config seeders haven't run yet — no Tenant, no `customer` EntityDef, etc. — rather than raising.

Money is integer luma (AMD minor units, 1 ֏ = 100 luma).
"""
from sqlalchemy import select, func

from .db import OwnerSessionLocal as SessionLocal   # seeding runs privileged (bypasses RLS)
from .models import Tenant, OrgNode, User, EntityDef, Record
from .models.product import Product
from .models.order import Order, OrderItem
from .models.billing import Subscription, Invoice, InvoiceLine, Payment
from . import workflow
from .routers.billing import _now, _add_cycle        # reuse the live billing time/cycle math
from .routers.services import provision_service_for_subscription  # reuse the order→service hook

# The marker name the emptiness guard keys off — a believable Armenian ISP customer.
DEMO_CUSTOMER_NAME = "Արամ Հակոբյան"
DEMO_PRODUCT_KEY = "home-100"


async def seed_demo_loop_if_empty() -> dict | None:
    """Stand up ONE end-to-end loop for the demo tenant, only if no loop exists yet.

    Guard: returns immediately (creating nothing) if ANY Subscription row already exists — that is
    the loop's centre of gravity, so this is the idempotency marker. Also returns cleanly if the
    config seeders haven't run (no Tenant / no `customer` entity / no group node).

    Builds, linked by the real FKs that mirror the live chain:
      1. a Product (if the catalog is empty),
      2. an ACTIVE Customer Record (Armenian ISP customer),
      3. a COMPLETED Order with one product-bearing line,
      4. an ACTIVE Subscription (mirrors orders.py::_provision_subscriptions),
      5. an ACTIVE Service (via provision_service_for_subscription, status="ACTIVE"),
      6. one ISSUED→PAID Invoice (+ a Payment covering it in full),
      7. one open Ticket Record.

    Emits the same audit Events the live endpoints emit, so Customer 360 activity is populated.
    Returns a dict of the created ids (or None if it no-op'd).
    """
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
        # --- idempotency guard: a single existing subscription means the loop already ran ---
        if (await s.execute(select(func.count()).select_from(Subscription))).scalar_one():
            return None

        # --- resolve the demo tenant + group node the same way seed_access_if_empty does ---
        tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            return None                                   # config seeders haven't run
        group = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id, OrgNode.code == "grp")
        )).scalar_one_or_none()
        if not group:
            return None
        owner_node_id = group.id

        # config seeders must have built the CRM entities (we insert Records, not the config itself)
        cust_ent = (await s.execute(
            select(EntityDef).where(EntityDef.tenant_id == tenant.id, EntityDef.key == "customer")
        )).scalar_one_or_none()
        ticket_ent = (await s.execute(
            select(EntityDef).where(EntityDef.tenant_id == tenant.id, EntityDef.key == "ticket")
        )).scalar_one_or_none()
        if not cust_ent or not ticket_ent:
            return None

        # the demo admin is the actor on every audit Event (same user the config seed creates)
        admin = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one_or_none()
        actor_id = admin.id if admin else None

        now = _now()

        # --- 1. Product (reuse the catalog if it already has one; else create the demo plan) ---
        product = (await s.execute(
            select(Product).where(Product.tenant_id == tenant.id).order_by(Product.created_at)
        )).scalars().first()
        if not product:
            product = Product(
                tenant_id=tenant.id, key=DEMO_PRODUCT_KEY, name="Home 100 Mbps",
                description="Residential fibre, 100 Mbps", default_amount=1_500_000,  # ֏15,000 in luma
                cycle="monthly", active=True,
            )
            s.add(product)
            await s.flush()
            await workflow.emit(s, tenant.id, "create", "product", product.id, actor_id,
                                {"key": product.key, "name": product.name})

        # --- 2. Customer Record (ACTIVE) ---
        customer = Record(
            tenant_id=tenant.id, entity_key="customer", owner_node_id=owner_node_id, status="ACTIVE",
            data={"name": DEMO_CUSTOMER_NAME, "email": "aram.hakobyan@example.am",
                  "phone": "+374 99 123456", "plan": "Pro"},
        )
        s.add(customer)
        await s.flush()
        await workflow.emit(s, tenant.id, "create", "customer", customer.id, actor_id,
                            {"data": customer.data, "status": customer.status})

        # --- 3. COMPLETED Order with one product-bearing line (mirrors orders.py numbering) ---
        line_total = product.default_amount  # quantity 1 * unit_amount
        order_n = (await s.execute(
            select(func.count()).select_from(Order).where(Order.tenant_id == tenant.id)
        )).scalar_one()
        order = Order(
            tenant_id=tenant.id, owner_node_id=owner_node_id, customer_id=customer.id,
            number=f"ORD-{order_n + 1:05d}", status="COMPLETED", total=line_total,
        )
        s.add(order)
        await s.flush()
        s.add(OrderItem(
            tenant_id=tenant.id, order_id=order.id, product_id=product.id,
            description=product.name, quantity=1, unit_amount=product.default_amount,
            line_total=line_total,
        ))
        await workflow.emit(s, tenant.id, "create", "order", order.id, actor_id,
                            {"number": order.number, "total": order.total, "status": "COMPLETED"})

        # --- 4. ACTIVE Subscription (mirror orders.py::_provision_subscriptions) ---
        sub = Subscription(
            tenant_id=tenant.id, owner_node_id=owner_node_id, customer_id=customer.id,
            product_id=product.id, plan_name=product.name, amount=product.default_amount,
            cycle=product.cycle, status="ACTIVE", started_at=now,
            next_invoice_at=_add_cycle(now, product.cycle),
        )
        s.add(sub)
        await s.flush()
        await workflow.emit(s, tenant.id, "create", "subscription", sub.id, actor_id,
                            {"plan_name": sub.plan_name, "amount": sub.amount, "from_order": str(order.id)})

        # --- 5. ACTIVE Service (REUSE the order→service hook, forced live) ---
        svc = await provision_service_for_subscription(
            s, tenant_id=tenant.id, subscription=sub, owner_node_id=owner_node_id,
            customer_id=customer.id, actor_user_id=actor_id, status="ACTIVE",
        )

        # --- 6. ISSUED → PAID Invoice + a Payment covering it in full ---
        invoice_n = (await s.execute(
            select(func.count()).select_from(Invoice).where(Invoice.tenant_id == tenant.id)
        )).scalar_one()
        period_start = sub.started_at
        period_end = _add_cycle(period_start, sub.cycle)
        invoice = Invoice(
            tenant_id=tenant.id, owner_node_id=owner_node_id, customer_id=customer.id,
            number=f"INV-{invoice_n + 1:05d}", period_start=period_start, period_end=period_end,
            status="PAID", total=sub.amount, issued_at=now,
            due_at=_add_cycle(now, "monthly"),
        )
        s.add(invoice)
        await s.flush()
        s.add(InvoiceLine(
            tenant_id=tenant.id, invoice_id=invoice.id, kind="charge", description=sub.plan_name,
            quantity=1, unit_amount=sub.amount, line_total=sub.amount,
        ))
        await workflow.emit(s, tenant.id, "create", "invoice", invoice.id, actor_id,
                            {"number": invoice.number, "total": invoice.total, "status": "ISSUED",
                             "from_subscription": str(sub.id)})
        payment = Payment(
            tenant_id=tenant.id, invoice_id=invoice.id, amount=invoice.total, method="card",
            paid_at=now, note="Demo seed: invoice paid in full",
        )
        s.add(payment)
        await s.flush()
        await workflow.emit(s, tenant.id, "payment", "invoice", invoice.id, actor_id,
                            {"payment_id": str(payment.id), "amount": payment.amount, "method": "card",
                             "paid_sum": invoice.total, "invoice_status": "PAID"})

        # --- 7. one open Ticket Record ---
        ticket = Record(
            tenant_id=tenant.id, entity_key="ticket", owner_node_id=owner_node_id, status="OPEN",
            data={"subject": "Slow speeds in the evening", "priority": "Normal",
                  "customer": str(customer.id)},
        )
        s.add(ticket)
        await s.flush()
        await workflow.emit(s, tenant.id, "create", "ticket", ticket.id, actor_id,
                            {"data": ticket.data, "status": ticket.status})

        await s.commit()

        return {
            "tenant_id": str(tenant.id),
            "product_id": str(product.id),
            "customer_id": str(customer.id),
            "order_id": str(order.id),
            "subscription_id": str(sub.id),
            "service_id": str(svc.id),
            "invoice_id": str(invoice.id),
            "payment_id": str(payment.id),
            "ticket_id": str(ticket.id),
        }
