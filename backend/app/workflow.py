"""Workflow engine: guarded lifecycle transitions, on-enter actions, and approval steps.

A WorkflowDef.config holds {"transitions": [{from, to, guard, actions?, approval?}]}. Status changes
go ONLY through transitions (not free PATCH), each gated by a GXL guard. On success an Event is
emitted, the transition's on-enter `actions` run (fail-soft), and — if the transition is flagged for
`approval` — the move is parked as a PendingApproval until an eligible approver decides it.
"""
from simpleeval import EvalWithCompoundTypes, NameNotDefined
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import WorkflowDef, FieldDef, Event, Record, OrgNode, RoleDef, Assignment
from .models.approval import PendingApproval
from .access import _scope_ok, _has_perm


async def get_transitions(s: AsyncSession, entity_id) -> list[dict]:
    wf = (await s.execute(select(WorkflowDef).where(WorkflowDef.entity_def_id == entity_id))).scalars().first()
    if not wf or not wf.config:
        return []
    return wf.config.get("transitions", [])


def find_transition(transitions: list[dict], frm: str | None, to: str) -> dict | None:
    for t in transitions:
        if t.get("from") == frm and t.get("to") == to:
            return t
    return None


async def guard_context(s: AsyncSession, entity_id, record: Record) -> dict:
    """Field values + status — the names a guard expression can reference."""
    fields = (await s.execute(select(FieldDef).where(FieldDef.entity_def_id == entity_id))).scalars().all()
    ctx: dict = {}
    for f in fields:
        if f.type == "status":
            continue
        ctx[f.key] = (record.data or {}).get(f.key)
    ctx["status"] = record.status
    return ctx


async def emit(
    s: AsyncSession,
    tenant_id,
    type_: str,
    entity_key: str,
    record_id,
    actor_user_id,
    data: dict,
    *,
    # Event System extension kwargs (D1, file 06). All optional — existing call sites
    # work unchanged; new call sites can enrich events progressively.
    event_name: str | None = None,            # "<Object>.<Action>" PascalCase (E13)
    category: str | None = None,              # EventCategory UPPER_SNAKE (E14/E21)
    actor_type: str = "USER",                 # ActorType (B3/D5); USER=authenticated internal
    actor_id=None,                            # canonical actor UUID (non-FK; covers SYSTEM etc.)
    department: str | None = None,            # accountable dept at event time (B5)
    visibility: str = "INTERNAL",             # PUBLIC|INTERNAL|RESTRICTED|SYSTEM
    correlation_id=None,                      # trace key (M1)
    causation_id=None,                        # trace key (M1)
    idempotency_key: str | None = None,       # integration/automation dedup fence
) -> None:
    # R7-D: normalise type_ to UPPER_SNAKE once at the entry point so every
    # downstream consumer (Event row, webhook dispatch, run_automations matcher)
    # sees a consistent case regardless of what the call site passed.  This
    # mirrors the .upper() fold R7-B added to notify_hooks.fire().
    type_ = (type_ or "").upper()
    s.add(Event(
        tenant_id=tenant_id, type=type_, entity_key=entity_key,
        record_id=record_id, actor_user_id=actor_user_id, data=data,
        event_name=event_name,
        category=category,
        schema_version=1,
        actor_type=actor_type,
        actor_id=actor_id if actor_id is not None else actor_user_id,
        department=department,
        visibility=visibility,
        correlation_id=correlation_id,
        causation_id=causation_id,
        idempotency_key=idempotency_key,
    ))
    # Fan the event out to any subscribed outbound webhooks (fail-soft, lazy import to avoid a
    # router↔workflow import cycle; a no-op when no webhooks are configured for this tenant).
    try:
        async with s.begin_nested():   # savepoint: a webhook-dispatch failure must not abort the caller's txn
            from .routers.webhooks import dispatch_event
            await dispatch_event(s, tenant_id=tenant_id, event_type=type_, payload={
                "type": type_, "entity_key": entity_key,
                "record_id": str(record_id) if record_id else None,
                "actor_user_id": str(actor_user_id) if actor_user_id else None,
                "data": data,
            })
    except Exception:
        pass
    # Fire automation rules that match this event (fail-soft: a rule failure must not abort the
    # caller's transaction; wrapped in its own savepoint exactly like webhook dispatch above).
    try:
        async with s.begin_nested():
            await run_automations(
                s,
                tenant_id=tenant_id,
                event_type=type_,
                entity_key=entity_key,
                record_id=record_id,
                actor_user_id=actor_user_id,
                data=data,
            )
    except Exception:
        pass


# ===========================================================================================
# On-enter actions
# ===========================================================================================
#
# A transition may carry an `actions` list in its config; each action runs on entry, inside the
# caller's transaction (after the status change, before commit). Action JSON shapes:
#
#   {"type": "notify", "def_key"?: "<NotificationDef key>", "roles"?: ["manager", ...]}
#       Fire inbox notifications. def_key defaults to "{entity_key}.{to_status_lower}". `roles`
#       (optional) narrows recipients to covering holders of those roles (else the usual
#       owner + covering-role set). The actor is never notified.
#   {"type": "set_field", "field": "<key>", "value": <literal>}
#       Set a `data` field to a literal value.
#   {"type": "set_field", "field": "<key>", "expr": "<GXL expression>"}
#       Set a `data` field to a value computed from the record context (data fields + status).
#   {"type": "emit_event", "event_type": "<type>", "data"?: {...}}
#       Emit a custom typed audit Event.
#
# Anything else is skipped (and noted in the per-action result). Every action is fail-soft: a
# failing one is logged as an `action_failed` Event and skipped — it never breaks the transition.


def _record_context(record: Record) -> dict:
    """Names an action's GXL expression can reference: the record's data fields + status + ids."""
    ctx: dict = dict(record.data or {})
    ctx["status"] = record.status
    ctx["id"] = str(record.id)
    ctx["record_id"] = str(record.id)
    return ctx


def _eval_value(expr: str, context: dict):
    """Evaluate a GXL expression to its *value* (not coerced to bool, unlike gxl.evaluate, which is
    for guards). Sandboxed via simpleeval; unknown names resolve to None."""
    evaluator = EvalWithCompoundTypes(names=dict(context))

    def run():
        try:
            return evaluator.eval(expr)
        except NameNotDefined as e:
            name = getattr(e, "name", None)
            if not name:
                raise
            evaluator.names[name] = None
            return run()

    return run()


def _action_set_field(record: Record, action: dict) -> None:
    field = action.get("field")
    if not field:
        raise ValueError("set_field action requires 'field'")
    if "expr" in action:
        value = _eval_value(action["expr"], _record_context(record))
    else:
        value = action.get("value")
    data = dict(record.data or {})
    data[field] = value
    record.data = data                      # reassign so SQLAlchemy detects the JSONB change


async def _action_notify(s: AsyncSession, *, tenant_id, entity_key, record, transition, action, actor_user_id) -> None:
    from .notify_hooks import resolve_recipients          # local import avoids any import-order coupling
    from .routers.notifications import emit_notification

    to_status = transition.get("to")
    def_key = action.get("def_key") or f"{entity_key}.{str(to_status).lower()}"
    context = _record_context(record)
    context["to"] = to_status
    recipients = await resolve_recipients(s, tenant_id=tenant_id, record=record, role_keys=action.get("roles"))
    for uid in recipients:
        if actor_user_id is not None and uid == actor_user_id:
            continue
        await emit_notification(s, tenant_id=tenant_id, def_key=def_key, user_id=uid,
                                entity_key=entity_key, record_id=record.id, context=context)


async def run_actions(s: AsyncSession, *, tenant_id, entity_key, record: Record, transition: dict, actor_user_id) -> list[dict]:
    """Run a transition's on-enter actions in the caller's transaction. Fail-soft per action; returns
    a per-action result list (useful for callers/tests). See the module comment for action shapes."""
    results = []
    for action in (transition or {}).get("actions") or []:
        atype = (action or {}).get("type")
        try:
            async with s.begin_nested():        # savepoint: one failing action must not abort the txn
                if atype == "notify":
                    await _action_notify(s, tenant_id=tenant_id, entity_key=entity_key, record=record,
                                         transition=transition, action=action, actor_user_id=actor_user_id)
                elif atype == "set_field":
                    _action_set_field(record, action)
                elif atype == "emit_event":
                    await emit(s, tenant_id, action.get("event_type", "action"), entity_key,
                               record.id, actor_user_id, action.get("data") or {})
                else:
                    results.append({"type": atype, "status": "skipped", "reason": "unknown action type"})
                    continue
            results.append({"type": atype, "status": "ok"})
        except Exception as e:                  # fail-soft: log + keep going, never break the transition
            try:
                async with s.begin_nested():
                    await emit(s, tenant_id, "ACTION_FAILED", entity_key, record.id, actor_user_id,
                               {"action": atype, "error": str(e)})
            except Exception:
                pass
            results.append({"type": atype, "status": "error", "error": str(e)})
    return results


async def complete_transition(s: AsyncSession, *, tenant_id, entity_key, record: Record, transition: dict, actor_user_id) -> None:
    """Apply a transition's full effect: set status, emit the transition Event, run on-enter actions.
    Used by the approval-approve path; the normal /transition handler can call run_actions directly."""
    frm = record.status
    record.status = transition.get("to")
    await emit(s, tenant_id, "TRANSITION", entity_key, record.id, actor_user_id, {"from": frm, "to": record.status})
    await run_actions(s, tenant_id=tenant_id, entity_key=entity_key, record=record,
                      transition=transition, actor_user_id=actor_user_id)


# ===========================================================================================
# Approval steps
# ===========================================================================================
#
# A transition is an approval step when it carries a truthy `approval` flag:
#   {"from": "QUALIFIED", "to": "CONVERTED", "approval": true}
#   {"from": "OPEN", "to": "WON", "approval": {"roles": ["manager", "super_admin"]}}
# `approval.roles` (when given) names the role keys that may approve; otherwise any covering
# role-holder who can edit the entity is eligible.


def requires_approval(transition: dict | None) -> bool:
    return bool((transition or {}).get("approval"))


def approver_roles(transition: dict | None) -> list | None:
    """The role keys allowed to approve, or None for the default (covering editors)."""
    appr = (transition or {}).get("approval")
    if isinstance(appr, dict):
        roles = appr.get("roles")
        if isinstance(roles, list) and roles:
            return roles
    return None


async def eligible_approvers(s: AsyncSession, *, tenant_id, record: Record, transition: dict) -> list:
    """User ids allowed to approve this transition for this record: a holder of a qualifying role
    whose (scope, node) covers the record's owner node — the same scope rule access.py enforces.

    Qualifying role = one named in `approval.roles`, or (when unspecified) any role granting
    `{entity_key}.edit`. Owners with no covering role do NOT qualify (unlike notification recipients).
    """
    if record is None or record.owner_node_id is None:
        return []
    paths = {str(i): str(p) for i, p in (await s.execute(
        select(OrgNode.id, OrgNode.path).where(OrgNode.tenant_id == tenant_id)
    )).all()}
    record_path = paths.get(str(record.owner_node_id))
    if not record_path:
        return []

    wanted = approver_roles(transition)
    rows = (await s.execute(
        select(Assignment.user_id, RoleDef.scope, RoleDef.key, RoleDef.permissions, OrgNode.path)
        .join(RoleDef, RoleDef.id == Assignment.role_id)
        .join(OrgNode, OrgNode.id == Assignment.node_id)
        .where(Assignment.tenant_id == tenant_id)
    )).all()

    out: set = set()
    for uid, scope, rkey, perms, grant_path in rows:
        if wanted is not None:
            if rkey not in wanted:
                continue
        elif not _has_perm(set(perms or []), record.entity_key, "edit"):
            continue
        if _scope_ok(scope, str(grant_path), record_path):
            out.add(uid)
    return list(out)


async def request_approval(s: AsyncSession, *, tenant_id, entity_key, record: Record, transition: dict, actor_user_id) -> PendingApproval:
    """Park an approval transition: create a PENDING PendingApproval (the record does NOT move),
    emit an `approval_requested` Event, and notify eligible approvers (fail-soft). Returns the row."""
    pa = PendingApproval(
        tenant_id=tenant_id, entity_key=entity_key, record_id=record.id,
        from_status=record.status, to_status=transition.get("to"),
        requested_by=actor_user_id, status="PENDING",
    )
    s.add(pa)
    await s.flush()
    await emit(s, tenant_id, "APPROVAL_REQUESTED", entity_key, record.id, actor_user_id,
               {"from": record.status, "to": transition.get("to"), "approval_id": str(pa.id)})
    try:
        from .routers.notifications import emit_notification
        approvers = await eligible_approvers(s, tenant_id=tenant_id, record=record, transition=transition)
        context = _record_context(record)
        context["to_status"] = transition.get("to")
        for uid in approvers:
            if actor_user_id is not None and uid == actor_user_id:
                continue
            await emit_notification(s, tenant_id=tenant_id, def_key=f"{entity_key}.approval_requested",
                                    user_id=uid, entity_key=entity_key, record_id=record.id, context=context)
    except Exception:
        pass                                    # a notification failure must never block the request
    return pa


# ===========================================================================================
# Automation rules executor
# ===========================================================================================
#
# Loads active AutomationRule rows matching (tenant, event_type, entity_key), evaluates the
# optional GXL condition, and runs the action. Mirrors run_actions — each rule is wrapped
# in its own savepoint so a single failure never poisons the caller's transaction.
#
# Called from emit() after webhook dispatch, wrapped in a savepoint there as well.

async def run_automations(
    s: AsyncSession,
    *,
    tenant_id,
    event_type: str,
    entity_key: str,
    record_id,
    actor_user_id,
    data: dict,
) -> None:
    """Execute active automation rules matching (tenant, event_type, entity_key).

    A lightweight record-context is built from the event data dict (record is not re-fetched
    for speed/safety — the data payload already carries the relevant field snapshot). The full
    Record object is needed only for actions that work with it; we lazy-fetch when required.

    Each rule body runs inside its own savepoint. Any exception is swallowed — a rule failure
    must never poison the caller's transaction.
    """
    # R7-D belt-and-suspenders: normalise before the DB comparison even though emit()
    # already folds to UPPER_SNAKE.  Callers that invoke run_automations() directly
    # (e.g. tests, future integrations) are covered without relying on emit() being
    # the entry point.
    event_type = (event_type or "").upper()

    from .models.automation import AutomationRule
    from . import gxl as _gxl

    rules = (await s.execute(
        select(AutomationRule).where(
            AutomationRule.tenant_id == tenant_id,
            AutomationRule.event_type == event_type,
            AutomationRule.entity_key == entity_key,
            AutomationRule.is_active.is_(True),
        ).order_by(AutomationRule.order)
    )).scalars().all()

    if not rules:
        return

    # Build context from the event data dict + ids for GXL evaluation
    ctx: dict = dict(data)
    ctx.setdefault("record_id", str(record_id) if record_id else None)
    ctx.setdefault("entity_key", entity_key)
    ctx.setdefault("event_type", event_type)

    for rule in rules:
        try:
            async with s.begin_nested():        # savepoint per rule — a failure rolls back this rule only
                # Evaluate condition if present; skip if false
                if rule.condition and not _gxl.evaluate(rule.condition, ctx):
                    continue

                action = rule.action or {}
                atype = action.get("type")
                aconfig = action.get("config") or {}

                if atype == "notify":
                    # Lazy-fetch the record so we can use resolve_recipients + emit_notification
                    rec = (await s.execute(
                        select(Record).where(Record.id == record_id, Record.tenant_id == tenant_id)
                    )).scalar_one_or_none() if record_id else None
                    if rec is not None:
                        from .notify_hooks import resolve_recipients
                        from .routers.notifications import emit_notification
                        def_key = aconfig.get("def_key") or f"{entity_key}.{event_type}"
                        recipients = await resolve_recipients(
                            s, tenant_id=tenant_id, record=rec, role_keys=aconfig.get("roles")
                        )
                        for uid in recipients:
                            if actor_user_id is not None and uid == actor_user_id:
                                continue
                            await emit_notification(
                                s, tenant_id=tenant_id, def_key=def_key, user_id=uid,
                                entity_key=entity_key, record_id=record_id, context=ctx,
                            )

                elif atype == "set_field":
                    rec = (await s.execute(
                        select(Record).where(Record.id == record_id, Record.tenant_id == tenant_id)
                    )).scalar_one_or_none() if record_id else None
                    if rec is not None:
                        field = aconfig.get("field")
                        if field:
                            if "expr" in aconfig:
                                value = _eval_value(aconfig["expr"], _record_context(rec))
                            else:
                                value = aconfig.get("value")
                            rec_data = dict(rec.data or {})
                            rec_data[field] = value
                            rec.data = rec_data

                elif atype == "webhook":
                    import httpx
                    url = aconfig.get("url")
                    if url:
                        method = (aconfig.get("method") or "POST").upper()
                        headers = aconfig.get("headers") or {}
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            await client.request(method, url, json=ctx, headers=headers)

                elif atype == "emit_event":
                    custom_event_type = aconfig.get("event_type", "automation")
                    await emit(s, tenant_id, custom_event_type, entity_key, record_id,
                               actor_user_id, aconfig.get("data") or {})

        except Exception:
            pass  # fail-soft: one bad rule must never block the event pipeline
