"""M1-C Phase 0 — RADIUS backend exception hierarchy."""
from __future__ import annotations


class RadiusBackendError(Exception):
    """Base exception for all RADIUS backend errors."""


class RadiusBackendConfigError(RadiusBackendError):
    """RADIUS credentials missing / malformed at construction time."""


class RadiusBackendConnectionError(RadiusBackendError):
    """Could not reach the RADIUS server (UDP packets dropped, etc.)."""


class RadiusBackendCommandError(RadiusBackendError):
    """RADIUS server responded but rejected the operation."""


class RadiusBackendTimeoutError(RadiusBackendError):
    """Operation timed out."""


class RadiusAuthRejectedError(RadiusBackendError):
    """RADIUS server returned Access-Reject (bad username/password)."""
