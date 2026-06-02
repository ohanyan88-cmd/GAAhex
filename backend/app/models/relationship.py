"""Relationship / Entity Link Standard (file 12) — first-class typed link entity.

A first-class table for explicit, typed relationships between any two business
objects. The Relationship table is the "logical link" layer: it does NOT replace
existing FKs in the schema (Subscription.customer_id, Order.account_id, etc. all
remain), it adds an additive metadata layer where the link itself carries identity,
audit, lifecycle, and direction (file 12).

Design:
  - Polymorphic on BOTH sides (source_entity_type + source_entity_id and
    target_entity_type + target_entity_id; no FKs on either side, matching the
    Approval / Comment / Attachment polymorphic precedents).
  - Per-tenant business id: REL-000001 via SELECT COUNT(*)+1; UNIQUE
    (tenant_id, reference_number) is the authoritative collision fence.
  - Status lifecycle: ACTIVE → INACTIVE → ARCHIVED. Soft delete = ARCHIVED.
  - Direction: DIRECTED (source → target meaningful, e.g. PARENT_OF) or
    BIDIRECTIONAL (symmetric, e.g. RELATED_TO, CONNECTED_TO).
  - Duplicate-active fence: partial UNIQUE INDEX on
      (tenant_id, source_entity_type, source_entity_id,
       target_entity_type, target_entity_id, relationship_type)
    WHERE status='ACTIVE'. An ARCHIVED row carrying the same key may coexist with
    a fresh ACTIVE row — re-creating a link after archiving the old one is legal.

17 RelationshipType values (file 12):
  RELATED_TO, PARENT_OF, CHILD_OF, DEPENDS_ON, BLOCKED_BY, DUPLICATES,
  DUPLICATED_BY, OWNS, USED_BY, ASSOCIATED_WITH, REPLACES, REPLACED_BY,
  CONNECTED_TO, BILLED_TO, SERVES, LOCATED_AT, ASSIGNED_TO.

2 RelationshipDirection values: DIRECTED, BIDIRECTIONAL.
3 Status values: ACTIVE, INACTIVE, ARCHIVED.

"User sees a relationship only if they can view both sides" (file 12 §visibility):
  v1 leaves the both-sides view gate to the records router (i.e. clients that load
  a Relationship row and then load the related entities will get default-denied at
  the entity router). The Relationship row itself respects tenant RLS only. Closing
  the both-sides gate at the relationship layer is a tracked follow-up.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import String, ForeignKey, DateTime, Text, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Relationship(Base):
    """A typed, directional or bidirectional link between two business objects.

    Reference numbers: REL-000001 per-tenant via SELECT COUNT(*)+1; the UNIQUE
    (tenant_id, reference_number) fence makes a concurrent collision fail rather
    than duplicate (same race / same fix as TSK-, INV-, ORD-).
    """
    __tablename__ = "relationship"
    __table_args__ = (
        UniqueConstraint("tenant_id", "reference_number", name="uq_relationship_reference_number"),
        Index("ix_relationship_source", "tenant_id", "source_entity_type", "source_entity_id"),
        Index("ix_relationship_target", "tenant_id", "target_entity_type", "target_entity_id"),
        Index("ix_relationship_status", "tenant_id", "status"),
        # Partial unique fence — no duplicate ACTIVE link of the same shape.
        # ARCHIVED rows of the same shape may coexist with a fresh ACTIVE row.
        Index(
            "uq_relationship_active_pair",
            "tenant_id",
            "source_entity_type", "source_entity_id",
            "target_entity_type", "target_entity_id",
            "relationship_type",
            unique=True,
            postgresql_where=sa.text("status = 'ACTIVE'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    reference_number: Mapped[str] = mapped_column(String(20), nullable=False)  # REL-000001

    # Polymorphic source + target (no FKs — Approval / Comment / Attachment precedent).
    source_entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    target_entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # 17-value RelationshipType enum (file 12).
    relationship_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # 2-value RelationshipDirection enum (file 12).
    direction: Mapped[str] = mapped_column(String(20), nullable=False, default="DIRECTED")
    # 3-value Status enum (file 12). Soft delete = ARCHIVED.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    # updated_at is set explicitly at the router (onupdate= is unsafe with asyncpg).
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    # Deletion / Archive / Restore Standard (file 12 — D14). Separate from lifecycle `status`
    # (Relationship `status` is ACTIVE/INACTIVE/ARCHIVED — that's a link-lifecycle axis;
    # deletion_state is the orthogonal data-lifecycle axis. Both may say ACTIVE simultaneously.)
    # 5-value enum: ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED. Default ACTIVE.
    deletion_state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="'ACTIVE'")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
