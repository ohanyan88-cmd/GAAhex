from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ReportDef(Base):
    """A saved, named aggregation a user can re-run — the config-driven report built on the SAME
    aggregation engine as dashboard widgets (the `query` shape is identical, so a saved report and a
    widget interoperate).

    `owner_user_id` NULL ⇒ shared with the whole tenant; otherwise the report is private to its owner.
    ⚠️ This table needs Postgres ROW-LEVEL SECURITY (tenant isolation + owner/shared visibility) as
    defense-in-depth beside the app-layer checks — reported for the coordinator to add in the migration.
    """
    __tablename__ = "report_def"
    __table_args__ = (UniqueConstraint("tenant_id", "owner_user_id", "key", name="uq_report_def_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True, index=True)  # NULL = shared
    key: Mapped[str] = mapped_column(String(80), nullable=False)            # stable handle, snake/kebab
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    query: Mapped[dict] = mapped_column(JSONB, nullable=False)              # {entity, metric, field?, group_by?, filter?, columns?}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
