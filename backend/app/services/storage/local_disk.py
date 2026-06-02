"""LocalDiskBackend — v1 storage implementation.

Writes files to a local directory inside the container. Zero external infra —
works in docker-compose on-prem out of the box. Not suitable for multi-node
deployments (files are not shared across nodes).

Before production with more than one container replica: swap to MinIOBackend.
See docs/PRE-LAUNCH-CHECKLIST.md §1 — Storage.

Storage layout:
  {base_path}/{tenant_id}/{attachment_id}.bin

The original filename is NEVER used as the path — the attachment_id (UUIDv7)
is the storage key, matching the spec: "never use filename as identity".
"""
from __future__ import annotations

import hashlib
import os
import pathlib

from .backend import StorageBackend, StoredObject, StorageError


class LocalDiskBackend:
    """Stores files on local disk under base_path. Implements StorageBackend."""

    def __init__(self, base_path: str = "/app/uploads") -> None:
        self._base = pathlib.Path(base_path)
        self._base.mkdir(parents=True, exist_ok=True)

    def _path(self, storage_key: str) -> pathlib.Path:
        return self._base / storage_key

    async def store(
        self,
        *,
        tenant_id: str,
        attachment_id: str,
        file_bytes: bytes,
        original_filename: str,
        mime_type: str,
    ) -> StoredObject:
        storage_key = f"{tenant_id}/{attachment_id}.bin"
        dest = self._base / storage_key
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            dest.write_bytes(file_bytes)
        except OSError as e:
            raise StorageError(f"LocalDiskBackend write failed: {e}") from e
        checksum = hashlib.sha256(file_bytes).hexdigest()
        return StoredObject(
            storage_key=storage_key,
            size_bytes=len(file_bytes),
            checksum_sha256=checksum,
        )

    async def retrieve(self, *, storage_key: str) -> bytes:
        path = self._path(storage_key)
        try:
            return path.read_bytes()
        except FileNotFoundError:
            raise StorageError(f"Object not found: {storage_key}")
        except OSError as e:
            raise StorageError(f"LocalDiskBackend read failed: {e}") from e

    async def delete(self, *, storage_key: str) -> None:
        path = self._path(storage_key)
        try:
            path.unlink(missing_ok=True)
        except OSError as e:
            raise StorageError(f"LocalDiskBackend delete failed: {e}") from e

    async def presigned_url(self, *, storage_key: str, expires_seconds: int = 300) -> None:
        # Local disk has no presigned URL concept — callers stream via retrieve().
        return None


# Verify the Protocol is satisfied at import time (catches missing methods early).
_: StorageBackend = LocalDiskBackend.__new__(LocalDiskBackend)
