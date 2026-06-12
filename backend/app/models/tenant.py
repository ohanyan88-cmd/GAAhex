from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Tenant(Base):
    """The hard isolation boundary: one ISP company or group."""
    __tablename__ = "tenant"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="ACTIVE")
    # ---- editable profile (onboarding wizard + app header); all additive & nullable ----
    currency: Mapped[str | None] = mapped_column(String(8), nullable=True, default="AMD")   # tenant default currency code
    locale: Mapped[str | None] = mapped_column(String(8), nullable=True, default="en")      # en | hy
    logo_text: Mapped[str | None] = mapped_column(String(40), nullable=True)                # short company mark, e.g. "GA·ex"
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)                        # uploaded company logo: data:image/<mime>;base64,... OR https URL
    logo_pos: Mapped[str | None] = mapped_column(String(20), nullable=True)                  # logo focal point as CSS object-position "x% y%"; NULL = center
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # set when onboarding finishes
    # ---- Studio AppearancePane → design tokens (Prompt 6 sub-area 4); JSONB so the kit can grow ----
    # tokens without a per-field migration. Shape (any/all keys optional; missing ⇒ frontend default):
    #   {"accent": "Azure", "radius": "Soft", "density": "Comfortable", "mode": "Dark"}
    # Allow-lists live in routers/tenant_settings.py — keep them in sync with StudioRichPanes.tsx.
    theme: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # updated_at tracks the last time any tenant profile field was written (name, status,
    # currency, locale, logo_text, logo_url, theme, onboarded_at). Required for change-
    # detection in settings sync, audit diffing, and cache invalidation. Set via
    # onupdate=func.now() at the ORM layer; router PATCH handlers rely on this implicitly.
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )
