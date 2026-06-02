from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PageFieldValue(Base):
    """The per-ROW VALUES for the custom data fields a superadmin adds to a BESPOKE page.

    Companion to PageConfig: the field DEFINITIONS (label/type/options) live in the page-config
    descriptor's `customFields` array (an open JSON blob — no schema change). This table stores the
    VALUE each row carries for those fields, generically, so adding a field never touches the page's
    hand-coded engine (billing math, provisioning, SLA, …).

    One row per (tenant, page_key, row_id); `data` = {field_key: value} for that row. `row_id` is the
    natural id of the bespoke page's data row (e.g. a service id) stored as text so the mechanism is
    page-agnostic (the row may live in any table / not be a UUID).

    Tenant-scoped with the standard tenant_isolation RLS policy. READ is open to any authenticated
    tenant user (the view fetches values on load); WRITE is open too — setting a field's value is a
    data edit, not a config change (unlike PageConfig, whose defs are gated on config.manage).

    data shape (Services proof):
      { "notes": "VIP link", "risk": "High" }
    """
    __tablename__ = "page_field_value"
    __table_args__ = (
        UniqueConstraint("tenant_id", "page_key", "row_id", name="uq_page_field_value_tenant_page_row"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    page_key: Mapped[str] = mapped_column(String(80), nullable=False)   # e.g. "services"
    row_id: Mapped[str] = mapped_column(String(255), nullable=False)    # natural id of the page's data row
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)           # {field_key: value}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
