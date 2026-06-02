"""NETCONF transport — Protocol + deferred skeleton.

NETCONF + YANG is the modern config protocol favoured by newer vendors
(Nokia, recent Huawei). Most of the OLTs we target in Phases 3-4 (legacy
Huawei MA56xxT, ZTE C300/C320) speak CLI, not NETCONF — so this transport is
intentionally a skeleton. The Protocol is fully defined so vendor drivers can
type-hint against it, and ``MockNetconfTransport`` is a complete in-memory
simulator. Wire ``ncclient`` (or a future async-netconf lib) when the first
NETCONF-only OLT shows up in the field.
"""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class NetconfTransport(Protocol):
    """Async NETCONF/RESTCONF transport.

    Use ``MockNetconfTransport`` for tests; real implementation deferred until
    concrete vendor drivers need it.
    """

    host: str
    port: int

    async def connect(self) -> None: ...
    async def close(self) -> None: ...
    async def get_config(self, filter_xml: str | None = None) -> str: ...
    async def edit_config(self, payload_xml: str) -> str: ...
    async def rpc(self, name: str, args: dict[str, Any] | None = None) -> Any: ...
    async def __aenter__(self) -> "NetconfTransport": ...
    async def __aexit__(self, exc_type, exc, tb) -> None: ...


class NcclientNetconfTransport:
    """SKELETON — raises NotImplementedError.

    Most legacy OLTs expose CLI; this transport is reserved for newer vendors
    (Nokia, modern Huawei) that prefer NETCONF/RESTCONF + YANG models. Wire
    ncclient (or a future async-netconf lib) when an actual NETCONF-speaking
    OLT is available.
    """

    def __init__(
        self,
        *,
        host: str,
        port: int = 830,
        username: str,
        password: str | None = None,
        ssh_key: str | None = None,
    ):
        self.host = host
        self.port = port
        # Don't lazy-import ncclient here — just raise on connect().
        self._username = username
        self._password = password
        self._ssh_key = ssh_key

    async def connect(self) -> None:
        raise NotImplementedError(
            "NETCONF transport deferred — most OLT vendors are reachable via CLI. "
            "Wire ncclient or asyncnetconf when a NETCONF-only target needs support."
        )

    async def close(self) -> None:
        pass

    async def get_config(self, filter_xml: str | None = None) -> str:
        raise NotImplementedError("NETCONF transport deferred — see connect()")

    async def edit_config(self, payload_xml: str) -> str:
        raise NotImplementedError("NETCONF transport deferred")

    async def rpc(self, name: str, args: dict[str, Any] | None = None) -> Any:
        raise NotImplementedError("NETCONF transport deferred")

    async def __aenter__(self) -> "NcclientNetconfTransport":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()
