"""Notification kernel glue (Phase-1 M9): turn a domain event into inbox notifications.

The kernel emits an Event for every record mutation (see `workflow.emit`). This module is the
single place that decides — from that event — *who* should hear about it and *which*
NotificationDef to render. It sits beside the kernel, never inside it: a notification failure
must NEVER break the record mutation that triggered it, so every public function here is
fail-soft (wraps its work in try/except and swallows on error).

Recipient resolution rides the same org-tree + RBAC primitives as `access.py`: a user is a
recipient if they *own* the record (their primary node is at/under the record's owner node) or
they hold a role whose scope *covers* the record's owner node (managers above a team hear their
team's events). The acting user is always excluded — you don't notify yourself.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import User, OrgNode, RoleDef, Assignment, Record
from .access import _scope_ok            # reuse the kernel's exact scope rule (single source of truth)
from .routers.notifications import emit_notification


# ---- (entity_key, event_type) → def_key mapping -------------------------------------------------
# event_type is normalised to UPPER_SNAKE at fire() entry (belt-and-suspenders).
# All call sites should pass UPPER_SNAKE to stay in sync with AutomationRule.event_type (B1 standard).
# CREATE      → "{entity_key}.created"
# TRANSITION  → "{entity_key}.{new_status_lower}"   (new status from extra["to"], else record.status)
# UPDATE      → "{entity_key}.updated"
# DELETE      → "{entity_key}.deleted"
# anything else → "{entity_key}.{event_type_lowercased}"
# A NotificationDef only fires if a row with the derived key exists, is enabled, and (if set) its
# GXL condition passes — so the mapping can be broad while the seed set stays intentional.

def derive_def_key(entity_key: str, event_type: str, record: Record, extra: dict | None) -> str:
    # event_type is normalised to UPPER_SNAKE at fire() entry; comparisons here use UPPER_SNAKE.
    et = event_type.upper()
    if et == "CREATE":
        return f"{entity_key}.created"
    if et == "TRANSITION":
        status = (extra or {}).get("to") or record.status
        return f"{entity_key}.{str(status).lower()}"
    if et == "UPDATE":
        return f"{entity_key}.updated"
    if et == "DELETE":
        return f"{entity_key}.deleted"
    # Free-form event types (e.g. "helpdesk_assign", "sla_breach", "comment", "workitem_assign"):
    # lower-case the normalised form so def keys stay readable ("entity.helpdesk_assign").
    return f"{entity_key}.{et.lower()}"


# ---- recipient resolution -----------------------------------------------------------------------

async def _node_paths(s: AsyncSession, tenant_id) -> dict[str, str]:
    rows = (await s.execute(select(OrgNode.id, OrgNode.path).where(OrgNode.tenant_id == tenant_id))).all()
    return {str(i): str(p) for i, p in rows}


def _at_or_under(path: str | None, ancestor_path: str | None) -> bool:
    """True if `path` is `ancestor_path` itself or a descendant of it (ltree dot-prefix)."""
    if not path or not ancestor_path:
        return False
    return path == ancestor_path or path.startswith(ancestor_path + ".")


async def resolve_recipients(s: AsyncSession, *, tenant_id, record: Record, role_keys=None) -> list:
    """Resolve the set of user ids to notify about `record`.

    Returns user ids (UUIDs), de-duplicated, never crossing tenant boundaries:
      1. **Owners** — users whose primary org node is at or under `record.owner_node_id`.
      2. **Covering role-holders** — users with an assignment whose (scope, node) covers the
         record's owner node, exactly as `access.py` would let them *view* it (managers above the
         owner node included). When `role_keys` is given, only assignments to those roles count for
         this part (owners are always included regardless of role).

    A record with no `owner_node_id` has no org anchor → no recipients.
    """
    if record is None or record.owner_node_id is None:
        return []

    paths = await _node_paths(s, tenant_id)
    record_path = paths.get(str(record.owner_node_id))
    if not record_path:
        return []

    recipients: set = set()

    # 1. owners — primary node at/under the record's owner node
    users = (await s.execute(
        select(User.id, User.primary_node_id).where(User.tenant_id == tenant_id)
    )).all()
    for uid, pnode in users:
        if pnode and _at_or_under(paths.get(str(pnode)), record_path):
            recipients.add(uid)

    # 2. covering role-holders — an assignment whose scope covers the record's owner node
    rows = (await s.execute(
        select(Assignment.user_id, RoleDef.scope, RoleDef.key, OrgNode.path)
        .join(RoleDef, RoleDef.id == Assignment.role_id)
        .join(OrgNode, OrgNode.id == Assignment.node_id)
        .where(Assignment.tenant_id == tenant_id)
    )).all()
    wanted = set(role_keys) if role_keys else None
    for uid, scope, rkey, grant_path in rows:
        if wanted is not None and rkey not in wanted:
            continue
        if _scope_ok(scope, str(grant_path), record_path):
            recipients.add(uid)

    return list(recipients)


# ---- the single entry point the kernel calls ----------------------------------------------------

def _build_context(record: Record, extra: dict | None) -> dict:
    """Template + GXL context: the record's field values, its status/ids, plus any event extra."""
    ctx: dict = dict(record.data or {})
    ctx["status"] = record.status
    ctx["id"] = str(record.id)
    ctx["record_id"] = str(record.id)
    if record.owner_node_id:
        ctx["owner_node_id"] = str(record.owner_node_id)
    if extra:
        ctx.update(extra)
    return ctx


async def fire(s: AsyncSession, *, tenant_id, event_type: str, entity_key: str, record: Record,
               actor_user_id, extra: dict | None = None) -> None:
    """Fan a domain event out to inbox notifications. Fail-soft: any error is swallowed so a
    notification problem can never break the record mutation that triggered it.

    Derives the candidate def_key, builds the context, resolves recipients, and calls
    `emit_notification` once per recipient — skipping the actor. `emit_notification` itself is
    config- and condition-gated (no def / disabled / GXL false → no-op), so this safely fires on
    every event and only materializes notifications that are actually configured.
    """
    try:
        async with s.begin_nested():   # savepoint: a notification failure must not abort the caller's txn
            event_type = event_type.upper()   # normalise: call sites must use UPPER_SNAKE; belt-and-suspenders fold
            def_key = derive_def_key(entity_key, event_type, record, extra)
            context = _build_context(record, extra)
            recipients = await resolve_recipients(s, tenant_id=tenant_id, record=record)
            for uid in recipients:
                if actor_user_id is not None and uid == actor_user_id:
                    continue                   # don't notify the person who did the thing
                await emit_notification(
                    s, tenant_id=tenant_id, def_key=def_key, user_id=uid,
                    entity_key=entity_key, record_id=record.id, context=context,
                )
    except Exception:
        # never propagate into the caller's unit of work; the savepoint already rolled back any
        # partial notification writes, leaving the outer transaction (and its tenant GUC) usable.
        return
