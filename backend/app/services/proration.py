"""Phase A.1 — proration: split an MRC across a partial billing cycle.

Two granularities:

* ``prorate_daily``  — bills by days (the BSS default; what most ISPs use). The amount is
  ``mrc * (days_active / days_in_cycle)`` rounded to 2dp HALF_UP.
* ``prorate_secondly`` — bills by seconds (used for hourly/metered prepaid). The amount is
  ``mrc * (seconds_active / seconds_in_cycle)`` rounded to 2dp HALF_UP.

Decimal arithmetic ONLY — float drift is unacceptable in money math. The active window is
**clamped** to the cycle window before measurement, so passing a `start` before the cycle's
opening day, or an `end` after its close, doesn't over-bill the customer. An inverted or
zero-day range returns ``Decimal('0.00')`` instead of raising — proration is a money helper,
not a validator; the caller stays in control of input checks.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP


_TWO_PLACES = Decimal("0.01")
_ZERO = Decimal("0.00")


def _round2(value: Decimal) -> Decimal:
    """2-decimal-place HALF_UP rounding — the BSS money rounding convention."""
    return value.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


def prorate_daily(
    mrc: Decimal,
    *,
    start: date,
    end: date,
    cycle_start: date,
    cycle_end: date,
) -> Decimal:
    """Days-active / days-in-cycle proration of ``mrc``.

    The ``[start, end]`` window is clamped into ``[cycle_start, cycle_end]`` before measurement.
    The day count is **inclusive** on both ends (a start==end charges 1 day) — that matches the
    way BSS bills "the day the service started counts as a day." An inverted or empty range
    returns ``Decimal('0.00')``; a fully-covering range returns the rounded full ``mrc``.
    """
    if mrc is None:
        return _ZERO
    mrc = Decimal(mrc)
    # Cycle length: also inclusive (Jan 1..Jan 31 = 31 days).
    cycle_days = (cycle_end - cycle_start).days + 1
    if cycle_days <= 0:
        return _ZERO

    # Clamp the active window into the cycle. The caller may pass dates outside the cycle —
    # we never over- or under-charge by trusting the raw inputs.
    active_start = max(start, cycle_start)
    active_end = min(end, cycle_end)
    if active_end < active_start:
        return _ZERO
    active_days = (active_end - active_start).days + 1
    if active_days <= 0:
        return _ZERO

    # Whole-cycle short-circuit: returns the exact rounded MRC even when the ratio is 1.
    if active_days >= cycle_days:
        return _round2(mrc)

    ratio = Decimal(active_days) / Decimal(cycle_days)
    return _round2(mrc * ratio)


def prorate_secondly(
    mrc: Decimal,
    *,
    start: datetime,
    end: datetime,
    cycle_start: datetime,
    cycle_end: datetime,
) -> Decimal:
    """Per-second proration of ``mrc`` — for hourly/metered cycles needing high precision.

    Same clamping + rounding rules as :func:`prorate_daily`. Returns ``Decimal('0.00')`` for
    inverted / zero-length ranges. ``end`` and ``cycle_end`` are treated as exclusive instants
    so back-to-back cycles don't double-count the boundary second.
    """
    if mrc is None:
        return _ZERO
    mrc = Decimal(mrc)
    cycle_seconds = Decimal((cycle_end - cycle_start).total_seconds())
    if cycle_seconds <= 0:
        return _ZERO

    active_start = max(start, cycle_start)
    active_end = min(end, cycle_end)
    if active_end <= active_start:
        return _ZERO
    active_seconds = Decimal((active_end - active_start).total_seconds())
    if active_seconds <= 0:
        return _ZERO

    if active_seconds >= cycle_seconds:
        return _round2(mrc)

    ratio = active_seconds / cycle_seconds
    return _round2(mrc * ratio)
