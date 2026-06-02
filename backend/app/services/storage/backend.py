"""StorageBackend Protocol — vendor-agnostic file storage abstraction.

Same pattern as PaymentGateway (app/services/payments/gateway.py) and
OltDriver (app/services/olt/driver.py).

Implementations:
  LocalDiskBackend   — files on container disk (v1 default, zero infra, on-prem)
  MinIOBackend       — self-hosted S3-compatible (add to docker-compose for prod)
  S3Backend          — AWS S3

Factory: app/services/storage/factory.py — reads settings.storage_backend.

See docs/PRE-LAUNCH-CHECKLIST.md §1 for the vendor decision context.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator, Protocol, runtime_checkable


class StorageError(Exception):
    """Raised by any StorageBackend implementation on non-recoverable storage failure."""


@dataclass
class StoredObject:
    """Result of a successful store() call."""
    storage_key: str       # the stable, opaque key to persist in the DB (never the filename)
    size_bytes: int        # actual bytes written (after any compression)
    checksum_sha256: str   # hex SHA-256 of the file bytes (file 04: checksum stored)


@runtime_checkable
class StorageBackend(Protocol):
    """Vendor-agnostic interface for file storage.

    All methods are async. Implementations must be safe to call concurrently.
    Implementations must NEVER use the original filename as the storage key —
    storage_key is always a system-generated UUID-based path.
    """

    async def store(
        self,
        *,
        tenant_id: str,
        attachment_id: str,
        file_bytes: bytes,
        original_filename: str,
        mime_type: str,
    ) -> StoredObject:
        """Write file_bytes to storage. Returns StoredObject with the stable key.
        Raises StorageError on failure."""
        ...

    async def retrieve(self, *, storage_key: str) -> bytes:
        """Read and return the file bytes for the given storage_key.
        Raises StorageError if not found or inaccessible."""
        ...

    async def delete(self, *, storage_key: str) -> None:
        """Remove the object. Idempotent — no-op if already deleted.
        Raises StorageError on failure (not on missing)."""
        ...

    async def presigned_url(
        self, *, storage_key: str, expires_seconds: int = 300
    ) -> str | None:
        """Return a time-limited presigned download URL, or None if the backend
        does not support presigned URLs (e.g. LocalDiskBackend).
        Implementations that return None must support streaming via retrieve()."""
        ...
