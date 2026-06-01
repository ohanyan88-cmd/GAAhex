"""Phase A.1 — proration math tests.

Exercises ``app.services.proration``:

* ``prorate_daily`` — mid-month signup, whole cycle, zero-day, inverted-range, clamping.
* ``prorate_secondly`` — high-precision per-second proration; whole cycle; inverted-range.

Every assertion is exact (no float drift). Money is Decimal('0.00') with HALF_UP rounding.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.services.proration import prorate_daily, prorate_secondly


# ---------------------------- prorate_daily ----------------------------

def test_prorate_daily_mid_month_signup():
    """Signed up Jan 15 in a Jan 1–Jan 31 cycle = 17 inclusive days out of 31 days.
    100.00 * 17/31 = 54.83870... → 54.84 HALF_UP."""
    out = prorate_daily(
        Decimal("100.00"),
        start=date(2026, 1, 15), end=date(2026, 1, 31),
        cycle_start=date(2026, 1, 1), cycle_end=date(2026, 1, 31),
    )
    assert out == Decimal("54.84")


def test_prorate_daily_whole_cycle_returns_full_mrc():
    """Range exactly covers the cycle → full MRC, no rounding error."""
    out = prorate_daily(
        Decimal("100.00"),
        start=date(2026, 1, 1), end=date(2026, 1, 31),
        cycle_start=date(2026, 1, 1), cycle_end=date(2026, 1, 31),
    )
    assert out == Decimal("100.00")


def test_prorate_daily_zero_day_returns_zero():
    """End before start → 0.00, never raises."""
    out = prorate_daily(
        Decimal("100.00"),
        start=date(2026, 1, 20), end=date(2026, 1, 10),
        cycle_start=date(2026, 1, 1), cycle_end=date(2026, 1, 31),
    )
    assert out == Decimal("0.00")


def test_prorate_daily_inverted_cycle_returns_zero():
    """Cycle bounds inverted → 0.00, no exception."""
    out = prorate_daily(
        Decimal("100.00"),
        start=date(2026, 1, 1), end=date(2026, 1, 5),
        cycle_start=date(2026, 1, 31), cycle_end=date(2026, 1, 1),
    )
    assert out == Decimal("0.00")


def test_prorate_daily_clamps_to_cycle_window():
    """Range extending beyond cycle is clamped — never over-bills the customer."""
    # Active Dec 20, 2025 – Feb 10, 2026 vs cycle Jan 1 – Jan 31 → clamped to full 31-day cycle.
    out = prorate_daily(
        Decimal("100.00"),
        start=date(2025, 12, 20), end=date(2026, 2, 10),
        cycle_start=date(2026, 1, 1), cycle_end=date(2026, 1, 31),
    )
    assert out == Decimal("100.00")


def test_prorate_daily_single_day():
    """One active day in a 31-day cycle: 100/31 = 3.2258 → 3.23 HALF_UP."""
    out = prorate_daily(
        Decimal("100.00"),
        start=date(2026, 1, 15), end=date(2026, 1, 15),
        cycle_start=date(2026, 1, 1), cycle_end=date(2026, 1, 31),
    )
    assert out == Decimal("3.23")


def test_prorate_daily_rounding_half_up_boundary():
    """31.00 / 31 days × 15 days = 15.00 exactly. Verifies no float artifacts."""
    out = prorate_daily(
        Decimal("31.00"),
        start=date(2026, 1, 1), end=date(2026, 1, 15),
        cycle_start=date(2026, 1, 1), cycle_end=date(2026, 1, 31),
    )
    assert out == Decimal("15.00")


# ---------------------------- prorate_secondly ----------------------------

def test_prorate_secondly_half_cycle():
    """Half a cycle (12h of 24h) at MRC 24.00 = 12.00 exactly."""
    cycle_start = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    cycle_end = datetime(2026, 1, 2, 0, 0, 0, tzinfo=timezone.utc)
    out = prorate_secondly(
        Decimal("24.00"),
        start=cycle_start, end=datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        cycle_start=cycle_start, cycle_end=cycle_end,
    )
    assert out == Decimal("12.00")


def test_prorate_secondly_one_second():
    """Single-second precision: 86400.00 / 86400 sec * 1 sec = 1.00."""
    cycle_start = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    cycle_end = datetime(2026, 1, 2, 0, 0, 0, tzinfo=timezone.utc)
    out = prorate_secondly(
        Decimal("86400.00"),
        start=cycle_start, end=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
        cycle_start=cycle_start, cycle_end=cycle_end,
    )
    assert out == Decimal("1.00")


def test_prorate_secondly_whole_cycle():
    """End == cycle_end → full MRC."""
    cycle_start = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    cycle_end = datetime(2026, 1, 2, 0, 0, 0, tzinfo=timezone.utc)
    out = prorate_secondly(
        Decimal("50.00"),
        start=cycle_start, end=cycle_end,
        cycle_start=cycle_start, cycle_end=cycle_end,
    )
    assert out == Decimal("50.00")


def test_prorate_secondly_inverted_returns_zero():
    """end before start → 0.00, no exception."""
    cycle_start = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    cycle_end = datetime(2026, 1, 2, 0, 0, 0, tzinfo=timezone.utc)
    out = prorate_secondly(
        Decimal("24.00"),
        start=datetime(2026, 1, 1, 18, 0, 0, tzinfo=timezone.utc),
        end=datetime(2026, 1, 1, 6, 0, 0, tzinfo=timezone.utc),
        cycle_start=cycle_start, cycle_end=cycle_end,
    )
    assert out == Decimal("0.00")


def test_prorate_returns_decimal_not_float():
    """Returned value must be Decimal (never float — float drift breaks money math)."""
    out = prorate_daily(
        Decimal("100.00"),
        start=date(2026, 1, 1), end=date(2026, 1, 15),
        cycle_start=date(2026, 1, 1), cycle_end=date(2026, 1, 31),
    )
    assert isinstance(out, Decimal)
    out2 = prorate_secondly(
        Decimal("24.00"),
        start=datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
        end=datetime(2026, 1, 1, 6, 0, 0, tzinfo=timezone.utc),
        cycle_start=datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
        cycle_end=datetime(2026, 1, 2, 0, 0, 0, tzinfo=timezone.utc),
    )
    assert isinstance(out2, Decimal)


def test_prorate_daily_none_mrc_returns_zero():
    """Defensive: None as MRC returns 0.00 — pricing fields may be NULL on Product."""
    out = prorate_daily(
        None,
        start=date(2026, 1, 1), end=date(2026, 1, 15),
        cycle_start=date(2026, 1, 1), cycle_end=date(2026, 1, 31),
    )
    assert out == Decimal("0.00")


def test_prorate_secondly_none_mrc_returns_zero():
    cycle_start = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    cycle_end = datetime(2026, 1, 2, 0, 0, 0, tzinfo=timezone.utc)
    out = prorate_secondly(None, start=cycle_start, end=cycle_end,
                           cycle_start=cycle_start, cycle_end=cycle_end)
    assert out == Decimal("0.00")


def test_prorate_daily_february_leap_year():
    """Feb 2024 cycle is 29 days. 290.00 / 29 × 29 = 290.00 exactly."""
    out = prorate_daily(
        Decimal("290.00"),
        start=date(2024, 2, 1), end=date(2024, 2, 29),
        cycle_start=date(2024, 2, 1), cycle_end=date(2024, 2, 29),
    )
    assert out == Decimal("290.00")


def test_prorate_daily_february_non_leap_year():
    """Feb 2026 cycle is 28 days. Mid-month half = 100 × 14/28 = 50.00."""
    out = prorate_daily(
        Decimal("100.00"),
        start=date(2026, 2, 1), end=date(2026, 2, 14),
        cycle_start=date(2026, 2, 1), cycle_end=date(2026, 2, 28),
    )
    assert out == Decimal("50.00")


def test_prorate_daily_yearly_cycle():
    """365-day yearly cycle, 100-day usage: 365.00 * 100/365 = 100.00."""
    out = prorate_daily(
        Decimal("365.00"),
        start=date(2026, 1, 1), end=date(2026, 4, 10),  # Jan 1 to Apr 10 inclusive = 100 days
        cycle_start=date(2026, 1, 1), cycle_end=date(2026, 12, 31),
    )
    assert out == Decimal("100.00")


def test_prorate_secondly_quarter_cycle():
    """6h of a 24h cycle = 25% of MRC."""
    cycle_start = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    cycle_end = datetime(2026, 1, 2, 0, 0, 0, tzinfo=timezone.utc)
    out = prorate_secondly(
        Decimal("40.00"),
        start=cycle_start, end=datetime(2026, 1, 1, 6, 0, 0, tzinfo=timezone.utc),
        cycle_start=cycle_start, cycle_end=cycle_end,
    )
    assert out == Decimal("10.00")


def test_prorate_secondly_clamps_to_cycle():
    """Active window extends beyond cycle on both ends → clamped to full cycle."""
    cycle_start = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    cycle_end = datetime(2026, 1, 2, 0, 0, 0, tzinfo=timezone.utc)
    out = prorate_secondly(
        Decimal("24.00"),
        start=datetime(2025, 12, 31, 0, 0, 0, tzinfo=timezone.utc),
        end=datetime(2026, 1, 3, 0, 0, 0, tzinfo=timezone.utc),
        cycle_start=cycle_start, cycle_end=cycle_end,
    )
    assert out == Decimal("24.00")
