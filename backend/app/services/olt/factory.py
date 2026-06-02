"""M1-B Phase 1 — OLT driver factory.

The service layer calls :func:`get_driver_for_olt` with an OLT Record (ORM instance or
dict) and gets back an :class:`~.driver.OltDriver` ready to use. Phase 3 (Huawei) and
Phase 4 (ZTE) register their concrete classes via :func:`register_driver` at import time.

Credentials shape
=================

We accept credentials in ``Record.data['credentials']`` as a flat dict whose VALUES are
Fernet ciphertext strings produced by
:func:`app.security.field_crypto.encrypt_str`. Example:

.. code-block:: python

    record.data = {
        "vendor": "huawei",
        "host": "10.10.0.1",
        "port": 22,
        "credentials": {
            "username": encrypt_str("admin"),
            "password": encrypt_str("s3cret"),
        },
    }

The factory decrypts each value with :func:`decrypt_str`. If a value is not Fernet
ciphertext (legacy plaintext, or a clear field like ``"auth_method": "password"`` that
was intentionally stored in the clear), ``decrypt_str`` returns ``None`` — in that case
we pass the original value through unchanged. That keeps the factory tolerant of mixed
encrypted/plaintext credential maps during migration.

If ``credentials`` is absent or empty, that's NOT an error here — the mock driver
ignores credentials, and concrete drivers will raise
:class:`~.exceptions.OltCredentialsError` themselves when they actually try to connect.
"""
from __future__ import annotations

from typing import Any

from ...security.field_crypto import decrypt_str
from .driver import OltDriver
from .exceptions import OltCredentialsError, OltNotSupportedError
from .mock_driver import MockOltDriver


# ──────────────────────────────────────────────────────────────────────────
# Registry — concrete drivers register themselves here in later phases
# ──────────────────────────────────────────────────────────────────────────

_DRIVERS: dict[str, type] = {
    "mock": MockOltDriver,
    # M1-B.3 adds: 'huawei': HuaweiDriver
    # M1-B.4 adds: 'zte':    ZteDriver
}


def register_driver(vendor: str, driver_class: type) -> None:
    """Register a concrete driver class. Called by Phase 3/4 drivers at module import.

    Vendor key is normalized to lowercase. Re-registering the same vendor replaces the
    prior entry (useful in tests).
    """
    if not vendor or not isinstance(vendor, str):
        raise ValueError("vendor must be a non-empty string")
    _DRIVERS[vendor.lower()] = driver_class


def registered_vendors() -> list[str]:
    """Snapshot of currently registered vendor keys (sorted, for diagnostics)."""
    return sorted(_DRIVERS.keys())


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────


def _extract_data(olt_record: Any) -> dict:
    """Return the ``data`` dict from an ORM Record OR pass through a plain dict."""
    # ORM Record instance → has a ``data`` attribute
    data = getattr(olt_record, "data", None)
    if isinstance(data, dict):
        return data
    # Plain dict shaped like ``{"vendor": ..., "host": ..., ...}`` OR
    # plain dict shaped like ``{"data": {...}}`` (rare, but tolerated).
    if isinstance(olt_record, dict):
        if "data" in olt_record and isinstance(olt_record["data"], dict):
            return olt_record["data"]
        return olt_record
    raise OltCredentialsError(
        "olt_record must be a Record ORM instance with .data or a dict; "
        f"got {type(olt_record).__name__}"
    )


def _decrypt_credentials(creds: Any) -> dict:
    """Walk a credentials dict, decrypting Fernet ciphertext values.

    Non-string values pass through unchanged. String values that don't decrypt cleanly
    (legacy plaintext, or intentionally clear fields) also pass through unchanged.
    """
    if not creds:
        return {}
    if not isinstance(creds, dict):
        raise OltCredentialsError(
            f"credentials must be a dict; got {type(creds).__name__}"
        )
    out: dict = {}
    for k, v in creds.items():
        if isinstance(v, str):
            decrypted = decrypt_str(v)
            out[k] = decrypted if decrypted is not None else v
        else:
            out[k] = v
    return out


# ──────────────────────────────────────────────────────────────────────────
# Factory
# ──────────────────────────────────────────────────────────────────────────


async def get_driver_for_olt(olt_record: Any) -> OltDriver:
    """Build a driver instance for the given OLT Record.

    Parameters
    ----------
    olt_record:
        Either an ORM Record (``Record(entity_key='olt', data={...})``) or a plain dict
        with the same shape under ``data`` (useful for tests + dry-runs).

    The lookup reads ``data['vendor']`` (case-insensitive), looks the vendor up in the
    driver registry, decrypts every string value in ``data['credentials']`` via
    :func:`app.security.field_crypto.decrypt_str`, and instantiates the driver with
    ``host`` / ``port`` / ``credentials`` / ``olt_record_id``.

    Raises
    ------
    OltNotSupportedError
        Vendor is missing from ``data`` or not present in the registry.
    OltCredentialsError
        ``olt_record`` shape is invalid OR credentials shape is invalid.
    """
    data = _extract_data(olt_record)

    vendor = data.get("vendor")
    if not vendor or not isinstance(vendor, str):
        raise OltNotSupportedError(
            "olt_record.data['vendor'] is required and must be a string"
        )
    vendor_key = vendor.lower()
    driver_cls = _DRIVERS.get(vendor_key)
    if driver_cls is None:
        raise OltNotSupportedError(
            f"No driver registered for vendor {vendor!r}. "
            f"Registered: {registered_vendors()}"
        )

    host = data.get("host") or data.get("ip")
    if not host or not isinstance(host, str):
        raise OltCredentialsError(
            "olt_record.data must include a 'host' (or legacy 'ip') string"
        )

    raw_port = data.get("port", 0)
    try:
        port = int(raw_port) if raw_port is not None else 0
    except (TypeError, ValueError):
        port = 0

    credentials = _decrypt_credentials(data.get("credentials"))
    olt_record_id = str(getattr(olt_record, "id", None) or data.get("id") or "") or None

    driver = driver_cls(
        host=host,
        port=port,
        credentials=credentials,
        olt_record_id=olt_record_id,
    )
    return driver
