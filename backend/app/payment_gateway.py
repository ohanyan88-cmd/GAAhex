"""Online payment gateway (provider-agnostic, deterministic DevGateway, dormant real providers).

Mirrors the AI-assist foundation (ai.py) and channel-adapter discipline (channels.py):
a small provider registry + `configure_payment_gateway()` that activates a real payment provider
ONLY when env-configured. With no provider (`payment_provider=dev`, the default), every capability
still returns a useful DETERMINISTIC result — the DevGateway fully works with NO external call —
so the test suite and fresh clones are unaffected. Real providers are lazy-imported (from
`app.adapters.payment.<provider>`) only when merchant keys are present; Lane E builds them.

Provider chain:
  dev     → DevGateway (deterministic; always safe; the default)
  idram   → app.adapters.payment.idram.IdramGateway     (active when IDRAM keys set)
  telcell → app.adapters.payment.telcell.TelcellGateway (active when TELCELL keys set)
  arca    → app.adapters.payment.arca.ArcaGateway       (active when ARCA keys set)
  easypay → app.adapters.payment.easypay.EasypayGateway (active when EASYPAY keys set)

`settle_order` is the single idempotent "money confirmed" path — it creates the billing Payment row,
re-sums the invoice, and optionally flips the invoice to PAID. Mirrors billing.add_payment logic
exactly, but driven by gateway confirmation rather than a human UI action.

Configure via backend/.env (never hardcode secrets):
  PAYMENT_PROVIDER=idram
  IDRAM_MERCHANT_ID=...  IDRAM_SECRET_KEY=...
  PAYMENT_CALLBACK_BASE_URL=https://my-isp.example.com
"""
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings

logger = logging.getLogger("gaaex.payment_gateway")


# ============================================================================================
# Abstract gateway contract
# ============================================================================================

class PaymentGateway(ABC):
    """Provider-agnostic gateway interface.

    Every real provider (idram, telcell, arca) and the DevGateway implement this.
    The module-level `_GATEWAY` always points at the active implementation so callers
    never reference a specific provider class.
    """

    @abstractmethod
    async def initiate(self, order, *, callback_url: str) -> dict:
        """Start a payment, return redirect info.

        Returns:
            {"redirect_url": str, "provider_ref": str}

        `redirect_url` is where the user should be sent to pay (or the dev confirm URL).
        `provider_ref` is the provider's unique reference for this transaction.
        Raises on unrecoverable error (caller records FAILED).
        """
        ...

    @abstractmethod
    async def check_status(self, order) -> str:
        """Poll the provider for the current status of a previously-initiated order.

        Returns one of: "PENDING" | "PAID" | "FAILED"
        Used by the reconcile sweep to catch missed callbacks.
        Raises on provider error (caller handles gracefully).
        """
        ...

    @abstractmethod
    def verify_callback(self, body: bytes, headers: dict) -> dict:
        """Verify and parse an inbound provider webhook/callback.

        Returns:
            {"provider_ref": str, "status": "PAID"|"FAILED", "ok": bool}

        `ok=False` signals an invalid HMAC/signature — caller returns 400 without processing.
        `ok=True` means the callback is genuine and `status` is authoritative.
        Never raises (caller depends on a clean dict regardless of body garbage).
        """
        ...


# ============================================================================================
# DevGateway — deterministic, no external call, fully testable
# ============================================================================================

class DevGateway(PaymentGateway):
    """Development gateway. Works without any credentials or external services.

    - initiate: assigns a stable `dev-{order.id}` provider_ref and returns a local confirm URL
      that the frontend's dev-payment page (or a test) can POST to confirm payment.
    - check_status: always returns "PAID" (the dev flow assumes immediate success for demos/tests).
    - verify_callback: always returns ok=True, status=PAID (no HMAC to check in dev mode).

    This is the active gateway when `payment_provider=dev` (the default), so the complete
    payment lifecycle — initiate → callback → settle → invoice flip — is testable with zero
    real provider configuration.
    """

    async def initiate(self, order, *, callback_url: str) -> dict:
        provider_ref = f"dev-{order.id}"
        # callback_url is the base URL of the GAAex server; the frontend dev-confirm page lives there.
        redirect_url = f"{callback_url.rstrip('/')}/pay/dev/{order.id}"
        return {"redirect_url": redirect_url, "provider_ref": provider_ref}

    async def check_status(self, order) -> str:
        # Dev mode: treat all PENDING orders as PAID when polled (simplifies reconcile tests).
        return "PAID"

    def verify_callback(self, body: bytes, headers: dict) -> dict:
        # Dev mode: no HMAC to verify. Echo the posted provider_ref/status so the full callback
        # path (lookup → settle) is exercisable end-to-end; real gateways verify a signature here.
        #
        # Wave 1 multi-tenant note: the verified payload also surfaces the optional `tenant_id`
        # from the body so the callback handler can cross-check that the order found by
        # provider_ref actually belongs to the claimed tenant. Real providers (idram/telcell/arca)
        # MUST include tenant_id (or a tenant-bound order_id) in the HMAC-signed payload before
        # going live — see follow-up in M1-A audit (forward-looking; test ISP is single-tenant).
        import json
        try:
            data = json.loads(body or b"{}")
        except Exception:
            data = {}
        return {"provider_ref": str(data.get("provider_ref") or ""),
                "tenant_id": data.get("tenant_id"),
                "status": data.get("status", "PAID"), "ok": True}


# ============================================================================================
# Registry
# ============================================================================================

_GATEWAY: PaymentGateway = DevGateway()


def register(gw: PaymentGateway) -> None:
    """Register (replace) the active gateway. Called by configure_payment_gateway() when a real
    provider is detected, or by tests that want to inject a mock."""
    global _GATEWAY
    _GATEWAY = gw


def get_gateway() -> PaymentGateway:
    """Return the currently-active gateway (DevGateway by default)."""
    return _GATEWAY


# ============================================================================================
# configure_payment_gateway — activates a real provider when (and only when) env-configured
# ============================================================================================

def configure_payment_gateway() -> None:
    """Activate a real provider when env-configured; otherwise stay on DevGateway.
    Idempotent — safe to call more than once.

    Real providers are lazy-imported from `app.adapters.payment.<provider>` (Lane E builds them).
    The import is guarded inside a try/except so missing modules never crash the server —
    they just fall through to DevGateway with a warning log.
    """
    provider = (getattr(settings, "payment_provider", "dev") or "dev").lower()

    if provider == "dev":
        logger.info("payment_gateway: provider = dev (deterministic DevGateway)")
        return

    # Merchant key checks — each provider needs different keys.
    has_keys = False
    if provider == "idram":
        has_keys = bool(
            getattr(settings, "idram_merchant_id", None) and
            getattr(settings, "idram_secret_key", None)
        )
    elif provider == "telcell":
        has_keys = bool(
            getattr(settings, "telcell_merchant", None) and
            getattr(settings, "telcell_key", None)
        )
    elif provider == "arca":
        has_keys = bool(
            getattr(settings, "arca_merchant", None) and
            getattr(settings, "arca_password", None)
        )
    elif provider == "easypay":
        has_keys = bool(
            getattr(settings, "easypay_merchant_id", None) and
            getattr(settings, "easypay_secret_key", None)
        )

    if not has_keys:
        logger.warning(
            "payment_gateway: provider '%s' selected but merchant keys not set — "
            "falling back to DevGateway (dev mode)",
            provider,
        )
        return

    # Lazy-import the real adapter (built by Lane E).
    try:
        if provider == "idram":
            from app.adapters.payment.idram import IdramGateway  # noqa: PLC0415
            register(IdramGateway(settings.idram_merchant_id, settings.idram_secret_key))
        elif provider == "telcell":
            from app.adapters.payment.telcell import TelcellGateway  # noqa: PLC0415
            register(TelcellGateway(settings.telcell_merchant, settings.telcell_key))
        elif provider == "arca":
            from app.adapters.payment.arca import ArcaGateway  # noqa: PLC0415
            register(ArcaGateway(settings.arca_merchant, settings.arca_password))
        elif provider == "easypay":
            from app.adapters.payment.easypay import EasypayGateway  # noqa: PLC0415
            register(EasypayGateway(settings.easypay_merchant_id, settings.easypay_secret_key))
        else:
            logger.warning("payment_gateway: unknown provider '%s' — dev mode", provider)
            return
        logger.info("payment_gateway: provider = %s (real adapter active)", provider)
    except ImportError:
        logger.warning(
            "payment_gateway: adapter for '%s' not yet installed — falling back to DevGateway",
            provider,
        )


# ============================================================================================
# settle_order — the single idempotent "money confirmed" path
# ============================================================================================

async def settle_order(
    s: AsyncSession,
    order,
    *,
    actor_id=None,
    provider_ref: str | None = None,
    raw: dict | None = None,
) -> None:
    """Idempotent "money has arrived" handler. Creates the billing Payment, re-sums the invoice,
    flips the invoice to PAID when fully paid, and emits a workflow audit event.

    Mirrors billing.add_payment exactly but is driven by gateway confirmation (callback or
    dev-confirm endpoint) rather than a manual payment form.

    Args:
        s:            Active AsyncSession (tenant GUC already set by caller).
        order:        PaymentOrder instance (loaded in the same session).
        actor_id:     User.id of the actor (None for unauthenticated callbacks — OK for audit).
        provider_ref: Provider's transaction reference (updates order.provider_ref if given).
        raw:          Raw callback body dict (stored in order.raw_callback for audit trail).

    Idempotency: if order.status == "PAID" already, returns immediately without any write.
    """
    if order.status == "PAID":
        return  # already settled — idempotent guard

    # Import here to avoid a circular import (payment_gateway ← billing models ← no cycle)
    from .models.billing import Payment, Invoice  # noqa: PLC0415
    from . import workflow  # noqa: PLC0415

    now = datetime.now(timezone.utc)

    # 1. Create the billing Payment row (same fields as billing.add_payment)
    pay = Payment(
        tenant_id=order.tenant_id,
        invoice_id=order.invoice_id,
        amount=order.amount,
        method=order.provider,
        paid_at=now,
        note=f"Gateway {order.provider}",
    )
    s.add(pay)
    await s.flush()  # so pay.id is available

    # 2. Re-sum all payments for this invoice (identical to billing.add_payment's paid_sum query)
    paid_sum = (await s.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.invoice_id == order.invoice_id
        )
    )).scalar_one()

    # 3. Load the invoice and optionally flip to PAID
    invoice = (await s.execute(
        select(Invoice).where(Invoice.id == order.invoice_id)
    )).scalar_one_or_none()

    if invoice is not None and paid_sum >= invoice.total:
        invoice.status = "PAID"

    # 4. Update the PaymentOrder itself
    order.status = "PAID"
    order.payment_id = pay.id
    order.confirmed_at = now
    if provider_ref is not None:
        order.provider_ref = provider_ref
    if raw is not None:
        order.raw_callback = raw

    # 5. Emit workflow audit event (identical chokepoint as all billing mutations)
    await workflow.emit(
        s, order.tenant_id, "payment", "invoice", order.invoice_id, actor_id,
        {
            "payment_order_id": str(order.id),
            "payment_id": str(pay.id),
            "amount": order.amount,
            "provider": order.provider,
            "provider_ref": order.provider_ref,
            "paid_sum": int(paid_sum),
            "invoice_status": invoice.status if invoice else None,
        },
    )


# Activate at import time, guarded by settings (non-invasive — no main.py change needed).
configure_payment_gateway()
