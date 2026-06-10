"""Step 4 — SPEC §5 workflow seeds (W1-W5).

Seeds the 5 SPEC §5.4 Key End-to-End Workflows as `workflow_def` rows carrying the Universal
Workflow Contract (SPEC §5.1) — Trigger · Conditions · Actions · Owner · SLA · Approval ·
Notification · Failure handling. Each row is created per-tenant and is idempotent on
`(tenant_id, key)` via `pg_insert(...).on_conflict_do_nothing()` (the matching DB UNIQUE
`uq_workflow_def_key` is added by Alembic revision `7a4b1e9c2f08`).

W1 references the SPEC §3 Stage 8 control gate via a `control_gate` action — that action type
delegates to `app.kernel.control_gate.assert_can_advance_to_scheduling`. **NO second gate is
created here.** Stage 8 is the single source of truth.

W4 (Network Incident) and W5 (Procurement → Asset) reference modules that don't exist in M0
(Incidents, Outages, Procurement, Inventory). Their actions are seeded with `audit_only` shapes
so the engine can run them end-to-end today; when the real modules land, swap the action `type`
without re-seeding the def row.

Call site: `backend/app/main.py` lifespan, AFTER `seed_canonical_pipeline_if_empty()` (the W1
control_gate action depends on the Stage 8 row being present).
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models import Tenant, WorkflowDef


_log = logging.getLogger("gaahex.seed_workflows")


# =========================================================================== SPEC §5.4 W1..W5

# Each entry is a complete Universal Workflow Contract (SPEC §5.1):
#   key, label, owner_module, trigger_spec, conditions_spec, actions_spec, sla_seconds,
#   approval_required, notification_def_key, failure_action.
#
# `entity_def_id` stays NULL — these are CROSS-entity workflows; the column is nullable as of
# Alembic revision 7a4b1e9c2f08. `config` stays NULL — that's the legacy entity-lifecycle blob
# slot; SPEC §5 rows use the dedicated columns instead.

SPEC_WORKFLOWS: list[dict] = [
    # ---------------------------------------------------- W1 — Lead to Activation
    {
        "key": "w1_lead_to_activation",
        "label": "W1 — Lead to Activation",
        "owner_module": "Pipeline",
        # SPEC §5.2 trigger — "Lead created" event from the catalog `lead` entity.
        "trigger_spec": {
            "type": "record_created",
            "entity_key": "lead",
        },
        # No structural pre-conditions on entry — every new lead enters W1.
        "conditions_spec": {},
        # SPEC §5.3 action list. Stage 8 (`control_gate`) reuses the kernel function and IS
        # NOT a second gate. The advance_stage / send_notification / audit_only verbs are
        # implemented in kernel.workflow_engine; their handlers are dispatch-registered.
        "actions_spec": [
            {"type": "audit_only", "event_type": "w1.lead_received",
             "data": {"stage": "lead", "note": "W1 entered at Stage 1 (Lead)"}},
            {"type": "advance_stage", "to_stage_key": "validated_lead"},
            {"type": "audit_only", "event_type": "w1.stage7_order_created",
             "data": {"stage": "order_created"}},
            # SPEC §3 Stage 8 — the single mandatory gate between Sales and Fulfillment.
            # The handler delegates to app.kernel.control_gate.assert_can_advance_to_scheduling.
            # When the engine is invoked without an order_id / control_pass in context the gate
            # short-circuits with WorkflowExecutionError (no order_id), which is the W1 path's
            # 'pending' state until Revenue Control writes the verdict.
            {"type": "control_gate",
             "order_id_from_context": "order_id",
             "control_pass_from_context": "control_pass"},
            {"type": "advance_stage", "to_stage_key": "scheduling"},
            {"type": "send_notification", "def_key": "customer.activated"},
        ],
        # SPEC §5.1 SLA budget (placeholder: 5 business days @ 8h = 144000s). Async monitor lands later.
        "sla_seconds": 5 * 24 * 60 * 60,
        # SPEC §4.5 — W1 carries the Stage 8 control gate but no global approval (the gate
        # itself is the approval surface; control_pass=TRUE *is* the Revenue Control approval).
        "approval_required": False,
        "notification_def_key": "customer.activated",
        # Stage 8 failure is a hard block — surface to the caller so the order isn't allowed
        # to advance. `retry` flags the instance as failed and surfaces the exception; an
        # async monitor / re-trigger from a later Revenue Control verdict re-runs the workflow.
        "failure_action": "retry",
    },
    # ---------------------------------------------------- W2 — Ticket to Resolution
    {
        "key": "w2_ticket_to_resolution",
        "label": "W2 — Ticket to Resolution",
        "owner_module": "Tickets",
        "trigger_spec": {
            "type": "record_created",
            "entity_key": "ticket",
        },
        "conditions_spec": {},
        "actions_spec": [
            {"type": "audit_only", "event_type": "w2.ticket_received",
             "data": {"note": "W2 entered — type/cause classification pending"}},
            {"type": "create_task", "task_kind": "ticket_investigate",
             "assignee_role": "customer_care"},
            {"type": "send_notification", "def_key": "ticket.assigned"},
            {"type": "audit_only", "event_type": "w2.investigation_in_progress",
             "data": {"sla_clock_running": True}},
            {"type": "send_notification", "def_key": "ticket.resolved"},
            {"type": "audit_only", "event_type": "w2.closed",
             "data": {"kpi": "first_contact_resolution"}},
        ],
        # SLA: 24h First Contact Resolution KPI envelope per SPEC §5.4 (placeholder).
        "sla_seconds": 24 * 60 * 60,
        "approval_required": False,
        "notification_def_key": "ticket.resolved",
        # Escalate when an action fails — SPEC §5.4 explicitly calls out "escalate on SLA risk".
        "failure_action": "escalate",
    },
    # ---------------------------------------------------- W3 — Billing & Collection
    {
        "key": "w3_billing_collection",
        "label": "W3 — Billing & Collection",
        "owner_module": "Billing",
        # Trigger: the billing cycle's start tick (a domain event the cycle runner emits).
        "trigger_spec": {
            "type": "billing_cycle_started",
            "entity_key": "invoice",
        },
        "conditions_spec": {},
        "actions_spec": [
            {"type": "audit_only", "event_type": "w3.cycle_start",
             "data": {"note": "W3 invoice generation kick-off"}},
            {"type": "send_notification", "def_key": "invoice.issued"},
            {"type": "audit_only", "event_type": "w3.payment_expected",
             "data": {"reminder_at": "due_date"}},
            # Overdue → dunning (a SPEC §5.4 action; full collections pipeline TBD).
            {"type": "create_task", "task_kind": "dunning",
             "assignee_role": "billing"},
            {"type": "audit_only", "event_type": "w3.payment_received",
             "data": {"kpi": "collection_recovery_rate"}},
        ],
        # SPEC §5.4: SPECs immutability ("Invoices/Payments immutable — no delete") is enforced
        # at the entity level by §0.4 audit invariants; the workflow itself just records.
        "sla_seconds": 30 * 24 * 60 * 60,  # 30-day collection window
        "approval_required": False,
        "notification_def_key": "invoice.issued",
        "failure_action": "escalate",
    },
    # ---------------------------------------------------- W4 — Network Incident to Customer Impact
    {
        "key": "w4_incident_to_impact",
        "label": "W4 — Network Incident to Customer Impact",
        "owner_module": "Incidents & Outages",
        # Trigger: an `alarm_opened` event from monitoring. Module doesn't exist in M0 — the
        # workflow is dormant until alarms start firing. trigger_workflow can still be called
        # manually via the admin POST endpoint.
        "trigger_spec": {
            "type": "alarm_opened",
            "entity_key": "alarm",
        },
        "conditions_spec": {},
        # Actions are audit_only until the Incidents / NOC modules land — the structure is
        # SPEC-shaped so the def isn't reseeded when the real handlers register.
        "actions_spec": [
            {"type": "audit_only", "event_type": "w4.alarm_received",
             "data": {"note": "W4 entered from monitoring"}},
            {"type": "audit_only", "event_type": "w4.incident_opened",
             "data": {"impacted_assets": "tbd", "impacted_services": "tbd"}},
            {"type": "create_task", "task_kind": "noc_investigate",
             "assignee_role": "network"},
            {"type": "audit_only", "event_type": "w4.customer_comms_sent",
             "data": {"channel": "email"}},
            {"type": "audit_only", "event_type": "w4.resolved",
             "data": {"kpi": "mean_time_to_restore"}},
        ],
        # Tight SLA — 4h MTTR target (placeholder per SPEC §5.4).
        "sla_seconds": 4 * 60 * 60,
        "approval_required": False,
        "notification_def_key": "incident.opened",
        "failure_action": "escalate",
    },
    # ---------------------------------------------------- W5 — Procurement to Asset
    {
        "key": "w5_procurement_to_asset",
        "label": "W5 — Procurement to Asset",
        "owner_module": "Procurement",
        # Trigger: a purchase request created. Procurement / Asset Management modules are
        # deferred; this workflow is seeded as a SPEC placeholder.
        "trigger_spec": {
            "type": "record_created",
            "entity_key": "purchase_request",
        },
        "conditions_spec": {},
        "actions_spec": [
            {"type": "audit_only", "event_type": "w5.pr_created",
             "data": {"stage": "purchase_request"}},
            # SPEC §4.5 lists Procurement under Mandatory Approvals — surface that via the
            # approval_required column. The gate is enforced by the approvals kernel when
            # POSTed via the routers/approvals workflow today; W5 records intent here.
            {"type": "audit_only", "event_type": "w5.approval_requested",
             "data": {"mandatory_approval": "procurement"}},
            {"type": "audit_only", "event_type": "w5.po_issued",
             "data": {"stage": "po"}},
            {"type": "audit_only", "event_type": "w5.goods_received",
             "data": {"stage": "grn"}},
            {"type": "audit_only", "event_type": "w5.asset_created",
             "data": {"kpi": "po_cycle_time"}},
        ],
        # Procurement cycle measured in days; 14-day SLA placeholder.
        "sla_seconds": 14 * 24 * 60 * 60,
        "approval_required": True,         # SPEC §4.5 — Procurement is mandatory-approval
        "notification_def_key": "asset.created",
        "failure_action": "escalate",
    },
]


# ============================================================================= seeder

async def seed_workflows_if_missing() -> int:
    """Insert the 5 SPEC §5 workflow_def rows for every tenant. Idempotent.

    Returns:
        Total number of rows actually inserted across all tenants (0 on a fully-seeded re-run).

    Idempotency: `pg_insert(...).on_conflict_do_nothing(index_elements=["tenant_id", "key"])`
    relies on the UNIQUE constraint `uq_workflow_def_key` added by Alembic revision
    `7a4b1e9c2f08`. The SQLAlchemy model declares the same constraint so test DBs created via
    `Base.metadata.create_all` also have it.
    """
    inserted = 0
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
        tenants = (await s.execute(select(Tenant))).scalars().all()
        if not tenants:
            _log.info("seed_workflows: no tenants — nothing to seed")
            return 0

        for t in tenants:
            for wf in SPEC_WORKFLOWS:
                stmt = (
                    pg_insert(WorkflowDef.__table__)
                    .values(
                        tenant_id=t.id,
                        entity_def_id=None,          # SPEC §5 is cross-entity
                        key=wf["key"],
                        label=wf["label"],
                        config=None,                 # legacy slot unused for §5 rows
                        trigger_spec=wf["trigger_spec"],
                        conditions_spec=wf["conditions_spec"],
                        actions_spec=wf["actions_spec"],
                        owner_module=wf["owner_module"],
                        sla_seconds=wf["sla_seconds"],
                        approval_required=wf["approval_required"],
                        notification_def_key=wf["notification_def_key"],
                        failure_action=wf["failure_action"],
                    )
                    .on_conflict_do_nothing(index_elements=["tenant_id", "key"])
                )
                res = await s.execute(stmt)
                if res.rowcount:
                    inserted += res.rowcount

        await s.commit()

    _log.info(
        "seed_workflows: %d workflow_def row(s) inserted across %d tenant(s)",
        inserted, len(tenants),
    )
    return inserted


if __name__ == "__main__":
    import asyncio
    print("SPEC §5 workflow seed result:", asyncio.run(seed_workflows_if_missing()))
