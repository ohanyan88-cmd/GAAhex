"""M1-C Phase 0 — RadiusBackend factory.

Mirrors the payments/comms factories: registry of zero-arg builders, falls back
to the mock on ImportError / config errors so GAAhex boots without a RADIUS host.
"""
from __future__ import annotations

import logging
from typing import Callable

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


def get_radius_backend() -> RadiusBackend:
    """Build a RadiusBackend based on ``settings.radius_backend_provider``.

    Always returns a working backend; falls back to mock on any config / import
    error. Never raises.
    """
    from app.config import settings

    name = (getattr(settings, "radius_backend_provider", None) or "mock").lower()
    builder = _REGISTRY.get(name)
    if builder is None:
        _log.warning("radius_backend: unknown provider %r — falling back to mock", name)
        return _build_mock()
    try:
        return builder()
    except (RadiusBackendConfigError, ImportError) as e:
        _log.warning(
            "radius_backend: %s config error: %s — falling back to mock", name, e,
        )
        return _build_mock()
