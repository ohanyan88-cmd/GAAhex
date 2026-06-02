"""M1-B Phase 1 — Vendor-agnostic OLT driver exception hierarchy.

Concrete drivers (Huawei, ZTE) and the MockOltDriver raise these for the service
layer to catch + classify (retry, surface to user, escalate, etc.). Keep the tree
shallow — callers should be able to ``except OltError`` and get every flavor.
"""
from __future__ import annotations


class OltError(Exception):
    """Base exception for all OLT driver errors."""


class OltConnectionError(OltError):
    """Could not reach the OLT (TCP refused, timeout, auth failure at network layer)."""


class OltCommandError(OltError):
    """The OLT responded but the command failed (e.g. ONU already provisioned, port not found)."""


class OltCredentialsError(OltError):
    """Authentication failed (bad username/password, expired keys, undecryptable record)."""


class OltTimeoutError(OltError):
    """Operation took too long."""


class OltNotSupportedError(OltError):
    """Vendor or hardware does not support this command (no driver registered, missing capability)."""
