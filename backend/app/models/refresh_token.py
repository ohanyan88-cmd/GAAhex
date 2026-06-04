from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RefreshToken(Base):
    """A stored, hashed refresh token — one per active session. We store only the SHA-256 hash of
    the opaque token (never the token itself), so a DB leak can't be replayed. Revocation is real:
    `revoked_at` set ⇒ the token is dead. Tokens rotate on every refresh (old revoked, new issued)."""
    __tablename__ = "refresh_token"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    # Session-family identifier (T2 remediation 2026-06-04, alembic e1a4b2c3d5f7). Every refresh
    # token rotation preserves the parent's session_id, so all tokens descended from one /auth/login
    # share a session_id. Replay of a revoked refresh ⇒ revoke the whole family in one UPDATE.
    # Legacy rows backfill to session_id = id (family-of-one) via the migration.
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
