"""i18n string store (Armenian + English).

A Translation is one localized string. `tenant_id` NULL ⇒ a GLOBAL/default string shared by all
tenants; a row with a tenant_id is that tenant's OVERRIDE (tenant wins at read time). Keys are dotted
handles the frontend looks up, e.g. `nav.dashboard`, `status.NEW`, `entity.lead.label`. Needs RLS on
the tenant-scoped rows (global rows readable by all). Languages: `hy`, `en` (default `en`).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Translation(Base):
    __tablename__ = "translation"
    __table_args__ = (UniqueConstraint("tenant_id", "lang", "key", name="uq_translation_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=True, index=True)  # NULL = global default
    lang: Mapped[str] = mapped_column(String(8), nullable=False)            # hy | en
    key: Mapped[str] = mapped_column(String(160), nullable=False)           # dotted handle, e.g. nav.dashboard
    value: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
