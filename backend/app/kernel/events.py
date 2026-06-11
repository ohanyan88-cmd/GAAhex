"""Domain event bus — PERFECT-TARGET I3 (decoupled engines via choreography).

A lifecycle entity PUBLISHES a domain event (e.g. ``order.activated``); the Billing / CRM / Customer-Care
domains SUBSCRIBE and react independently, each owning its reaction. The publisher knows nothing about
the subscribers. Handlers run in registration order (so a handler can depend on an earlier one's writes —
e.g. CRM sets ``order.customer_id`` before Billing provisions against it) and in the SAME DB transaction
as the publish (I4 atomicity). ``publish`` returns each handler's result keyed by its name, so a caller
that still needs a synchronous value (e.g. the provisioned subscriptions for the API response) can read it.
"""
from __future__ import annotations

from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

# event name -> ordered list of (handler_name, handler). Handlers: async (s, **ctx) -> result.
_SUBSCRIBERS: dict[str, list[tuple[str, Callable[..., Awaitable]]]] = {}


def subscribe(event_name: str, handler_name: str, handler: Callable[..., Awaitable]) -> None:
    """Register a domain reaction to an event. Idempotent on (event, handler_name) — re-registering the
    same named handler replaces it, so module re-import never double-fires."""
    bucket = _SUBSCRIBERS.setdefault(event_name, [])
    for i, (name, _) in enumerate(bucket):
        if name == handler_name:
            bucket[i] = (handler_name, handler)
            return
    bucket.append((handler_name, handler))


async def publish(s: AsyncSession, event_name: str, **ctx) -> dict:
    """Fire all subscribers for ``event_name`` in registration order, in the caller's transaction.
    Returns ``{handler_name: result}``."""
    results: dict = {}
    for name, handler in _SUBSCRIBERS.get(event_name, []):
        results[name] = await handler(s, **ctx)
    return results
