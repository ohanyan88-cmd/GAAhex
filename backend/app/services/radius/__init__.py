"""M1-C Phase 0 — Vendor-agnostic RADIUS backend layer.

Usage::

    from app.services.radius import get_radius_backend

    radius = get_radius_backend()
    auth = await radius.authenticate(username="cust42", password="pw")
    if auth.allowed:
        await radius.acct_start(session_id="abc-1", username="cust42",
                                framed_ip=auth.framed_ip)
"""
from .backend import (
    RadiusAcctResult,
    RadiusAuthResult,
    RadiusBackend,
    RadiusDisconnectResult,
)
from .exceptions import (
    RadiusAuthRejectedError,
    RadiusBackendCommandError,
    RadiusBackendConfigError,
    RadiusBackendConnectionError,
    RadiusBackendError,
    RadiusBackendTimeoutError,
)
from .factory import (
    get_radius_backend,
    register_radius_backend,
    registered_radius_backends,
)
from .freeradius_backend import FreeRadiusBackend
from .mock_backend import MockRadiusBackend

__all__ = [
    "RadiusBackend",
    "RadiusAuthResult", "RadiusAcctResult", "RadiusDisconnectResult",
    "get_radius_backend",
    "register_radius_backend",
    "registered_radius_backends",
    "MockRadiusBackend", "FreeRadiusBackend",
    "RadiusBackendError",
    "RadiusBackendConfigError",
    "RadiusBackendConnectionError",
    "RadiusBackendCommandError",
    "RadiusBackendTimeoutError",
    "RadiusAuthRejectedError",
]
