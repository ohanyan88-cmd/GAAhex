from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, Integer, ForeignKey, DateTime, func, UniqueConstraint, Index, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class EntityDef(Base):
    """Definition of a config-driven entity (e.g. 'lead'). Lives above the Kernel Line."""
    __tablename__ = "entity_def"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_entity_def_key"),
        UniqueConstraint("tenant_id", "route_slug", name="uq_entity_def_slug"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)            # snake_case, singular
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    label_plural: Mapped[str] = mapped_column(String(120), nullable=False)
    route_slug: Mapped[str] = mapped_column(String(120), nullable=False)    # kebab-case, plural
    icon: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="active")
    order: Mapped[int] = mapped_column(Integer, default=0)                   # sidebar / listing order
    # SPEC §2.2 ownership matrix: single source module that owns this record kind (the
    # write-lock owner). Nullable for now; Step 3 backfills from the §2.2 matrix and a later
    # pass will tighten to NOT NULL. Semantically: entity_def == SPEC's record_def, so this is
    # the "owner_module" column SPEC §10.1 calls for on record_def.
    owner_module: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FieldDef(Base):
    """A field on an entity. type ∈ text|number|boolean|date|datetime|money|email|phone|
    select|multiselect|status|ref|ref_user|ref_orgnode|file|formula."""
    __tablename__ = "field_def"
    __table_args__ = (UniqueConstraint("entity_def_id", "key", name="uq_field_def_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    entity_def_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("entity_def.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)            # snake_case
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    default_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)        # type-specifics: options, target, currency…
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StatusDef(Base):
    """A lifecycle status value for an entity (UPPER_SNAKE key + human label)."""
    __tablename__ = "status_def"
    __table_args__ = (UniqueConstraint("entity_def_id", "key", name="uq_status_def_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    entity_def_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("entity_def.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(60), nullable=False)            # UPPER_SNAKE
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
    is_initial: Mapped[bool] = mapped_column(Boolean, default=False)
    # SPEC §7 terminal-status flag — lifecycle stops here (Closed, Archived, Cancelled, Terminated,
    # Expired, Disconnected, Paid, Credited, Reconciled, Chargeback, Disqualified, Converted).
    # Seeded by `app.seed_statuses`; column added by Alembic revision d4f8a1c6b3e5.
    is_terminal: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RelationDef(Base):
    """A relationship between entities (defined now; used as the model matures)."""
    __tablename__ = "relation_def"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    from_entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("entity_def.id"), nullable=False)
    to_entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("entity_def.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)           # ref|ref_user|ref_orgnode
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkflowDef(Base):
    """A workflow definition — either an entity lifecycle (legacy: entity_def_id NOT NULL)
    OR a SPEC §5 Universal Workflow Contract row (cross-entity orchestration: entity_def_id NULL).

    Two shapes share this table:

    1. **Entity lifecycle** (pre-SPEC §5 — seeded by `seed_catalog.py` / `seed.py`):
       `entity_def_id` is set, `config = {"transitions": [...]}`. Drives the existing
       `app.workflow` engine that gates status PATCHes through guarded transitions.

    2. **SPEC §5 Universal Workflow Contract** (Step 4 of the SPEC build — W1..W5):
       `entity_def_id` is NULL (the workflow spans many entities). The new SPEC §5 columns
       below carry the full Universal Contract: trigger · conditions · actions · owner ·
       SLA · approval · notification · failure handling. Each column maps 1:1 to a clause
       in SPEC §5.1.

    SPEC §5.1 column mapping (the Universal Workflow Contract):
        Trigger              -> trigger_spec        (JSONB: {"type": "record_created", ...})
        Conditions           -> conditions_spec     (JSONB: GXL/CEL guard expr)
        Actions              -> actions_spec        (JSONB list, executed in order)
        Single Owner         -> owner_module        (SPEC §0.1 owner_module)
        SLA                  -> sla_seconds         (budget; NULL = no SLA)
        Approval (if needed) -> approval_required   (TRUE wires §4.5 gate)
        Notification         -> notification_def_key (NotificationDef key)
        Failure handling     -> failure_action      ('retry'|'escalate'|'audit_only'|'rollback')

    Status (running instance state) and Audit log live on `WorkflowInstance` — not on the
    `_def` row, which is the template.

    The `(tenant_id, key)` UNIQUE constraint makes idempotent seeding via
    `pg_insert(...).on_conflict_do_nothing(index_elements=["tenant_id", "key"])` safe —
    the matching DB constraint is added in Alembic revision `7a4b1e9c2f08`.
    """
    __tablename__ = "workflow_def"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_workflow_def_key"),
        # File 12 standard 61 — WFL-000001 reference number scoped per-tenant.
        UniqueConstraint("tenant_id", "reference_number", name="uq_workflow_def_reference_number"),
        # PERFECT-TARGET I5 (determinism): at most ONE entity-lifecycle workflow per entity_def — a
        # duplicate is impossible, so `get_transitions().first()` can never be ambiguous. NULL-entity
        # SPEC §5 workflows (W1..W5) are excluded by the partial predicate.
        Index("uq_workflow_def_one_per_entity", "entity_def_id", unique=True,
              postgresql_where=text("entity_def_id IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    # NULLABLE for SPEC §5 cross-entity workflows (W1 spans Pipeline+Orders+Billing+...).
    # Step 4's Alembic migration (7a4b1e9c2f08) drops the NOT NULL via ALTER COLUMN ... DROP NOT NULL.
    # Legacy entity-lifecycle rows continue to set this; SPEC §5 rows leave it NULL.
    entity_def_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("entity_def.id"), nullable=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # Legacy entity-lifecycle config (transitions blob). Untouched by SPEC §5.
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # ---- SPEC §5.1 Universal Workflow Contract columns (additive; NULLable so legacy rows stay valid)
    # SPEC §5.2 trigger: {"type": "record_created"|"status_changed"|"sla_breached"|..., "entity_key": ...}
    trigger_spec: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # GXL/CEL expression spec evaluated before actions run.
    conditions_spec: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # SPEC §5.3 action list, in execution order. Each entry: {"type": "...", "..."}.
    actions_spec: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # SPEC §0.1 / §5.1 — single owner module (e.g. 'Pipeline', 'Tickets', 'Billing').
    owner_module: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # SPEC §5.1 SLA budget in seconds (NULL = no SLA on this workflow).
    sla_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # SPEC §4.5 — TRUE wires the mandatory-approval gate at workflow start.
    approval_required: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # NotificationDef.key to emit on the canonical "workflow advanced" event.
    notification_def_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # SPEC §5.1 failure handling: 'retry'|'escalate'|'audit_only'|'rollback'.
    failure_action: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # ---- Workflow Engine Standard (file 12 std 61) — GateType + lifecycle + versioning
    # NULLable for backward compat: pre-existing rows pick up the server_default ('ACTIVE'),
    # the new jsonb stays NULL, and version backfills to 1 via server_default. Migration
    # `c443f037e6ac_workflow_engine_gate_type` adds the matching DDL.

    # file 14 WorkflowStatus enum (4 values, UPPER_SNAKE per B1):
    #   DRAFT | ACTIVE | DEPRECATED | RETIRED
    # Enforced at the application/router layer — same shape every other lifecycle column
    # on this platform uses (varchar + app-layer validation, not a native DB enum type).
    workflow_status: Mapped[str | None] = mapped_column(
        String(20), nullable=True, default="ACTIVE", server_default="ACTIVE",
    )
    # file 14 GateType enum — array of values this definition's stages reference, e.g.
    # ["COMMERCIAL_GATE", "TECHNICAL_GATE"]. Lets dashboards see at a glance which gates
    # a workflow has. Possible values (7):
    #   COMMERCIAL_GATE | TECHNICAL_GATE | SERVICE_GATE | OPERATIONAL_GATE |
    #   APPROVAL_GATE | COMPLIANCE_GATE | MANUAL_REVIEW_GATE
    # The enum itself doesn't get a dedicated column — it's referenced by VALUE here and
    # in stage config blobs inside `actions_spec` / `config`.
    gate_types_used: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # WFL-000001 prefix (file 00 S5 registered). UNIQUE(tenant_id, reference_number).
    reference_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Versioned definitions. Backfills to 1 for existing rows via server_default.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
