"""Normalize lead + order entity_def StatusDefs to the iron-rule SST (insert SST + DELETE legacy).

The dev DB carried stale/legacy statuses on the lead/order entity_defs that predate the SST
(lead: NEW/WORKING/QUALIFIED/DISQUALIFIED/CONVERTED · order: CREATED/NEW/IN_VALIDATION/FULFILLING/
COMPLETED/VALIDATED/CANCELLED/REJECTED/FULFILLED). Records do NOT reference these (verified), and
`status_def` is a string-key config row (record.status / order.status store the key string, NOT a FK),
so pruning them is safe.

This seeder makes each entity_def's status set EXACTLY its iron-rule slice (+ its exit state):

    LEAD  : LEAD, VALIDATED_LEAD, ASSIGNED, DEAL, CONTRACT_SIGNED, ORDER_CREATED   (+ LOST)
    ORDER : ORDER_VALIDATED, SCHEDULING, CONFIG, INSTALLATION, CONNECTION_TEST,
            PAYMENT_CONFIRMED, ACTIVATION                                          (+ CANCELLED)

Idempotent: inserts missing (on_conflict_do_nothing), deletes any StatusDef whose key is not in the
keep-set. "Delete no mercy" (Gev 2026-06-12).
"""
from __future__ import annotations

import logging

from sqlalchemy import select, delete, update

from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models.tenant import Tenant
from .models.meta import EntityDef, StatusDef, WorkflowDef
from .models import Record
from .models.order import Order

_log = logging.getLogger("gaahex.seed_lifecycle_statuses")

# Keep-set per entity: (key, label, order, is_initial). Anything NOT here is legacy → deleted.
KEEP: dict[str, list[tuple[str, str, int, bool]]] = {
    "lead": [
        ("LEAD",            "Lead",            1, True),
        ("VALIDATED_LEAD",  "Validated Lead",  2, False),
        ("ASSIGNED",        "Assigned",        3, False),
        ("DEAL",            "Deal",            4, False),
        ("CONTRACT_SIGNED", "Contract Signed", 5, False),
        ("ORDER_CREATED",   "Order Created",   6, False),  # sales done → converts to ORDER
        ("LOST",            "Lost",            20, False),  # sales off-ramp (exit)
    ],
    "order": [
        ("ORDER_CREATED",     "Order Created",     6, True),   # SST #6 — true initial (orders.py ORDER_INITIAL)
        ("ORDER_VALIDATED",   "Order Validated",   7, False),  # after manual submit / converted-path start
        ("SCHEDULING",        "Scheduling",        8, False),
        ("CONFIG",            "Config",            9, False),
        ("INSTALLATION",      "Installation",      10, False),
        ("CONNECTION_TEST",   "Connection Test",   11, False),
        ("PAYMENT_CONFIRMED", "Payment Confirmed", 12, False),
        ("ACTIVATION",        "Activation",        13, False),  # converts to CUSTOMER + care task
        ("CANCELLED",         "Cancelled",         20, False),  # order off-ramp (exit)
    ],
    # Customer = active base (NOT a pipeline). "monitoring" was never a stage (iron rule) → ACTIVE.
    # suspended/terminated are the off-ramps. SPEC §7 canonical casing: UPPER_SNAKE (Gev 2026-06-14).
    "customer": [
        ("ACTIVE",     "Active",     1, True),
        ("SUSPENDED",  "Suspended",  2, False),
        ("TERMINATED", "Terminated", 3, False),
    ],
}

# Record-status renames to apply before pruning legacy StatusDefs (so no record is orphaned).
# Includes the legacy lowercase → UPPER_SNAKE collapse for the customer base (Gev 2026-06-14, no exception).
_RECORD_STATUS_RENAMES: dict[str, dict[str, str]] = {
    "customer": {
        "monitoring": "ACTIVE",   # iron rule: the active-base status is ACTIVE, not "monitoring"
        "active": "ACTIVE", "suspended": "SUSPENDED", "terminated": "TERMINATED",
    },
    # B1b (Gev 2026-06-14, no exception): lead lowercase → UPPER_SNAKE (matches lifecycle.ts). Leads
    # are generic Records (entity_key='lead'), so this Record rename migrates them.
    "lead": {
        "lead": "LEAD", "validated_lead": "VALIDATED_LEAD", "assigned": "ASSIGNED",
        "deal": "DEAL", "contract_signed": "CONTRACT_SIGNED", "order_created": "ORDER_CREATED",
        "lost": "LOST",
    },
}

# Order is a FIRST-CLASS table (order.status), NOT a Record row — its existing dev/prod rows are
# migrated directly against the Order model (see seed_lifecycle_statuses_if_missing).
_ORDER_STATUS_RENAMES: dict[str, str] = {
    "order_created": "ORDER_CREATED", "order_validated": "ORDER_VALIDATED", "scheduling": "SCHEDULING",
    "config": "CONFIG", "installation": "INSTALLATION", "connection_test": "CONNECTION_TEST",
    "payment_confirmed": "PAYMENT_CONFIRMED", "activation": "ACTIVATION", "cancelled": "CANCELLED",
}

# Order WorkflowDef transitions (iron rule, order slice 7→13 + cancel exits). The dev DB carries a
# legacy graph (NEW→FULFILLING→COMPLETED); we overwrite it so the config-driven advance reads the
# correct chain. order_created→order_validated stays for the manual draft-submit path.
_ORDER_TRANSITIONS = [
    # order_created is the order's TRUE initial status (orders.py ORDER_INITIAL; manual draft). The
    # converted path (convert.py) starts at order_validated; the manual path submits
    # order_created→order_validated. Both are real order statuses — order_created MUST be in the
    # KEEP set below or the normalizer prunes it and the drift guard / registry disagree.
    {"from": "ORDER_CREATED",     "to": "ORDER_VALIDATED",   "guard": None},   # submit (manual draft)
    {"from": "ORDER_VALIDATED",   "to": "SCHEDULING",        "guard": "control_gate:stage8"},  # Stage-8 gate

    {"from": "SCHEDULING",        "to": "CONFIG",            "guard": None},
    {"from": "CONFIG",            "to": "INSTALLATION",      "guard": None},
    {"from": "INSTALLATION",      "to": "CONNECTION_TEST",   "guard": None},
    {"from": "CONNECTION_TEST",   "to": "PAYMENT_CONFIRMED", "guard": None},
    # ACTIVATION choreography is config-declared (PERFECT-TARGET I3): reaching `activation` publishes
    # `order.activated`; the CRM/Care/Billing subscribers (kernel/events.py) create+activate the
    # customer, file the welcome check-call task, and provision subscriptions — fired atomically by
    # workflow.complete_transition, NOT by router code.
    {"from": "PAYMENT_CONFIRMED", "to": "ACTIVATION",        "guard": None, "publish": "order.activated"},
    {"from": "ORDER_VALIDATED",   "to": "CANCELLED",         "guard": None},   # off-ramps
    {"from": "SCHEDULING",        "to": "CANCELLED",         "guard": None},
    {"from": "CONFIG",            "to": "CANCELLED",         "guard": None},
]

# Customer WorkflowDef transitions — the active base (NOT a pipeline). The dev DB carries a STALE
# legacy graph (PROSPECT→ACTIVE / ACTIVE→CHURNED) whose endpoints don't even exist in the customer
# StatusDef set {ACTIVE, SUSPENDED, TERMINATED} → the customer state machine was DEAD (no transition
# could ever fire). We overwrite it to the correct UPPER_SNAKE graph that matches the StatusDefs +
# seed.py (Gev 2026-06-14, single source of truth, no exception). Mirrors the order normalization below.
_CUSTOMER_TRANSITIONS = [
    {"from": "ACTIVE",    "to": "SUSPENDED",  "guard": None},   # suspend
    {"from": "SUSPENDED", "to": "ACTIVE",     "guard": None},   # reactivate
    {"from": "ACTIVE",    "to": "TERMINATED", "guard": None},   # terminate (from active)
    {"from": "SUSPENDED", "to": "TERMINATED", "guard": None},   # terminate (from suspended)
]

# Lead WorkflowDef transitions — the iron-rule SST sales slice (MUST match seed.py build_crm_entities
# exactly). The dev DB carries a STALE legacy graph (NEW→CONTACTED→QUALIFIED→CONVERTED) whose endpoints
# aren't lead StatusDef keys → lead advance would read the wrong chain. Force-normalize like order/customer.
_LEAD_TRANSITIONS = [
    {"from": "LEAD",            "to": "VALIDATED_LEAD",  "guard": "phone != None and phone != ''"},
    {"from": "VALIDATED_LEAD",  "to": "ASSIGNED",        "guard": None},
    {"from": "ASSIGNED",        "to": "DEAL",            "guard": None},
    {"from": "DEAL",            "to": "CONTRACT_SIGNED", "guard": None},
    {"from": "CONTRACT_SIGNED", "to": "ORDER_CREATED",   "guard": None},  # sales done → convert to ORDER
    {"from": "VALIDATED_LEAD",  "to": "LOST",            "guard": None},
    {"from": "ASSIGNED",        "to": "LOST",            "guard": None},
    {"from": "DEAL",            "to": "LOST",            "guard": None},
]

# Entities whose WorkflowDef transitions this seeder owns + force-normalizes every boot (overwrites
# stale/legacy graphs). The config-driven advance reads these as the single source of truth.
_ENTITY_TRANSITIONS = {
    "order":    _ORDER_TRANSITIONS,
    "customer": _CUSTOMER_TRANSITIONS,
    "lead":     _LEAD_TRANSITIONS,
}


async def seed_lifecycle_statuses_if_missing() -> dict:
    """Make lead + order entity_defs carry EXACTLY their iron-rule slice statuses, per tenant."""
    inserted = 0
    deleted = 0
    wf_fixed = 0
    async with SessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        tenants = (await s.execute(select(Tenant))).scalars().all()
        for t in tenants:
            for ent_key, statuses in KEEP.items():
                ent = (await s.execute(
                    select(EntityDef).where(EntityDef.tenant_id == t.id, EntityDef.key == ent_key)
                )).scalar_one_or_none()
                if ent is None:
                    # The order is a first-class table whose CONFIG (entity_def + WorkflowDef) is created
                    # by the full dev/prod seed but NOT the minimal test seed — so in tests the order had
                    # no config at all and its lifecycle ran entirely on in-router fallbacks. Create the
                    # config here so the order participates in config in EVERY env (PERFECT-TARGET I2/I6).
                    # lead/customer entity_defs are always present, so only the order needs this.
                    if ent_key != "order":
                        continue
                    ent = EntityDef(tenant_id=t.id, key="order", label="Order", label_plural="Orders",
                                    route_slug="orders", owner_module="Orders")
                    s.add(ent)
                    await s.flush()
                keep_keys = [k for (k, _l, _o, _i) in statuses]
                # 0) rename record statuses first, so pruning legacy StatusDefs never orphans a record
                for old, new in _RECORD_STATUS_RENAMES.get(ent_key, {}).items():
                    await s.execute(
                        update(Record).where(
                            Record.tenant_id == t.id, Record.entity_key == ent_key, Record.status == old
                        ).values(status=new)
                    )
                # order is a first-class table (order.status), not a Record — migrate its rows directly.
                if ent_key == "order":
                    for old, new in _ORDER_STATUS_RENAMES.items():
                        await s.execute(
                            update(Order).where(
                                Order.tenant_id == t.id, Order.status == old
                            ).values(status=new)
                        )
                # 1) insert any missing SST/exit statuses
                for key, label, order, is_initial in statuses:
                    res = await s.execute(
                        pg_insert(StatusDef)
                        .values(tenant_id=t.id, entity_def_id=ent.id, key=key, label=label,
                                order=order, is_initial=is_initial)
                        .on_conflict_do_nothing(constraint="uq_status_def_key")
                    )
                    inserted += res.rowcount or 0
                # 2) DELETE legacy — any status on this def not in the keep-set
                res = await s.execute(
                    delete(StatusDef).where(
                        StatusDef.entity_def_id == ent.id,
                        StatusDef.key.notin_(keep_keys),
                    )
                )
                deleted += res.rowcount or 0
                # 3) WorkflowDef transitions → canonical chain. The dev DB carries legacy graphs
                #    (order: NEW→FULFILLING→COMPLETED · customer: stale PROSPECT/CHURNED that don't
                #    match the StatusDefs). This is the single source the config-driven advance reads.
                canonical = _ENTITY_TRANSITIONS.get(ent_key)
                if canonical is not None:
                    wf = (await s.execute(
                        select(WorkflowDef).where(WorkflowDef.entity_def_id == ent.id)
                    )).scalars().first()
                    if wf is None:
                        # No WorkflowDef in this env (e.g. minimal test seed) — create it so the
                        # config-driven transition path (incl. the order activation `publish`
                        # choreography) is available. One WorkflowDef per entity (I5).
                        s.add(WorkflowDef(tenant_id=t.id, entity_def_id=ent.id, key=f"{ent_key}_lifecycle",
                                          label=f"{ent_key.capitalize()} Lifecycle",
                                          config={"transitions": canonical}))
                        wf_fixed += 1
                    else:
                        cfg = dict(wf.config or {})
                        if cfg.get("transitions") != canonical:
                            cfg["transitions"] = canonical
                            wf.config = cfg
                            wf_fixed += 1
        await s.commit()
    _log.info("seed_lifecycle_statuses: +%d SST status(es), -%d legacy, %d order-workflow fixed",
              inserted, deleted, wf_fixed)
    return {"inserted": inserted, "deleted": deleted, "workflow_fixed": wf_fixed}
