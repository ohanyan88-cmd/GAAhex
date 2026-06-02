# Automation Standard (file 18)

LOCKED. Resolves SOURCE NOT PROVIDED for **Automation** (display-order #20; file 18). Written
code-accurate against `models/automation.py`, `models/meta.py` (`WorkflowDef`), and
`kernel/workflow_engine.py`.

## 1. Two mechanisms, one boundary
The platform has **two** reactive mechanisms. The boundary is not a style choice — pick by shape:

- **AutomationRule** — *single-entity, single-step* reactions. One trigger event on one entity,
  one optional condition, one action. No owner, no SLA, no approval, no multi-step state.
- **WorkflowDef + workflow engine** (SPEC §5 Universal Workflow Contract) — *cross-entity,
  multi-step* orchestration with an owner, optional SLA, optional approval gate, an ordered action
  list, failure handling, and a running instance with its own state.

Rule of thumb: if it spans entities, needs ordering, an owner, an SLA, or an approval gate → it's
a Workflow. Otherwise → an AutomationRule.

## 2. AutomationRule (`automation_rule`)
Tenant-scoped. Fields: `id, tenantId, key, name, eventType, entityKey, condition, action,
isActive, order`.
- `eventType ∈ create | update | transition | delete` — the record event that fires the rule.
- `condition` — an optional GXL expression evaluated against the record context; `null` = always.
- `action` — JSONB `{type, config}` where `type ∈ notify | set_field | webhook | emit_event`.
- `order` — evaluation order among rules on the same entity/event; `isActive` toggles it.

## 3. WorkflowDef (`workflow_def`) — the Universal Workflow Contract
A `WorkflowDef` row is a **template**. The §5.1 contract maps 1:1 to columns:
`trigger_spec` (trigger), `conditions_spec` (guard), `actions_spec` (ordered action list),
`owner_module` (the single owner, §0.1), `sla_seconds` (budget; null = none),
`approval_required` (wires the §4.5 gate), `notification_def_key`, `failure_action`.
`(tenantId, key)` unique (idempotent seeding). A NULL `entity_def_id` = cross-entity workflow; a
set `entity_def_id` = a legacy entity-lifecycle definition (`config.transitions`) driving guarded
status transitions.

## 4. Conditions
`conditions_spec` supports the structured shape `{"all": [{"key": ..., "equals": ...}, ...]}` and
GXL/CEL guard expressions, evaluated **before** actions run. A failing condition stops the run
without side effects.

## 5. Actions (§5.3 verbs)
Actions run **in order**. Supported verbs are registered in the engine's `_ACTION_HANDLERS`
dispatch table; adding a verb = registering a handler, no call-site change. Current verbs include
`control_gate`, `send_notification`, `set_field`, `emit_event`/`create_record`.
**Reused engines are never duplicated:**
- `control_gate` delegates to `kernel/control_gate.assert_can_advance_to_scheduling` (§3 Stage 8 —
  single source of truth).
- `send_notification` delegates to `routers/notifications.emit_notification` (the platform's one
  notification path).
- every state transition emits a `workflow.*` event via `app.workflow.emit` (append-only, §0.4).

## 6. Failure handling (`failure_action`)
- `retry` — surface the exception (caller may retry); instance left `failed` with `failure_reason`.
- `escalate` — instance → `escalated`; `sla_breached_at` set if the `sla_seconds` budget was
  exceeded.
- `audit_only` — log `workflow.action_failed` and continue to the next action.
- `rollback` — instance → `failed`; the engine signals the caller-owned transaction to roll back.

## 7. Instance state + transaction model
Running state and the per-run audit live on `WorkflowInstance` (`running | completed | failed |
escalated`), never on the `_def` template. The engine is **transaction-agnostic** — it never
commits or rolls back; the caller's unit of work owns the boundary.

## 8. Cross-references
GXL/CEL is the shared condition DSL (Workflow & Automation Standard). Events are append-only
(file 06, §0.4). Owner (§0.1) and approval gate (§4.5) are enforced by the Security/Permission
Standard (file 17).
