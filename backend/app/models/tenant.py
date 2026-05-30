import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Tenant(Base):
    """The hard isolation boundary: one ISP company or group."""
    __tablename__ = "tenant"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="active")
    # ---- editable profile (onboarding wizard + app header); all additive & nullable ----
    currency: Mapped[str | None] = mapped_column(String(8), nullable=True, default="AMD")   # tenant default currency code
    locale: Mapped[str | None] = mapped_column(String(8), nullable=True, default="en")      # en | hy
    logo_text: Mapped[str | None] = mapped_column(String(40), nullable=True)                # short company mark, e.g. "GA·ex"
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)                        # uploaded company logo: data:image/<mime>;base64,... OR https URL
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # set when onboarding finishes
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
