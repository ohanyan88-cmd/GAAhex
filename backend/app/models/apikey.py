"""API keys — machine principals (J93).

A key authenticates as a specific User (`acts_as_user_id`), so all downstream access control,
org-scoping, and audit work unchanged — a machine is just a principal. We store only the SHA-256
hash of the full key (never the raw value); the `prefix` (first chars) is kept for display so lists
can show which key is which without revealing it."""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ApiKey(Base):
    __tablename__ = "api_key"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    prefix: Mapped[str] = mapped_column(String(16), nullable=False, index=True)         # first chars, shown in lists
    key_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)  # sha256 of the full key
    acts_as_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)  # principal
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # T4/T5 remediation 2026-06-04 (alembic e1a4b2c3d5f7). Both nullable, backward-compatible.
    # expires_at NULL = no expiry. scopes NULL or [] = no scope restriction (full principal access).
    # A scope is an `object.action` permission key from docs/standards/15-permission-registry.md;
    # e.g. ["billing.read", "subscription.read"]. Enforced by routers.apikeys.require_scope().
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scopes: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
