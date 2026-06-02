"""Configuration Standard (file 08) — first-class Configuration entity.

Replaces the ad-hoc `tenant_settings.py`, `feature_flag.py`, scattered per-domain
config tables with a single governed Configuration table. Additive only: the
pre-existing modules are NOT modified — both stand side-by-side until callers
migrate. New configuration features land here.

Key design decisions:
  - Polymorphic NOT used — scope is a fixed enum (file 14 ConfigurationScope) and
    the matching scope-identity is encoded as a key within the row. Resolution
    chooses the most-specific live ACTIVE row.
  - Reference numbers: CFG-000001 per-tenant (SELECT COUNT+1, UNIQUE index is the
    concurrency fence).
  - configuration_value is JSONB — opaque to the platform; callers cast as needed.
  - status lifecycle (file 14 ConfigurationStatus, 4 values):
        PENDING_REVIEW → ACTIVE → INACTIVE → DEPRECATED
    Resolution returns only ACTIVE rows.
  - version is monotonically increasing per (tenant_id, configuration_key, scope).
    Every value/status change bumps version + writes a ConfigurationHistory row.
  - ConfigurationHistory is append-only (no UPDATE / DELETE in the router). It
    survives Configuration row deletion (no CASCADE) — same audit-survivability
    principle as SlaEvent.
  - UNIQUE on (tenant_id, configuration_key, scope) — exactly ONE live row per
    (tenant, key, scope) tuple. A duplicate insert is a 409.

Scope precedence (file 08 — resolution order, most-specific first):
        USER > ROLE > DEPARTMENT > TENANT > GLOBAL > ENVIRONMENT

  Resolution walks this list and returns the FIRST matching ACTIVE row whose
  scope-identity hints are satisfied. ENVIRONMENT is the lowest because it
  represents an infrastructure default (dev/staging/prod) — TENANT and above
  always override it. GLOBAL sits above ENVIRONMENT to allow a platform-wide
  default that crosses environments.

Permissions: configuration.manage (single key, file 15 — Super Admin scope).
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Text, Integer, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


# Valid enums (file 14 — Configuration Standard).
VALID_SCOPES = {"GLOBAL", "TENANT", "DEPARTMENT", "ROLE", "USER", "ENVIRONMENT"}
VALID_STATUSES = {"ACTIVE", "INACTIVE", "DEPRECATED", "PENDING_REVIEW"}

# Resolution precedence — most specific first. See module docstring.
SCOPE_PRECEDENCE = ("USER", "ROLE", "DEPARTMENT", "TENANT", "GLOBAL", "ENVIRONMENT")


class Configuration(Base):
    """A first-class configuration entry (file 08 — Configuration Standard).

    Each row is exactly ONE governed (tenant, key, scope) configuration. The
    UNIQUE constraint on (tenant_id, configuration_key, scope) guarantees this.

    Scope enum (file 14 ConfigurationScope, 6 values):
      GLOBAL, TENANT, DEPARTMENT, ROLE, USER, ENVIRONMENT

    Status enum (file 14 ConfigurationStatus, 4 values):
      ACTIVE, INACTIVE, DEPRECATED, PENDING_REVIEW

    Resolution precedence (most-specific first):
      USER > ROLE > DEPARTMENT > TENANT > GLOBAL > ENVIRONMENT
    """
    __tablename__ = "configuration"
    __table_args__ = (
        UniqueConstraint("tenant_id", "configuration_key", "scope",
                         name="uq_configuration_key_scope"),
        UniqueConstraint("tenant_id", "reference_number",
                         name="uq_configuration_reference_number"),
        Index("ix_configuration_key", "tenant_id", "configuration_key"),
        Index("ix_configuration_scope", "tenant_id", "scope"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    reference_number: Mapped[str] = mapped_column(String(20), nullable=False)  # CFG-000001

    configuration_key: Mapped[str] = mapped_column(String(200), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    configuration_value: Mapped[dict] = mapped_column(JSONB, nullable=False)

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ACTIVE", server_default="ACTIVE"
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True
    )


class ConfigurationHistory(Base):
    """Append-only audit trail of Configuration value/status changes.

    One row per version, including the initial v1 written at create time. Rows
    are immutable; no CASCADE on configuration_id — history survives the parent
    record's deletion (same principle as SlaEvent).
    """
    __tablename__ = "configuration_history"
    __table_args__ = (
        Index(
            "ix_configuration_history_cfg_version",
            "tenant_id", "configuration_id", "version",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    configuration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("configuration.id"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    configuration_value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    changed_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False
    )
