"""Stage 2 remediation — H9 Subscription billing_anchor_day policy.

The audit flagged: the legacy `_add_cycle` derives the billing day from `started_at.day`
(clamped to the month length). That makes a subscription started on the 31st bill on the
28th every February + the 31st of every long month — undocumented behavior. Stage 2 close
adds an explicit `subscription.billing_anchor_day` (NULL = legacy derive-from-started_at);
1..31 stored in the DB, clamped to the target month's last day at apply time.

Properties covered:
  * anchor_day=29 → Feb 28 (or 29 in leap years), then back to 29 in March.
  * anchor_day=31 → last day of every month.
  * validate_anchor_day rejects 0 / negative / > 31.
"""
from datetime import datetime, timezone

import pytest

from app.routers._billing_shared import _add_cycle, validate_anchor_day
from fastapi import HTTPException


# ════════════════════════════════════════════════════════════════════════════
# 1. anchor_day=29 — short months clamp; longer months snap back.
# ════════════════════════════════════════════════════════════════════════════

def test_anchor_day_29_falls_to_feb_28_then_back_to_29_in_march():
    """A subscription anchored to the 29th, billed on Jan 29, advances to Feb 28 (the last
    day of February in 2026, a non-leap year), then snaps BACK to Mar 29. This is the
    canonical Stripe-style anchor-day behavior and it must survive every cycle."""
    # Jan 29 2026 → Feb 28 2026 (Feb has 28 days in 2026, a non-leap year).
    jan_29 = datetime(2026, 1, 29, 12, 0, tzinfo=timezone.utc)
    feb = _add_cycle(jan_29, "monthly", 29)
    assert feb.year == 2026 and feb.month == 2 and feb.day == 28, (
        f"Expected Feb 28 2026 for anchor=29 in non-leap year; got {feb.isoformat()}"
    )

    # Feb 28 → Mar 29 (anchor snaps back to 29 in a month that has the day).
    mar = _add_cycle(feb, "monthly", 29)
    assert mar.year == 2026 and mar.month == 3 and mar.day == 29, (
        f"Expected Mar 29 2026 after the Feb fallback; got {mar.isoformat()}"
    )

    # Apr 29 — also has the day, stays 29.
    apr = _add_cycle(mar, "monthly", 29)
    assert apr.year == 2026 and apr.month == 4 and apr.day == 29, (
        f"Expected Apr 29 2026; got {apr.isoformat()}"
    )

    # Leap-year sanity: Jan 29 2024 → Feb 29 2024 (leap year does have day 29).
    jan_29_leap = datetime(2024, 1, 29, 12, 0, tzinfo=timezone.utc)
    feb_leap = _add_cycle(jan_29_leap, "monthly", 29)
    assert feb_leap.year == 2024 and feb_leap.month == 2 and feb_leap.day == 29, (
        f"Expected Feb 29 2024 (leap year has day 29); got {feb_leap.isoformat()}"
    )


# ════════════════════════════════════════════════════════════════════════════
# 2. anchor_day=31 → last day of every month.
# ════════════════════════════════════════════════════════════════════════════

def test_anchor_day_31_uses_last_day_each_month():
    """anchor=31 must produce the LAST day of every target month: 31 in months that have it,
    30 in months that don't (April / June / September / November), 28 in February (29 in
    leap years). This is the contract product owners expect for "bill on the last day"."""
    # Jan 31 → Feb 28 (2026, non-leap).
    jan_31 = datetime(2026, 1, 31, 12, 0, tzinfo=timezone.utc)
    feb = _add_cycle(jan_31, "monthly", 31)
    assert feb.year == 2026 and feb.month == 2 and feb.day == 28

    # Feb 28 → Mar 31 (anchor snaps back to 31; March has 31 days).
    mar = _add_cycle(feb, "monthly", 31)
    assert mar.year == 2026 and mar.month == 3 and mar.day == 31

    # Mar 31 → Apr 30 (April has only 30 days; anchor clamps).
    apr = _add_cycle(mar, "monthly", 31)
    assert apr.year == 2026 and apr.month == 4 and apr.day == 30

    # Apr 30 → May 31 (May has 31; anchor snaps back).
    may = _add_cycle(apr, "monthly", 31)
    assert may.year == 2026 and may.month == 5 and may.day == 31

    # Yearly cycle also clamps correctly: 2024-02-29 (leap) → 2025-02-28 with anchor=29.
    leap_feb = datetime(2024, 2, 29, 12, 0, tzinfo=timezone.utc)
    next_year = _add_cycle(leap_feb, "yearly", 29)
    assert next_year.year == 2025 and next_year.month == 2 and next_year.day == 28


# ════════════════════════════════════════════════════════════════════════════
# 3. validate_anchor_day rejects 0 / negative / > 31 / non-int.
# ════════════════════════════════════════════════════════════════════════════

def test_invalid_anchor_day_rejected():
    """The validator must 422 for: 0, negative, > 31, booleans (which are technically int),
    non-int types. None passes through (means "derive from started_at.day")."""
    # day=0 — explicitly rejected (not in 1..31).
    with pytest.raises(HTTPException) as exc_info_zero:
        validate_anchor_day(0)
    assert exc_info_zero.value.status_code == 422

    # day=-1 — rejected.
    with pytest.raises(HTTPException) as exc_info_neg:
        validate_anchor_day(-1)
    assert exc_info_neg.value.status_code == 422

    # day=32 — rejected.
    with pytest.raises(HTTPException) as exc_info_high:
        validate_anchor_day(32)
    assert exc_info_high.value.status_code == 422

    # day=True (bool is subclass of int) — rejected because the operator almost certainly
    # meant a number, not a flag.
    with pytest.raises(HTTPException) as exc_info_bool:
        validate_anchor_day(True)
    assert exc_info_bool.value.status_code == 422

    # day="15" — string, rejected (don't silently coerce).
    with pytest.raises(HTTPException) as exc_info_str:
        validate_anchor_day("15")
    assert exc_info_str.value.status_code == 422

    # None passes through — means "derive from started_at.day" (legacy behavior).
    validate_anchor_day(None)  # MUST NOT raise

    # All values in 1..31 pass through.
    for d in (1, 15, 28, 29, 30, 31):
        validate_anchor_day(d)  # MUST NOT raise
