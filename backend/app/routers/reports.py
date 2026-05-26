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
        recs = (await s.execute(
            select(Record).where(Record.tenant_id == user.tenant_id, Record.entity_key == ent.key)
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
    recs = (await s.execute(
        select(Record).where(Record.tenant_id == user.tenant_id, Record.entity_key == ent.key)
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
