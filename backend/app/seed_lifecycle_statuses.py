"""Normalize lead + order entity_def StatusDefs to the iron-rule SST (insert SST + DELETE legacy).

The dev DB carried stale/legacy statuses on the lead/order entity_defs that predate the SST
(lead: NEW/WORKING/QUALIFIED/DISQUALIFIED/CONVERTED · order: CREATED/NEW/IN_VALIDATION/FULFILLING/
COMPLETED/VALIDATED/CANCELLED/REJECTED/FULFILLED). Records do NOT reference these (verified), and
`status_def` is a string-key config row (record.status / order.status store the key string, NOT a FK),
so pruning them is safe.

This seeder makes each entity_def's status set EXACTLY its iron-rule slice (+ its exit state):

    LEAD  : lead, validated_lead, assigned, deal, contract_signed, order_created   (+ lost)
    ORDER : order_validated, scheduling, config, installation, connection_test,
            payment_confirmed, activation                                          (+ cancelled)

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

_log = logging.getLogger("gaahex.seed_lifecycle_statuses")

# Keep-set per entity: (key, label, order, is_initial). Anything NOT here is legacy → deleted.
KEEP: dict[str, list[tuple[str, str, int, bool]]] = {
    "lead": [
        ("lead",            "Lead",            1, True),
        ("validated_lead",  "Validated Lead",  2, False),
        ("assigned",        "Assigned",        3, False),
        ("deal",            "Deal",            4, False),
        ("contract_signed", "Contract Signed", 5, False),
        ("order_created",   "Order Created",   6, False),  # sales done → converts to ORDER
        ("lost",            "Lost",            20, False),  # sales off-ramp (exit)
    ],
    "order": [
        ("order_validated",   "Order Validated",   7, True),  # order's first stage
        ("scheduling",        "Scheduling",        8, False),
        ("config",            "Config",            9, False),
        ("installation",      "Installation",      10, False),
        ("connection_test",   "Connection Test",   11, False),
        ("payment_confirmed", "Payment Confirmed", 12, False),
        ("activation",        "Activation",        13, False),  # converts to CUSTOMER + care task
        ("cancelled",         "Cancelled",         20, False),  # order off-ramp (exit)
    ],
    # Customer = active base (NOT a pipeline). "monitoring" was never a stage (iron rule) → renamed to
    # "active". suspended/terminated are the off-ramps.
    "customer": [
        ("active",     "Active",     1, True),
        ("suspended",  "Suspended",  2, False),
        ("terminated", "Terminated", 3, False),
    ],
}

# Record-status renames to apply before pruning legacy StatusDefs (so no record is orphaned).
_RECORD_STATUS_RENAMES: dict[str, dict[str, str]] = {
    "customer": {"monitoring": "active"},   # iron rule: the active-base status is ACTIVE, not "monitoring"
}

# Order WorkflowDef transitions (iron rule, order slice 7→13 + cancel exits). The dev DB carries a
# legacy graph (NEW→FULFILLING→COMPLETED); we overwrite it so the config-driven advance reads the
# correct chain. order_created→order_validated stays for the manual draft-submit path.
_ORDER_TRANSITIONS = [
    {"from": "order_created",     "to": "order_validated",   "guard": None},   # submit (manual draft)
    {"from": "order_validated",   "to": "scheduling",        "guard": "control_gate:stage8"},  # Stage-8 gate

    {"from": "scheduling",        "to": "config",            "guard": None},
    {"from": "config",            "to": "installation",      "guard": None},
    {"from": "installation",      "to": "connection_test",   "guard": None},
    {"from": "connection_test",   "to": "payment_confirmed", "guard": None},
    {"from": "payment_confirmed", "to": "activation",        "guard": None},
    {"from": "order_validated",   "to": "cancelled",         "guard": None},   # off-ramps
    {"from": "scheduling",        "to": "cancelled",         "guard": None},
    {"from": "config",            "to": "cancelled",         "guard": None},
]


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
                    continue
                keep_keys = [k for (k, _l, _o, _i) in statuses]
                # 0) rename record statuses first, so pruning legacy StatusDefs never orphans a record
                for old, new in _RECORD_STATUS_RENAMES.get(ent_key, {}).items():
                    await s.execute(
                        update(Record).where(
                            Record.tenant_id == t.id, Record.entity_key == ent_key, Record.status == old
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
                # 3) ORDER WorkflowDef transitions → iron-rule chain (the dev DB graph is legacy
                #    NEW→FULFILLING→COMPLETED). This is what the config-driven advance reads.
                if ent_key == "order":
                    wf = (await s.execute(
                        select(WorkflowDef).where(WorkflowDef.entity_def_id == ent.id)
                    )).scalars().first()
                    if wf is not None:
                        cfg = dict(wf.config or {})
                        if cfg.get("transitions") != _ORDER_TRANSITIONS:
                            cfg["transitions"] = _ORDER_TRANSITIONS
                            wf.config = cfg
                            wf_fixed += 1
        await s.commit()
    _log.info("seed_lifecycle_statuses: +%d SST status(es), -%d legacy, %d order-workflow fixed",
              inserted, deleted, wf_fixed)
    return {"inserted": inserted, "deleted": deleted, "workflow_fixed": wf_fixed}
