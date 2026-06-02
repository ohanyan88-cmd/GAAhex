"""In-memory CLI transport simulator.

Driver tests register canned responses for commands they expect the driver to
send (e.g. ``display board 0`` for Huawei), then assert on ``executed_commands``
to verify the driver constructed the right wire-level commands.
"""
from __future__ import annotations

from .exceptions import TransportConnectionError, TransportProtocolError


class MockCliTransport:
    """In-memory simulator for CLI transport.

    Driver tests set canned responses via ``set_response`` then call
    ``execute`` — the transport returns the matching response.

    Behaviours:

    * Match by exact command string first, then by prefix, then default response.
    * If no match and no default → ``TransportProtocolError``.
    * Tracks all executed commands in ``executed_commands`` (list of strings) so
      tests can assert what the driver actually sent to the wire.
    * Connection state: ``connect()`` / ``close()`` flip a flag; ``execute()``
      before ``connect()`` raises ``TransportConnectionError``. Idempotent close.
    """

    def __init__(self, *, host: str = "mock-cli", port: int = 22):
        self.host = host
        self.port = port
        self._connected = False
        self._exact: dict[str, str] = {}
        self._prefix: list[tuple[str, str]] = []  # ordered by registration
        self._default: str | None = None
        self.executed_commands: list[str] = []

    def set_response(self, command: str, response: str) -> None:
        """Register an exact-match canned response. Last write wins."""
        self._exact[command] = response

    def set_prefix_response(self, prefix: str, response: str) -> None:
        """Register a prefix-match canned response. First match wins (registration order)."""
        self._prefix.append((prefix, response))

    def set_default_response(self, response: str | None) -> None:
        """Catch-all response when no exact / prefix matches. None means 'raise instead'."""
        self._default = response

    def reset(self) -> None:
        """Clear all canned responses + execution history. Useful between test cases."""
        self._exact.clear()
        self._prefix.clear()
        self._default = None
        self.executed_commands.clear()

    async def connect(self) -> None:
        self._connected = True

    async def close(self) -> None:
        self._connected = False

    async def execute(self, command: str, *, timeout: float | None = None) -> str:
        if not self._connected:
            raise TransportConnectionError(
                "MockCliTransport.execute called before connect()"
            )
        self.executed_commands.append(command)
        if command in self._exact:
            return self._exact[command]
        for prefix, response in self._prefix:
            if command.startswith(prefix):
                return response
        if self._default is not None:
            return self._default
        raise TransportProtocolError(
            f"MockCliTransport: no canned response for {command!r}. "
            f"Use set_response/set_prefix_response/set_default_response."
        )

    async def __aenter__(self) -> "MockCliTransport":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()
