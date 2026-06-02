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
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func

from .db import OwnerSessionLocal as SessionLocal  # privileged — bypasses RLS
from .models import (
    Tenant, OrgNode, User, EntityDef, Record,
)
from .models.party import Party, Account
from .models.product import Product
from .models.billing import Subscription, Invoice, InvoiceLine, Payment
from .models.order import Order, OrderItem
from .models.helpdesk import HelpdeskTicket, HelpdeskQueue
from .models.workitem import WorkItem
from . import workflow
from .routers.billing import _now, _add_cycle

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
    ("Լիլիթ Սարգսյան",      "individual",   "lilit.sargsyan@example.am",      "+374 99 201004", "Pro",      "Մալաթիա-Սեբաստիա",   "Շիրազի 64",      "residential"),
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
    ("Աննա Ավետիսյան",   "anna.avetisyan@gaahex.am",   "Helpdesk Lead"),
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
