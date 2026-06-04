"""Canonical money formatters (BL-2).

Single source of truth for converting integer luma amounts (1 ֏ = 100 luma) into
human-readable AMD strings. Historically four routers each defined their own
``amd()`` helper — three at 2 d.p. and one (``ai.py``) at 0 d.p., so AI monetary
summaries silently truncated decimals. This module fixes that with one helper.

Use cases:
* ``amd_format(luma)`` — branded document / receipt / portal display.
* ``amd_format_compact(luma)`` — analytics / AI / one-line summaries where
  whole-dram precision is acceptable (still uses the same grouping locale).

Callers should import these — do NOT redefine ``amd``/``_amd``/``fmt_amd`` in
routers, services, or seed scripts.
"""
from __future__ import annotations


def amd_format(luma: int | None) -> str:
    """Integer luma → grouped AMD string at 2 d.p. (``"15,000.00 ֏"``).

    ``None`` is rendered as zero to keep template interpolation simple.
    """
    return f"{(luma or 0) / 100:,.2f} ֏"


def amd_format_compact(luma: int | None) -> str:
    """Integer luma → grouped AMD string at 0 d.p. (``"15,000 ֏"``).

    For contexts where sub-dram precision is noise (AI prose, KPI labels).
    """
    return f"{int(luma or 0) / 100:,.0f} ֏"
