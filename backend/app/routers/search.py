"""Global cross-entity search (launch-critical G61/62).

One query — `GET /api/search?q=...` — spans every entity the caller can view, org-scope filtered
exactly like the records engine: load grants + node paths once, gate each entity on `{key}.view`,
and each record on `can(..., "view", record_path)`. Read-only; never leaks across tenant or scope.

Matching mirrors `records._matches_q`: a case-insensitive substring over a record's text-ish `data`
values (status/ids excluded). Results are grouped by entity and lightly ranked (records whose
name-ish label hits the query come first), capped per entity and overall.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, Record, OrgNode, User
from ..access import load_grants, can
from .auth import current_user

router = APIRouter(prefix="/api/search", tags=["search"])

PER_ENTITY = 5              # max matches returned per entity
DEFAULT_LIMIT = 20         # max total matches across all entities
SNIPPET_LEN = 120
LABEL_FIELDS = ("name", "title", "subject")


async def _node_paths(s: AsyncSession, tenant_id) -> dict[str, str]:
    rows = (await s.execute(select(OrgNode.id, OrgNode.path).where(OrgNode.tenant_id == tenant_id))).all()
    return {str(i): str(p) for i, p in rows}


def _label(rec: Record) -> str:
    """A human label for a record: the first present name-ish field, else its id."""
    data = rec.data or {}
    for k in LABEL_FIELDS:
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return str(rec.id)


def _snippet(rec: Record, needle: str) -> str | None:
    """First text-ish data value containing `needle` (already lowercased), windowed + truncated.
    Same match rule as records._matches_q; returns None when nothing matches."""
    for v in (rec.data or {}).values():
        if isinstance(v, str) and needle in v.lower():
            i = v.lower().find(needle)
            start = max(0, i - 30)
            snip = v[start:start + SNIPPET_LEN]
            return ("…" + snip) if start > 0 else snip
    return None


@router.get("")
async def search(
    q: str | None = None,
    limit: int = DEFAULT_LIMIT,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Search every viewable entity for `q`. Blank `q` → empty result (never dumps the DB)."""
    needle = (q or "").strip().lower()
    if not needle:
        return []
    if limit <= 0:
        limit = DEFAULT_LIMIT

    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    entities = (await s.execute(
        select(EntityDef)
        .where(EntityDef.tenant_id == user.tenant_id, EntityDef.status != "retired")
        .order_by(EntityDef.order, EntityDef.label)
    )).scalars().all()

    results = []
    total = 0
    for ent in entities:
        if total >= limit:
            break
        if not can(grants, ent.key, "view"):           # entity-level view gate (default-deny)
            continue
        rows = (await s.execute(
            select(Record)
            .where(Record.tenant_id == user.tenant_id, Record.entity_key == ent.key)
            .order_by(Record.created_at)
        )).scalars().all()

        ent_matches = []
        for r in rows:
            record_path = paths.get(str(r.owner_node_id)) if r.owner_node_id else None
            if not can(grants, ent.key, "view", record_path):   # per-record org scope
                continue
            snip = _snippet(r, needle)
            if snip is None:
                continue
            label = _label(r)
            ent_matches.append({
                "id": str(r.id), "status": r.status, "label": label, "snippet": snip,
                "_label_hit": 0 if needle in label.lower() else 1,
            })

        if not ent_matches:
            continue

        ent_matches.sort(key=lambda m: m["_label_hit"])         # label hits first; stable → keeps created order
        capped = ent_matches[: min(PER_ENTITY, limit - total)]
        for m in capped:
            m.pop("_label_hit")
        total += len(capped)
        results.append({
            "entity_key": ent.key,
            "label_plural": ent.label_plural,
            "route_slug": ent.route_slug,
            "matches": capped,
        })

    return results
