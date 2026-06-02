"""M1-C Phase 0 — Vendor-agnostic RadiusBackend Protocol + return-type dataclasses.

Concrete implementations: :class:`MockRadiusBackend`, :class:`FreeRadiusBackend`.

Surface choice
==============
Four methods cover the daily AAA flow:

* ``authenticate`` — Access-Request → Access-Accept / Access-Reject
* ``acct_start``   — Accounting-Request (Start)
* ``acct_stop``    — Accounting-Request (Stop) with octet counters
* ``disconnect``   — Change-of-Authorization Disconnect-Request (kicks a session)

Re-auth / CoA-Attribute updates can be added later without breaking this
Protocol (Python Protocols are structural; adding a method is forward-compatible).

Webhooks aren't part of RADIUS so there's no ``verify_webhook`` here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class RadiusAuthResult:
    """Outcome of an ``authenticate`` call."""

    allowed: bool
    framed_ip: str | None       # the IPv4 string the server returned (Framed-IP-Address)
    attributes: dict            # any other RADIUS attributes (Filter-Id, Acct-Interim-Interval, …)
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class RadiusAcctResult:
    """Outcome of an accounting Start/Stop request."""

    session_id: str
    status: str                 # 'ok' | 'no-response' | 'rejected'
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class RadiusDisconnectResult:
    """Outcome of a CoA Disconnect-Request."""

    session_id: str
    status: str                 # 'ok' | 'not-found' | 'nak'
    raw: dict = field(default_factory=dict)


@runtime_checkable
class RadiusBackend(Protocol):
    """Vendor-agnostic RADIUS backend.

    All methods async. On failure raise one of the
    :mod:`~app.services.radius.exceptions` classes.
    """

    provider: str  # 'mock' | 'freeradius' | ...

    async def authenticate(
        self,
        *,
        username: str,
        password: str,
        nas_ip: str | None = None,
        nas_port: str | None = None,
        calling_station_id: str | None = None,
    ) -> RadiusAuthResult:
        """Send Access-Request. Returns ``allowed=True/False`` based on Accept/Reject."""
        ...

    async def acct_start(
        self,
        *,
        session_id: str,
        username: str,
        nas_ip: str | None = None,
        framed_ip: str | None = None,
    ) -> RadiusAcctResult:
        """Send Accounting-Request (Start)."""
        ...

    async def acct_stop(
        self,
        *,
        session_id: str,
        username: str,
        octets_in: int = 0,
        octets_out: int = 0,
        termination_cause: str | None = None,
    ) -> RadiusAcctResult:
        """Send Accounting-Request (Stop) with octet counters + termination cause."""
        ...

    async def disconnect(
        self,
        *,
        session_id: str,
        username: str,
        nas_ip: str | None = None,
    ) -> RadiusDisconnectResult:
        """Send CoA Disconnect-Request — kicks the session off the BNG/NAS."""
        ...
