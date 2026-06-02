"""Bulk operations (D40 / bulk-action bar).

`POST /api/{slug}/bulk` applies an action to many records at once — `delete` or `transition` —
running the EXACT same access + org-scope + workflow-guard + audit logic as the single-record
endpoints (helpers imported from records.py / workflow.py), so nothing is bypassed.

Partial-failure model: each id is processed and committed independently. A forbidden / guard-failed
/ not-found id fails only itself (with its reason) while the rest proceed — never an all-or-nothing
500. The response carries a per-id result plus a summary.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session, SessionLocal, set_tenant_guc
from ..kernel import assert_can, AccessDenied
from ..models import User
from ..access import load_grants, can
from .. import workflow, gxl, notify_hooks
from .auth import current_user
from .records import _entity, _get, _node_paths        # reuse the records engine's helpers for parity

router = APIRouter(prefix="/api", tags=["bulk"])

BULK_MAX = 200
ALLOWED_ACTIONS = ("delete", "transition")


async def _do_delete(s, user, ent, grants, paths, rec) -> dict | None:
    record_path = paths.get(str(rec.owner_node_id)) if rec.owner_node_id else None
    if not can(grants, ent.key, "delete", record_path):
        raise HTTPException(403, f"Not allowed: {ent.key}.delete")
    # SPEC §0.2 default-deny (Step 7.2) — per-record kernel gate (partial-failure friendly).
    try:
        await assert_can(s, user, action="delete", entity_key=ent.key,
                         region_id=getattr(rec, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    await workflow.emit(s, user.tenant_id, "DELETE", ent.key, rec.id, user.id,
                        {"data": dict(rec.data or {}), "status": rec.status})
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="DELETE", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"status": rec.status})
    await s.delete(rec)
    return None


async def _do_transition(s, user, ent, grants, paths, rec, to, transitions) -> dict | None:
    record_path = paths.get(str(rec.owner_node_id)) if rec.owner_node_id else None
    if not can(grants, ent.key, "edit", record_path):
        raise HTTPException(403, f"Not allowed: {ent.key}.edit")
    # SPEC §0.2 default-deny (Step 7.2) — per-record kernel gate (partial-failure friendly).
    try:
        await assert_can(s, user, action="edit", entity_key=ent.key,
                         region_id=getattr(rec, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    tr = workflow.find_transition(transitions, rec.status, to)
    if not tr:
        raise HTTPException(409, f"No transition from '{rec.status}' to '{to}'")
    ctx = await workflow.guard_context(s, ent.id, rec)
    if not gxl.evaluate(tr.get("guard"), ctx):
        raise HTTPException(422, f"Guard failed for {rec.status} -> {to}: {tr.get('guard')}")

    frm = rec.status
    if workflow.requires_approval(tr):
        pa = await workflow.request_approval(s, tenant_id=user.tenant_id, entity_key=ent.key,
                                             record=rec, transition=tr, actor_user_id=user.id)
        return {"pending_approval": {"id": str(pa.id), "to": to, "status": "PENDING"}}

    await workflow.complete_transition(s, tenant_id=user.tenant_id, entity_key=ent.key,
                                       record=rec, transition=tr, actor_user_id=user.id)
    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="TRANSITION", entity_key=ent.key,
                            record=rec, actor_user_id=user.id, extra={"from": frm, "to": to})
    return None


@router.post("/{slug}/bulk")
async def bulk(slug: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Apply `action` ('delete'|'transition') to `ids`. transition also needs `to`.
    Returns per-id results + a {requested, succeeded, failed} summary."""
    action = payload.get("action")
    if action not in ALLOWED_ACTIONS:
        raise HTTPException(422, f"action must be one of {list(ALLOWED_ACTIONS)}")
    ids = payload.get("ids")
    if not isinstance(ids, list):
        raise HTTPException(422, "ids must be a list")
    if len(ids) > BULK_MAX:
        raise HTTPException(422, f"Too many ids: {len(ids)} (max {BULK_MAX})")
    to = payload.get("to")
    if action == "transition" and not to:
        raise HTTPException(422, "transition action requires 'to'")

    ent = await _entity(s, user.tenant_id, slug)          # 404 for unknown entity

    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    transitions = await workflow.get_transitions(s, ent.id) if action == "transition" else None

    # Process each id in its OWN session/transaction — true partial-failure isolation, and it avoids
    # corrupting one shared async session with interleaved per-id commit/rollback. `grants`, `paths`,
    # `transitions`, `ent` are plain in-memory data loaded above, reusable across sessions. Each per-id
    # session gets the tenant GUC set so RLS holds under the gaahex_app flip.
    results = []
    succeeded = 0
    for raw_id in ids:
        entry: dict = {"id": raw_id}
        try:
            rid = uuid.UUID(str(raw_id))
        except (ValueError, AttributeError, TypeError):
            entry.update(ok=False, error="Invalid id")
            results.append(entry)
            continue
        async with SessionLocal() as s2:
            await set_tenant_guc(s2, user.tenant_id)
            try:
                rec = await _get(s2, user.tenant_id, ent.key, rid)     # 404 if missing / wrong entity
                if action == "delete":
                    extra = await _do_delete(s2, user, ent, grants, paths, rec)
                else:
                    extra = await _do_transition(s2, user, ent, grants, paths, rec, to, transitions)
                await s2.commit()
                entry["ok"] = True
                if extra:
                    entry.update(extra)
                succeeded += 1
            except HTTPException as e:
                await s2.rollback()
                entry.update(ok=False, error=e.detail)
            except Exception as e:                                     # never let one id 500 the batch
                await s2.rollback()
                entry.update(ok=False, error=str(e))
        results.append(entry)

    return {
        "action": action,
        "summary": {"requested": len(ids), "succeeded": succeeded, "failed": len(ids) - succeeded},
        "results": results,
    }
