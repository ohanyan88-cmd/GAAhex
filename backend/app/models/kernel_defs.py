"""Kernel `_def` meta-tables introduced by the Cross-Module Architecture SPEC §10.1.

These tables make the canonical pipeline (SPEC §3) and KPI catalog (SPEC §9) metadata-driven
instead of hardcoded enums. Records, stages, statuses, KPIs, permissions all live in `_def`
rows. Seeding (14 stage rows, the KPI catalog, owner_module backfill on entity_def) lands in
later kernel-build steps.

Tenant-scoped + carries the standard NULLIF-guarded tenant_isolation RLS policy applied in the
companion migration; matches every other post-enable-RLS _def table.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, Boolean, Integer, Numeric, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class StageDef(Base):
    """Canonical pipeline stage per SPEC §3.

    14 rows seeded in Step 4 (Lead → Monitoring). `sequence` 1..14, `is_control_gate` True only
    for stage 8 (Order Validation, owned by Revenue Control) — the single mandatory gate between
    Sales and Fulfillment. KPI denominators and report joins bind to `key`.
    """
    __tablename__ = "stage_def"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_stage_def_key"),
        UniqueConstraint("tenant_id", "sequence", name="uq_stage_def_sequence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)            # snake_case, e.g. "lead", "order_validation"
    name: Mapped[str] = mapped_column(String(120), nullable=False)         # display, e.g. "Lead", "Order Validation"
    owner_module: Mapped[str] = mapped_column(String(80), nullable=False)  # e.g. "Marketing", "Revenue Control"
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)         # 1..14
    exit_gate: Mapped[str | None] = mapped_column(String(255), nullable=True)        # e.g. "Mandatory fields complete"
    kpi_def_key: Mapped[str | None] = mapped_column(String(80), nullable=True)       # by-key link into kpi_def
    is_control_gate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class KpiDef(Base):
    """KPI definition per SPEC §3 / §5.4 / §9.

    Invariant (SPEC §0 rule 7): one KPI = one owner = one formula = one valid denominator.
    No shared ownership, no activity-only metrics. Optionally bound to a single stage_def.key
    and/or workflow_def.key — kernel enforcement of one-owner-one-formula lands in Step 2.

    Two parallel formula representations:
      - `formula` (VARCHAR) — free-form human-readable text (legacy / display). Future home
        for GXL/CEL expressions; not currently executed.
      - `formula_spec` (JSONB) — STRUCTURED spec consumed by `app/kernel/kpi_engine.py` at
        runtime. THE column the engine actually evaluates today.

    formula_spec schema (the four shapes the engine supports — see KPI-ENGINE.md):

        # 1. count — a tenant-scoped row count over a single table with optional filters
        {
            "type": "count",
            "table": "record" | "order" | "subscription" | "invoice" | "payment",
            "where": {
                # entity_key | data.<json key> | column name (for non-record tables)
                "entity_key": "lead",
                "data.status": "QUALIFIED",
                # Boolean keys map to TRUE; key__not_null suffix maps to IS NOT NULL.
                "control_pass": True,
                "control_pass__not_null": True,
            },
        }

        # 2. ratio — numerator / denominator (both are nested specs)
        {
            "type": "ratio",
            "numerator":   {<count_spec | stage_total>},
            "denominator": {<count_spec | stage_total>},
        }

        # 3. stage_total — count of records currently AT a named pipeline stage
        # (today: counts records whose entity_def has owner_module = the stage's owner; emits
        # a WARNING log "no stage attribution wired yet" — see docs/kernel-build/KPI-ENGINE.md)
        {"type": "stage_total", "stage_key": "lead"}

        # 4. rate — numerator divided by a time window (days)
        {
            "type": "rate",
            "numerator": {<count_spec>},
            "since_days": 30,   # default 30 if omitted
        }

    Cache: `last_computed_at` + `last_computed_value` memo a single result on the row so a
    busy dashboard doesn't recompute the same KPI dozens of times per second; the engine
    treats a cache <60s old as fresh.
    """
    __tablename__ = "kpi_def"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_kpi_def_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)           # snake_case
    name: Mapped[str] = mapped_column(String(120), nullable=False)         # display
    owner_module: Mapped[str] = mapped_column(String(80), nullable=False)
    formula: Mapped[str | None] = mapped_column(String(500), nullable=True)           # GXL/CEL expression text (display)
    denominator: Mapped[str | None] = mapped_column(String(255), nullable=True)       # human-readable denominator
    # Machine-executable structured spec — see class docstring for the four supported shapes.
    formula_spec: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    bound_stage_key: Mapped[str | None] = mapped_column(String(80), nullable=True)    # links to stage_def.key (nullable)
    bound_workflow_key: Mapped[str | None] = mapped_column(String(80), nullable=True) # links to workflow_def.key (nullable)
    # Lazy-evaluation cache; engine refreshes when older than 60s.
    last_computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_computed_value: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
