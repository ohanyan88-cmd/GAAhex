import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PermissionDef(Base):
    """Catalog of permission keys, e.g. 'lead.create'. (key = entity.verb)"""
    __tablename__ = "permission_def"
    __table_args__ = (UniqueConstraint("tenant_id", "key", name="uq_permission_def_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    group: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RoleDef(Base):
    """A named bundle of permissions + a default org scope. permissions = list of permission keys
    (supports wildcards: '*', 'lead.*'). scope ∈ node|subtree|tenant."""
    __tablename__ = "role_def"
    __table_args__ = (UniqueConstraint("tenant_id", "key", name="uq_role_def_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    permissions: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    scope: Mapped[str] = mapped_column(String(20), default="node", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Assignment(Base):
    """Who holds which role, at which org node (the scope anchor)."""
    __tablename__ = "assignment"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False, index=True)
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("role_def.id"), nullable=False)
    node_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
