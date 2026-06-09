"""records_service — pure service functions for the generic records engine.

Extracted from ``app.routers.records`` (M-4 refactor). All functions here are pure:
no FastAPI Request / Response / Depends. They accept plain Python / SQLAlchemy types
and raise HTTPException where appropriate (these are still application-layer concerns,
but they carry no FastAPI transport state).

Callers:
  - ``app.routers.records`` — the main generic CRUD router
"""
import re

from fastapi import HTTPException
from sqlalchemy import cast, desc, or_, select
from sqlalchemy.types import Text

from ..models import Record
from ..access import can
from .. import gxl


# ---------------------------------------------------------------------------
# SQL statement builders
# ---------------------------------------------------------------------------

def build_record_list_stmt(tenant_id, entity_key: str, q: str | None, sort: str | None):
    """Build a SELECT statement for listing records: base WHERE + optional q-filter + ORDER BY.

    Does NOT apply LIMIT/OFFSET — call ``Page.apply(stmt)`` on the result.
    Raises HTTPException(422) if ``sort`` contains an invalid field name.

    Returns:
        stmt — a SQLAlchemy select() ready for ``Page.apply()`` and ``s.execute()``.
    """
    stmt = select(Record).where(
        Record.tenant_id == tenant_id,
        Record.entity_key == entity_key,
    )

    # ---- q (free-text search) — pushed into SQL ----------------------------------------
    # Approximate the legacy in-Python ``_matches_q`` via ``data::text ILIKE '%q%'``.
    # False-positive risk on non-string numerics is acceptable (documented trade-off D25).
    if q:
        needle = f"%{q}%"
        stmt = stmt.where(or_(
            cast(Record.data, Text).ilike(needle),
            Record.status.ilike(needle),
        ))

    # ---- sort — pushed into SQL --------------------------------------------------------
    # status / created_at → plain column; anything else → JSONB key lookup.
    # Validate the field name to prevent injection even though SQLAlchemy parameterises.
    sort_clause = Record.created_at  # default ordering
    sort_desc = False
    if sort:
        sort_desc = sort.startswith("-")
        field = sort[1:] if sort_desc else sort
        if not re.match(r"^[A-Za-z0-9_]+$", field):
            raise HTTPException(422, f"Invalid sort field '{field}'")
        if field == "created_at":
            sort_clause = Record.created_at
        elif field == "status":
            sort_clause = Record.status
        else:
            sort_clause = Record.data[field].astext

    stmt = stmt.order_by(
        desc(sort_clause).nullslast() if sort_desc else sort_clause.nullslast()
    )
    return stmt


def build_count_stmt(tenant_id, entity_key: str, q: str | None):
    """Build a base SELECT statement for counting records (same WHERE as ``build_record_list_stmt``).

    The caller passes this to ``count_select()`` from ``app.pagination``.

    Returns:
        base_stmt — a SQLAlchemy select() without ORDER BY / LIMIT / OFFSET.
    """
    base_stmt = select(Record).where(
        Record.tenant_id == tenant_id,
        Record.entity_key == entity_key,
    )
    if q:
        needle = f"%{q}%"
        base_stmt = base_stmt.where(or_(
            cast(Record.data, Text).ilike(needle),
            Record.status.ilike(needle),
        ))
    return base_stmt


# ---------------------------------------------------------------------------
# Post-fetch Python filters
# ---------------------------------------------------------------------------

def apply_org_scope(rows: list, grants, entity_key: str, paths: dict) -> list:
    """Drop records whose owner_node_id is outside the caller's org scope.

    Runs in Python after the SQL page has been fetched because the path-subtree match
    is not cheaply pushable into SQL (would need an org-tree join).

    Args:
        rows:       fetched Record objects (one SQL page).
        grants:     the caller's Grant list from ``load_grants()``.
        entity_key: the entity's internal key (e.g. ``"customer"``).
        paths:      mapping of ``{str(node_id): ltree_path}`` from ``_node_paths()``.

    Returns:
        Filtered subset of ``rows`` the caller is allowed to see.
    """
    return [
        r for r in rows
        if can(
            grants,
            entity_key,
            "view",
            paths.get(str(r.owner_node_id)) if r.owner_node_id else None,
        )
    ]


def apply_gxl_filter(rows: list, filter_expr: str | None) -> list:
    """Apply a GXL boolean expression to a list of records.

    A broken or falsy expression excludes the record (fail-closed). If ``filter_expr``
    is None or empty, all rows pass through.

    Args:
        rows:        Record objects (already org-scoped).
        filter_expr: a GXL expression string (e.g. ``"status == 'active'"``) or None.

    Returns:
        Filtered subset of ``rows`` for which the expression evaluates to True.
    """
    if not filter_expr:
        return rows
    return [
        r for r in rows
        if gxl.evaluate(filter_expr, {**(r.data or {}), "status": r.status})
    ]
