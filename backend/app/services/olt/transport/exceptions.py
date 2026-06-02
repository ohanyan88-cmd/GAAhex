"""Transport-layer exception hierarchy for OLT drivers.

These are raised by transports (CLI / SNMP / NETCONF) when something goes
wrong at the wire level — before the driver layer ever sees the response.
Driver-level errors live in ``app.services.olt.exceptions`` (OltError tree).
"""
from __future__ import annotations


class TransportError(Exception):
    """Base for all transport-layer errors."""


class TransportConnectionError(TransportError):
    """Could not establish the network connection (DNS, TCP refused, route blocked)."""


class TransportAuthError(TransportError):
    """Authentication failed (bad credentials, expired keys, missing enable password)."""


class TransportTimeoutError(TransportError):
    """Operation took too long to complete."""


class TransportProtocolError(TransportError):
    """Protocol-level failure (malformed response, unexpected disconnect,
    parse error at the transport layer)."""
