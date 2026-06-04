"""M1-C.1 — Stripe webhook event dispatcher.

Translates an inbound Stripe event into GAAhex-side state changes:

  * ``payment_intent.succeeded``   → write Payment row, flip Invoice to PAID,
                                     recompute account balance
  * ``payment_intent.payment_failed`` → emit audit Event for dunning re-evaluation;
                                        NO DB-state mutation (the invoice stays ISSUED/OVERDUE)
  * ``charge.refunded``            → accumulate Payment.refunded_amount; recompute balance
  * ``payment_method.attached``    → upsert PaymentMethod row (idempotent against the
                                     vault_card flow which would have created it already)
  * ``setup_intent.succeeded``     → no-op (vault flow doesn't run through SetupIntent today)
  * anything else                  → ``ignored`` (we keep the audit row; no mutation)

Tenant scoping
==============
Each handler reads ``tenant_id`` from ``event.data.object.metadata``. If the metadata is
absent (e.g. a dashboard-fired refund against an old PaymentIntent), the handler logs a
warning and returns ``'ignored'`` — better than silently writing to the wrong tenant. The
session's ``gaahex.tenant_id`` GUC is bound before any tenant-scoped query.

The caller (the webhook router) owns ``await session.commit()`` AND owns writing the
``StripeWebhookEvent`` audit row (so a single transaction covers the dispatch + audit).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ...models.billing import Invoice, Payment
from ...models.payment_method import PaymentMethod
from ...services.account_balance import recompute_account_balance
from ...services.payment_allocation import outstanding_for_invoice

_log = logging.getLogger("portal.payments.stripe_events")


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────


def _data_object(event: dict) -> dict:
    """Extract ``event['data']['object']`` defensively.

    Stripe always wraps the resource in ``data.object`` — but we never trust an upstream
    payload to have the right shape. ``None`` cascades into an empty dict so the caller
    code stays branchless.
    """
    return (((event or {}).get("data") or {}).get("object")) or {}


def _metadata(obj: dict) -> dict:
    """Stripe ``metadata`` field — always a dict (possibly empty)."""
    return (obj or {}).get("metadata") or {}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_uuid(v: Any) -> uuid.UUID | None:
    """Return ``v`` as a UUID, or ``None`` if it isn't a parseable UUID string."""
    if v is None or v == "":
        return None
    try:
        return uuid.UUID(str(v))
    except (TypeError, ValueError):
        return None


async def _set_tenant_guc(session: AsyncSession, tenant_id: uuid.UUID | None) -> None:
    """Bind the RLS GUC for this session before any tenant-scoped query.

    The webhook router uses the owner role (which BYPASSES RLS), so setting the GUC
    is decorative today but future-proofs the path for when webhooks move under a
    NOSUPERUSER role with explicit per-event tenant binding.
    """
    if tenant_id is None:
        return
    await session.execute(
        text("SELECT set_config(:k, :v, false)"),
        {"k": "gaahex.tenant_id", "v": str(tenant_id)},
    )


# ──────────────────────────────────────────────────────────────────────────
# Individual event handlers
# ──────────────────────────────────────────────────────────────────────────


async def _handle_payment_intent_succeeded(session: AsyncSession, event: dict) -> str:
    """Write a Payment row + flip the Invoice to PAID + recompute account balance.

    Idempotency: we check for a prior Payment row with ``gateway_charge_id == intent.id``
    via the ``note`` field (the Payment table doesn't have a dedicated gateway-id column
    in the current schema, so we encode it in ``note`` as a ``stripe:pi_...`` marker).
    A duplicate succeeds silently with ``'ignored'``.
    """
    obj = _data_object(event)
    meta = _metadata(obj)

    tenant_id = _coerce_uuid(meta.get("tenant_id"))
    invoice_id = _coerce_uuid(meta.get("invoice_id"))
    customer_id = _coerce_uuid(meta.get("customer_ref"))
    if tenant_id is None or invoice_id is None:
        _log.warning(
            "stripe_events.payment_intent.succeeded: missing tenant_id/invoice_id in metadata; "
            "skipping. intent=%s", obj.get("id"),
        )
        return "ignored"

    await _set_tenant_guc(session, tenant_id)

    # Tenant-scoped invoice lookup. The handler runs under the owner role so RLS is a no-op,
    # but the explicit tenant_id filter prevents cross-tenant writes even if a future engine
    # change shifts the boundary.
    inv = (await session.execute(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if inv is None:
        _log.warning(
            "stripe_events.payment_intent.succeeded: invoice %s not found in tenant %s",
            invoice_id, tenant_id,
        )
        return "ignored"

    intent_id = obj.get("id") or ""
    # Idempotency: a Payment whose ``note`` already references this intent id is a duplicate.
    # The ``note`` carries ``stripe:<intent_id>`` as a sentinel for that match.
    sentinel = f"stripe:{intent_id}"
    existing = (await session.execute(
        select(Payment).where(
            Payment.tenant_id == tenant_id,
            Payment.invoice_id == invoice_id,
            Payment.note == sentinel,
        )
    )).scalar_one_or_none()
    if existing is not None:
        return "ignored"

    # Stripe returns amounts in the currency's smallest unit (cents for USD, luma for AMD).
    # Our Payment.amount column is luma already, so the value passes straight through.
    amount = int(obj.get("amount_received") or obj.get("amount") or 0)
    if amount <= 0:
        _log.warning(
            "stripe_events.payment_intent.succeeded: non-positive amount %s on intent %s",
            amount, intent_id,
        )
        return "ignored"

    # F1 (financial-integrity Critical) — currency lock-in.
    # GAAhex's money column is AMD luma (the smallest unit of AMD). A Stripe event arriving
    # in any other currency would otherwise be credited at face value (e.g. 1000 USD cents
    # would land as 1000 AMD luma) — silently miscrediting the invoice. We REFUSE to credit
    # any non-AMD event; raise so the webhook router records the audit row as 'errored' for
    # operator triage, and the surrounding transaction rolls back without writing a Payment.
    currency = (obj.get("currency") or "").lower()
    if currency != "amd":
        _log.warning(
            "stripe_events.payment_intent.succeeded: rejecting non-AMD currency %r on intent %s "
            "(invoice %s, tenant %s)", currency, intent_id, invoice_id, tenant_id,
        )
        raise ValueError(
            f"stripe webhook currency must be 'amd', got {currency!r} (intent={intent_id})"
        )

    # F2 (financial-integrity Critical) — amount-vs-outstanding gate.
    # We must never credit more than what's actually owed on the invoice (cumulative payments +
    # applied credit notes already subtracted). outstanding_for_invoice() returns Decimal luma.
    # Comparing int luma (amount) against Decimal luma is safe — both are integer luma values.
    outstanding = await outstanding_for_invoice(session, inv.id)
    if amount > int(outstanding):
        _log.warning(
            "stripe_events.payment_intent.succeeded: rejecting over-payment amount=%s > "
            "outstanding=%s on intent %s (invoice %s, tenant %s)",
            amount, int(outstanding), intent_id, invoice_id, tenant_id,
        )
        raise ValueError(
            f"stripe webhook amount {amount} exceeds invoice outstanding {int(outstanding)} "
            f"(intent={intent_id})"
        )

    pay = Payment(
        tenant_id=tenant_id,
        invoice_id=invoice_id,
        customer_id=customer_id,
        account_id=inv.account_id,
        amount=amount,
        method="card",
        paid_at=_utcnow(),
        note=sentinel,
    )
    session.add(pay)
    await session.flush()

    # F3 (financial-integrity Critical) — net-paid flip.
    # The auto-PAID flip used to look at SUM(Payment.amount), ignoring refunds. After a partial
    # refund, gross-paid could still meet invoice.total while net-paid was below — leaving the
    # invoice incorrectly stuck at PAID. Subtract refunded_amount so the flip reflects the money
    # actually retained.
    from sqlalchemy import func as _f
    paid_sum = (await session.execute(
        select(_f.coalesce(
            _f.sum(Payment.amount - _f.coalesce(Payment.refunded_amount, 0)),
            0,
        )).where(Payment.invoice_id == inv.id)
    )).scalar_one()
    if paid_sum >= inv.total and inv.status not in ("PAID", "VOID"):
        inv.status = "PAID"

    if inv.account_id is not None:
        await recompute_account_balance(session, inv.account_id)

    return "handled"


async def _handle_payment_intent_payment_failed(session: AsyncSession, event: dict) -> str:
    """No DB-state mutation — just log the failure so dunning can re-evaluate.

    A failed PaymentIntent doesn't move the invoice (it stays ISSUED/OVERDUE) and doesn't
    create a Payment row. We emit an info log so operators can correlate the failure
    with their dunning queue; downstream, the run-dunning sweep picks the invoice up the
    next time it runs.
    """
    obj = _data_object(event)
    meta = _metadata(obj)
    _log.info(
        "stripe_events.payment_intent.payment_failed: intent=%s tenant=%s invoice=%s reason=%s",
        obj.get("id"), meta.get("tenant_id"), meta.get("invoice_id"),
        (obj.get("last_payment_error") or {}).get("message"),
    )
    return "handled"


async def _handle_charge_refunded(session: AsyncSession, event: dict) -> str:
    """Accumulate refunded_amount on the matching Payment row.

    Stripe fires ``charge.refunded`` whenever a refund (full or partial) lands. The
    ``object`` is the underlying Charge with cumulative ``amount_refunded`` — we use
    that as the authoritative refunded total rather than adding the per-event delta
    (which would double-count if a single refund triggered two webhook deliveries).
    """
    obj = _data_object(event)
    meta = _metadata(obj)

    tenant_id = _coerce_uuid(meta.get("tenant_id"))
    intent_id = obj.get("payment_intent") or ""
    if tenant_id is None or not intent_id:
        _log.warning(
            "stripe_events.charge.refunded: missing tenant_id or payment_intent; skipping. "
            "charge=%s tenant_meta=%s", obj.get("id"), meta.get("tenant_id"),
        )
        return "ignored"

    await _set_tenant_guc(session, tenant_id)

    sentinel = f"stripe:{intent_id}"
    pay = (await session.execute(
        select(Payment).where(
            Payment.tenant_id == tenant_id,
            Payment.note == sentinel,
        )
    )).scalar_one_or_none()
    if pay is None:
        _log.warning(
            "stripe_events.charge.refunded: no Payment with sentinel %s in tenant %s",
            sentinel, tenant_id,
        )
        return "ignored"

    # Stripe's ``amount_refunded`` is cumulative — use it as the source of truth.
    refunded_total = int(obj.get("amount_refunded") or 0)
    if refunded_total < int(pay.refunded_amount or 0):
        # A late-arriving event for an earlier (smaller) refund — ignore so we don't go
        # backwards. The latest delivery already reflected the larger total.
        return "ignored"
    if refunded_total == int(pay.refunded_amount or 0):
        # Same total as before — duplicate delivery for an already-recorded refund.
        return "ignored"

    pay.refunded_amount = refunded_total
    pay.refunded_at = _utcnow()

    # Recompute balance: refunded payments effectively reduce ``payments_collected``.
    if pay.account_id is not None:
        await recompute_account_balance(session, pay.account_id)
    elif pay.invoice_id is not None:
        inv = (await session.execute(
            select(Invoice).where(Invoice.id == pay.invoice_id)
        )).scalar_one_or_none()
        if inv is not None and inv.account_id is not None:
            await recompute_account_balance(session, inv.account_id)

    return "handled"


async def _handle_payment_method_attached(session: AsyncSession, event: dict) -> str:
    """Upsert a PaymentMethod row.

    Stripe fires this when a PaymentMethod is attached to a Customer — usually right
    after our ``vault_card`` flow (which already wrote the row). The handler is
    idempotent: if a row with the same ``gateway_token`` exists, we touch ``last_used_at``
    and return; otherwise we'd need the ``customer_id`` (GAAhex UUID) from metadata to
    insert a fresh row.
    """
    obj = _data_object(event)
    meta = _metadata(obj)

    tenant_id = _coerce_uuid(meta.get("tenant_id"))
    if tenant_id is None:
        _log.warning(
            "stripe_events.payment_method.attached: missing tenant_id in metadata; skipping. "
            "pm=%s", obj.get("id"),
        )
        return "ignored"

    await _set_tenant_guc(session, tenant_id)

    pm_token = obj.get("id") or ""
    if not pm_token:
        return "ignored"

    existing = (await session.execute(
        select(PaymentMethod).where(
            PaymentMethod.tenant_id == tenant_id,
            PaymentMethod.gateway_token == pm_token,
        )
    )).scalar_one_or_none()
    if existing is not None:
        # Already vaulted by the application's vault_card flow — touch last_used_at.
        existing.last_used_at = _utcnow()
        return "handled"

    # Insertion path: we need the GAAhex customer_id from metadata to land a row.
    customer_id = _coerce_uuid(meta.get("customer_ref"))
    if customer_id is None:
        _log.warning(
            "stripe_events.payment_method.attached: pm %s has no customer_ref metadata "
            "and no prior row in tenant %s; cannot insert", pm_token, tenant_id,
        )
        return "ignored"

    card = (obj or {}).get("card") or {}
    pm = PaymentMethod(
        tenant_id=tenant_id,
        customer_id=customer_id,
        gateway="stripe",
        gateway_token=pm_token,
        last4=str(card.get("last4") or "")[:4],
        brand=str(card.get("brand") or "other")[:20].lower(),
        exp_month=int(card.get("exp_month") or 0),
        exp_year=int(card.get("exp_year") or 0),
        is_default=False,
        status="active",
    )
    session.add(pm)
    await session.flush()
    return "handled"


async def _handle_setup_intent_succeeded(session: AsyncSession, event: dict) -> str:
    """No-op. The vault flow uses PaymentMethod.attach directly, not SetupIntent."""
    obj = _data_object(event)
    _log.debug(
        "stripe_events.setup_intent.succeeded: no-op (vault flow uses PaymentMethod.attach). "
        "setup_intent=%s", obj.get("id"),
    )
    return "ignored"


# ──────────────────────────────────────────────────────────────────────────
# Dispatcher
# ──────────────────────────────────────────────────────────────────────────


_HANDLERS = {
    "payment_intent.succeeded": _handle_payment_intent_succeeded,
    "payment_intent.payment_failed": _handle_payment_intent_payment_failed,
    "charge.refunded": _handle_charge_refunded,
    "payment_method.attached": _handle_payment_method_attached,
    "setup_intent.succeeded": _handle_setup_intent_succeeded,
}


async def handle_stripe_event(session: AsyncSession, event: dict) -> str:
    """Dispatch a Stripe event to the right handler. Returns the result string.

    Result vocabulary: ``'handled'`` | ``'ignored'``. The router maps exceptions to
    ``'errored'`` itself — handlers SHOULD raise on unexpected conditions and the router
    captures + records that. The router also keeps the audit row (see
    ``StripeWebhookEvent``) so a handler returning ``'ignored'`` still leaves a trail.
    """
    event_type = (event or {}).get("type") or ""
    handler = _HANDLERS.get(event_type)
    if handler is None:
        _log.info("stripe_events: unhandled event type %s — ignoring", event_type)
        return "ignored"
    return await handler(session, event)
