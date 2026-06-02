"""SNMP transport — Protocol + pysnmp-backed skeleton.

SNMP is commonly used for read-only OLT telemetry (port counters, ONU optical
power, board temperatures). The Protocol exposes ``get`` and ``walk``. The
``PysnmpTransport`` is a skeleton — real wiring is deferred until first lab
access to a physical OLT, because pysnmp's async API has shifted across
versions and we want to verify against real hardware. Tests + drivers should
use ``MockSnmpTransport`` until then.
"""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class SnmpTransport(Protocol):
    """Async SNMP transport — get/walk against a remote agent."""

    host: str
    port: int  # typically 161

    async def connect(self) -> None: ...
    async def close(self) -> None: ...
    async def get(self, oid: str, *, timeout: float | None = None) -> Any: ...
    async def walk(
        self, oid_prefix: str, *, timeout: float | None = None
    ) -> dict[str, Any]: ...
    async def __aenter__(self) -> "SnmpTransport": ...
    async def __aexit__(self, exc_type, exc, tb) -> None: ...


class PysnmpTransport:
    """Real pysnmp-based SNMP transport. Lazy-imports pysnmp.

    NOTE: ``get`` and ``walk`` are skeletons — pysnmp's async API differs
    across versions, and we want to wire it against a real OLT for verification.
    Use ``MockSnmpTransport`` for development until then.
    """

    def __init__(
        self,
        *,
        host: str,
        port: int = 161,
        community: str = "public",
        version: str = "v2c",
        connect_timeout: float = 10.0,
    ):
        try:
            import pysnmp  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "pysnmp is required for PysnmpTransport — pip install pysnmp"
            ) from e
        self.host = host
        self.port = port
        self._community = community
        self._version = version
        self._connect_timeout = connect_timeout

    async def connect(self) -> None:
        # pysnmp is stateless — no persistent connection needed; method is a no-op.
        # Subclasses or future async-snmp libs may need real connection setup.
        pass

    async def close(self) -> None:
        pass

    async def get(self, oid: str, *, timeout: float | None = None) -> Any:
        # NOTE: pysnmp's async API differs across versions; this is a SKELETON
        # implementation that documents the expected behavior. Real wiring
        # deferred to when an actual OLT is available for testing. For now,
        # raise so callers know it's not yet wired.
        raise NotImplementedError(
            "PysnmpTransport.get is a skeleton — real implementation deferred to "
            "M1-B.5 or when first OLT lab access is available. Use "
            "MockSnmpTransport for development."
        )

    async def walk(
        self, oid_prefix: str, *, timeout: float | None = None
    ) -> dict[str, Any]:
        raise NotImplementedError(
            "PysnmpTransport.walk is a skeleton — see get() for context."
        )

    async def __aenter__(self) -> "PysnmpTransport":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()
