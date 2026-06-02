"""M1-C Phase 0 — FreeRadiusBackend (real-vendor skeleton).

Lazy-imports the ``pyrad`` SDK; the factory catches ImportError /
:class:`RadiusBackendConfigError` and falls back to the mock.

Status of methods
=================
* ``__init__`` — fully implemented (host + secret + ports + NAS-IP validation).
* All four async methods — :class:`NotImplementedError`. Wired in M1-C.4.

RADIUS is connectionless UDP — there's no ``verify_webhook`` to implement.
"""
from __future__ import annotations

from .backend import (
    RadiusAcctResult,
    RadiusAuthResult,
    RadiusDisconnectResult,
)
from .exceptions import RadiusBackendConfigError


class FreeRadiusBackend:
    """FreeRADIUS-backed RADIUS client.

    Uses ``pyrad`` for RFC 2865 / 2866 / 5176 packet construction. Connection
    is per-call (UDP is stateless), so there's no ``close()`` semantic.
    """

    provider: str = "freeradius"

    def __init__(
        self,
        *,
        host: str | None,
        secret: str | None,
        auth_port: int = 1812,
        acct_port: int = 1813,
        nas_ip: str | None = None,
        dictionary_path: str | None = None,
    ) -> None:
        try:
            # pyrad ships dictionary + client + packet; lazy-import for the same
            # reason as the SDK in Stripe/Twilio: don't crash on missing pkg.
            from pyrad import dictionary as _dictionary  # noqa: F401
            from pyrad.client import Client  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise ImportError(
                "pyrad is required for FreeRadiusBackend — pip install pyrad"
            ) from e
        if not host:
            raise RadiusBackendConfigError("RADIUS_HOST missing")
        if not secret:
            raise RadiusBackendConfigError("RADIUS_SECRET missing")
        if auth_port <= 0 or auth_port > 65535:
            raise RadiusBackendConfigError(
                f"RADIUS_AUTH_PORT out of range: {auth_port}"
            )
        if acct_port <= 0 or acct_port > 65535:
            raise RadiusBackendConfigError(
                f"RADIUS_ACCT_PORT out of range: {acct_port}"
            )
        self._host = host
        self._secret = secret
        self._auth_port = auth_port
        self._acct_port = acct_port
        self._nas_ip = nas_ip
        self._dictionary_path = dictionary_path

    async def authenticate(self, *, username, password, nas_ip=None,
                            nas_port=None, calling_station_id=None) -> RadiusAuthResult:
        raise NotImplementedError(
            "FreeRadiusBackend.authenticate — wire pyrad.client.Client + "
            "AuthPacket(Access-Request) in M1-C.4 when a test RADIUS host is available."
        )

    async def acct_start(self, *, session_id, username, nas_ip=None,
                          framed_ip=None) -> RadiusAcctResult:
        raise NotImplementedError(
            "FreeRadiusBackend.acct_start — wire pyrad.client.Client + "
            "AcctPacket(Acct-Status-Type=Start) in M1-C.4."
        )

    async def acct_stop(self, *, session_id, username, octets_in=0,
                         octets_out=0, termination_cause=None) -> RadiusAcctResult:
        raise NotImplementedError(
            "FreeRadiusBackend.acct_stop — wire pyrad.client.Client + "
            "AcctPacket(Acct-Status-Type=Stop) in M1-C.4."
        )

    async def disconnect(self, *, session_id, username, nas_ip=None) -> RadiusDisconnectResult:
        raise NotImplementedError(
            "FreeRadiusBackend.disconnect — wire pyrad.client.Client.CoAClient + "
            "DisconnectPacket in M1-C.4."
        )
