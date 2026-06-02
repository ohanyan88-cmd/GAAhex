"""M1-C Phase 0 — PaymentGateway factory.

Looks up settings.payment_gateway_provider, builds the right gateway, and
falls back to the mock implementation when:

* the provider name is unknown
* the provider's config is missing / malformed (``PaymentGatewayConfigError``)
* the vendor SDK is not installed (``ImportError``)

The fallback path keeps the app bootable in dev / fresh-clone scenarios where
no Stripe account exists yet.
"""
from __future__ import annotations

import logging
from typing import Callable

from .exceptions import PaymentGatewayConfigError
from .gateway import PaymentGateway
from .mock_gateway import MockPaymentGateway
from .stripe_gateway import StripeGateway

_log = logging.getLogger("portal.payments.factory")

# name → zero-arg builder. Builders close over settings at the call site, so
# tests can mutate settings between calls without rebuilding the registry.
_REGISTRY: dict[str, Callable[[], PaymentGateway]] = {}


def register_payment_gateway(name: str, builder: Callable[[], PaymentGateway]) -> None:
    """Register a zero-arg builder for a named provider.

    ``builder`` is called from :func:`get_payment_gateway` — defer credential
    lookups inside it so settings changes between tests propagate naturally.
    """
    if not name or not isinstance(name, str):
        raise ValueError("name must be a non-empty string")
    _REGISTRY[name.lower()] = builder


def registered_providers() -> list[str]:
    """Snapshot of currently registered provider keys (sorted)."""
    return sorted(_REGISTRY.keys())


# ------------------------------------------------------------------ builders


def _build_mock() -> PaymentGateway:
    return MockPaymentGateway()


def _build_stripe() -> PaymentGateway:
    """Build StripeGateway from settings; raise ``PaymentGatewayConfigError`` on bad config."""
    from app.config import settings

    return StripeGateway(
        secret_key=getattr(settings, "stripe_secret_key", None),
        webhook_secret=getattr(settings, "stripe_webhook_secret", None),
        api_version=getattr(settings, "stripe_api_version", "2024-06-20"),
    )


# Auto-register the providers we ship.
register_payment_gateway("mock", _build_mock)
register_payment_gateway("logging", _build_mock)  # back-compat alias
register_payment_gateway("stripe", _build_stripe)


# ------------------------------------------------------------------- factory


def get_payment_gateway() -> PaymentGateway:
    """Build a PaymentGateway based on ``settings.payment_gateway_provider``.

    Always returns a working gateway: falls back to ``MockPaymentGateway`` when
    the configured provider isn't usable. Never raises.
    """
    from app.config import settings

    name = (getattr(settings, "payment_gateway_provider", None) or "mock").lower()
    builder = _REGISTRY.get(name)
    if builder is None:
        _log.warning(
            "payment_gateway: unknown provider %r — falling back to mock", name,
        )
        return _build_mock()
    try:
        return builder()
    except (PaymentGatewayConfigError, ImportError) as e:
        _log.warning(
            "payment_gateway: %s config error: %s — falling back to mock",
            name, e,
        )
        return _build_mock()
