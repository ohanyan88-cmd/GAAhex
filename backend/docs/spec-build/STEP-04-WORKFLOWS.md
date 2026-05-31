# Step 4 — SPEC §5 Workflow Orchestration (W1-W5 + engine + router)

**Date:** 2026-05-31
**Author:** spec-build / workflow agent
**Scope:** Land the SPEC §5 Universal Workflow Contract — engine, 5 SPEC workflows (W1-W5), router. Additive only. File-only verification on temp DB. No live-DB migration.

---

## 1. SPEC §5 source (verbatim, lines 222-253 of `GAAex_Cross_Module_Architecture_SPEC.md`)

### 5.1 Universal Workflow Contract
> Every workflow has: Trigger · Conditions · Actions · **Single Owner** · SLA · Status · Approval (if needed) · Notification · Audit log · Failure handling.

### 5.2 Triggers
> Record created/updated · Status changed · SLA breached · Payment failed · Invoice overdue · Ticket escalated · Alarm opened · Installation scheduled · Work order completed · Contract signed · Customer activated · Stock low · Approval requested · AI risk detected.

### 5.3 Actions
> Create task/ticket/work order · Assign user/team · Notify · Email/message · Update status · Request approval · Generate document · Create invoice · Suspend/activate service · Escalate · Add timeline event · Add note · Trigger AI summary · Trigger report update.

### 5.4 Key End-to-End Workflows (with control gates)
W1 — Lead to Activation · W2 — Ticket to Resolution · W3 — Billing & Collection · W4 — Network Incident to Customer Impact · W5 — Procurement to Asset.

---

## 2. Stage 8 control gate REUSE (the non-negotiable)

SPEC §3 control rule (verbatim, line 187): _"Stage 8 is the single mandatory gate between Sales and Fulfillment. The validator (Revenue Control) is organizationally separate from the order creator (Sales). No order advances to Scheduling without Control Pass = TRUE."_

SPEC §10.4 codifies this as kernel enforcement: _"advance_to_scheduling is impossible while control_pass != TRUE."_

The Stage 8 gate is implemented at `backend/app/kernel/control_gate.py:49` as `assert_can_advance_to_scheduling`. **The workflow engine REUSES this kernel function — there is NO second gate.**

The W1 workflow's `control_gate` action handler at `backend/app/kernel/workflow_engine.py:_action_control_gate` reads `order_id` and `control_pass` out of the engine's `context` dict and calls the kernel function directly:

```python
from .control_gate import assert_can_advance_to_scheduling, ControlGateNotPassed
...
await assert_can_advance_to_scheduling(s, order_id=order_id, control_pass=control_pass)
```

This is the single source of truth. The W1 seed embeds the action as `{"type": "control_gate", "order_id_from_context": "order_id", "control_pass_from_context": "control_pass"}` — naming the context keys, not the gate logic. Re-running the workflow with a different `control_pass` re-evaluates the SAME kernel function.

---

## 3. What this step did

1. **Engine.** New `backend/app/kernel/workflow_engine.py`. Public surface: `trigger_workflow`, `execute_action`, `WorkflowExecutionError`. Dispatch table `_ACTION_HANDLERS` for the 5 action verbs the W1-W5 seeds need (`control_gate`, `send_notification`, `advance_stage`, `create_task`, `audit_only`). Transaction-agnostic — caller owns commit. Re-exports added to `backend/app/kernel/__init__.py`.
2. **Seed.** New `backend/app/seed_workflows.py`. Defines `SPEC_WORKFLOWS` (5 rows) and `seed_workflows_if_missing()`. Idempotent via `pg_insert(...).on_conflict_do_nothing(["tenant_id", "key"])` against the `uq_workflow_def_key` UNIQUE constraint (added by Alembic revision `7a4b1e9c2f08`). Hooked into `main.py` lifespan after `seed_canonical_pipeline_if_empty()`.
3. **Router.** New `backend/app/routers/workflows.py`. Four endpoints: list defs, list instances, get instance, POST manual trigger. POST gated by `assert_can(action='manage', entity_key='workflow')`. Mounted in `main.py` before the generic `/api/{slug}` records router.
4. **Test.** New `backend/tests/test_workflows.py`. Five tests cover seed presence, manual trigger creates an instance, W1 control_gate refuses with `control_pass=False` AND `control_pass=NULL`, and SPEC_WORKFLOWS module completeness.

The migration (`7a4b1e9c2f08_spec_5_workflows.py`) and the `WorkflowInstance` model were already in place from the prior agent's work — this step did NOT modify the schema, only added runtime code on top.

---

## 4. Per-workflow Universal Contract (SPEC §5.1)

### W1 — Lead to Activation

| Field | Value |
| --- | --- |
| **Trigger** | `record_created` on `entity_key=lead` |
| **Conditions** | none (every new lead enters W1) |
| **Actions** | `audit_only` (lead received) → `advance_stage` (qualified) → `audit_only` (Stage 7 order created) → **`control_gate`** (SPEC §3 Stage 8 — delegates to `assert_can_advance_to_scheduling`) → `advance_stage` (scheduling) → `send_notification` (customer.activated) |
| **Owner module** | Pipeline |
| **SLA** | 432000s (5 business days @ 8h) |
| **Approval required** | False (the Stage 8 gate IS the approval surface for this workflow) |
| **Notification** | `customer.activated` |
| **Audit** | `workflow.triggered`, `workflow.action_executed` per step, `workflow.completed` / `workflow.failed` |
| **Failure action** | `retry` (Stage 8 failure surfaces to caller; async re-trigger from a later Revenue Control verdict re-runs the workflow) |

### W2 — Ticket to Resolution

| Field | Value |
| --- | --- |
| **Trigger** | `record_created` on `entity_key=ticket` |
| **Conditions** | none |
| **Actions** | `audit_only` (ticket received) → `create_task` (investigate, role=customer_care) → `send_notification` (ticket.assigned) → `audit_only` (SLA clock running) → `send_notification` (ticket.resolved) → `audit_only` (KPI=first_contact_resolution) |
| **Owner module** | Tickets |
| **SLA** | 86400s (24h First Contact Resolution envelope) |
| **Approval required** | False |
| **Notification** | `ticket.resolved` |
| **Audit** | full lifecycle via `workflow.*` events |
| **Failure action** | `escalate` (SPEC §5.4: "escalate on SLA risk") |

### W3 — Billing & Collection

| Field | Value |
| --- | --- |
| **Trigger** | `billing_cycle_started` on `entity_key=invoice` |
| **Conditions** | none |
| **Actions** | `audit_only` (cycle start) → `send_notification` (invoice.issued) → `audit_only` (payment_expected) → `create_task` (dunning, role=billing) → `audit_only` (KPI=collection_recovery_rate) |
| **Owner module** | Billing |
| **SLA** | 2592000s (30-day collection window) |
| **Approval required** | False |
| **Notification** | `invoice.issued` |
| **Audit** | per-step `workflow.*` events; invoice/payment immutability enforced separately at the §0.4 entity layer |
| **Failure action** | `escalate` |

### W4 — Network Incident to Customer Impact

| Field | Value |
| --- | --- |
| **Trigger** | `alarm_opened` on `entity_key=alarm` (alarm module deferred — workflow is dormant in M0) |
| **Conditions** | none |
| **Actions** | `audit_only` (alarm received) → `audit_only` (incident opened, impacted_assets/services) → `create_task` (NOC investigate, role=network) → `audit_only` (customer comms sent) → `audit_only` (resolved, KPI=mean_time_to_restore) |
| **Owner module** | Incidents & Outages |
| **SLA** | 14400s (4h MTTR target) |
| **Approval required** | False |
| **Notification** | `incident.opened` |
| **Audit** | per-step `workflow.*` events |
| **Failure action** | `escalate` |

### W5 — Procurement to Asset

| Field | Value |
| --- | --- |
| **Trigger** | `record_created` on `entity_key=purchase_request` (Procurement / Asset modules deferred) |
| **Conditions** | none |
| **Actions** | `audit_only` (PR created) → `audit_only` (approval requested — mandatory per §4.5) → `audit_only` (PO issued) → `audit_only` (goods received) → `audit_only` (asset created, KPI=po_cycle_time) |
| **Owner module** | Procurement |
| **SLA** | 1209600s (14-day procurement cycle) |
| **Approval required** | **True** — SPEC §4.5 Procurement is mandatory-approval |
| **Notification** | `asset.created` |
| **Audit** | per-step `workflow.*` events |
| **Failure action** | `escalate` |

---

## 5. Engine action verbs (dispatch table)

The `_ACTION_HANDLERS` dispatch in `workflow_engine.py` registers 5 verbs:

| Verb | Handler | Purpose | Reuse |
| --- | --- | --- | --- |
| `control_gate` | `_action_control_gate` | SPEC §3 Stage 8 enforcement | calls `assert_can_advance_to_scheduling` — never duplicates |
| `send_notification` | `_action_send_notification` | inbox + external delivery | calls `routers.notifications.emit_notification` |
| `advance_stage` | `_action_advance_stage` | emit `workflow.stage_advanced` audit Event | calls `workflow.emit` (SPEC §0.4) |
| `create_task` | `_action_create_task` | emit `workflow.task_requested` audit Event | calls `workflow.emit`; real task creation owned by Tasks module per §0.1 |
| `audit_only` | `_action_audit_only` | emit a custom-typed audit Event with payload | calls `workflow.emit`; serves as placeholder for deferred SPEC verbs |

Adding a new verb is one entry in the dispatch table. The engine itself never grows new code paths per verb.

---

## 6. Router shape

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/api/workflows` | list workflow_def rows (optional `?owner_module=`) | any authenticated user |
| GET | `/api/workflow-instances` | list instances (optional `?status=`, `?workflow_key=`) | any authenticated user |
| GET | `/api/workflow-instances/{id}` | instance detail | any authenticated user |
| POST | `/api/workflow-instances` | manually trigger a workflow run | `assert_can(action='manage', entity_key='workflow')` — admin/super_admin pass via wildcard |

All paths are tenant-scoped via the caller's session. Mounted in `main.py` BEFORE `records.router` so they aren't swallowed as `/api/{slug}` entity routes.

---

## 7. Failure semantics (SPEC §5.1)

`WorkflowDef.failure_action` drives the engine on action exceptions:

| Value | Behavior |
| --- | --- |
| `retry` | `instance.status='failed'`, `failure_reason` populated, exception surfaces to caller. Async retry monitor deferred to a later step. |
| `escalate` | `instance.status='escalated'`, `sla_breached_at` populated when `sla_seconds` exhausted, exception surfaces. |
| `audit_only` | failure logged via `emit(workflow.action_failed, ...)`, engine continues to next action — instance stays running. |
| `rollback` | `instance.status='failed'`, exception surfaces; caller is expected to roll back the txn. The engine never calls `s.rollback()` itself. |

Every transition (`workflow.triggered` / `workflow.action_executed` / `workflow.action_failed` / `workflow.completed` / `workflow.escalated` / `workflow.failed`) writes an Event via `app.workflow.emit`, which the existing webhook + automation pipelines fan out from for free.

---

## 8. Idempotency

- **Seed.** `pg_insert(...).on_conflict_do_nothing(index_elements=["tenant_id","key"])` against the `uq_workflow_def_key` UNIQUE (added by Alembic revision `7a4b1e9c2f08`). Re-running `seed_workflows_if_missing()` after the first boot inserts 0 rows.
- **Engine.** `trigger_workflow` always creates a fresh `WorkflowInstance` — duplicate suppression is the caller's responsibility. The action loop is forward-only; there's no replay logic today.
- **Migration.** Additive only — 8 NULLable columns added to `workflow_def`, one UNIQUE constraint, one new table `workflow_instance` with RLS. Reversible via the migration's `downgrade()` (in the file the prior agent created).

---

## 9. Out of scope / deferred

| Item | Reason |
| --- | --- |
| Async SLA monitor | sla_breached_at is set on-demand by the engine today, not by a background worker. Real-time SLA enforcement is a follow-up step. |
| W4 / W5 module wiring | Incidents, Outages, Procurement, Inventory modules don't exist in M0. The defs are seeded with `audit_only` action shapes so they're SPEC-shaped today; swap the action `type` (no def re-seed) when the real modules land. |
| GXL conditions DSL | `conditions_spec` evaluator supports `{all: [...]}` / `{any: [...]}` of `{key, equals}` clauses only. Full GXL guard expressions land with the conditions DSL in a later step. |
| Live DB apply | file-only per Gev's gate. Verified on the temp test DB (gaaex_test) which the conftest spins fresh per session via `Base.metadata.create_all`. |
| W1's full §3 pipeline mutation | `advance_stage` records intent via Event; actual record-status mutation belongs to the entity router (write-lock owner per §0.1). A future "stage_apply" action verb can wire the mutation when the SPEC has settled on a single record-of-truth for pipeline stage on the canonical `record` table. |

---

## 10. Verification

```
$ .venv/Scripts/python.exe -m pytest tests/test_workflows.py -q
.....                                                                    [100%]
5 passed in 5.53s

$ .venv/Scripts/python.exe -m pytest -q
569 passed, 8 skipped, 1 xfailed, 2 failed in 86s
```

The 2 failures (`test_timeline_pagination_cursor`, `test_timeline_append_only_db_level`) reproduce against `main` with the Step 4 changes stashed out — they are pre-existing and unrelated to this step.

**File-only.** No `alembic upgrade head` was run against the dev database. The migration file `7a4b1e9c2f08_spec_5_workflows.py` is staged on disk for the next live-apply gate.
