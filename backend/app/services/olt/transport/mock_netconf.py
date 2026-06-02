"""In-memory NETCONF transport simulator."""
from __future__ import annotations

from typing import Any

from .exceptions import TransportConnectionError, TransportProtocolError


class MockNetconfTransport:
    """In-memory simulator for NETCONF transport.

    Stores canned RPC responses + a single ``get_config()`` snapshot. Used by
    driver tests for NETCONF-speaking vendor support.
    """

    def __init__(self, *, host: str = "mock-netconf", port: int = 830):
        self.host = host
        self.port = port
        self._connected = False
        self._config: str = "<config/>"  # default empty config
        self._rpc_responses: dict[str, Any] = {}
        self._edit_log: list[str] = []  # records edit_config payloads for assertions
        self.executed_rpcs: list[tuple[str, dict | None]] = []  # (name, args) per call

    def set_config(self, config_xml: str) -> None:
        """Pre-load the response for ``get_config()``."""
        self._config = config_xml

    def set_rpc_response(self, name: str, response: Any) -> None:
        """Pre-load a canned response for a specific RPC name."""
        self._rpc_responses[name] = response

    def reset(self) -> None:
        self._config = "<config/>"
        self._rpc_responses.clear()
        self._edit_log.clear()
        self.executed_rpcs.clear()

    @property
    def edit_log(self) -> list[str]:
        return list(self._edit_log)

    async def connect(self) -> None:
        self._connected = True

    async def close(self) -> None:
        self._connected = False

    async def get_config(self, filter_xml: str | None = None) -> str:
        if not self._connected:
            raise TransportConnectionError(
                "MockNetconfTransport.get_config before connect()"
            )
        return self._config

    async def edit_config(self, payload_xml: str) -> str:
        if not self._connected:
            raise TransportConnectionError(
                "MockNetconfTransport.edit_config before connect()"
            )
        self._edit_log.append(payload_xml)
        return "<ok/>"

    async def rpc(self, name: str, args: dict[str, Any] | None = None) -> Any:
        if not self._connected:
            raise TransportConnectionError(
                "MockNetconfTransport.rpc before connect()"
            )
        self.executed_rpcs.append((name, args))
        if name not in self._rpc_responses:
            raise TransportProtocolError(
                f"MockNetconfTransport: no canned response for RPC {name!r}. "
                f"Use set_rpc_response() before calling."
            )
        return self._rpc_responses[name]

    async def __aenter__(self) -> "MockNetconfTransport":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()
