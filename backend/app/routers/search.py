"""Global cross-entity search (launch-critical G61/62/66/67/69).

One query — `GET /api/search?q=...` — spans every entity the caller can view, org-scope filtered
exactly like the records engine: load grants + node paths once, gate each entity on `{key}.view`,
and each record on `can(..., "view", record_path)`. Read-only; never leaks across tenant or scope.

Field-view redaction (`can_view_field`, the same gate the records engine uses): a field a caller's
roles may not see is never used as a label, snippet, or highlight source — so search can't be used
to read a value the record API would hide.

Matching mirrors `records._matches_q`: a case-insensitive substring over a record's *viewable*
text-ish `data` values. Results are lightly ranked (a hit on the record's name-ish label outranks a
hit only in the body, more matches outrank fewer), capped per entity and overall.

Response shapes (additive / non-breaking):
  - default  → the original grouped list: `[{entity_key, label_plural, route_slug, matches:[...]}]`,
    where each match now also carries a `highlight` (safe `<mark>`-wrapped snippet) and a `score`.
  - `?view=hits` (or `?facets=true`) → a richer envelope `{query, total, hits:[...], facets:{...}}`
    with a flat, globally-ranked hit list plus faceted counts by entity_key and by status. Nothing
    in the existing UI requests this, so the default body is unchanged.

Optional `?entity=<key|route_slug>` scopes the search to a single entity in either shape.
"""
import html

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, FieldDef, Record, OrgNode, User
from ..access import load_grants, can, role_keys, can_view_field
from .auth import current_user

router = APIRouter(prefix="/api/search", tags=["search"])

PER_ENTITY = 5              # max matches returned per entity (grouped shape)
DEFAULT_LIMIT = 20         # max total matches across all entities
SNIPPET_LEN = 120
SNIPPET_LEAD = 30          # chars of context kept before the match
LABEL_FIELDS = ("name", "title", "subject")

# Relevance weights. A hit on the record's label is worth far more than one buried in the body;
# additional occurrences add a little, and an exact (whole-value) label match tops it off.
SCORE_LABEL_HIT = 100
SCORE_LABEL_EXACT = 40
SCORE_BODY_HIT = 10
SCORE_PER_EXTRA = 2
SCORE_EXTRA_CAP = 10       # don't let occurrence-count dominate


async def _node_paths(s: AsyncSession, tenant_id) -> dict[str, str]:
    rows = (await s.execute(select(OrgNode.id, OrgNode.path).where(OrgNode.tenant_id == tenant_id))).all()
    return {str(i): str(p) for i, p in rows}


async def _hidden_keys_by_entity(s: AsyncSession, tenant_id, entity_ids, caller_roles, is_admin):
    """For each entity_def id, the set of data-field keys the caller's roles may NOT view.

    One query for all the entities in play; mirrors records._hidden_keys / can_view_field so search
    redaction is identical to the records engine (admins — config.manage holders — bypass)."""
    if not entity_ids:
        return {}
    rows = (await s.execute(
        select(FieldDef).where(FieldDef.tenant_id == tenant_id, FieldDef.entity_def_id.in_(entity_ids))
    )).scalars().all()
    out: dict = {eid: set() for eid in entity_ids}
    for f in rows:
        if not can_view_field(f.config, caller_roles, is_admin):
            out.setdefault(f.entity_def_id, set()).add(f.key)
    return out


def _viewable_text_values(rec: Record, hidden: set) -> list[str]:
    """The record's text-ish data values the caller may view (view-gated keys dropped)."""
    out = []
    for k, v in (rec.data or {}).items():
        if k in hidden:
            continue
        if isinstance(v, str) and v:
            out.append(v)
    return out


def _label(rec: Record, hidden: set) -> str:
    """A human label: the first present, *viewable*, name-ish field — else the record id."""
    data = rec.data or {}
    for k in LABEL_FIELDS:
        if k in hidden:
            continue
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return str(rec.id)


def _best_field(values: list[str], needle: str) -> str | None:
    """First viewable text value containing `needle` (already lowercased)."""
    for v in values:
        if needle in v.lower():
            return v
    return None


def _window(value: str, needle: str) -> tuple[str, bool]:
    """A truncated window of `value` centered on the first match. Returns (window, leading_ellipsis)."""
    i = value.lower().find(needle)
    if i < 0:
        return value[:SNIPPET_LEN], False
    start = max(0, i - SNIPPET_LEAD)
    return value[start:start + SNIPPET_LEN], start > 0


def _snippet(window: str, lead: bool) -> str:
    return ("…" + window) if lead else window


def _highlight(window: str, lead: bool, needle: str) -> str:
    """Safe highlight: HTML-escape the window first, then wrap each case-insensitive match of the
    (escaped) needle in <mark>…</mark>. Escaping before marking means record data can never inject
    markup — the only tags in the output are the <mark> wrappers we add."""
    esc = html.escape(window)
    esc_needle = html.escape(needle)
    if not esc_needle:
        return ("…" + esc) if lead else esc
    low = esc.lower()
    target = esc_needle.lower()
    out = []
    pos = 0
    while True:
        j = low.find(target, pos)
        if j < 0:
            out.append(esc[pos:])
            break
        out.append(esc[pos:j])
        out.append("<mark>" + esc[j:j + len(target)] + "</mark>")
        pos = j + len(target)
    body = "".join(out)
    return ("…" + body) if lead else body


def _score(label: str, values: list[str], needle: str) -> int:
    """Relevance score for a record that already matched `needle` somewhere viewable."""
    low_label = label.lower()
    score = 0
    if needle in low_label:
        score += SCORE_LABEL_HIT
        if low_label.strip() == needle:
            score += SCORE_LABEL_EXACT
    else:
        score += SCORE_BODY_HIT
    occurrences = sum(v.lower().count(needle) for v in values)
    score += min(SCORE_EXTRA_CAP, max(0, occurrences - 1) * SCORE_PER_EXTRA)
    return score


def _match_record(rec: Record, needle: str, hidden: set) -> dict | None:
    """Build a match dict for `rec` if it matches `needle` in any viewable field, else None."""
    values = _viewable_text_values(rec, hidden)
    field = _best_field(values, needle)
    if field is None:
        return None
    label = _label(rec, hidden)
    window, lead = _window(field, needle)
    return {
        "id": str(rec.id),
        "status": rec.status,
        "label": label,
        "snippet": _snippet(window, lead),
        "highlight": _highlight(window, lead, needle),
        "score": _score(label, values, needle),
    }


def _wants_envelope(view: str | None, facets: bool) -> bool:
    return facets or (view or "").strip().lower() in ("hits", "flat", "envelope")


@router.get("")
async def search(
    q: str | None = None,
    limit: int = DEFAULT_LIMIT,
    entity: str | None = None,
    view: str | None = None,
    facets: bool = False,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Search every viewable entity for `q`. Blank `q` → empty result (never dumps the DB).

    Default shape is the original grouped list (now with `highlight` + `score` per match). Pass
    `view=hits` or `facets=true` for the flat envelope `{query, total, hits, facets}`. `entity` (an
    entity key or route_slug) scopes to one entity. Org-scope + field-view redaction are enforced
    before anything is returned — an out-of-scope record or a non-viewable field never appears.
    """
    envelope = _wants_envelope(view, facets)
    needle = (q or "").strip().lower()
    if not needle:
        return {"query": q or "", "total": 0, "hits": [], "facets": {"entity": {}, "status": {}}} if envelope else []
    if limit <= 0:
        limit = DEFAULT_LIMIT

    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    is_admin = can(grants, "config", "manage")
    rkeys = role_keys(grants)

    ent_q = (
        select(EntityDef)
        .where(EntityDef.tenant_id == user.tenant_id, EntityDef.status != "retired")
        .order_by(EntityDef.order, EntityDef.label)
    )
    sel = (entity or "").strip()
    if sel:
        ent_q = ent_q.where((EntityDef.key == sel) | (EntityDef.route_slug == sel))
    entities = (await s.execute(ent_q)).scalars().all()

    # field-view redaction: one pass to learn which data keys are hidden per entity for this caller
    hidden_by_eid = await _hidden_keys_by_entity(
        s, user.tenant_id, [e.id for e in entities], rkeys, is_admin
    )

    # Facets are computed over the FULL match set (every entity, all matches) so the filter panel is
    # accurate regardless of how the result list below is capped/limited.
    facet_entity: dict[str, int] = {}
    facet_status: dict[str, int] = {}

    groups = []           # legacy grouped shape
    all_hits = []         # flat shape (envelope)
    total = 0

    for ent in entities:
        if not envelope and total >= limit:
            break
        if not can(grants, ent.key, "view"):           # entity-level view gate (default-deny)
            continue
        hidden = hidden_by_eid.get(ent.id, set())
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
            m = _match_record(r, needle, hidden)
            if m is None:
                continue
            ent_matches.append(m)
            # facet tallies over every in-scope match (uncapped)
            facet_entity[ent.key] = facet_entity.get(ent.key, 0) + 1
            st = r.status or "—"
            facet_status[st] = facet_status.get(st, 0) + 1

        if not ent_matches:
            continue

        # higher score first; ties keep created order (stable sort on the created-ordered list)
        ent_matches.sort(key=lambda m: -m["score"])

        if envelope:
            for m in ent_matches:
                all_hits.append({
                    "entity_key": ent.key,
                    "label_plural": ent.label_plural,
                    "route_slug": ent.route_slug,
                    **m,
                })
        else:
            capped = ent_matches[: min(PER_ENTITY, limit - total)]
            total += len(capped)
            groups.append({
                "entity_key": ent.key,
                "label_plural": ent.label_plural,
                "route_slug": ent.route_slug,
                "matches": capped,
            })

    if not envelope:
        return groups

    # flat envelope: global relevance order, then cap to `limit`
    all_hits.sort(key=lambda h: -h["score"])
    capped_hits = all_hits[:limit]
    return {
        "query": q or "",
        "total": len(all_hits),
        "hits": capped_hits,
        "facets": {"entity": facet_entity, "status": facet_status},
    }
