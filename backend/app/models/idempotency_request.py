"""Idempotency Request — middleware fingerprint + cached response store.

API Standard (file 12, standard 66): mutating endpoints (POST/PATCH/DELETE)
accept an `Idempotency-Key` HTTP header. When a previous successful request
within the retention window (default 24h) shares the same
``(tenant_id, idempotency_key, method, path)`` AND the SHA-256 of the body
matches, the middleware returns the cached response instead of re-running
the handler — making safe-retries fully idempotent.

Schema notes:
  - `idempotency_key` is whatever the client sent (opaque to us, max 200 chars).
  - `request_fingerprint` = SHA-256 hex of the request body bytes; differing
     fingerprints with the same key collide → 422.
  - `response_status` + `response_body` are the cached HTTP status + JSON body
     replayed on a hit (only 2xx responses are cached).
  - `expires_at` is set on insert (default now + 24h). A row past `expires_at`
     is treated as absent → fresh request runs.

UniqueConstraint `(tenant_id, idempotency_key, method, path)` is the collision
fence — same key reused with the same shape collapses to one row.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, DateTime, UniqueConstraint, Index, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class IdempotencyRequest(Base):
    """A captured (tenant_id, key, method, path) fingerprint + cached response.

    Written by ``app.middleware.idempotency.IdempotencyMiddleware`` after a
    successful (2xx) handler run; read on the next request with the same
    Idempotency-Key to replay the cached response.
    """
    __tablename__ = "idempotency_request"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "idempotency_key", "method", "path",
            name="uq_idempotency_request",
        ),
        Index("ix_idem_expires", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    # SHA-256 hex of the raw request body (64 hex chars).
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_body: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )
