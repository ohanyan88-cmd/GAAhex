"""M1-C Phase 0 — RadiusBackend factory.

Mirrors the payments/comms factories: registry of zero-arg builders, falls back
to the mock on ImportError / config errors so GAAhex boots without a RADIUS host.

Stage-2 fail-closed (2026-06-04)
================================
The FreeRADIUS backend ships as a :class:`NotImplementedError` stub (real pyrad
wiring lands in M1-C.4). To prevent that stub from ever surfacing a naked
stack-trace to a customer-facing call site in production, ``get_radius_backend``
now consults two new signals before returning a backend:

1. ``settings.feature_radius_required`` — call site needs RADIUS (prod default
   True; dev/test default False so the existing suite is unaffected).
2. ``FreeRadiusBackend.IS_PRODUCTION_READY`` — class-level flag the stub keeps
   at ``False`` until M1-C.4 wires real packets.

If RADIUS is required AND the resolved backend is a non-production-ready stub,
the factory raises :class:`~app.exceptions.FeatureDisabledError` (mapped to
HTTP 503 + audit Event by the router boundary) instead of returning the stub.

For dev/test (``feature_radius_required=False``) the legacy fall-through to
the mock backend is preserved unchanged.
"""
from __future__ import annotations

import logging
from typing import Callable

from app.exceptions import FeatureDisabledError

from .backend import RadiusBackend
from .exceptions import RadiusBackendConfigError
from .freeradius_backend import FreeRadiusBackend
from .mock_backend import MockRadiusBackend

_log = logging.getLogger("portal.radius.factory")

_REGISTRY: dict[str, Callable[[], RadiusBackend]] = {}


def register_radius_backend(name: str, builder: Callable[[], RadiusBackend]) -> None:
    if not name or not isinstance(name, str):
        raise ValueError("name must be a non-empty string")
    _REGISTRY[name.lower()] = builder


def registered_radius_backends() -> list[str]:
    return sorted(_REGISTRY.keys())


def _build_mock() -> RadiusBackend:
    return MockRadiusBackend()


def _build_freeradius() -> RadiusBackend:
    from app.config import settings
    return FreeRadiusBackend(
        host=getattr(settings, "radius_host", None),
        secret=getattr(settings, "radius_secret", None),
        auth_port=getattr(settings, "radius_auth_port", 1812),
        acct_port=getattr(settings, "radius_acct_port", 1813),
        nas_ip=getattr(settings, "radius_nas_ip", None),
        dictionary_path=getattr(settings, "radius_dictionary_path", None),
    )


register_radius_backend("mock", _build_mock)
register_radius_backend("freeradius", _build_freeradius)


def _is_production_ready(backend: RadiusBackend) -> bool:
    """True iff ``backend`` declares ``IS_PRODUCTION_READY = True`` at the class.

    The mock backend doesn't carry the flag — it's "production-ready" in the
    narrow sense that calling it never raises NotImplementedError — but the
    deploy contract refuses ``radius_backend_provider='mock'`` in production
    anyway, so we only ever consult this flag for the FreeRADIUS class. We
    default to ``False`` when the attribute is absent (fail-closed by default).
    """
    return bool(getattr(type(backend), "IS_PRODUCTION_READY", False))


def get_radius_backend() -> RadiusBackend:
    """Build a RadiusBackend based on ``settings.radius_backend_provider``.

    Stage-2 fail-closed semantics:

    * If ``settings.feature_radius_required`` is True and the configured
      provider would resolve to a non-production-ready stub (FreeRADIUS today),
      raise :class:`~app.exceptions.FeatureDisabledError`. The router layer
      maps this onto HTTP 503 + an audit Event.

    * Otherwise (dev / test / RADIUS-optional deploys) preserve the legacy
      behavior: build the requested backend, falling back to the mock on
      unknown providers / import errors / config errors.

    The mock backend is always safe to return (it never raises
    NotImplementedError); the deploy contract in :mod:`app.config` separately
    refuses ``radius_backend_provider='mock'`` in production.
    """
    from app.config import settings

    name = (getattr(settings, "radius_backend_provider", None) or "mock").lower()
    required = bool(getattr(settings, "feature_radius_required", False))

    # Fail-closed: production requires real RADIUS but the only configured
    # provider is the unimplemented FreeRADIUS stub. Refuse to hand it out;
    # the router boundary will map this onto 503 + audit Event.
    if required and name == "freeradius" and not getattr(
        FreeRadiusBackend, "IS_PRODUCTION_READY", False,
    ):
        _log.error(
            "radius_backend: refusing to return FreeRadiusBackend stub "
            "(IS_PRODUCTION_READY=False) with feature_radius_required=True",
        )
        raise FeatureDisabledError(
            "radius",
            "FreeRADIUS backend is unavailable (NotImplementedError stub)",
        )

    builder = _REGISTRY.get(name)
    if builder is None:
        _log.warning("radius_backend: unknown provider %r — falling back to mock", name)
        return _build_mock()
    try:
        backend = builder()
    except (RadiusBackendConfigError, ImportError) as e:
        _log.warning(
            "radius_backend: %s config error: %s — falling back to mock", name, e,
        )
        return _build_mock()

    # Defensive second gate: if we somehow built a stub backend AND RADIUS is
    # required, refuse it. Covers a custom-registered provider that didn't go
    # through the name-based guard above.
    if required and not _is_production_ready(backend):
        # Mock is always considered safe for the "not required" path below;
        # only refuse here when feature_radius_required=True.
        if isinstance(backend, MockRadiusBackend):
            # Required-RADIUS + mock would be caught by the deploy contract at
            # boot; if we reach this in tests, surface the same error shape.
            _log.error(
                "radius_backend: refusing to return MockRadiusBackend with "
                "feature_radius_required=True (deploy contract should have blocked this)",
            )
            raise FeatureDisabledError(
                "radius",
                "Mock RADIUS backend cannot satisfy feature_radius_required=True",
            )
        _log.error(
            "radius_backend: refusing to return %s (IS_PRODUCTION_READY=False) "
            "with feature_radius_required=True",
            type(backend).__name__,
        )
        raise FeatureDisabledError(
            "radius",
            f"{type(backend).__name__} is not production-ready",
        )
    return backend
