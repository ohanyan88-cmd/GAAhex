"""Canonical datetime helpers (BL-5, BL-9).

Single source of truth for the three datetime idioms that every router used to
re-implement:

* ``parse_iso_dt(value, field, optional=False)`` — parse an ISO-8601 string into
  a tz-aware ``datetime``. **Crucially, naive inputs (no offset, no ``Z``) are
  coerced to UTC** rather than left as tz-naive. Without this coercion,
  subsequent arithmetic against ``datetime.now(timezone.utc)`` raised
  ``TypeError: can't compare offset-naive and offset-aware datetimes`` — a bug
  16+ inline ``_parse_dt`` copies all carried.

* ``now_utc()`` — ``datetime.now(timezone.utc)``. Same one-liner, defined 25+ times
  before this consolidation.

* ``iso_format(dt)`` — ``dt.isoformat() if dt else None``. Same one-liner,
  defined 30+ times before this consolidation.

Callers MUST import from this module. Do not redefine ``_parse_dt``, ``_now``,
``_iso`` (or any equivalent local helper) in router or service files.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Union

from fastapi import HTTPException


def now_utc() -> datetime:
    """Return the current time as a tz-aware UTC ``datetime``."""
    return datetime.now(timezone.utc)


def iso_format(dt: Optional[datetime]) -> Optional[str]:
    """Serialize a ``datetime`` to ISO-8601 string; ``None`` passes through."""
    return dt.isoformat() if dt else None


def parse_iso_dt(
    value: Union[str, None],
    field: str,
    optional: bool = False,
) -> Optional[datetime]:
    """Parse an ISO-8601 string into a tz-aware ``datetime``.

    Naive datetimes (no offset, no ``Z``) are coerced to UTC so downstream
    arithmetic against ``now_utc()`` never raises ``TypeError`` for an
    offset-naive vs offset-aware comparison. Inputs like ``2026-01-15T08:00:00``
    used to silently produce a naive ``datetime`` and blow up at the first
    comparison — that's the bug 16+ inline copies all carried.

    Args:
        value: ISO-8601 string or ``None`` / ``""`` for absent input.
        field: name of the field, used in the 422 error message.
        optional: when ``True``, ``None``/``""`` returns ``None`` instead of 422.

    Raises:
        ``HTTPException(422)`` if the value is missing and ``optional=False``,
        or if the value isn't a parseable ISO-8601 string.
    """
    if value in (None, ""):
        if optional:
            return None
        raise HTTPException(422, f"'{field}' is required")
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"'{field}' must be an ISO datetime")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
