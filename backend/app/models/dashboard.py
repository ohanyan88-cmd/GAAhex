from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class DashboardDef(Base):
    """A named analytics board (config). Its widgets are WidgetDef rows; the engine computes
    each widget's value at request time. Lives above the Kernel Line — analytics as configuration."""
    __tablename__ = "dashboard_def"
    __table_args__ = (UniqueConstraint("tenant_id", "key", name="uq_dashboard_def_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)            # snake_case
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WidgetDef(Base):
    """One widget on a dashboard. `query` (JSONB) declares the aggregation the engine performs:
    {entity, metric: count|sum|avg, field (for sum/avg), group_by (optional), filter (GXL, optional)}.
    type ∈ kpi|bar|line|donut|table."""
    __tablename__ = "widget_def"
    __table_args__ = (UniqueConstraint("dashboard_def_id", "key", name="uq_widget_def_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    dashboard_def_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dashboard_def.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)            # snake_case
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)          # kpi|bar|line|donut|table
    query: Mapped[dict | None] = mapped_column(JSONB, nullable=True)        # aggregation spec
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
