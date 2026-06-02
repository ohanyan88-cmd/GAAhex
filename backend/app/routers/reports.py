from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, StatusDef, Record, OrgNode, User
from ..access import load_grants, can
from .auth import current_user

router = APIRouter(prefix="/reports", tags=["reports"])


# ---- helpers (read-only aggregation; scope-filtered exactly like records.py) ----

async def _node_paths(s: AsyncSession, tenant_id) -> dict[str, str]:
    rows = (await s.execute(select(OrgNode.id, OrgNode.path).where(OrgNode.tenant_id == tenant_id))).all()
    return {str(i): str(p) for i, p in rows}


def _record_path(paths: dict[str, str], rec: Record) -> str | None:
    return paths.get(str(rec.owner_node_id)) if rec.owner_node_id else None


# ---- aggregate-leakage protection (file 17 §8) -------------------------------------------------
# Counts must respect the same view permissions as detail queries. Reports endpoints already
# gate per-entity via `can(grants, ent.key, "view")`, so this helper is provided for parity
# with analytics.py and any future report endpoints that don't loop entity-by-entity.

async def _assert_view_permission(s: AsyncSession, user: User, entity_key: str) -> None:
    """Raise 403 if the caller lacks `{entity_key}.view` for this aggregation.

    Use BEFORE any COUNT/SUM query that aggregates rows of `entity_key`. Prevents the
    aggregate leak documented in file 17 §8 (UI / API / EXPORT / REPORTS / SEARCH / AI views).
    """
    grants = await load_grants(s, user)
    if not can(grants, entity_key, "view"):
        raise HTTPException(status_code=403, detail=f"Not allowed to view {entity_key}")


def _alive(model):
    """SQL condition list excluding soft-deleted / purged rows (file 12 — D14).

    Returns an empty list for models that lack `deletion_state` so callers can splat it
    unconditionally into a WHERE clause.
    """
    col = getattr(model, "deletion_state", None)
    if col is None:
        return []
    return [col.notin_(("SOFT_DELETED", "PURGED"))]


# ---- endpoints ----

@router.get("/summary")
async def summary(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """For every entity the user can view, the count of records visible within their org scope."""
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    entities = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == user.tenant_id).order_by(EntityDef.label_plural)
    )).scalars().all()

    out = []
    for ent in entities:
        if not can(grants, ent.key, "view"):       # no view permission on this entity at all
            continue
        # Exclude soft-deleted / purged records from the headline count (file 12 — D14): callers
        # without `view_deleted` shouldn't even know those rows existed.
        recs = (await s.execute(
            select(Record).where(
                Record.tenant_id == user.tenant_id, Record.entity_key == ent.key,
                *_alive(Record),
            )
        )).scalars().all()
        count = sum(1 for r in recs if can(grants, ent.key, "view", _record_path(paths, r)))
        out.append({
            "entity_key": ent.key,
            "route_slug": ent.route_slug,   # UI navigates by slug (by-status endpoint keys on route_slug)
            "label_plural": ent.label_plural,
            "count": count,
        })
    return out


@router.get("/{slug}/by-status")
async def by_status(slug: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Record counts grouped by status for one entity, filtered to the user's org scope."""
    ent = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == user.tenant_id, EntityDef.route_slug == slug)
    )).scalar_one_or_none()
    if not ent:
        raise HTTPException(404, f"Unknown entity '{slug}'")

    grants = await load_grants(s, user)
    if not can(grants, ent.key, "view"):
        raise HTTPException(403, f"Not allowed: {ent.key}.view")

    # seed every defined status at 0 so the report is stable even with no records yet
    statuses = (await s.execute(
        select(StatusDef).where(StatusDef.entity_def_id == ent.id).order_by(StatusDef.order)
    )).scalars().all()
    counts: dict[str, int] = {st.key: 0 for st in statuses}
    labels = {st.key: st.label for st in statuses}

    paths = await _node_paths(s, user.tenant_id)
    # Exclude soft-deleted / purged records (file 12 — D14): aggregate by-status counts must not
    # include rows the caller can't see in the detail view.
    recs = (await s.execute(
        select(Record).where(
            Record.tenant_id == user.tenant_id, Record.entity_key == ent.key,
            *_alive(Record),
        )
    )).scalars().all()
    for r in recs:
        if not can(grants, ent.key, "view", _record_path(paths, r)):
            continue
        key = r.status or "(none)"
        counts[key] = counts.get(key, 0) + 1

    return {
        "entity_key": ent.key,
        "label_plural": ent.label_plural,
        "by_status": [
            {"status": k, "label": labels.get(k, k), "count": counts[k]}
            for k in counts
        ],
    }
