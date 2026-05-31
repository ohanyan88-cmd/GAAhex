import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Region(Base):
    """SPEC §0.6 canonical Region/Branch — the partition key for operational records.

    SPEC §0 invariant #6: "Region/Branch is a partition key on every operational record.
    Cross-region read requires explicit grant." Step 2 (`b70ef3b98e27`) widened seven
    operational tables (record, invoice, payment, order, service, helpdesk_ticket, workitem)
    with a `region_id UUID NULL` column — but with no canonical region table to FK against
    those columns are free-floating UUIDs with no referential integrity. THIS table is the
    canonical home those columns will eventually FK to.

    Foreign-key wiring from the existing `region_id` columns into `region.id` is DEFERRED to
    a separate later migration to avoid breaking running code (rows already in those columns
    may not match any seeded region until backfill completes). The cross-region read guard
    (`assert_can_read_region`) is also a follow-up adoption sweep.

    Hierarchy: a region can have a parent. `region_type` projects the SPEC's locked four-level
    org topology (`country > region > city > branch`); the M0 demo seed inserts a single
    `region` row per tenant matching the existing Yerevan ISP demo data, with the multi-region
    expansion (Gyumri, Vanadzor, …) deferred to a richer follow-up seed.

    Tenant-scoped (`tenant_id` FK). Identified by short `code` (e.g. `YER`, `GYU`) unique per
    tenant. `metadata_` (Python attr) maps to the DB column `metadata` (JSONB) for arbitrary
    config (GIS coords, contact info, dispatch rules) — the attribute name is suffixed with `_`
    because SQLAlchemy's Declarative reserves the bare `metadata` name for the registry.
    """
    __tablename__ = "region"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_region_code"),
        Index("ix_region_tenant_status", "tenant_id", "status"),
        Index("ix_region_parent", "parent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("region.id"), nullable=True,
    )
    # 'country' | 'region' | 'city' | 'branch' — the SPEC hierarchy projection.
    region_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="region")
    # 'active' | 'inactive' | 'archived'
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="active")
    timezone: Mapped[str | None] = mapped_column(String(40), nullable=True)   # IANA, e.g. 'Asia/Yerevan'
    locale: Mapped[str | None] = mapped_column(String(20), nullable=True)     # e.g. 'hy-AM'
    # Python attribute `metadata_` maps to DB column `metadata` — SQLAlchemy's Declarative
    # reserves the bare `metadata` attribute for the registry, hence the trailing underscore.
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
