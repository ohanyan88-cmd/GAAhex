"""Messaging channels — per-tenant SMS / Telegram / WhatsApp config (the Mail-module pattern).

Each tenant ISP configures its OWN channel credentials (Telegram bot token, Viva Armenia SMS creds,
WhatsApp Business token) — multi-tenant from day one: 5 tenants = 5 independent, RLS-isolated,
Fernet-encrypted rows. `channels.dispatch` routes a tenant's sms/telegram/whatsapp traffic through
ITS configured account (the `mail_account → SmtpEmailGateway` pattern applied to messaging).

Telegram ships live; Viva-SMS + WhatsApp gateways are registered stubs (creds/API pending from the
pilot) — the per-tenant framework is ready, they slot in when HouseNet shares access.

Enums (UPPER_SNAKE, B1):
  ChannelKind          : SMS | TELEGRAM | WHATSAPP
  ChannelAccountStatus : PENDING | CONNECTED | AUTH_ERROR | CONN_ERROR | DISABLED
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, ForeignKey, DateTime, func, Text, Index, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from ..security import EncryptedString


class TenantChannelAccount(Base):
    """A tenant's outbound messaging account for one channel (SMS/Telegram/WhatsApp). Credentials are
    Fernet-encrypted at rest; the sender drives the channel from THIS row's creds, never a global env."""
    __tablename__ = "tenant_channel_account"
    __table_args__ = (
        # One default account per (tenant, channel) among live rows.
        Index(
            "uq_channel_account_default", "tenant_id", "channel",
            unique=True,
            postgresql_where=text("is_default = true AND deletion_state = 'ACTIVE'"),
        ),
        Index("ix_channel_account_lookup", "tenant_id", "channel", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)

    channel: Mapped[str] = mapped_column(String(20), nullable=False)        # SMS | TELEGRAM | WHATSAPP
    provider: Mapped[str] = mapped_column(String(40), nullable=False)       # telegram_bot | viva_armenia | whatsapp_cloud
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    sender_id: Mapped[str | None] = mapped_column(String(255), nullable=True)   # from-number / bot @username / WABA phone id

    # Fernet-encrypted credentials (the DB never sees plaintext). Which fields a provider uses:
    #   telegram_bot  → secret_token = bot token
    #   viva_armenia  → secret_token = API key/token,  secret_extra = password (if any)
    #   whatsapp_cloud→ secret_token = access token,    config = {phone_number_id, waba_id}
    secret_token: Mapped[str | None] = mapped_column(EncryptedString(), nullable=True)
    secret_extra: Mapped[str | None] = mapped_column(EncryptedString(), nullable=True)
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)        # non-secret provider params

    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING", server_default="PENDING")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deletion_state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="ACTIVE")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
