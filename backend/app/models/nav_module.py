"""SPEC §1 — canonical Left Navigation registry (groups + modules).

Two tenant-scoped tables that hold the *information architecture* (IA) the UI renders
from. The SPEC §1 nav tree is hardcoded in marketing/whiteboard form today; this is its
data-model home, so the UI can fetch it instead of being hardcoded itself (zero-bespoke
directive).

Locked SPEC placement rules (all enforced in `seed_nav_registry.py`):
  - Orders & Validation sits in **Billing & Revenue** (NOT CRM) — Control Gate at §3 stage 8.
  - Contracts is its own CRM module.
  - KB / Announcements / Communications / Calendar appear under Workspace but own their
    records (placement='O'). Workspace itself owns nothing (placement='V' for hub items).
  - Studio is first-class top-level (NOT nested under System).

Placement legend (SPEC §1 [O]/[V]):
  - 'O' — module OWNS records (edited here); `owner_record_keys` lists the entity_def keys.
  - 'V' — view / aggregation only (Home, Dashboards, Search, Studio builders, ...).

Tenant-scoped throughout. The standard NULLIF-guarded `tenant_isolation` RLS policy is
applied to both tables by the migration (`<hash>_nav_registry`).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, DateTime, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class NavGroup(Base):
    """SPEC §1 top-level nav group (Workspace, CRM & Commercial, Billing & Revenue, ...).

    One row per group per tenant. `key` is the stable machine identifier ('workspace',
    'crm', 'billing_revenue', ...); `name` is the displayed label. `order` is the
    display position within the side-nav (1..N, unique per tenant).

    Identified canonically per tenant via `uq_nav_group_key`. Display order is enforced
    unique per tenant via `uq_nav_group_order` so two groups can never collide at the
    same slot — re-ordering is a swap.
    """
    __tablename__ = "nav_group"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_nav_group_key"),
        UniqueConstraint("tenant_id", "order", name="uq_nav_group_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Python attribute `order_` maps to DB column `order` — `order` is a reserved SQL
    # keyword (used by ORDER BY); the column is intentionally named `order` for the SPEC
    # but the attribute carries a trailing underscore to keep ORM expressions safe.
    order_: Mapped[int] = mapped_column("order", Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )


class NavModule(Base):
    """SPEC §1 module within a group (Home, My Work, Pipeline, Contracts, Orders, ...).

    One row per module per group per tenant. `placement` is the SPEC [O]/[V] legend:

      - 'O' — module OWNS records. `owner_record_keys` lists the entity_def keys it
        owns (e.g. ['lead', 'pipeline_item'] for Pipeline; ['order'] for the Billing
        Orders Control Gate; ['customer', 'contact'] for Customers).
      - 'V' — view / aggregation only (Home, Global Search, Dashboards, Studio builders,
        Workspace hub items, ...); `owner_record_keys` is empty/null.

    `route` is the UI path the side-nav links to (e.g. '/pipeline', '/orders'); kept
    on the row so the UI fetches both label AND route from `/api/nav`.

    Identified per (tenant, group) by `key` (`uq_nav_module_key_in_group`). Display
    order is enforced unique per (tenant, group) via `uq_nav_module_order_in_group`.
    `ix_nav_module_owner_module` makes "which module owns this entity_key?" lookups
    cheap once the FK adoption sweep (separate step) starts using it.
    """
    __tablename__ = "nav_module"
    __table_args__ = (
        UniqueConstraint("tenant_id", "group_id", "key", name="uq_nav_module_key_in_group"),
        UniqueConstraint("tenant_id", "group_id", "order", name="uq_nav_module_order_in_group"),
        Index("ix_nav_module_owner_module", "owner_module"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("nav_group.id"), nullable=False, index=True,
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # See NavGroup.order_ for the reserved-keyword note.
    order_: Mapped[int] = mapped_column("order", Integer, nullable=False)
    # 'O' (owns records) or 'V' (view/aggregation only) — SPEC §1 [O]/[V] legend.
    placement: Mapped[str] = mapped_column(String(20), nullable=False)
    # The module's stable machine identifier mirrored as `owner_module` so the index
    # `ix_nav_module_owner_module` can power "which module owns entity X?" lookups
    # symmetrically with `entity_def.owner_module` (SPEC §2.2 ownership matrix).
    # Always equal to `key` on insert (and updated alongside `key`); kept as a separate
    # indexed column for explicitness and to mirror SPEC's vocabulary.
    owner_module: Mapped[str] = mapped_column(String(80), nullable=False)
    # JSONB list of entity_def keys this module owns (e.g. ['lead', 'pipeline_item']).
    # NULL or [] for placement='V' rows. JSONB so a future migration can add structure
    # (e.g. per-entity sub-routing) without a schema change.
    owner_record_keys: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    route: Mapped[str | None] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
