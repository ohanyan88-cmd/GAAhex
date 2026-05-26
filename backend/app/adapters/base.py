"""Channel adapter interface and registry (doc 24 / E23).

A ChannelAdapter is the OOP seam for any outbound delivery channel. Each adapter is responsible
for exactly one channel name ("email", "sms", "webhook", …) and exposes a single async `send`
method.  The module-level registry maps channel names to instances; `channels.dispatch` consults
it first before falling back to the legacy functional-adapter registry in channels.py — so the
transition is fully non-breaking.

Result contract
---------------
`send(...)` always returns a dict:
    {"status": "SENT"|"FAILED"|"LOG", "channel": <name>, "to": <addr>, "detail": <str>}
It NEVER raises — a failed send is recorded as status="FAILED".
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger("gaaex.adapters")


class ChannelAdapter(ABC):
    """Base class for all channel adapters.

    Sub-classes MUST implement `send`.  The base class wraps every call in a
    try/except so a broken implementation cannot propagate into the kernel.
    """

    #: The canonical channel name this adapter handles ("email", "sms", …)
    channel: str = ""

    @abstractmethod
    async def send(
        self,
        to: str | None,
        subject: str | None,
        body: str,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Deliver a message.

        Parameters
        ----------
        to:      Channel-specific address (email address, phone number, URL, …).
                 May be None; the adapter decides whether that is an error.
        subject: Human-readable subject / title (optional for SMS / push).
        body:    The message body / content.
        meta:    Arbitrary extra context (def_key, user_id, …) — for logging only.

        Returns
        -------
        dict with at minimum:
            status  — "SENT", "FAILED", or "LOG" (logged-only, no real send)
            channel — the channel name
            to      — the destination address (or None)
            detail  — human-readable outcome string
        """

    async def safe_send(
        self,
        to: str | None,
        subject: str | None,
        body: str,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Wrapper that guarantees no exception escapes; returns FAILED result on error."""
        try:
            return await self.send(to, subject, body, meta)
        except Exception as exc:  # noqa: BLE001
            logger.exception("adapter %r send failed: %s", self.channel, exc)
            return {
                "status": "FAILED",
                "channel": self.channel,
                "to": to,
                "detail": f"unhandled error: {exc!s}"[:500],
            }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class _AdapterRegistry:
    """Simple name → ChannelAdapter map.

    `get(channel)` returns the registered adapter or None.
    `set(adapter)` uses `adapter.channel` as the key (overwrites if already set).
    `all()` returns a snapshot dict.
    """

    def __init__(self) -> None:
        self._store: dict[str, ChannelAdapter] = {}

    def set(self, adapter: ChannelAdapter) -> None:
        """Register (or replace) an adapter by its channel name."""
        if not adapter.channel:
            raise ValueError(f"Adapter {type(adapter).__name__} has no channel set")
        self._store[adapter.channel] = adapter
        logger.debug("adapters: registered %r → %s", adapter.channel, type(adapter).__name__)

    def get(self, channel: str) -> ChannelAdapter | None:
        """Return the adapter for *channel*, or None if not registered."""
        return self._store.get(channel)

    def all(self) -> dict[str, ChannelAdapter]:
        return dict(self._store)

    def channels(self) -> list[str]:
        return sorted(self._store)


#: Module-level singleton registry — import and use directly.
registry = _AdapterRegistry()
