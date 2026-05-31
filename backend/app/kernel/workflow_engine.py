"""SPEC §5 Workflow Orchestration — engine.

The engine is the runtime that interprets the Universal Workflow Contract (SPEC §5.1) rows seeded
into `workflow_def` and drives them to a terminal state on a `workflow_instance` row.

Public surface:

    trigger_workflow(s, *, tenant_id, workflow_key, context)
        Look up the `workflow_def` by `(tenant_id, key)`, evaluate `conditions_spec` against the
        incoming context, create a `WorkflowInstance` row in status='running', then execute the
        `actions_spec` list in order. Drives the instance to status='completed' on success or
        status='failed' / status='escalated' on failure (per the def's `failure_action`).

    execute_action(s, *, instance, action, context)
        Dispatch one action by its `type`. The supported action types are the SPEC §5.3 verbs
        most relevant to the W1..W5 seed workflows; new verbs are added by registering a handler
        in the `_ACTION_HANDLERS` dispatch table below — no other change needed.

Reused engines (NEVER duplicated):

    * SPEC §3 Stage 8 control gate — the `control_gate` action delegates to
      `app.kernel.control_gate.assert_can_advance_to_scheduling`. This module does NOT
      re-implement the gate; it is the single SOT and W1's Stage 8 action calls into it.
    * Notification emit — the `send_notification` action delegates to
      `app.routers.notifications.emit_notification` (the same path the rest of the platform
      uses to emit inbox + external notifications).
    * Append-only audit — every state transition emits a `workflow.*` Event via the existing
      `app.workflow.emit` helper (SPEC §0.4 append-only).

Failure semantics (SPEC §5.1 "Failure handling"):

    * `failure_action='retry'`        — surface the exception (caller can retry); instance left
                                        as 'failed' with `failure_reason`. (Async retry monitor
                                        deferred to a later step.)
    * `failure_action='escalate'`     — instance flipped to 'escalated'; `sla_breached_at` set
                                        if a `sla_seconds` budget was already exceeded.
    * `failure_action='audit_only'`   — failure is logged via `emit(workflow.action_failed, …)`
                                        and the engine continues to the next action.
    * `failure_action='rollback'`     — instance flipped to 'failed' and the caller-owned txn
                                        is signalled to roll back (caller handles the rollback
                                        — engine itself never commits or rolls back).

The engine is transaction-agnostic: it never calls `s.commit()` or `s.rollback()`. The caller's
unit of work owns the txn boundary, the same way `app.workflow.emit` and `emit_notification` do.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import WorkflowDef, WorkflowInstance
from .control_gate import assert_can_advance_to_scheduling, ControlGateNotPassed

_log = logging.getLogger("gaaex.kernel.workflow_engine")


class WorkflowExecutionError(Exception):
    """A workflow action raised and the def's `failure_action` was not `audit_only`.

    Maps to HTTP 409 Conflict at the router boundary. The `instance_id` attribute carries the
    failed instance so callers can fetch its `failure_reason` / `current_action_index` for diagnostics.
    """

    def __init__(self, message: str, *, instance_id: uuid.UUID | None = None) -> None:
        super().__init__(message)
        self.instance_id = instance_id


# ============================================================================ trigger entry point

async def trigger_workflow(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    workflow_key: str,
    context: dict | None = None,
    triggered_by_record_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> WorkflowInstance:
    """Fire one workflow run. Idempotent in the sense that re-firing creates a fresh instance —
    duplicate suppression is the caller's concern (workflows are designed to be re-runnable).

    Args:
        s:                       AsyncSession owned by the caller — the engine does not commit.
        tenant_id:               UUID of the tenant whose def to look up.
        workflow_key:            `workflow_def.key` — e.g. 'w1_lead_to_activation'.
        context:                 Free-form dict passed into every action handler and evaluated
                                 against `conditions_spec`. Accumulates per-action results so
                                 later actions can chain on earlier output.
        triggered_by_record_id:  Record that fired the workflow (a lead created, a ticket, …).
                                 Stored on the instance for audit/correlation. Optional.
        actor_user_id:           Who fired the workflow (for audit). Optional — system triggers
                                 are valid and leave this NULL.

    Returns:
        The `WorkflowInstance` row in its final state. Status will be one of
        running|completed|failed|escalated depending on action outcomes + `failure_action`.

    Raises:
        WorkflowExecutionError when the def is missing, conditions_spec evaluates falsy
        (caller-style precondition violation), or an action fails and `failure_action` is not
        `audit_only`. The exception's `instance_id` (when set) lets the caller fetch the row for
        the failure_reason.
    """
    ctx: dict = dict(context or {})

    # ---- def lookup (tenant-scoped; NULLs OK for legacy entity-lifecycle rows)
    wdef = (await s.execute(
        select(WorkflowDef).where(
            WorkflowDef.tenant_id == tenant_id,
            WorkflowDef.key == workflow_key,
        )
    )).scalar_one_or_none()
    if not wdef:
        raise WorkflowExecutionError(
            f"workflow_def not found: tenant={tenant_id} key={workflow_key}"
        )

    # ---- conditions_spec gating (SPEC §5.1 'Conditions')
    # Empty/missing → always-allow. A non-empty conditions_spec is a structured gate; today the
    # only supported shape is `{"all": [{"key": "...", "equals": ...}, ...]}` evaluated against
    # `context`. More complex GXL guards land with the conditions DSL in a later step.
    if wdef.conditions_spec and not _evaluate_conditions(wdef.conditions_spec, ctx):
        raise WorkflowExecutionError(
            f"workflow_def conditions failed: key={workflow_key}"
        )

    # ---- instance creation (status='running', current_action_index=0)
    instance = WorkflowInstance(
        tenant_id=tenant_id,
        workflow_key=workflow_key,
        triggered_by_record_id=triggered_by_record_id,
        status="running",
        current_action_index=0,
        context=dict(ctx),  # snapshot the trigger context onto the row
    )
    s.add(instance)
    await s.flush()

    # ---- audit: workflow.triggered (append-only via app.workflow.emit)
    from ..workflow import emit  # local import: avoid kernel↔app cycle
    await emit(
        s,
        tenant_id,
        "workflow.triggered",
        "workflow_instance",
        instance.id,
        actor_user_id,
        {"workflow_key": workflow_key, "context_keys": list(ctx.keys())},
    )

    # ---- action loop
    actions: list[dict] = list(wdef.actions_spec or [])
    failure_action = (wdef.failure_action or "audit_only").lower()
    sla_seconds = wdef.sla_seconds

    for idx, action in enumerate(actions):
        instance.current_action_index = idx
        try:
            result = await execute_action(s, instance=instance, action=action, context=ctx)
            # Accumulate the action's result into context so later actions can chain on it.
            if isinstance(result, dict):
                ctx[f"_action_{idx}"] = result
                instance.context = dict(ctx)  # rebind so JSONB-dirty detection fires
            await emit(
                s,
                tenant_id,
                "workflow.action_executed",
                "workflow_instance",
                instance.id,
                actor_user_id,
                {"action_index": idx, "action_type": action.get("type"), "result": _safe_summary(result)},
            )
        except Exception as exc:
            # Per-action failure handling, per SPEC §5.1.
            reason = f"action[{idx}] type={action.get('type')!r}: {exc}"
            instance.failure_reason = reason
            await emit(
                s,
                tenant_id,
                "workflow.action_failed",
                "workflow_instance",
                instance.id,
                actor_user_id,
                {"action_index": idx, "action_type": action.get("type"), "error": str(exc),
                 "failure_action": failure_action},
            )

            if failure_action == "audit_only":
                # Logged and continue — instance stays running, next action gets a shot.
                continue

            # Terminal failure paths.
            if failure_action == "escalate":
                instance.status = "escalated"
                instance.sla_breached_at = datetime.now(timezone.utc) if sla_seconds else None
                await emit(s, tenant_id, "workflow.escalated", "workflow_instance",
                           instance.id, actor_user_id, {"reason": reason})
                raise WorkflowExecutionError(reason, instance_id=instance.id) from exc

            # retry | rollback | (unknown) all collapse to status='failed'. retry: caller-driven;
            # rollback: caller signals txn rollback after seeing the exception.
            instance.status = "failed"
            await emit(s, tenant_id, "workflow.failed", "workflow_instance",
                       instance.id, actor_user_id, {"reason": reason})
            raise WorkflowExecutionError(reason, instance_id=instance.id) from exc

    # ---- happy path: all actions ran
    instance.status = "completed"
    instance.current_action_index = len(actions)
    instance.completed_at = datetime.now(timezone.utc)
    await emit(s, tenant_id, "workflow.completed", "workflow_instance",
               instance.id, actor_user_id, {"actions_run": len(actions)})
    return instance


# ============================================================================ action dispatcher

async def execute_action(
    s: AsyncSession,
    *,
    instance: WorkflowInstance,
    action: dict,
    context: dict,
) -> dict | None:
    """Dispatch ONE action by its `type`. Each handler returns a dict result (or None) — the
    `trigger_workflow` loop accumulates results into `context` so later actions can chain.

    Args:
        s:        AsyncSession owned by the caller — handlers do not commit.
        instance: The WorkflowInstance row — handlers may read `instance.tenant_id` /
                  `triggered_by_record_id` and may mutate `instance.context` (but should prefer
                  returning a result dict the loop merges in).
        action:   One element of `WorkflowDef.actions_spec` — a dict with at minimum a `type` key.
        context:  Cumulative context dict — input + accumulated results.

    Returns:
        Optional dict of result data the action emitted; the loop merges this into `context`
        under `_action_{index}` so subsequent action exprs can reference it.

    Raises:
        Whatever the action handler raises — the loop above translates that into a workflow
        failure path per the def's `failure_action`. Unknown action types raise
        WorkflowExecutionError ("unknown action type: ...").
    """
    atype = (action.get("type") or "").lower()
    handler = _ACTION_HANDLERS.get(atype)
    if not handler:
        raise WorkflowExecutionError(f"unknown action type: {atype!r}")
    return await handler(s, instance, action, context)


# ============================================================================ action handlers

async def _action_control_gate(
    s: AsyncSession,
    instance: WorkflowInstance,
    action: dict,
    context: dict,
) -> dict:
    """SPEC §3 Stage 8 control gate — delegates to `assert_can_advance_to_scheduling`.

    NEVER reimplements the gate logic. The kernel function is the single source of truth.

    Action shape:
        {"type": "control_gate",
         "order_id_from_context": "order_id",      # context key holding the order UUID
         "control_pass_from_context": "control_pass"  # context key holding the bool verdict
        }

    Both context keys default to `order_id` / `control_pass` if omitted. The handler reads them
    out of `context`, calls the kernel gate, and returns `{"passed": True}` on success.
    `ControlGateNotPassed` (the kernel's typed exception) propagates up to `trigger_workflow`,
    which translates it per the def's `failure_action`.
    """
    order_id_key = action.get("order_id_from_context", "order_id")
    cp_key = action.get("control_pass_from_context", "control_pass")
    order_id = context.get(order_id_key)
    control_pass = context.get(cp_key)
    if order_id is None:
        raise WorkflowExecutionError(
            f"control_gate action: context missing '{order_id_key}' (order_id)"
        )
    if isinstance(order_id, str):
        order_id = uuid.UUID(order_id)
    # Delegate to the kernel — DO NOT duplicate the gate logic here.
    await assert_can_advance_to_scheduling(s, order_id=order_id, control_pass=control_pass)
    return {"passed": True, "order_id": str(order_id)}


async def _action_send_notification(
    s: AsyncSession,
    instance: WorkflowInstance,
    action: dict,
    context: dict,
) -> dict:
    """Emit one inbox notification via the platform-wide `emit_notification` helper.

    Action shape:
        {"type": "send_notification",
         "def_key": "<NotificationDef key>",
         "user_id_from_context": "assignee_user_id",  # optional; default 'user_id'
         "entity_key": "lead"                          # optional; passed through
        }

    Returns `{"def_key": ..., "user_id": ..., "delivered": bool}`. Missing recipient is a
    soft no-op (returns delivered=False) so a workflow with no resolvable user doesn't
    cascade into a hard failure.
    """
    from ..routers.notifications import emit_notification  # local: avoid import cycle

    def_key = action.get("def_key")
    if not def_key:
        raise WorkflowExecutionError("send_notification action: 'def_key' required")
    user_key = action.get("user_id_from_context", "user_id")
    user_id = context.get(user_key)
    entity_key = action.get("entity_key")

    if user_id is None:
        return {"def_key": def_key, "user_id": None, "delivered": False, "reason": "no recipient"}

    if isinstance(user_id, str):
        user_id = uuid.UUID(user_id)
    note = await emit_notification(
        s,
        tenant_id=instance.tenant_id,
        def_key=def_key,
        user_id=user_id,
        entity_key=entity_key,
        record_id=instance.triggered_by_record_id,
        context=context,
    )
    return {"def_key": def_key, "user_id": str(user_id), "delivered": note is not None}


async def _action_advance_stage(
    s: AsyncSession,
    instance: WorkflowInstance,
    action: dict,
    context: dict,
) -> dict:
    """Record a stage advancement on the instance audit trail.

    Action shape:
        {"type": "advance_stage", "to_stage_key": "scheduling"}

    This is the workflow-level mutation: the engine logs the advance via `emit(workflow.advanced)`.
    Actual record-status mutation belongs to the entity router (which owns the write lock per SPEC
    §0.1); the workflow only records intent. Returns `{"advanced_to": "..."}`.
    """
    to_stage = action.get("to_stage_key")
    if not to_stage:
        raise WorkflowExecutionError("advance_stage action: 'to_stage_key' required")
    from ..workflow import emit
    await emit(
        s,
        instance.tenant_id,
        "workflow.stage_advanced",
        "workflow_instance",
        instance.id,
        None,
        {"workflow_key": instance.workflow_key, "to_stage_key": to_stage,
         "triggered_by_record_id": str(instance.triggered_by_record_id) if instance.triggered_by_record_id else None},
    )
    return {"advanced_to": to_stage}


async def _action_create_task(
    s: AsyncSession,
    instance: WorkflowInstance,
    action: dict,
    context: dict,
) -> dict:
    """Record intent to create a task; emits a `workflow.task_requested` Event.

    Action shape:
        {"type": "create_task",
         "task_kind": "follow_up",
         "assignee_role": "sales_agent"}

    The actual task-record creation is owned by the Tasks module (write-lock owner per §0.1).
    The workflow engine records the request as an Event so downstream subscribers (or a future
    task-creator action) can react. Returns `{"requested": True, "task_kind": "..."}`.
    """
    task_kind = action.get("task_kind", "generic")
    assignee_role = action.get("assignee_role")
    from ..workflow import emit
    await emit(
        s,
        instance.tenant_id,
        "workflow.task_requested",
        "workflow_instance",
        instance.id,
        None,
        {"workflow_key": instance.workflow_key, "task_kind": task_kind,
         "assignee_role": assignee_role,
         "triggered_by_record_id": str(instance.triggered_by_record_id) if instance.triggered_by_record_id else None},
    )
    return {"requested": True, "task_kind": task_kind, "assignee_role": assignee_role}


async def _action_audit_only(
    s: AsyncSession,
    instance: WorkflowInstance,
    action: dict,
    context: dict,
) -> dict:
    """Pure audit log entry — emit a custom-typed Event with the action's `data` payload.

    Action shape:
        {"type": "audit_only",
         "event_type": "workflow.checkpoint",
         "data": {"note": "..."}}

    Useful as a no-op placeholder for actions that are SPEC-listed but not yet implemented
    (procurement, inventory, …) so a workflow can be seeded and trigger end-to-end before
    its full action surface lands. Returns `{"audited": True}`.
    """
    from ..workflow import emit
    event_type = action.get("event_type", "workflow.audit")
    payload = action.get("data") or {}
    await emit(
        s,
        instance.tenant_id,
        event_type,
        "workflow_instance",
        instance.id,
        None,
        {**payload, "workflow_key": instance.workflow_key},
    )
    return {"audited": True, "event_type": event_type}


# Dispatch table — extend by registering a new (atype, async-callable) here.
_ACTION_HANDLERS: dict[str, Callable[[AsyncSession, WorkflowInstance, dict, dict], Awaitable[dict | None]]] = {
    "control_gate": _action_control_gate,
    "send_notification": _action_send_notification,
    "advance_stage": _action_advance_stage,
    "create_task": _action_create_task,
    "audit_only": _action_audit_only,
}


# ============================================================================ conditions helper

def _evaluate_conditions(spec: dict, context: dict) -> bool:
    """Minimal `conditions_spec` evaluator — gates `trigger_workflow` entry.

    Supported shapes:
        {"all": [{"key": "<context-key>", "equals": <literal>}, ...]}
        {"any": [{"key": "<context-key>", "equals": <literal>}, ...]}

    An empty list is treated as truthy (no conditions to fail). Unknown shapes fall through
    to True so a misconfigured guard never silently blocks the whole workflow (the engine's
    failure_action layer above is the place to surface authoring errors).
    """
    if not spec:
        return True
    all_clauses = spec.get("all")
    if isinstance(all_clauses, list):
        return all(_clause_ok(c, context) for c in all_clauses)
    any_clauses = spec.get("any")
    if isinstance(any_clauses, list):
        return any(_clause_ok(c, context) for c in any_clauses)
    return True


def _clause_ok(clause: dict, context: dict) -> bool:
    """One {key, equals} clause from `_evaluate_conditions`. Missing keys evaluate False."""
    if not isinstance(clause, dict):
        return False
    key = clause.get("key")
    if key is None or key not in context:
        return False
    if "equals" in clause:
        return context[key] == clause["equals"]
    return True


def _safe_summary(result: Any) -> Any:
    """Make any action result safe to JSON-serialize into an audit Event."""
    if result is None or isinstance(result, (bool, int, float, str)):
        return result
    if isinstance(result, dict):
        return {k: _safe_summary(v) for k, v in result.items()}
    if isinstance(result, (list, tuple)):
        return [_safe_summary(v) for v in result]
    return str(result)
