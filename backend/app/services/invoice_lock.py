"""Phase A.3 — Invoice immutability gate.

SPEC §0.3 — Financial immutability. Once an Invoice transitions DRAFT → ISSUED its
``posted_at`` is set and the row is "locked": only the small whitelist of fields that
represent ongoing state transitions (status, paid_at) may change. Everything else (total,
lines, customer, period, due date, account, ...) is frozen.

The DB-level DELETE trigger (`prevent_delete_invoice`, migration `b70ef3b98e27`) still
forbids row deletion at all times — `posted_at` adds the UPDATE-time guard on top.

This module is intentionally tiny: one frozenset + one HTTPException-raising guard. The
guard is called from every mutating path on /api/invoices in routers/billing.py before
each non-status / non-paid_at field is written.
"""
from __future__ import annotations

from fastapi import HTTPException


# Fields that REMAIN MUTABLE after an invoice has been posted (posted_at IS NOT NULL).
# Everything else freezes. Keep this set small and intentional — adding a field here means
# stating, in code, "this represents an ongoing state transition, not a content edit".
MUTABLE_AFTER_POST_FIELDS = frozenset({"status", "paid_at"})


def ensure_invoice_mutable(invoice, field: str) -> None:
    """Raise HTTPException(409) when writing ``field`` on a locked invoice is forbidden.

    Rules:
      * ``invoice.posted_at IS NULL``  → always allowed (DRAFT lifecycle).
      * ``invoice.posted_at NOT NULL`` + field in MUTABLE_AFTER_POST_FIELDS → allowed.
      * ``invoice.posted_at NOT NULL`` + field NOT in whitelist → 409.

    The function is a no-op pass-through for the allowed cases — it ONLY raises. Caller
    just unconditionally invokes it before the write.
    """
    if invoice is None or invoice.posted_at is None:
        return  # DRAFT / pre-post — anything goes.
    if field in MUTABLE_AFTER_POST_FIELDS:
        return
    raise HTTPException(
        409,
        "invoice is locked; only status/paid_at may change after posted_at",
    )
