"""In-memory SNMP transport simulator."""
from __future__ import annotations

from typing import Any

from .exceptions import TransportConnectionError


class MockSnmpTransport:
    """In-memory simulator for SNMP transport.

    Test setup pre-loads OID -> value pairs; ``get`` looks them up exactly,
    ``walk`` returns all entries with a matching OID prefix.
    """

    def __init__(
        self,
        *,
        host: str = "mock-snmp",
        port: int = 161,
        community: str = "public",
        version: str = "v2c",
    ):
        self.host = host
        self.port = port
        self._community = community
        self._version = version
        self._connected = False
        self._oids: dict[str, Any] = {}

    def set_oid(self, oid: str, value: Any) -> None:
        """Pre-load an OID -> value mapping."""
        self._oids[oid] = value

    def set_oids(self, mapping: dict[str, Any]) -> None:
        """Bulk pre-load."""
        self._oids.update(mapping)

    def reset(self) -> None:
        self._oids.clear()

    async def connect(self) -> None:
        self._connected = True

    async def close(self) -> None:
        self._connected = False

    async def get(self, oid: str, *, timeout: float | None = None) -> Any:
        if not self._connected:
            raise TransportConnectionError(
                "MockSnmpTransport.get called before connect()"
            )
        if oid not in self._oids:
            # SNMP semantics: missing OID returns None (rather than raise) — caller decides.
            return None
        return self._oids[oid]

    async def walk(
        self, oid_prefix: str, *, timeout: float | None = None
    ) -> dict[str, Any]:
        if not self._connected:
            raise TransportConnectionError(
                "MockSnmpTransport.walk called before connect()"
            )
        return {oid: v for oid, v in self._oids.items() if oid.startswith(oid_prefix)}

    async def __aenter__(self) -> "MockSnmpTransport":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()
