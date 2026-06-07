"""Dev-only bulk seeder — populate previously-sparse pages with 10 realistic Armenian-ISP
customers and their full cross-referenced tree (parties, accounts, contacts, subscriptions,
invoices, payments, tickets, work-items, sites, devices, orders, employees).

================================================================================================
PRODUCTION SAFETY — read this BEFORE touching this module.
================================================================================================

This module is GATED at the lifespan entry point by the env-var `GAAHEX_DEV_SEED`. When that
env-var is unset/empty (the default — and the only state any real deployment is configured in),
`_dev_seed_enabled()` returns False and `main.py` never calls `seed_dev_bulk_if_empty()`. The
seeder code is loaded but inert. **Production therefore stays empty-until-real** by construction:
no opt-out flag, no override — the only way to seed bulk data is to opt IN.

The doctrine:
  - Real product UIs render REAL data only — this module is REAL data in the DB (real rows,
    real FKs, real workflow events) put there ONLY in dev, ONLY when explicitly requested.
  - Idempotent: every row is tagged `data["_seed"] = "dev_bulk"` (or the marker is checked via
    the matching customer's tag for first-class BSS tables that don't have a JSONB bag), and the
    function returns immediately if it finds any existing dev_bulk row. Safe to re-run.
  - Runs as OWNER (`OwnerSessionLocal`), bypassing RLS — same pattern as the other `*_if_empty`
    seeders. Seeding is a privileged boot-time op.
  - Runs AFTER `seed_demo_loop_if_empty()` and `seed_default_records_run()` so the demo loop's
    single customer remains untagged and untouched. We ADD on top, never modify what's there.

================================================================================================
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import timedelta

from sqlalchemy import select, func

from .db import OwnerSessionLocal as SessionLocal  # privileged — bypasses RLS
from .models import (
    Tenant, OrgNode, User, EntityDef, Record,
)
from .models.party import Party, Account
from .models.product import Product
from .models.billing import Subscription, Invoice, InvoiceLine, Payment
from .models.order import Order, OrderItem
from .models.helpdesk import HelpdeskTicket
from .models.workitem import WorkItem
from .models.calendar import CalendarEvent, UserCalendar
from .models.communication import Communication
from .models.comm import Thread, Message
from . import workflow
from .routers.billing import _now, _add_cycle
from .utils.refnum import next_reference_number

_log = logging.getLogger("gaahex.seed_dev_bulk")

# Marker stored on every Record-table row this seeder inserts (the same idempotency-tag pattern
# `seed_default_records.py` uses with "starter"). First-class BSS-table rows (Subscription,
# Invoice, Payment, HelpdeskTicket, WorkItem, Order, Party, Account) don't have a JSONB bag, so
# we detect their presence via the customer Record's tag — if any dev_bulk-tagged customer
# already exists, we no-op the whole seeder up-front (see `seed_dev_bulk_if_empty`).
SEED_MARKER = "dev_bulk"


# =================================================================================================
# Dev-only guard
# =================================================================================================

def _dev_seed_enabled() -> bool:
    """Return True iff the env-var `GAAHEX_DEV_SEED` is set to a truthy value.

    This is the production safety contract. Default (env-var unset) → False → seeder never runs.
    Truthy values: "1", "true", "yes", "on" (case-insensitive). Anything else → False.
    """
    v = os.environ.get("GAAHEX_DEV_SEED", "").lower()
    return v in ("1", "true", "yes", "on")


# =================================================================================================
# Realistic Armenian-ISP data
# =================================================================================================

# ~12 customer leads (mix of individuals + orgs). We use the first ~10 by default.
CUSTOMERS = [
    # (name, kind, email, phone, plan, district, street, type)
    ("Արամ Գրիգորյան",      "individual",   "aram.grigoryan@example.am",      "+374 99 201001", "Pro",      "Կենտրոն",            "Մաշտոցի 28",     "residential"),
    ("Անի Հարությունյան",   "individual",   "ani.harutyunyan@example.am",     "+374 99 201002", "Basic",    "Արաբկիր",            "Բաղրամյան 47",   "residential"),
    ("Տիգրան Մելիքյան",     "individual",   "tigran.melikyan@example.am",     "+374 99 201003", "Pro",      "Աջափնյակ",           "Հալաբյան 19",    "residential"),
    ("Սարգսյան Լիլիթ",      "individual",   "lilit.sargsyan@example.am",      "+374 99 201004", "Pro",      "Մալաթիա-Սեբաստիա",   "Շիրազի 64",      "residential"),
    ("Հայկ Պետրոսյան",      "individual",   "hayk.petrosyan@example.am",      "+374 99 201005", "Enterprise","Շենգավիթ",           "Բագրատունյաց 3", "residential"),
    ("Մարիամ Հակոբյան",     "individual",   "mariam.hakobyan@example.am",     "+374 99 201006", "Basic",    "Դավիթաշեն",          "Դավիթաշեն 1-7",  "residential"),
    ("Erebuni IT Solutions LLC",   "organization", "info@erebuni-it.am",      "+374 10 540210", "Enterprise","Կենտրոն",           "Աբովյան 14",     "business"),
    ("Ararat Trading Group",       "organization", "office@ararat-trading.am","+374 10 522305", "Enterprise","Քանաքեռ-Զեյթուն",   "Ազատության 25",  "business"),
    ("Սայաթ-Նովա Կաֆե",            "organization", "manager@sayatnova-cafe.am","+374 10 530118","Pro",      "Կենտրոն",            "Սայաթ-Նովա 32",  "business"),
    ("Tashir Pizza HQ",            "organization", "hq@tashir-pizza.am",      "+374 10 545566", "Enterprise","Արաբկիր",           "Կոմիտաս 49",     "business"),
    ("Tumo Center for Creative Tech","organization","reception@tumo.am",     "+374 60 600000", "Enterprise","Նոր Նորք",           "Հալաբյան 16",    "business"),
    ("GG Taxi Armenia CJSC",       "organization", "ops@ggtaxi.am",           "+374 10 460460", "Pro",      "Կենտրոն",            "Տերյան 105",     "business"),
]

# Contact people, one or two per customer
CONTACT_NAMES = [
    "Դավիթ Մարտիրոսյան", "Նարինե Աբովյան", "Արթուր Բաբայան",
    "Սիրանուշ Ղազարյան", "Վահան Մուրադյան", "Սոնա Մկրտչյան",
    "Գայանե Ստեփանյան",  "Գագիկ Կարապետյան","Անահիտ Ղարիբյան",
]

# Subscription plans (luma = AMD * 100).
PLANS = [
    ("home-fiber-100", "Հոմ ֆայբեր 100 Մբիթ",   800_000),   # ֏8,000
    ("home-fiber-500", "Հոմ ֆայբեր 500 Մբիթ",   1_500_000), # ֏15,000
    ("biz-fiber-1g",   "Բիզնես ֆայբեր 1 Գբիթ",  4_500_000), # ֏45,000
    ("mobile-unl",     "Մոբայլ Անսահման",       550_000),   # ֏5,500
]

# Sites (Yerevan POPs).
SITES = [
    ("Կենտրոն POP",              "Մաշտոցի 28, Երևան",        "POP"),
    ("Արաբկիր POP",              "Կոմիտաս 49, Երևան",         "POP"),
    ("Աջափնյակ POP",             "Հալաբյան 19, Երևան",        "POP"),
    ("Շենգավիթ POP",             "Բագրատունյաց 3, Երևան",     "POP"),
    ("Մալաթիա Datacenter",      "Շիրազի 64, Երևան",           "datacenter"),
    ("Դավիթաշեն Tower",         "Դավիթաշեն 1-7, Երևան",      "tower"),
    ("Քանաքեռ-Զեյթուն POP",     "Ազատության 25, Երևան",      "POP"),
    ("Նոր Նորք POP",            "Հալաբյան 16, Երևան",         "POP"),
]

# Devices (router/switch/CPE — assigned to sites).
DEVICE_TYPES = [
    ("Router", "CPE", "RT-AC68U-"),
    ("Router", "CPE", "RT-AX88U-"),
    ("Switch", "other", "GS-108T-"),
    ("Switch", "other", "GS-724T-"),
    ("ONT",    "ONT", "GPON-ONT-"),
    ("CPE",    "CPE", "CPE-AX-"),
    ("Modem",  "modem", "DSL-2740-"),
    ("Router", "CPE", "RT-AX86U-"),
    ("Switch", "other", "GS-748T-"),
    ("ONT",    "ONT", "XGS-ONT-"),
    ("Router", "CPE", "RT-AX92U-"),
    ("CPE",    "CPE", "CPE-AC-"),
]

# Employees (operations / technicians / sales — same Armenian-name pool).
EMPLOYEES = [
    ("Արման Գալստյան",   "arman.galstyan@gaahex.am",   "Field Tech"),
    ("Ավետիսյան Աննա",   "anna.avetisyan@gaahex.am",   "Helpdesk Lead"),
    ("Սերգեյ Մինասյան",  "sergey.minasyan@gaahex.am",  "Network Engineer"),
    ("Կարինե Բադալյան",  "karine.badalyan@gaahex.am",  "Sales Manager"),
    ("Ռոբերտ Սահակյան",  "robert.sahakyan@gaahex.am",  "Field Tech"),
    ("Մարինե Գևորգյան",  "marine.gevorgyan@gaahex.am", "Billing Specialist"),
    ("Արսեն Հովհաննիսյան","arsen.hovhannisyan@gaahex.am","NOC Operator"),
    ("Նունե Թումասյան",  "nune.tumasyan@gaahex.am",    "Customer Care"),
]

# Helpdesk ticket templates (subject pool — we vary the customer / priority / status).
TICKETS = [
    ("Արագությունը երեկոյան ընկնում է", "NORMAL", "OPEN"),
    ("Անդամակցության հաշիվ", "LOW", "RESOLVED"),
    ("Չի աշխատում WiFi-ը", "HIGH", "OPEN"),
    ("Տեղափոխում նոր հասցե", "NORMAL", "IN_PROGRESS"),
    ("Գումարը մինուս է երևում", "NORMAL", "OPEN"),
    ("Կարող ենք բարձրացնել պլանը?", "LOW", "OPEN"),
    ("Չի կարողանում միանալ խաղային սերվերին", "HIGH", "IN_PROGRESS"),
    ("Շատ լատենտի խնդիր", "URGENT", "OPEN"),
    ("ONT սարքը կարմիր լույս է վառվում", "URGENT", "OPEN"),
    ("Կարող եմ նոր router ստանալ?", "LOW", "RESOLVED"),
]


# =================================================================================================
# Helpers
# =================================================================================================

def _tag(extra: dict | None = None) -> dict:
    """Return a Record-table data dict pre-tagged with the dev-bulk marker."""
    d = {"_seed": SEED_MARKER}
    if extra:
        d.update(extra)
    return d


async def _has_dev_bulk_rows(s) -> bool:
    """Return True if any record carries the dev_bulk seed marker (idempotency short-circuit)."""
    row = (await s.execute(
        select(func.count()).select_from(Record).where(
            Record.data["_seed"].astext == SEED_MARKER,
        )
    )).scalar_one()
    return row > 0


# =================================================================================================
# Main entry point
# =================================================================================================

async def seed_dev_bulk_if_empty() -> dict | None:
    """Insert the dev-bulk fixture set (idempotent — no-op on re-run).

    Returns a dict summary on first run, or None if the seeder no-ops (already seeded, or env-var
    off — though the env-var path is checked at the caller). See module docstring for the
    full safety contract.
    """
    if not _dev_seed_enabled():
        # Defense in depth — main.py also gates the call, but if anyone imports + calls this
        # directly without setting the env-var, refuse.
        _log.info("dev-bulk seeder skipped: GAAHEX_DEV_SEED not set")
        return None

    async with SessionLocal() as s:
        # Owner-session dev-seed is intentionally cross-tenant — bypass the tenant-filter audit
        # listener so the many hand-rolled BSS-table inserts here don't trip dev warnings.
        await s.connection(execution_options={"audit_tenant_filter": False})
        # ---- idempotency ----
        if await _has_dev_bulk_rows(s):
            _log.info("dev-bulk seeder skipped: dev_bulk rows already present")
            return None

        # ---- resolve tenant + owner node + actor ----
        # Anchor on the seeded admin user's tenant — that's the tenant the demo logs into and the
        # one the frontend talks to. Multiple tenants can exist (Smoke ISP, x, x, Demo ISP) from
        # test fixtures; `select(Tenant).first()` would arbitrarily pick whichever was inserted
        # first, which is rarely the demo tenant in practice. Falling back to .first() if the
        # admin row doesn't exist preserves the seed_demo_loop's behaviour.
        admin = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one_or_none()
        if admin is not None:
            tenant = (await s.execute(
                select(Tenant).where(Tenant.id == admin.tenant_id)
            )).scalar_one_or_none()
        else:
            tenant = None
        if tenant is None:
            tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            _log.info("dev-bulk seeder skipped: no tenant yet (config seeders haven't run)")
            return None
        # Use the same group node the demo-loop uses (code="grp"); fall back to admin's primary
        # node or the first node in the tenant.
        owner = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id, OrgNode.code == "grp")
        )).scalar_one_or_none()
        if not owner and admin and admin.primary_node_id:
            owner = (await s.execute(
                select(OrgNode).where(OrgNode.id == admin.primary_node_id)
            )).scalar_one_or_none()
        if not owner:
            owner = (await s.execute(
                select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.id).limit(1)
            )).scalar_one_or_none()
        owner_node_id = owner.id if owner else None
        actor_id = admin.id if admin else None

        # ---- ensure required EntityDefs exist (config seeders should already have built these) ----
        def _ent(key: str) -> EntityDef | None:
            return None  # placeholder, actual lookup is per-call below

        async def _get_ent(key: str) -> EntityDef | None:
            return (await s.execute(
                select(EntityDef).where(EntityDef.tenant_id == tenant.id, EntityDef.key == key)
            )).scalar_one_or_none()

        cust_ent    = await _get_ent("customer")
        contact_ent = await _get_ent("contact")
        site_ent    = await _get_ent("site")
        device_ent  = await _get_ent("device")
        wo_ent      = await _get_ent("work_order")
        emp_ent     = await _get_ent("employee")
        if not cust_ent:
            _log.warning("dev-bulk seeder skipped: 'customer' entity missing — run config seeders first")
            return None

        now = _now()
        summary = {
            "customers": 0, "parties": 0, "accounts": 0, "contacts": 0,
            "products": 0, "subscriptions": 0, "invoices": 0, "payments": 0,
            "tickets": 0, "workitems": 0, "sites": 0, "devices": 0,
            "orders": 0, "employees": 0,
        }

        # =========================================================================================
        # 1) Products (the catalog plans)
        # =========================================================================================
        # Re-use any existing product; only create the plans we don't yet have (matched by key).
        existing_keys = set((await s.execute(
            select(Product.key).where(Product.tenant_id == tenant.id)
        )).scalars().all())
        products_by_key: dict[str, Product] = {}
        for key, name, amount in PLANS:
            if key in existing_keys:
                p = (await s.execute(
                    select(Product).where(Product.tenant_id == tenant.id, Product.key == key)
                )).scalar_one()
            else:
                p = Product(
                    tenant_id=tenant.id, key=key, name=name,
                    description=f"{name} — dev seed", default_amount=amount,
                    cycle="monthly", active=True,
                )
                s.add(p)
                await s.flush()
                await workflow.emit(s, tenant.id, "create", "product", p.id, actor_id,
                                    {"key": p.key, "name": p.name, "amount": p.default_amount})
                summary["products"] += 1
            products_by_key[key] = p

        # =========================================================================================
        # 2) Sites (network footprint) — Record table, entity_key="site"
        # =========================================================================================
        site_ids: list[uuid.UUID] = []
        if site_ent:
            for i, (name, address, kind) in enumerate(SITES):
                rec = Record(
                    tenant_id=tenant.id, entity_key="site",
                    owner_node_id=owner_node_id, status="LIVE",
                    data=_tag({"name": name, "address": address, "kind": kind}),
                )
                s.add(rec)
                await s.flush()
                site_ids.append(rec.id)
                await workflow.emit(s, tenant.id, "create", "site", rec.id, actor_id,
                                    {"name": name, "kind": kind})
                summary["sites"] += 1

        # =========================================================================================
        # 3) Devices — Record table, entity_key="device", referencing sites
        # =========================================================================================
        if device_ent and site_ids:
            for i, (name_prefix, kind, serial_prefix) in enumerate(DEVICE_TYPES):
                rec = Record(
                    tenant_id=tenant.id, entity_key="device",
                    owner_node_id=owner_node_id, status="DEPLOYED" if i % 3 else "STOCK",
                    data=_tag({
                        "name": f"{name_prefix}-{i+1:02d}",
                        "kind": kind,
                        "serial": f"{serial_prefix}{1000 + i}",
                        # NB: the device.customer ref is optional — leave None; we'll wire some below
                    }),
                )
                s.add(rec)
                await s.flush()
                await workflow.emit(s, tenant.id, "create", "device", rec.id, actor_id,
                                    {"name": rec.data["name"], "kind": kind})
                summary["devices"] += 1

        # =========================================================================================
        # 4) Employees — Record table, entity_key="employee"
        # =========================================================================================
        if emp_ent:
            for name, email, title in EMPLOYEES:
                rec = Record(
                    tenant_id=tenant.id, entity_key="employee",
                    owner_node_id=owner_node_id, status="ACTIVE",
                    data=_tag({"name": name, "email": email, "title": title}),
                )
                s.add(rec)
                await s.flush()
                await workflow.emit(s, tenant.id, "create", "employee", rec.id, actor_id,
                                    {"name": name, "title": title})
                summary["employees"] += 1

        # =========================================================================================
        # 5) Customers + Parties + Accounts + Contacts + Subscriptions + Invoices + Payments
        #     + Orders + Helpdesk tickets + Workitems
        # =========================================================================================
        # We seed one full tree per customer.
        # `order_seq` / `invoice_seq` count from whatever is currently in the DB so numbers don't
        # collide with the demo-loop's existing INV-00001 / ORD-00001.
        order_seq = (await s.execute(
            select(func.count()).select_from(Order).where(Order.tenant_id == tenant.id)
        )).scalar_one()
        invoice_seq = (await s.execute(
            select(func.count()).select_from(Invoice).where(Invoice.tenant_id == tenant.id)
        )).scalar_one()

        for idx, (cust_name, kind, email, phone, plan_label, district, street, account_type) in enumerate(CUSTOMERS):
            # --- 5a. Customer Record (entity_key="customer") ---
            cust = Record(
                tenant_id=tenant.id, entity_key="customer", owner_node_id=owner_node_id,
                status="ACTIVE",
                data=_tag({
                    "name": cust_name, "email": email, "phone": phone, "plan": plan_label,
                    # extra (non-schema) fields are fine — config records accept arbitrary keys
                    "district": district, "street": street,
                }),
            )
            s.add(cust)
            await s.flush()
            await workflow.emit(s, tenant.id, "create", "customer", cust.id, actor_id,
                                {"data": cust.data, "status": "ACTIVE"})
            summary["customers"] += 1

            # --- 5b. Party row (BSS first-class table — for the holder picker) ---
            party = Party(
                tenant_id=tenant.id, owner_node_id=owner_node_id,
                type=kind, name=cust_name,
                customer_record_id=cust.id, status="active",
            )
            s.add(party)
            await s.flush()
            await workflow.emit(s, tenant.id, "create", "party", party.id, actor_id,
                                {"name": cust_name, "type": kind})
            summary["parties"] += 1

            # --- 5c. Account row (held by the party) ---
            account = Account(
                tenant_id=tenant.id, owner_node_id=owner_node_id,
                holder_party_id=party.id, type=account_type,
                currency="AMD", billing_cycle="monthly", status="active",
            )
            s.add(account)
            await s.flush()
            await workflow.emit(s, tenant.id, "create", "account", account.id, actor_id,
                                {"holder": str(party.id), "type": account_type})
            summary["accounts"] += 1

            # --- 5d. 1-2 Contacts (Record entity_key="contact") ---
            if contact_ent:
                n_contacts = 2 if kind == "organization" else 1
                for k in range(n_contacts):
                    cn = CONTACT_NAMES[(idx * 2 + k) % len(CONTACT_NAMES)]
                    cphone = f"+374 99 {300000 + idx*10 + k:06d}"
                    cmail = f"contact{idx}.{k}@{(email.split('@')[1] if '@' in email else 'example.am')}"
                    c = Record(
                        tenant_id=tenant.id, entity_key="contact", owner_node_id=owner_node_id,
                        status=None,
                        data=_tag({
                            "name": cn, "email": cmail, "phone": cphone,
                            "title": "Primary contact" if k == 0 else "Secondary contact",
                            "customer": str(cust.id),
                        }),
                    )
                    s.add(c)
                    await s.flush()
                    await workflow.emit(s, tenant.id, "create", "contact", c.id, actor_id,
                                        {"name": cn, "customer": str(cust.id)})
                    summary["contacts"] += 1

            # --- 5e. 1-2 Subscriptions + Order chain ---
            # Pick a plausible product based on the plan label.
            if plan_label == "Enterprise":
                primary_pkey = "biz-fiber-1g"
            elif plan_label == "Pro":
                primary_pkey = "home-fiber-500"
            elif plan_label == "Basic":
                primary_pkey = "home-fiber-100"
            else:
                primary_pkey = "home-fiber-100"

            n_subs = 2 if kind == "organization" else 1
            sub_chosen_keys = [primary_pkey]
            if n_subs == 2:
                sub_chosen_keys.append("mobile-unl")

            for k, pkey in enumerate(sub_chosen_keys):
                prod = products_by_key[pkey]
                # --- Order: COMPLETED for the first sub, mixed for the second ---
                if k == 0:
                    order_status = "COMPLETED"
                else:
                    # Mix in a couple of NEW / FULFILLING for variety
                    order_status = ("NEW", "FULFILLING", "COMPLETED", "COMPLETED")[idx % 4]
                order_seq += 1
                order = Order(
                    tenant_id=tenant.id, owner_node_id=owner_node_id, customer_id=cust.id,
                    account_id=account.id,
                    number=f"ORD-{order_seq:05d}", status=order_status,
                    total=prod.default_amount,
                )
                s.add(order)
                await s.flush()
                s.add(OrderItem(
                    tenant_id=tenant.id, order_id=order.id, product_id=prod.id,
                    description=prod.name, quantity=1, unit_amount=prod.default_amount,
                    line_total=prod.default_amount,
                ))
                await workflow.emit(s, tenant.id, "create", "order", order.id, actor_id,
                                    {"number": order.number, "status": order_status,
                                     "customer": str(cust.id)})
                summary["orders"] += 1

                # Subscription: ACTIVE if order COMPLETED, else PENDING-ish (use ACTIVE for demo)
                sub = Subscription(
                    tenant_id=tenant.id, owner_node_id=owner_node_id,
                    customer_id=cust.id, account_id=account.id,
                    product_id=prod.id, plan_name=prod.name, amount=prod.default_amount,
                    cycle=prod.cycle, status="ACTIVE",
                    started_at=now - timedelta(days=90 - idx * 5),
                    next_invoice_at=_add_cycle(now, prod.cycle),
                )
                s.add(sub)
                await s.flush()
                await workflow.emit(s, tenant.id, "create", "subscription", sub.id, actor_id,
                                    {"plan_name": sub.plan_name, "amount": sub.amount,
                                     "customer": str(cust.id)})
                summary["subscriptions"] += 1

                # --- 5f. 2-5 Invoices per subscription ---
                # Pattern: 3 historic invoices PAID; 1 ISSUED (current); sometimes 1 OVERDUE.
                n_invoices = 3 + (idx % 3)  # 3..5
                for inv_idx in range(n_invoices):
                    period_start = sub.started_at + timedelta(days=30 * inv_idx)
                    period_end = _add_cycle(period_start, sub.cycle)
                    # status pattern: oldest are PAID, current is ISSUED, sometimes the last is OVERDUE
                    if inv_idx < n_invoices - 1:
                        inv_status = "PAID"
                    elif idx % 4 == 0:
                        inv_status = "OVERDUE"
                    else:
                        inv_status = "ISSUED"
                    invoice_seq += 1
                    inv = Invoice(
                        tenant_id=tenant.id, owner_node_id=owner_node_id,
                        customer_id=cust.id, account_id=account.id,
                        number=f"INV-{invoice_seq:05d}",
                        period_start=period_start, period_end=period_end,
                        status=inv_status, total=sub.amount,
                        issued_at=period_start,
                        due_at=period_start + timedelta(days=14),
                    )
                    s.add(inv)
                    await s.flush()
                    s.add(InvoiceLine(
                        tenant_id=tenant.id, invoice_id=inv.id, kind="charge",
                        description=sub.plan_name, quantity=1,
                        unit_amount=sub.amount, line_total=sub.amount,
                    ))
                    await workflow.emit(s, tenant.id, "create", "invoice", inv.id, actor_id,
                                        {"number": inv.number, "total": inv.total,
                                         "status": inv_status, "customer": str(cust.id)})
                    summary["invoices"] += 1

                    # --- 5g. 1-2 Payments per PAID invoice ---
                    if inv_status == "PAID":
                        # most pay in full in one go; some pay in two halves
                        if inv_idx % 3 == 0:
                            half = inv.total // 2
                            s.add(Payment(
                                tenant_id=tenant.id, invoice_id=inv.id,
                                amount=half, method="transfer",
                                paid_at=period_start + timedelta(days=2),
                                note="Dev seed: first half (bank transfer)",
                            ))
                            s.add(Payment(
                                tenant_id=tenant.id, invoice_id=inv.id,
                                amount=inv.total - half, method="card",
                                paid_at=period_start + timedelta(days=10),
                                note="Dev seed: second half (card)",
                            ))
                            summary["payments"] += 2
                        else:
                            method = ("card", "cash", "transfer")[inv_idx % 3]
                            s.add(Payment(
                                tenant_id=tenant.id, invoice_id=inv.id,
                                amount=inv.total, method=method,
                                paid_at=period_start + timedelta(days=3),
                                note=f"Dev seed: paid in full ({method})",
                            ))
                            summary["payments"] += 1
                        await workflow.emit(s, tenant.id, "payment", "invoice", inv.id, actor_id,
                                            {"invoice_status": "PAID", "amount": inv.total})

            # --- 5h. 0-2 Helpdesk tickets per customer ---
            n_tickets = (idx % 3)  # 0, 1, or 2 tickets
            for tk in range(n_tickets):
                subject, prio, status = TICKETS[(idx + tk) % len(TICKETS)]
                ticket = HelpdeskTicket(
                    tenant_id=tenant.id, owner_node_id=owner_node_id,
                    customer_id=cust.id,
                    subject=subject,
                    body=f"Customer: {cust_name}. Reported via portal.",
                    priority=prio, status=status,
                    sla_due_at=now + timedelta(hours=24 if prio != "URGENT" else 4),
                    sla_breached=False,
                    resolved_at=(now - timedelta(days=2)) if status == "RESOLVED" else None,
                )
                s.add(ticket)
                await s.flush()
                await workflow.emit(s, tenant.id, "create", "helpdesk_ticket", ticket.id, actor_id,
                                    {"subject": subject, "priority": prio, "status": status,
                                     "customer": str(cust.id)})
                summary["tickets"] += 1

            # --- 5i. 0-1 WorkItem per customer ---
            if idx % 2 == 0:
                wi = WorkItem(
                    tenant_id=tenant.id, owner_node_id=owner_node_id,
                    title=f"On-site installation for {cust_name}",
                    description=f"Schedule fibre install at {street}, {district}.",
                    kind="task", status="TODO" if idx % 4 else "IN_PROGRESS",
                    priority="NORMAL",
                    customer_id=cust.id,
                    due_at=now + timedelta(days=3 + idx),
                    scheduled_at=now + timedelta(days=2 + idx),
                    location=f"{street}, {district}, Երևան",
                )
                s.add(wi)
                await s.flush()
                await workflow.emit(s, tenant.id, "create", "workitem", wi.id, actor_id,
                                    {"title": wi.title, "customer": str(cust.id)})
                summary["workitems"] += 1

        # =========================================================================================
        # 6) A few stand-alone Work Orders (config entity, not the BSS workitem table)
        # =========================================================================================
        if wo_ent:
            for i in range(5):
                rec = Record(
                    tenant_id=tenant.id, entity_key="work_order",
                    owner_node_id=owner_node_id, status="OPEN" if i % 2 else "SCHEDULED",
                    data=_tag({
                        "title": f"Routine network maintenance #{i+1}",
                        "scheduled_at": (now + timedelta(days=i+1)).isoformat(),
                        "location": SITES[i % len(SITES)][1],
                    }),
                )
                s.add(rec)
                await s.flush()
                await workflow.emit(s, tenant.id, "create", "work_order", rec.id, actor_id,
                                    {"title": rec.data["title"]})

        await s.commit()

        _log.info("dev-bulk seeder complete: %s", summary)
        return summary


# =================================================================================================
# Dev-extras seeder — CalendarEvents + Communications for the Calendar / Communications pages
# =================================================================================================
#
# ADDITIVE + INDEPENDENT of `seed_dev_bulk_if_empty()`. It does NOT touch the customer/billing
# tree above and never short-circuits on the dev_bulk customer marker — it has its OWN idempotency
# guard so it can run even when dev_bulk customers already exist (e.g. on a DB that was seeded by
# an older build that predates this function). It ties its rows to the already-seeded dev_bulk
# customers (Record entity_key="customer", data["_seed"]="dev_bulk") so the Calendar/Comms pages
# show realistic, cross-referenced demo data.
#
# Idempotency: returns early if ANY dev_extras-tagged CalendarEvent OR Communication already
# exists. CalendarEvent has no JSONB bag, so we tag events by a recognizable title prefix
# (`_EVENT_TAG`) and detect by `title LIKE '<tag>%'`. Communication likewise has no bag, so we tag
# the subject with `_COMM_TAG` and detect by `subject LIKE '<tag>%'`. Re-runs therefore no-op.

# Recognizable markers — used both to stamp rows and to detect them on re-run.
_EVENT_TAG = "[demo] "
_COMM_TAG = "[demo] "

# Calendar events — (title, day_offset_from_today, start_hour, duration_hours, all_day, location,
# color). Spread so a few land TODAY (offset 0) and several across THIS week (offsets 1..5) so the
# Calendar TODAY / THIS WEEK KPIs are non-zero.
_CAL_EVENTS = [
    ("Ֆայբեր միացում — տեղում",        0,  9, 2, False, "Մաշտոցի 28, Երևան",        "#3A6FB5"),
    ("Թիմի ամենօրյա stand-up",         0, 10, 1, False, "Գրասենյակ, Երևան",         "#0EA5E9"),
    ("ONT փոխարինում հաճախորդի մոտ",    0, 14, 2, False, "Բաղրամյան 47, Երևան",      "#D4A017"),
    ("Ցանցի պլանային սպասարկում",       1,  8, 3, False, "Մալաթիա Datacenter",        "#3A6FB5"),
    ("Վաճառքի հանդիպում — Enterprise",  1, 13, 1, False, "Աբովյան 14, Երևան",        "#0EA5E9"),
    ("Հաճախորդի տեղափոխման այց",        2, 11, 2, False, "Հալաբյան 19, Երևան",       "#D4A017"),
    ("POP սարքավորման ստուգում",        3,  9, 2, False, "Կոմիտաս 49, Երևան",        "#3A6FB5"),
    ("Billing ամփոփման ստուգում",       4, 15, 1, False, "Գրասենյակ, Երևան",         "#0EA5E9"),
    ("Շաբաթական NOC վերանայում",        5, 16, 1, False, "Գրասենյակ, Երևան",         "#3A6FB5"),
]

# Communications — (channel, direction, status, subject, body, hours_ago, sent/received).
# Channel mix: EMAIL / SMS / CALLS / WHATSAPP / PORTAL_MESSAGE. participant_type=CUSTOMER, linked
# to seeded customers by participant_id + related_entity_type="customer" + related_entity_id.
_COMMS = [
    ("EMAIL",          "OUTBOUND", "DELIVERED", "Ձեր ապրիլ ամսվա հաշիվը",         "Հարգելի հաճախորդ, Ձեր ապրիլ ամսվա հաշիվը պատրաստ է։ Շնորհակալություն GAAhex-ն ընտրելու համար։", 2),
    ("SMS",            "OUTBOUND", "SENT",      "Վճարման հիշեցում",               "GAAhex: Ձեր վճարման ժամկետը լրանում է 3 օրից։ Մանրամասները՝ անձնական էջում։", 5),
    ("CALLS",          "INBOUND",  "RECEIVED",  "Արագության խնդրի բողոք",          "Հաճախորդը զանգահարել է երեկոյան արագության անկման կապակցությամբ։ Փոխանցվել է NOC-ին։", 8),
    ("WHATSAPP",       "OUTBOUND", "READ",      "Տեխնիկի այցի հաստատում",          "Բարև Ձեզ, մեր տեխնիկը կժամանի վաղը ժամը 11:00-ին։ Խնդրում ենք հաստատել։", 24),
    ("PORTAL_MESSAGE", "INBOUND",  "RECEIVED",  "Պլանի բարձրացման հարցում",        "Ցանկանում եմ անցնել ավելի բարձր արագության փաթեթի։ Ի՞նչ տարբերակներ կան։", 30),
    ("EMAIL",          "INBOUND",  "RECEIVED",  "Re: Ձեր ապրիլ ամսվա հաշիվը",      "Շնորհակալություն, վճարումը կատարված է բանկային փոխանցմամբ։", 33),
    ("SMS",            "OUTBOUND", "DELIVERED", "Միացման հաստատում",              "GAAhex: Ձեր ինտերնետ ծառայությունն ակտիվ է։ Բարի օգտագործում։", 48),
    ("CALLS",          "OUTBOUND", "DELIVERED", "Հետադարձ զանգ՝ բողոքի կապակցությամբ", "Կապ հաստատվեց հաճախորդի հետ, խնդիրը լուծված է, ONT-ն վերագործարկվել է։", 50),
    ("WHATSAPP",       "INBOUND",  "RECEIVED",  "WiFi-ի խնդիր",                    "Բարև, WiFi-ը չի աշխատում երկրորդ հարկում, օգնեք խնդրեմ։", 54),
    ("PORTAL_MESSAGE", "OUTBOUND", "READ",      "Տոմսի կարգավիճակ",                "Ձեր դիմումը մշակման փուլում է, կտեղեկացնենք լուծման մասին։", 60),
    ("EMAIL",          "OUTBOUND", "QUEUED",    "Նոր ծառայությունների առաջարկ",    "Ներկայացնում ենք մեր նոր Enterprise ֆայբեր փաթեթը հատուկ բիզնեսների համար։", 70),
    ("SMS",            "OUTBOUND", "DELIVERED", "Սպասարկման ծանուցում",           "GAAhex: Վաղը 02:00-04:00 պլանային աշխատանքների պատճառով հնարավոր են ընդհատումներ։", 72),
]

# Communications threads — the Communications view reads /api/threads (Thread + Message), NOT the
# Communication table above. Each thread is record-linked to a seeded customer so it surfaces via
# `_can_access_thread`, with a short realistic staff conversation. Authors alternate between the
# admin and a second staff user. Titles are clean (no "[demo]" prefix) — these are demo-worthy.
# (title, [(author: 'admin'|'agent', body, hours_ago), ...])
_THREADS = [
    ("Արագության խնդիր — երեկոյան անկում", [
        ("agent", "Հաճախորդը հայտնում է երեկոյան արագության անկման մասին։ Ստուգում եմ գիծը։", 27),
        ("admin", "NOC-ը նայեց՝ POP-ի ծանրաբեռնվածություն էր, շտկվեց։ Հետևիր մի օր։", 26),
        ("agent", "Հաստատված, արագությունը նորմալ է հիմա։ Փակում եմ տոմսը։", 25),
    ]),
    ("Նոր ֆայբեր միացման հայտ", [
        ("agent", "Հաճախորդը ցանկանում է ֆայբեր միացում նոր հասցեում։ Ծածկույթը կա։", 52),
        ("admin", "Հաստատում եմ։ Տեխնիկ նշանակիր վաղվա առավոտին։", 51),
    ]),
    ("Ապրիլի հաշվի հարցում", [
        ("agent", "Հաճախորդը հարցնում է ապրիլ ամսվա հաշվի մանրամասները։", 9),
        ("admin", "Ուղարկիր մանրամասն քաղվածքը էլ-փոստով։", 8),
        ("agent", "Ուղարկվեց, հաճախորդը գոհ է։", 7),
    ]),
    ("ONT սարքի փոխարինում", [
        ("agent", "Հին ONT-ն պարբերաբար անջատվում է։ Առաջարկում եմ փոխարինել։", 31),
        ("admin", "Հաստատված, պահեստից վերցրու նոր սարք ու պլանավորիր այցը։", 30),
    ]),
    ("Փաթեթի բարձրացում 300 Մբ/վ", [
        ("agent", "Հաճախորդը ցանկանում է անցնել 300 Մբ/վ փաթեթի։", 13),
        ("admin", "Կիրառիր նոր սակագինը հաջորդ բիլինգ ցիկլից։", 12),
    ]),
    ("WiFi ծածկույթ 2-րդ հարկում", [
        ("agent", "Հաճախորդը գանգատվում է 2-րդ հարկի թույլ WiFi-ից։ Առաջարկում եմ mesh։", 55),
        ("admin", "Առաջարկիր mesh փաթեթը, ուղարկիր գնացուցակը։", 54),
    ]),
]


async def _has_dev_extras_rows(s) -> bool:
    """Return True if any demo-tagged CalendarEvent OR Communication already exists.

    This is the dev-extras idempotency short-circuit — INDEPENDENT of the dev_bulk customer
    marker, so the function runs even when dev_bulk customers already exist.
    """
    n_events = (await s.execute(
        select(func.count()).select_from(CalendarEvent).where(
            CalendarEvent.title.like(f"{_EVENT_TAG}%")
        )
    )).scalar_one()
    if n_events > 0:
        return True
    n_comms = (await s.execute(
        select(func.count()).select_from(Communication).where(
            Communication.subject.like(f"{_COMM_TAG}%")
        )
    )).scalar_one()
    return n_comms > 0


async def seed_dev_extras_if_empty() -> dict | None:
    """Insert demo CalendarEvents + Communications tied to the seeded dev_bulk customers.

    Additive, idempotent (no-op on re-run via `_has_dev_extras_rows`), independent of the
    dev_bulk customer tree, and runs as OWNER (bypasses RLS) — same pattern as
    `seed_dev_bulk_if_empty()`. Gated by `GAAHEX_DEV_SEED` at the caller (defense-in-depth
    check here too). Returns a dict summary on first run, else None.
    """
    if not _dev_seed_enabled():
        _log.info("dev-extras seeder skipped: GAAHEX_DEV_SEED not set")
        return None

    async with SessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})

        # ---- idempotency (own guard, independent of dev_bulk customers) ----
        if await _has_dev_extras_rows(s):
            _log.info("dev-extras seeder skipped: demo CalendarEvent/Communication already present")
            return None

        # ---- resolve tenant + actor (same anchor logic as dev_bulk) ----
        admin = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one_or_none()
        tenant = None
        if admin is not None:
            tenant = (await s.execute(
                select(Tenant).where(Tenant.id == admin.tenant_id)
            )).scalar_one_or_none()
        if tenant is None:
            tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            _log.info("dev-extras seeder skipped: no tenant yet")
            return None
        actor_id = admin.id if admin else None

        # ---- find the seeded dev_bulk customers to link rows against ----
        customers = (await s.execute(
            select(Record).where(
                Record.tenant_id == tenant.id,
                Record.entity_key == "customer",
                Record.data["_seed"].astext == SEED_MARKER,
            ).order_by(Record.id)
        )).scalars().all()
        if not customers:
            # No dev_bulk customers to tie to — calendar/comms demo data is meaningless without
            # them, so skip rather than seed orphan rows.
            _log.info("dev-extras seeder skipped: no dev_bulk customers to link to (run dev-bulk first)")
            return None

        # Communication.created_by is NOT NULL — without a resolvable actor user we cannot insert
        # comms. The demo tenant always has admin@demo.isp, so this only trips on a degenerate DB.
        if actor_id is None:
            _log.info("dev-extras seeder skipped: no actor user resolved (admin@demo.isp missing)")
            return None

        now = _now()
        summary = {"calendar": 0, "communications": 0}

        # ---- a shared demo UserCalendar (so events have a home calendar) ----
        cal = UserCalendar(
            tenant_id=tenant.id,
            owner_node_id=customers[0].owner_node_id,
            created_by_id=actor_id,
            name=f"{_EVENT_TAG}Operations",
            color="#3A6FB5",
            is_shared=True,
        )
        s.add(cal)
        await s.flush()

        # ---- CalendarEvents ----
        for i, (title, day_off, hour, dur, all_day, location, color) in enumerate(_CAL_EVENTS):
            cust = customers[i % len(customers)]
            start_at = (now + timedelta(days=day_off)).replace(
                hour=hour, minute=0, second=0, microsecond=0
            )
            end_at = start_at + timedelta(hours=dur)
            ev = CalendarEvent(
                tenant_id=tenant.id,
                owner_node_id=cust.owner_node_id,
                calendar_id=cal.id,
                created_by_id=actor_id,
                title=f"{_EVENT_TAG}{title}",
                start_at=start_at,
                end_at=end_at,
                all_day=all_day,
                description=f"Հաճախորդ՝ {cust.data.get('name', '—')}. Demo seed.",
                location=location,
                color=color,
                customer_record_id=cust.id,
            )
            s.add(ev)
            await s.flush()
            # NOTE: no workflow.emit here — demo seed inserts rows directly (matches the
            # direct-insert pattern of the other seeders); emitting hit a record-lookup path.
            summary["calendar"] += 1

        # ---- Communications ----
        for i, (channel, direction, status, subject, body, hours_ago) in enumerate(_COMMS):
            cust = customers[i % len(customers)]
            ts = now - timedelta(hours=hours_ago)
            ref = await next_reference_number(s, tenant_id=tenant.id, prefix="COM", width=6)
            sent_at = ts if direction == "OUTBOUND" and status in (
                "SENT", "DELIVERED", "READ"
            ) else None
            received_at = ts if direction == "INBOUND" else None
            c = Communication(
                reference_number=ref,
                tenant_id=tenant.id,
                channel=channel,
                direction=direction,
                related_entity_type="customer",
                related_entity_id=cust.id,
                participant_type="CUSTOMER",
                participant_id=cust.id,
                subject=f"{_COMM_TAG}{subject}",
                message_body=body,
                status=status,
                created_by=actor_id,
                sent_at=sent_at,
                received_at=received_at,
            )
            s.add(c)
            await s.flush()
            # NOTE: no workflow.emit here — demo seed inserts rows directly (see calendar note above).
            summary["communications"] += 1

        await s.commit()
        _log.info("dev-extras seeder complete: %s", summary)
        return summary


async def seed_dev_threads_if_empty() -> dict | None:
    """Insert demo Communications threads (Thread + Message) tied to seeded dev_bulk customers.

    The Communications view (MessagesView) reads `/api/threads` — i.e. the Thread/Message tables —
    NOT the Communication table that `seed_dev_extras_if_empty` populates. Without these rows the
    page shows "No conversations yet". Each thread is record-linked to a seeded customer
    (entity_key='customer' + record_id) and authored by `admin@demo.isp`, so the view's
    `_can_access_thread` gate surfaces it. Additive, idempotent, OWNER session (bypasses RLS) —
    same contract as the other `*_if_empty` seeders. Gated by `GAAHEX_DEV_SEED` at the caller.
    """
    if not _dev_seed_enabled():
        _log.info("dev-threads seeder skipped: GAAHEX_DEV_SEED not set")
        return None

    async with SessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})

        admin = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one_or_none()
        if admin is None:
            _log.info("dev-threads seeder skipped: admin@demo.isp missing")
            return None
        tenant_id = admin.tenant_id

        # idempotency — any record-linked thread already authored by the seed actor → no-op.
        existing = (await s.execute(
            select(func.count()).select_from(Thread).where(
                Thread.tenant_id == tenant_id,
                Thread.created_by == admin.id,
                Thread.record_id.isnot(None),
            )
        )).scalar_one()
        if existing > 0:
            _log.info("dev-threads seeder skipped: demo threads already present")
            return None

        customers = (await s.execute(
            select(Record).where(
                Record.tenant_id == tenant_id,
                Record.entity_key == "customer",
                Record.data["_seed"].astext == SEED_MARKER,
            ).order_by(Record.id)
        )).scalars().all()
        if not customers:
            _log.info("dev-threads seeder skipped: no dev_bulk customers to link to (run dev-bulk first)")
            return None

        # A second staff user gives the conversations a back-and-forth feel. Fall back to admin.
        agent_user = (await s.execute(
            select(User).where(User.tenant_id == tenant_id, User.id != admin.id).order_by(User.id)
        )).scalars().first()
        authors = {"admin": admin.id, "agent": agent_user.id if agent_user else admin.id}

        now = _now()
        n_threads = 0
        n_messages = 0
        for i, (title, msgs) in enumerate(_THREADS):
            cust = customers[i % len(customers)]
            cust_name = (cust.data or {}).get("name", "")
            earliest = max((h for _, _, h in msgs), default=1)
            th = Thread(
                tenant_id=tenant_id,
                entity_key="customer",
                record_id=cust.id,
                title=(f"{title} — {cust_name}".strip(" —") if cust_name else title),
                created_by=admin.id,
                created_at=now - timedelta(hours=earliest + 1),
            )
            s.add(th)
            await s.flush()
            n_threads += 1
            for role, body, hours_ago in msgs:
                s.add(Message(
                    tenant_id=tenant_id,
                    thread_id=th.id,
                    author_user_id=authors.get(role, admin.id),
                    body=body,
                    created_at=now - timedelta(hours=hours_ago),
                ))
                n_messages += 1

        await s.commit()
        summary = {"threads": n_threads, "messages": n_messages}
        _log.info("dev-threads seeder complete: %s", summary)
        return summary


# CRM pipeline demo — leads + quotes so the Leads / Pipeline / Quotes pages and the
# My Day sales widgets are alive. (name, lead-status, assigned_to, source, est_value AMD)
# Statuses use the lead entity's CANONICAL status set (NEW/WORKING/CONTACTED/QUALIFIED/
# CONVERTED/DISQUALIFIED/LOST). CONVERTED = contract signed.
_LEADS = [
    ("Հակոբյան Արամ — Մաշտոցի ֆայբեր",   "QUALIFIED", "Demo Admin", "WEBSITE",  45000),
    ("Tumo Center — Enterprise կապ",      "CONVERTED", "Demo Admin", "OUTBOUND", 250000),
    ("Erebuni IT Solutions",              "CONTACTED", "Demo Admin", "OUTBOUND", 120000),
    ("Գրիգորյան Մարիամ — բիզնес փաթեթ",   "QUALIFIED", "Demo Admin", "WEBSITE",  45000),
    ("Սարգսյան Լիլիթ — բնակարան",         "WORKING",   "Demo Agent", "REFERRAL", 8000),
    ("Պետրոսյան Գևորգ",                   "NEW",       "Demo Agent", "WEBSITE",  8000),
    ("Մկրտչյան Անի — տուն",               "CONVERTED", "Demo Agent", "WALK_IN",  15000),
    ("Ավագյան Նարեկ",                     "NEW",       "Demo Agent", "REFERRAL", 8000),
    ("Սարուխանյան Հայկ",                  "NEW",       "Demo Agent", "WEBSITE",  8000),
    ("Ադամյան Լուսինե",                   "NEW",       "Demo Admin", "WALK_IN",  12000),
    ("Vardanyan Bakery — 3 sites",        "NEW",       "Demo Admin", "OUTBOUND", 140000),
    ("Խաչատրյան Ռուբեն",                  "NEW",       "Demo Agent", "REFERRAL", 8000),
    ("Գասպարյան Մհեր — բիզնес",           "QUALIFIED", "Demo Admin", "OUTBOUND", 60000),
]
# Prior-week leads — backdated so the weekly KPIs have a real week-over-week baseline.
# 7 NEW / 1 QUALIFIED / 1 CONVERTED / 1 CONTACTED (10 total): last week pulled more new
# leads but closed fewer, so this week reads as a down-arrow on NEW yet up on the funnel.
_LEADS_PRIOR = [
    ("Ավետիսյան Սուրեն",                  "NEW",       "Demo Admin", "WEBSITE",  8000),
    ("Հովհաննիսյան Կարեն",                "NEW",       "Demo Agent", "REFERRAL", 12000),
    ("Davit Group — office link",         "NEW",       "Demo Admin", "OUTBOUND", 90000),
    ("Սահակյան Նաիրա",                    "NEW",       "Demo Agent", "WEBSITE",  8000),
    ("Մարտիրոսյան Գոռ",                   "NEW",       "Demo Agent", "WALK_IN",  10000),
    ("Aren Tech — fiber quote",           "NEW",       "Demo Admin", "OUTBOUND", 75000),
    ("Բաբայան Արմեն",                     "NEW",       "Demo Agent", "WEBSITE",  8000),
    ("Մելքոնյան Շուշան",                  "QUALIFIED", "Demo Agent", "WALK_IN",  15000),
    ("Tigran Auto — 2 sites",             "CONVERTED", "Demo Admin", "OUTBOUND", 180000),
    ("Գրիգորյան Վահե",                    "CONTACTED", "Demo Agent", "WEBSITE",  8000),
]
# Yerevan demo addresses, cycled per lead so the Address column reads real.
_ADDR = [
    "Mashtots Ave 12, Yerevan", "Komitas Ave 45, Yerevan", "Baghramyan Ave 8, Yerevan",
    "Tumanyan St 23, Yerevan", "Abovyan St 7, Yerevan", "Saryan St 14, Yerevan",
    "Nalbandyan St 31, Yerevan", "Teryan St 56, Yerevan", "Pushkin St 19, Yerevan",
    "Arshakunyats Ave 102, Yerevan", "Kievyan St 4, Yerevan", "Vardanants St 18, Yerevan",
]


def _lead_contact(idx: int) -> dict:
    """Deterministic demo contact fields (phone / email / address) for a lead by index —
    so the Leads grid columns are populated without hand-editing every row."""
    op = 10 + idx % 89
    num = (100000 + idx * 7919) % 1000000
    return {
        "phone": f"+374 {op:02d} {num:06d}",
        "email": f"lead{idx + 1:03d}@housenet.am",
        "address": _ADDR[idx % len(_ADDR)],
    }


# (number, quote-status, amount_minor (luma = AMD×100), customer)
_QUOTES = [
    ("QUO-000101", "SENT",     4500000,  "Հակոբյան Արամ"),
    ("QUO-000102", "SENT",     25000000, "Tumo Center"),
    ("QUO-000103", "SENT",     1200000,  "Erebuni IT Solutions"),
    ("QUO-000104", "ACCEPTED", 800000,   "Սարգսյան Լիլիթ"),
    ("QUO-000105", "DRAFT",    1500000,  "Գրիգորյան Մարիամ"),
]


async def seed_dev_pipeline_if_empty() -> dict | None:
    """Insert demo CRM leads + quotes tied to the demo tenant. Makes the Leads /
    Pipeline / Quotes pages and the My Day sales widgets non-empty. Additive,
    idempotent (no-op once demo leads exist), OWNER session — same contract as the
    other `*_if_empty` dev seeders. Gated by `GAAHEX_DEV_SEED`.
    """
    if not _dev_seed_enabled():
        _log.info("dev-pipeline seeder skipped: GAAHEX_DEV_SEED not set")
        return None

    async with SessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})

        admin = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one_or_none()
        if admin is None:
            _log.info("dev-pipeline seeder skipped: admin@demo.isp missing")
            return None
        tenant_id = admin.tenant_id

        existing = (await s.execute(
            select(func.count()).select_from(Record).where(
                Record.tenant_id == tenant_id,
                Record.entity_key == "lead",
                Record.data["_seed"].astext == SEED_MARKER,
            )
        )).scalar_one()
        if existing > 0:
            _log.info("dev-pipeline seeder skipped: demo leads already present")
            return None

        # Anchor leads/quotes to the same owner node the dev_bulk customers use.
        cust = (await s.execute(
            select(Record).where(
                Record.tenant_id == tenant_id, Record.entity_key == "customer",
                Record.data["_seed"].astext == SEED_MARKER,
            ).order_by(Record.id)
        )).scalars().first()
        owner_node_id = cust.owner_node_id if cust else None
        if owner_node_id is None:
            node = (await s.execute(
                select(OrgNode).where(OrgNode.tenant_id == tenant_id).order_by(OrgNode.id)
            )).scalars().first()
            owner_node_id = node.id if node else None
        if owner_node_id is None:
            _log.info("dev-pipeline seeder skipped: no owner node to anchor to")
            return None

        actor_id = admin.id
        n_leads = 0
        n_quotes = 0
        # Spread created_at across the week's days so the cockpit sparklines have a real
        # daily shape (not one spike). Monday 10:00 of the current / prior week as anchors.
        now = _now()
        week_monday = (now - timedelta(days=now.weekday())).replace(
            hour=10, minute=0, second=0, microsecond=0
        )
        elapsed = now.weekday() + 1  # days Mon..today inclusive
        prior_monday = week_monday - timedelta(days=7)
        for idx, (name, status, assigned, source, est) in enumerate(_LEADS):
            created = week_monday + timedelta(days=idx % elapsed, hours=(idx * 3) % 8)
            if created > now:
                created = now - timedelta(hours=idx)
            rec = Record(
                tenant_id=tenant_id, entity_key="lead", owner_node_id=owner_node_id, status=status,
                created_at=created,
                data=_tag({"name": name, "assigned_to": assigned, "source": source, "est_value": est,
                           "ref": f"LED-{len(_LEADS_PRIOR) + idx + 1:06d}", **_lead_contact(idx)}),
            )
            s.add(rec)
            await s.flush()
            await workflow.emit(s, tenant_id, "create", "lead", rec.id, actor_id,
                                {"data": rec.data, "status": status})
            n_leads += 1
        # Prior-week leads — created_at spread across last week so the weekly KPIs have a
        # real week-over-week baseline (not a rise-from-zero on every card).
        for idx, (name, status, assigned, source, est) in enumerate(_LEADS_PRIOR):
            rec = Record(
                tenant_id=tenant_id, entity_key="lead", owner_node_id=owner_node_id, status=status,
                created_at=prior_monday + timedelta(days=idx % 7, hours=(idx * 3) % 8),
                data=_tag({"name": name, "assigned_to": assigned, "source": source, "est_value": est,
                           "ref": f"LED-{idx + 1:06d}", **_lead_contact(idx + len(_LEADS))}),
            )
            s.add(rec)
            await s.flush()
            await workflow.emit(s, tenant_id, "create", "lead", rec.id, actor_id,
                                {"data": rec.data, "status": status})
            n_leads += 1
        for number, status, amount, custname in _QUOTES:
            rec = Record(
                tenant_id=tenant_id, entity_key="quote", owner_node_id=owner_node_id, status=status,
                data=_tag({"number": number, "amount": amount, "customer": custname}),
            )
            s.add(rec)
            await s.flush()
            await workflow.emit(s, tenant_id, "create", "quote", rec.id, actor_id,
                                {"data": rec.data, "status": status})
            n_quotes += 1

        await s.commit()
        summary = {"leads": n_leads, "quotes": n_quotes}
        _log.info("dev-pipeline seeder complete: %s", summary)
        return summary
