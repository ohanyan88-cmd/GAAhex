"""Reusable, opt-in pagination for growable lists.

REMEDIATION (D25 — Critical Performance, 2026-06-04):
--------------------------------------------------------
Previously this module shipped ``DEFAULT_LIMIT = None`` — which meant "no limit param given ⇒
load everything". That was the load-bearing root cause of the D25 critical: any list endpoint
that used Page-default could be coerced into a tenant-wide table scan with one unauthenticated
``GET ?q=`` curl.

The new contract is:

  - ``DEFAULT_LIMIT = 100``  — no params now means a bounded page (100 rows), NOT the full table.
  - ``MAX_LIMIT = 1000``     — hard cap; an explicit ``?limit=2000`` is now REJECTED with HTTP 422
                               rather than silently clamped (clamping hides client-side bugs).
  - ``Page.from_request(...)`` — single chokepoint that validates ``limit`` against the cap and
                                 raises ``HTTPException(422)`` on overflow. Use this in routers.

**Breaking change**: any callsite that previously relied on the unbounded default now gets the
first 100 matching rows.  The records.py and export.py engines still pass the raw ``limit``
through Page() so a caller can opt into smaller pages, but they no longer enumerate full
tenants in memory before pagination. Callers expecting "all rows" must paginate.

Two surfaces, because GAAhex lists come in two shapes:

  - `Page` — parses + bounds `limit`/`offset` once (sane default, hard max cap). An explicit
    ``limit`` is range-checked against MAX_LIMIT; nothing is silently clamped.
  - `paginate_select` / `count_select` — apply the page (and get the matching total) to a
    SQLAlchemy `select()` when the DB does the filtering.
  - `slice_list` — apply the same page to an already-filtered in-memory list (used by the
    generic records engine, which filters/sorts in Python after the access-control pass).

`X_TOTAL_COUNT` is the canonical header name so every list endpoint spells it the same way.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.sql import Select

# Default page size. ``None`` is still tolerated by ``Page(...)`` (the legacy ``_paginate``
# helper in records.py passes ``None`` to mean "use my own DEFAULT_PAGE"), but the documented
# default for new list endpoints is now a bounded page of 100 rows.
DEFAULT_LIMIT: int = 100
# Hard cap on an explicit ``?limit=...`` value. Anything above this is rejected (not clamped).
MAX_LIMIT: int = 1000

# Canonical response header carrying the total count of matching rows (pre-pagination).
X_TOTAL_COUNT = "X-Total-Count"


class Page:
    """Parsed + bounded paging window.

    Behavior:
      - ``limit=None`` → legacy "no upper bound" sentinel (records.py engine + a handful of
        sibling helpers still rely on this; new code should pass a real integer).
      - An explicit integer ``limit`` is range-checked against ``MAX_LIMIT``; values over the
        cap are REJECTED with HTTP 422 (callers should use ``Page.from_request`` to surface this
        properly, but the constructor also enforces it so direct construction can't bypass it).
      - ``offset`` is clamped to ``>= 0``.
    """

    __slots__ = ("limit", "offset")

    def __init__(self, limit: int | None = DEFAULT_LIMIT, offset: int | None = 0):
        if limit is None:
            self.limit = None
        else:
            try:
                lim = int(limit)
            except (TypeError, ValueError):
                raise HTTPException(422, "limit must be an integer")
            if lim < 1:
                lim = 1
            if lim > MAX_LIMIT:
                raise HTTPException(422, f"limit exceeds MAX_LIMIT ({MAX_LIMIT})")
            self.limit = lim
        self.offset = max(0, int(offset or 0))

    @classmethod
    def from_request(cls, limit: int | None = None, offset: int | None = 0) -> "Page":
        """Build a Page from raw request params.

        ``limit=None`` ⇒ apply the module DEFAULT_LIMIT (100).  ``limit > MAX_LIMIT`` ⇒ 422.
        This is the recommended entry point for new list endpoints; old endpoints that pass
        ``Page(limit, offset)`` directly with a possibly-None limit keep working unchanged
        (None means unbounded for legacy callers).
        """
        if limit is None:
            return cls(DEFAULT_LIMIT, offset)
        return cls(limit, offset)

    @property
    def is_unbounded(self) -> bool:
        """True when no `limit` was supplied (legacy sentinel) ⇒ return everything from `offset` on."""
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
