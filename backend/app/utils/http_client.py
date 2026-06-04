"""Canonical async HTTP client factory (AC-5).

Single entry point for outbound HTTP calls so every adapter / router gets the
same retry/timeout/TLS policy. Eight bare ``httpx.AsyncClient(timeout=...)``
instantiations used to live across ``ai.py``, ``channels.py``,
``adapters/payment/arca.py``, ``adapters/sms.py``, ``routers/webhooks.py``, and
``workflow.py`` — each one chose its own timeout in isolation and none shared
headers, redirect policy, or TLS verification settings.

Use ``get_async_client(timeout=...)`` instead of ``httpx.AsyncClient(...)``
everywhere. The factory currently returns a configured ``httpx.AsyncClient``;
the caller controls its lifetime with ``async with``, exactly as before, so
this is a drop-in replacement.

Defaults: 30s total timeout, redirects followed, TLS verify on. Per-call
overrides land via keyword args.
"""
from __future__ import annotations

import httpx

DEFAULT_TIMEOUT_SECONDS: float = 30.0


def get_async_client(
    *,
    timeout: float | httpx.Timeout | None = None,
    headers: dict[str, str] | None = None,
    follow_redirects: bool = True,
    verify: bool = True,
) -> httpx.AsyncClient:
    """Return a configured ``httpx.AsyncClient`` ready for ``async with`` use.

    Args:
        timeout: total timeout in seconds (default 30). Pass an ``httpx.Timeout``
            for fine-grained connect/read/write/pool control.
        headers: default headers applied to every request the client issues.
        follow_redirects: whether to follow 3xx (default True).
        verify: whether to verify the server's TLS certificate (default True).
    """
    return httpx.AsyncClient(
        timeout=timeout if timeout is not None else DEFAULT_TIMEOUT_SECONDS,
        headers=headers or {},
        follow_redirects=follow_redirects,
        verify=verify,
    )
