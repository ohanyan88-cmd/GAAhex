"""Storage backend factory — reads settings.storage_backend and returns the
configured implementation. Lazy-imports heavy backends so LocalDisk stays
dependency-free.

See docs/PRE-LAUNCH-CHECKLIST.md §1 for the vendor decision context.
"""
from __future__ import annotations

from functools import lru_cache

from ...config import settings
from .backend import StorageBackend
from .local_disk import LocalDiskBackend


@lru_cache(maxsize=1)
def get_storage_backend() -> StorageBackend:
    provider = settings.storage_backend.lower()

    if provider == "local":
        return LocalDiskBackend(base_path=settings.storage_local_path)

    if provider == "minio":
        # Lazy import — only required when MinIO is configured.
        try:
            from .minio_backend import MinIOBackend  # noqa: F401 (future module)
        except ImportError as e:
            raise RuntimeError(
                "MinIO storage backend requires additional dependencies. "
                "Install them and ensure storage/minio_backend.py exists."
            ) from e
        return MinIOBackend(  # type: ignore[return-value]
            endpoint=settings.storage_minio_endpoint or "minio:9000",
            access_key=settings.storage_minio_access_key or "",
            secret_key=settings.storage_minio_secret_key or "",
            bucket=settings.storage_minio_bucket,
            secure=settings.storage_minio_secure,
        )

    if provider == "s3":
        try:
            from .s3_backend import S3Backend  # noqa: F401 (future module)
        except ImportError as e:
            raise RuntimeError(
                "S3 storage backend requires aiobotocore. "
                "pip install aiobotocore and ensure storage/s3_backend.py exists."
            ) from e
        return S3Backend(  # type: ignore[return-value]
            bucket=settings.storage_s3_bucket or "",
            region=settings.storage_s3_region,
            access_key=settings.storage_s3_access_key or "",
            secret_key=settings.storage_s3_secret_key or "",
        )

    raise ValueError(
        f"Unknown storage_backend '{provider}'. "
        "Valid values: 'local', 'minio', 's3'. See docs/PRE-LAUNCH-CHECKLIST.md."
    )
