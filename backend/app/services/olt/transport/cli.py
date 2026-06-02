"""CLI transport — Protocol + real asyncssh-backed implementation.

Most legacy OLTs (Huawei MA56xxT, ZTE C300/C320, FiberHome AN5516) expose a
text-based CLI/TL1 over SSH. The Protocol below is what concrete vendor
drivers depend on; ``AsyncSshCliTransport`` is the production implementation
that wraps ``asyncssh`` (lazy-imported so its absence doesn't break CI or
deployments that only need the mocks).
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class CliTransport(Protocol):
    """Async CLI/TL1 transport — sends a command string, returns the raw response text.

    The transport is NOT responsible for parsing — that's the driver layer.
    Each transport instance represents a connection to ONE OLT. Reuse across
    commands. Use as a context manager OR call connect()/close() explicitly.
    """

    host: str
    port: int

    async def connect(self) -> None: ...
    async def close(self) -> None: ...
    async def execute(self, command: str, *, timeout: float | None = None) -> str: ...
    async def __aenter__(self) -> "CliTransport": ...
    async def __aexit__(self, exc_type, exc, tb) -> None: ...


class AsyncSshCliTransport:
    """Real asyncssh-based CLI transport.

    Lazy-imports asyncssh in ``__init__`` so its absence doesn't break CI or
    production for users that don't need real SSH. If asyncssh is missing,
    constructing this class raises ``ImportError`` with an install hint.
    """

    def __init__(
        self,
        *,
        host: str,
        port: int = 22,
        username: str,
        password: str | None = None,
        ssh_key: str | None = None,
        enable_password: str | None = None,
        connect_timeout: float = 30.0,
    ):
        try:
            import asyncssh  # noqa: F401 — lazy import; surfacing the dep early
        except ImportError as e:
            raise ImportError(
                "asyncssh is required for AsyncSshCliTransport — pip install asyncssh"
            ) from e
        self.host = host
        self.port = port
        self._username = username
        self._password = password
        self._ssh_key = ssh_key
        self._enable_password = enable_password
        self._connect_timeout = connect_timeout
        self._conn = None  # holds the asyncssh connection
        self._shell = None

    async def connect(self) -> None:
        import asyncio

        import asyncssh

        from .exceptions import (
            TransportAuthError,
            TransportConnectionError,
            TransportTimeoutError,
        )

        try:
            self._conn = await asyncio.wait_for(
                asyncssh.connect(
                    self.host,
                    port=self.port,
                    username=self._username,
                    password=self._password,
                    client_keys=[self._ssh_key] if self._ssh_key else None,
                    known_hosts=None,  # OLT hosts often lack proper SSH host keys
                ),
                timeout=self._connect_timeout,
            )
        except asyncio.TimeoutError as e:
            raise TransportTimeoutError(
                f"SSH connect to {self.host}:{self.port} timed out"
            ) from e
        except asyncssh.PermissionDenied as e:
            raise TransportAuthError(
                f"SSH auth failed for {self._username}@{self.host}"
            ) from e
        except (OSError, asyncssh.Error) as e:
            raise TransportConnectionError(
                f"SSH connect to {self.host}:{self.port} failed: {e}"
            ) from e

    async def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            await self._conn.wait_closed()
            self._conn = None

    async def execute(self, command: str, *, timeout: float | None = None) -> str:
        import asyncio

        from .exceptions import (
            TransportConnectionError,
            TransportProtocolError,
            TransportTimeoutError,
        )

        if self._conn is None:
            raise TransportConnectionError(
                "Not connected — call connect() first or use async-with"
            )
        try:
            result = await asyncio.wait_for(
                self._conn.run(command, check=False), timeout=timeout or 30.0
            )
        except asyncio.TimeoutError as e:
            raise TransportTimeoutError(f"Command timed out: {command!r}") from e
        except Exception as e:
            raise TransportProtocolError(
                f"Command failed: {command!r}: {e}"
            ) from e
        return (result.stdout or "") + (result.stderr or "")

    async def __aenter__(self) -> "AsyncSshCliTransport":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()
