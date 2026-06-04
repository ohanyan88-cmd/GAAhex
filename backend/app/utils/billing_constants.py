"""Shared billing constants (BL-6, VA-3).

Single source of truth for billing-related enums and constant sets used by
multiple routers / services. Previously each file maintained its own copy and
silently drifted apart.
"""
from __future__ import annotations


# Invoice statuses that represent billed revenue on the customer's tab. DRAFT
# isn't billed yet; VOID is reversed. PAID counts because the billed amount is
# still on the ledger — it's just been offset by a corresponding Payment.
BILLED_STATUSES: tuple[str, ...] = ("ISSUED", "OVERDUE", "PAID")


# Methods accepted on the legacy /api/invoices/{id}/payments endpoint.
PAYMENT_METHODS: frozenset[str] = frozenset({"cash", "card", "transfer"})
