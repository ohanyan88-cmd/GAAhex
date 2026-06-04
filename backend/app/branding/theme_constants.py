"""Brand palette for server-rendered HTML — T-P1-7 / D18 backend-color-string guard.

FastAPI renders branded HTML for invoices, receipts, and statements. Those
responses are NOT inside the SPA, so `var(--gx-*)` doesn't resolve — the
browser doesn't have the Tier-1 CSS loaded. Historically every renderer
copy-pasted the brand hex constants (`#1C3B68` for cobalt, `#10B981` for
PAID green, etc.) inline. D18's backend-color-string guard documented this
as a violation: a brand-palette change would silently leave HTML documents
behind.

This module is the single source for those colors. Every renderer imports
from here; a future "we shifted the brand to a darker cobalt" lands once.

The values mirror the Tier-1 `--gx-*` tokens in
`frontend/src/styles/gaahex-tokens.css`. If you change a token, change the
matching entry here (and verify by re-rendering a sample invoice in both
themes — see `docs/standards/TOKEN_MIGRATION_STANDARD.md` §6 acceptance
gate 3).
"""
from __future__ import annotations


# Light print palette — invoice / receipt / statement HTML renders on white
# paper, so the values here are the LIGHT-theme variants of the equivalent
# `--gx-*` tokens (printed documents don't have a "dark mode").
BRAND_PRINT_PALETTE: dict[str, str] = {
    # Brand spine
    "cobalt": "#1C3B68",     # --gx-primary (light)
    "gold":   "#C5A059",     # --gx-gold (light)
    # Ink / text
    "ink":    "#111827",     # --gx-text-1 (light) — primary body text
    "ink2":   "#4B5563",     # --gx-text-2 (light) — secondary
    "ink3":   "#6B7280",     # --gx-text-3 (light) — tertiary / muted
    # Surfaces / borders
    "border":  "#E2E8F0",    # --gx-border-subtle (light)
    "surface": "#F1F3F5",    # --gx-surface-2 (light) — table headers, hover
    # Reverse / paper
    "paper":   "#FFFFFF",
    "on_dark": "#FFFFFF",
}


# Status pill colors — keyed by Invoice.status.
STATUS_COLORS: dict[str, str] = {
    "DRAFT":   BRAND_PRINT_PALETTE["ink3"],
    "ISSUED":  BRAND_PRINT_PALETTE["cobalt"],
    "PAID":    "#10B981",   # --gx-success (light)
    "OVERDUE": "#E65F00",   # --gx-danger / overdue accent
    "VOID":    "#D90429",   # --gx-danger (dark variant)
}


def status_color(status: str | None) -> str:
    """Return the brand color for an Invoice.status, or the muted ink-3 default."""
    return STATUS_COLORS.get((status or "").upper(), BRAND_PRINT_PALETTE["ink3"])
