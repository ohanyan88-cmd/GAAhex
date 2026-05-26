"""Search assistance layer — saved searches, recent history, pinned, autocomplete (E27/G63/G64/G68).

Owns three endpoint groups — all authed + tenant/user-scoped:

  /api/saved-searches          GET / POST / DELETE
  /api/recent-searches         GET
  /api/recent-searches/{id}    POST (record a query), PATCH (pin/unpin), DELETE
  /api/search/suggest          GET ?q=

Storage:
  - Saved searches → reuses `saved_view_def` with entity_key='__search__' as a sentinel.
    No new column needed: `config` carries {q, entity?} and the name is user-supplied.
    Shared flag is always False (saved searches are personal; a tenant-wide saved search
    can be wired later without schema change).

  - Recent / pinned → new `search_history` table (separate concern: needs queried_at + pinned
    which SavedViewDef does not have). Ring-buffer: unpinned rows beyond RECENT_CAP are pruned
    on each record call; pinned rows are kept until explicitly deleted or unpinned+evicted.

  - Suggestions → read-only: merges saved-search names, recent queries, and record label prefix
    matches. No additional storage.

IMPORTANT: register this router BEFORE records.router in main.py (fixed paths under /api/*).
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, Record, User
from ..models.saved_view import SavedViewDef
from ..models.search_history import SearchHistory
from .auth import current_user

router = APIRouter(tags=["search-assist"])

# ---- constants ----

_SEARCH_SENTINEL = "__search__"   # entity_key value that marks a saved-view row as a saved search
RECENT_CAP = 50                   # max unpinned history rows kept per user
SUGGEST_CAP = 10                  # max autocomplete entries returned
SUGGEST_RECORD_CAP = 5            # max record-title hits within suggest
LABEL_FIELDS = ("name", "title", "subject")   # mirrors search.py


# ---- Pydantic schemas ----

class SavedSearchIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    query: str = Field(..., min_length=1, max_length=500)
    entity: str | None = Field(None, max_length=80)   # optional entity scope filter


class RecentIn(BaseModel):
    """Body for recording a search query into recent history."""
    query: str = Field(..., min_length=1, max_length=500)
    entity: str | None = Field(None, max_length=80)


class PinPatch(BaseModel):
    pinned: bool


# ---- serializers ----

def _ser_saved(v: SavedViewDef) -> dict:
    cfg = v.config or {}
    return {
        "id": str(v.id),
        "name": v.name,
        "query": cfg.get("q", ""),
        "entity": cfg.get("entity"),
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def _ser_recent(h: SearchHistory) -> dict:
    return {
        "id": str(h.id),
        "query": h.query,
        "entity": h.entity,
        "pinned": h.pinned,
        "queried_at": h.queried_at.isoformat() if h.queried_at else None,
    }


# ---- helpers ----

async def _prune_recent(s: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> None:
    """Delete oldest unpinned rows beyond RECENT_CAP for this user. Called after each insert."""
    # Count unpinned rows
    count_q = await s.execute(
        select(func.count()).where(
            SearchHistory.tenant_id == tenant_id,
            SearchHistory.user_id == user_id,
            SearchHistory.pinned == False,  # noqa: E712
        )
    )
    total = count_q.scalar() or 0
    overflow = total - RECENT_CAP
    if overflow <= 0:
        return

    # Get the ids of the oldest unpinned rows to evict
    oldest = (await s.execute(
        select(SearchHistory.id)
        .where(
            SearchHistory.tenant_id == tenant_id,
            SearchHistory.user_id == user_id,
            SearchHistory.pinned == False,  # noqa: E712
        )
        .order_by(SearchHistory.queried_at.asc())
        .limit(overflow)
    )).scalars().all()

    if oldest:
        await s.execute(
            delete(SearchHistory).where(SearchHistory.id.in_(oldest))
        )


def _record_label(rec: Record) -> str:
    data = rec.data or {}
    for k in LABEL_FIELDS:
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return str(rec.id)


# ============================================================
# SAVED SEARCHES  /api/saved-searches
# ============================================================

@router.get("/api/saved-searches")
async def list_saved_searches(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Return the caller's saved searches (all entities)."""
    rows = (await s.execute(
        select(SavedViewDef)
        .where(
            SavedViewDef.tenant_id == user.tenant_id,
            SavedViewDef.entity_key == _SEARCH_SENTINEL,
            SavedViewDef.owner_user_id == user.id,
        )
        .order_by(SavedViewDef.created_at)
    )).scalars().all()
    return [_ser_saved(v) for v in rows]


@router.post("/api/saved-searches", status_code=201)
async def create_saved_search(
    body: SavedSearchIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Persist a named saved search for the current user."""
    config: dict = {"q": body.query}
    if body.entity:
        config["entity"] = body.entity

    view = SavedViewDef(
        tenant_id=user.tenant_id,
        owner_user_id=user.id,
        entity_key=_SEARCH_SENTINEL,
        name=body.name,
        config=config,
    )
    s.add(view)
    await s.commit()
    await s.refresh(view)
    return _ser_saved(view)


@router.delete("/api/saved-searches/{saved_id}", status_code=204)
async def delete_saved_search(
    saved_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Delete one of the caller's saved searches."""
    view = (await s.execute(
        select(SavedViewDef).where(
            SavedViewDef.id == saved_id,
            SavedViewDef.tenant_id == user.tenant_id,
            SavedViewDef.entity_key == _SEARCH_SENTINEL,
            SavedViewDef.owner_user_id == user.id,
        )
    )).scalar_one_or_none()
    if not view:
        raise HTTPException(404, "Saved search not found")
    await s.delete(view)
    await s.commit()


# ============================================================
# RECENT SEARCHES  /api/recent-searches
# ============================================================

@router.get("/api/recent-searches")
async def list_recent_searches(
    limit: int = Query(default=20, ge=1, le=RECENT_CAP),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Return the caller's recent search history, newest-first.
    Pinned entries appear mixed in their natural position; the UI may wish to surface them separately.
    """
    rows = (await s.execute(
        select(SearchHistory)
        .where(
            SearchHistory.tenant_id == user.tenant_id,
            SearchHistory.user_id == user.id,
        )
        .order_by(SearchHistory.queried_at.desc())
        .limit(limit)
    )).scalars().all()
    return [_ser_recent(h) for h in rows]


@router.post("/api/recent-searches", status_code=201)
async def record_recent_search(
    body: RecentIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Record a query into the caller's recent history (call after the user executes a search).
    Prunes unpinned overflow automatically to stay within RECENT_CAP."""
    entry = SearchHistory(
        tenant_id=user.tenant_id,
        user_id=user.id,
        query=body.query.strip(),
        entity=body.entity,
        pinned=False,
        queried_at=datetime.now(timezone.utc),
    )
    s.add(entry)
    await s.flush()   # get the ID; still in transaction
    await _prune_recent(s, user.id, user.tenant_id)
    await s.commit()
    await s.refresh(entry)
    return _ser_recent(entry)


@router.patch("/api/recent-searches/{history_id}")
async def pin_recent_search(
    history_id: uuid.UUID,
    body: PinPatch,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Pin or unpin a recent search entry. Pinned entries are exempt from cap eviction."""
    entry = (await s.execute(
        select(SearchHistory).where(
            SearchHistory.id == history_id,
            SearchHistory.tenant_id == user.tenant_id,
            SearchHistory.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Recent search entry not found")
    entry.pinned = body.pinned
    await s.commit()
    await s.refresh(entry)
    return _ser_recent(entry)


@router.delete("/api/recent-searches/{history_id}", status_code=204)
async def delete_recent_search(
    history_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Delete a single recent search entry (pinned or not)."""
    entry = (await s.execute(
        select(SearchHistory).where(
            SearchHistory.id == history_id,
            SearchHistory.tenant_id == user.tenant_id,
            SearchHistory.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Recent search entry not found")
    await s.delete(entry)
    await s.commit()


# ============================================================
# SUGGESTIONS  /api/search/suggest
# ============================================================

@router.get("/api/search/suggest")
async def search_suggest(
    q: str = Query(default="", min_length=0),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Quick autocomplete: prefix-matches the caller's saved searches, recent queries, and
    record labels (name/title/subject fields). Returns up to SUGGEST_CAP mixed entries.

    Empty `q` returns the user's most-recent queries as warm suggestions (no prefix filter).
    """
    needle = q.strip().lower()
    results: list[dict] = []
    seen_queries: set[str] = set()

    # ---- 1. Saved search names + queries (prefix on name or query) ----
    saved_rows = (await s.execute(
        select(SavedViewDef)
        .where(
            SavedViewDef.tenant_id == user.tenant_id,
            SavedViewDef.entity_key == _SEARCH_SENTINEL,
            SavedViewDef.owner_user_id == user.id,
        )
        .order_by(SavedViewDef.created_at.desc())
        .limit(SUGGEST_CAP * 2)   # fetch more, filter below
    )).scalars().all()

    for v in saved_rows:
        if len(results) >= SUGGEST_CAP:
            break
        cfg = v.config or {}
        sq = cfg.get("q", "")
        name_hit = needle in v.name.lower() if needle else True
        query_hit = needle in sq.lower() if needle else True
        if not (name_hit or query_hit):
            continue
        key = sq.lower()
        if key in seen_queries:
            continue
        seen_queries.add(key)
        results.append({
            "kind": "saved",
            "id": str(v.id),
            "label": v.name,
            "query": sq,
            "entity": cfg.get("entity"),
        })

    # ---- 2. Recent queries (prefix match on query text) ----
    recent_rows = (await s.execute(
        select(SearchHistory)
        .where(
            SearchHistory.tenant_id == user.tenant_id,
            SearchHistory.user_id == user.id,
        )
        .order_by(SearchHistory.queried_at.desc())
        .limit(RECENT_CAP)
    )).scalars().all()

    for h in recent_rows:
        if len(results) >= SUGGEST_CAP:
            break
        if needle and needle not in h.query.lower():
            continue
        key = h.query.lower()
        if key in seen_queries:
            continue
        seen_queries.add(key)
        results.append({
            "kind": "recent",
            "id": str(h.id),
            "label": h.query,
            "query": h.query,
            "entity": h.entity,
            "pinned": h.pinned,
        })

    # ---- 3. Record label prefix matches (only when needle is non-empty) ----
    if needle and len(results) < SUGGEST_CAP:
        record_slots = min(SUGGEST_RECORD_CAP, SUGGEST_CAP - len(results))
        # Fetch a sample of records and do in-process prefix match on their label fields.
        # This avoids ILIKE on JSONB and keeps the query cheap (small cap).
        entities = (await s.execute(
            select(EntityDef)
            .where(EntityDef.tenant_id == user.tenant_id, EntityDef.status != "retired")
            .order_by(EntityDef.order, EntityDef.label)
        )).scalars().all()

        record_hits: list[dict] = []
        for ent in entities:
            if len(record_hits) >= record_slots:
                break
            # Fetch recent records for this entity; filter by label prefix in Python (cheap for
            # small sets; if entities grow large this can be replaced by a GIN index approach).
            recs = (await s.execute(
                select(Record)
                .where(Record.tenant_id == user.tenant_id, Record.entity_key == ent.key)
                .order_by(Record.updated_at.desc())
                .limit(200)
            )).scalars().all()
            for r in recs:
                if len(record_hits) >= record_slots:
                    break
                label = _record_label(r)
                if needle not in label.lower():
                    continue
                record_hits.append({
                    "kind": "record",
                    "id": str(r.id),
                    "label": label,
                    "query": label,    # selecting the record fills the search box with its label
                    "entity": ent.key,
                    "entity_label": ent.label,
                    "route_slug": ent.route_slug,
                })
        results.extend(record_hits)

    return results[:SUGGEST_CAP]
