"""Billing — public re-export barrel (the original god-router was split, 2026-06-03).

The original ``routers/billing.py`` mixed Subscription, Invoice, Payment, Credit-Note, and
Product endpoints in a single ~1,800-line module. It is now split into domain-focused sibling
routers:

* ``billing_subscription`` — /api/subscriptions/*
* ``billing_invoice``      — /api/invoices/*  (+ /api/invoices/run-dunning)
* ``billing_payment``      — /api/payments/* + /api/invoices/{id}/payments
* ``billing_credit_note``  — /api/credit-notes
* ``billing_product``      — /api/products/* (+ /api/products/{id}/versions)

Shared helpers/constants/serializers live in ``_billing_shared``.

This module exists ONLY to preserve the public symbol surface that other modules import as
``from app.routers.billing import …`` — namely the helper funcs (used by seed scripts, the
scheduler, orders/usage/digests/notifications/report_schedules routers, and billing_cycle)
plus the ``run_dunning`` endpoint function (called by ``scheduler.py``). No FastAPI router is
exported from here anymore — ``main.py`` registers the new domain routers directly.
"""

# ---- helpers / constants / serializers / loaders ----
from ._billing_shared import (  # noqa: F401
    _CYCLES,
    _METHODS,
    _LINE_KINDS,
    _PRORATION_MODES,
    DEFAULT_DUE_DAYS,
    _parse_decimal_opt,
    _signed_line_total,
    _invoice_total,
    _deny,
    _owner_gate,
    _money,
    _now,
    _record_job_run,
    _add_cycle,
    _customer_or_422,
    _iso,
    _sub,
    _line,
    _product,
    _invoice,
    _payment,
    _allocation,
    _credit_note,
    _serialize_version,
    _get_sub,
    _get_invoice,
    _invoice_lines,
    _next_invoice_number,
    _get_product,
    _parse_dt,
)

# ---- endpoint function re-export (scheduler.py imports this) ----
from .billing_invoice import run_dunning  # noqa: F401
