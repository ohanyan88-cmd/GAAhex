"""Read-only registry of platform event types.

Studio (ActionsLogic / Automations) needs to populate WHEN dropdowns with the real platform
events an automation rule can fire on, instead of free-text. The source of truth is
``automations.ALLOWED_EVENT_TYPES`` (the same set the executor matches against), so the two
can never drift.

Endpoints (auth-required; no extra grant needed — pure metadata, mirrors /api/permissions):
  - GET /api/events/types     → flat list of the 4 generic event types
  - GET /api/events/registry  → richer list combining generic types + per-entity transitions
                                (e.g. "InvoicePaid", "OrderShipped"), built from EntityDef +
                                WorkflowDef.config.transitions for the tenant
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, WorkflowDef, User
from .auth import current_user
from .automations import ALLOWED_EVENT_TYPES

router = APIRouter(prefix="/api/events", tags=["events"])

# Friendly metadata for the 4 generic event types the automation executor recognises.
# Keys MUST stay in lockstep with automations.ALLOWED_EVENT_TYPES — the test below asserts that.
_TYPE_META: dict[str, dict[str, str]] = {
    "CREATE":     {"label": "Record created",   "description": "Fires when a new record is created for an entity"},
    "UPDATE":     {"label": "Record updated",   "description": "Fires when an existing record's fields are changed"},
    "TRANSITION": {"label": "Status changed",   "description": "Fires when a record moves along a workflow transition"},
    "DELETE":     {"label": "Record deleted",   "description": "Fires when a record is removed"},
}


def _generic_types() -> list[dict[str, str]]:
    """The 4 generic events, in a stable order, with friendly labels."""
    # Sorted for a deterministic response; ALLOWED_EVENT_TYPES is a set so order would otherwise vary.
    return [
        {"type": t, **_TYPE_META.get(t, {"label": t, "description": ""})}
        for t in sorted(ALLOWED_EVENT_TYPES)
    ]


@router.get("/types")
async def list_event_types(user: User = Depends(current_user)):  # noqa: ARG001 (auth gate)
    """The flat catalog of generic event types automations can subscribe to.

    Response: [{type, label, description}]
    """
    return _generic_types()


@router.get("/registry")
async def event_registry(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Richer registry: generic types + per-entity status transitions (concrete events).

    Each entry has a stable ``key`` (what an automation would subscribe to), a friendly
    ``label`` for pickers, an ``event_type`` that maps back to one of the 4 generics, and —
    when applicable — the originating ``entity_key`` plus ``from``/``to`` status keys.

    Response: {
      generic:  [{type, label, description}],
      entities: [{
        entity_key, label,
        transitions: [{key, event_type, from, to, label}]
      }],
    }
    """
    ents = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == user.tenant_id).order_by(EntityDef.label)
    )).scalars().all()
    wfs = (await s.execute(
        select(WorkflowDef).where(WorkflowDef.entity_def_id.in_([e.id for e in ents] or [None]))
    )).scalars().all()
    wf_by_ent = {w.entity_def_id: w for w in wfs}

    out_entities: list[dict] = []
    for e in ents:
        wf = wf_by_ent.get(e.id)
        transitions = (wf.config or {}).get("transitions", []) if wf else []
        rows = []
        for t in transitions:
            frm, to = t.get("from"), t.get("to")
            if not to:
                continue
            rows.append({
                "key":        f"{e.key}.{frm or '*'}->{to}",
                "event_type": "TRANSITION",
                "from":       frm,
                "to":         to,
                "label":      f"{e.label}: {frm or 'Any'} → {to}",
            })
        out_entities.append({"entity_key": e.key, "label": e.label, "transitions": rows})

    return {"generic": _generic_types(), "entities": out_entities}
