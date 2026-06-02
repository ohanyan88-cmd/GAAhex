"""Reusable, opt-in pagination for growable lists.

The contract is **non-breaking**: a caller that passes no paging params gets the *full* result
exactly as before (the body shape never changes — it stays a plain list). Pagination is purely
additive: callers opt in with `limit`/`offset`, and the total row count always travels in an
`X-Total-Count` response header so a frontend can build a pager without touching the body.

Two surfaces, because GAAhex lists come in two shapes:

  - `Page` — parses + bounds `limit`/`offset` once (sane default, hard max cap). `limit=None`
    means "no params" ⇒ no upper bound (full list, prior behavior).
  - `paginate_select` / `count_select` — apply the page (and get the matching total) to a
    SQLAlchemy `select()` when the DB does the filtering.
  - `slice_list` — apply the same page to an already-filtered in-memory list (used by the
    generic records engine, which filters/sorts in Python after the access-control pass).

`X_TOTAL_COUNT` is the canonical header name so every list endpoint spells it the same way.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.sql import Select

# Default page size: None ⇒ "no limit param given" ⇒ return everything (today's behavior).
DEFAULT_LIMIT: int | None = None
# Hard cap so an explicit `limit` can never ask for an unbounded page.
MAX_LIMIT = 500

# Canonical response header carrying the total count of matching rows (pre-pagination).
X_TOTAL_COUNT = "X-Total-Count"


class Page:
    """Parsed + bounded paging window.

    `limit=None` (the default ⇒ no param supplied) means *no upper bound*: the full result, so an
    existing caller that passes nothing sees exactly what it saw before. An explicit `limit` is
    clamped to `[1, MAX_LIMIT]`; `offset` is clamped to `>= 0`.
    """

    __slots__ = ("limit", "offset")

    def __init__(self, limit: int | None = DEFAULT_LIMIT, offset: int | None = 0):
        if limit is None:
            self.limit = None
        else:
            self.limit = max(1, min(int(limit), MAX_LIMIT))
        self.offset = max(0, int(offset or 0))

    @property
    def is_unbounded(self) -> bool:
        """True when no `limit` was supplied ⇒ return everything from `offset` on."""
        return self.limit is None

    def slice_list(self, items: list) -> list:
        """Apply this window to an already-filtered in-memory list.

        Unbounded ⇒ `items[offset:]` (full tail; with the default offset=0 this is `items`
        itself, identical to no pagination at all). Bounded ⇒ `items[offset : offset+limit]`.
        """
        if self.is_unbounded:
            return items[self.offset:] if self.offset else items
        return items[self.offset: self.offset + self.limit]

    def apply(self, stmt: Select) -> Select:
        """Apply this window to a SQLAlchemy select (offset always, limit only when bounded)."""
        if self.offset:
            stmt = stmt.offset(self.offset)
        if not self.is_unbounded:
            stmt = stmt.limit(self.limit)
        return stmt


def paginate_select(stmt: Select, limit: int | None = DEFAULT_LIMIT, offset: int | None = 0) -> Select:
    """Convenience: build a `Page` from raw params and apply it to a select."""
    return Page(limit, offset).apply(stmt)


def count_select(stmt: Select) -> Select:
    """A `SELECT count(*)` over the *same* filtered query (same WHERE/JOINs), with any
    ORDER BY / LIMIT / OFFSET stripped — the total of matching rows before paging.

    Use as: `total = (await session.execute(count_select(filtered_stmt))).scalar_one()`.
    """
    return select(func.count()).select_from(stmt.order_by(None).limit(None).offset(None).subquery())
