import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, Integer, ForeignKey, DateTime, func, UniqueConstraint
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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)            # snake_case, singular
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    label_plural: Mapped[str] = mapped_column(String(120), nullable=False)
    route_slug: Mapped[str] = mapped_column(String(120), nullable=False)    # kebab-case, plural
    icon: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="active")
    order: Mapped[int] = mapped_column(Integer, default=0)                   # sidebar / listing order
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FieldDef(Base):
    """A field on an entity. type ∈ text|number|boolean|date|datetime|money|email|phone|
    select|multiselect|status|ref|ref_user|ref_orgnode|file|formula."""
    __tablename__ = "field_def"
    __table_args__ = (UniqueConstraint("entity_def_id", "key", name="uq_field_def_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    entity_def_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("entity_def.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(60), nullable=False)            # UPPER_SNAKE
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
    is_initial: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RelationDef(Base):
    """A relationship between entities (defined now; used as the model matures)."""
    __tablename__ = "relation_def"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    from_entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("entity_def.id"), nullable=False)
    to_entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("entity_def.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)           # ref|ref_user|ref_orgnode
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkflowDef(Base):
    """A lifecycle / automation definition for an entity (defined now; engine in a later milestone)."""
    __tablename__ = "workflow_def"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    entity_def_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("entity_def.id"), nullable=False)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
