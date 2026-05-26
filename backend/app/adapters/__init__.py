"""GAAex channel adapters package (doc 24 / E23).

Importing this package registers the email and SMS adapters in `adapters.registry`
(dormant-safe: if no provider is configured, log-only adapters are used instead).

Usage (from anywhere in the codebase)
--------------------------------------
    from app.adapters import registry

    adapter = registry.get("email")   # ChannelAdapter | None
    if adapter:
        result = await adapter.safe_send(to, subject, body, meta={"def_key": key})

The adapter interface is in `base.py`; concrete adapters are in `email.py` and `sms.py`.
`channels.py` (the legacy functional registry) is still the canonical dispatch path; it now
calls `adapters.registry` first (see `channels.dispatch`), then falls back to its own registry
so existing channels (inapp, webhook, console) are unaffected.
"""
# Importing sub-modules triggers their configure() calls which register adapters.
from .base import ChannelAdapter, registry  # noqa: F401
from . import email  # noqa: F401  — registers LogEmailAdapter or SmtpEmailAdapter
from . import sms    # noqa: F401  — registers LogSmsAdapter or TwilioSmsAdapter

__all__ = ["ChannelAdapter", "registry"]
