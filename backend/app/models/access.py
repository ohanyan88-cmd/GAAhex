from app.utils.ids import uuid7
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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    permissions: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    scope: Mapped[str] = mapped_column(String(20), default="node", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Assignment(Base):
    """Who holds which role, at which org node (the scope anchor).

    Step 6 added optional Department / Region-scope filters per SPEC §4.1:
        - `department`   — if set, this assignment only applies in that department context.
        - `region_scope` — 'home_only' | 'subtree' | 'any'; how wide the assignment reaches
                           across the region partition. NULL is read as 'home_only' by the kernel.
    """
    __tablename__ = "assignment"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False, index=True)
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("role_def.id"), nullable=False)
    node_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=False)
    # SPEC §4.1 Department layer — optional per-assignment dept filter. Backfill via seeds.
    department: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # SPEC §4.1 Region layer — how the assignment widens across the region partition.
    # 'home_only' | 'subtree' | 'any'. NULL read as 'home_only' by the kernel.
    region_scope: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RoleDeny(Base):
    """SPEC §4.3 role hard-denials — the role.cannot list.

    Evaluated by `app.kernel.invariants.assert_can` AFTER the positive role grant check: a matching
    deny row raises `AccessDenied` even if the role's positive permissions would have allowed the
    action. Wildcards:
        - `denied_action='*'`            denies every verb (when entity matches or is NULL).
        - `denied_entity_key=NULL`       denies the action for ANY entity (e.g. sales `audit.*`
                                          is recorded as action='*', entity='audit_log', or as
                                          action='audit', entity=NULL depending on the SPEC text).
        - `denied_action='invoice.edit'` literal compound key — matches when `(entity_key, action)`
                                          joins back to the same string. The seeder normalizes
                                          either form to the structured `(action, entity)` pair.

    The unique key `(tenant_id, role_id, denied_action, COALESCE(denied_entity_key, '__any__'))`
    keeps the deny list deduplicated including the NULL-entity branch (plain UniqueConstraint
    treats NULLs as distinct in Postgres, which would let dupes through).
    """
    __tablename__ = "role_def_deny"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("role_def.id", ondelete="CASCADE"), nullable=False, index=True)
    denied_action: Mapped[str] = mapped_column(String(80), nullable=False)
    denied_entity_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
