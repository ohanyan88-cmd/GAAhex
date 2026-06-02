"""Customer Communication Standard (file 12) — first-class Communication entity.

A Communication is one observable customer-platform exchange: an outbound WhatsApp
message, an inbound email reply, a system notification, an internal team chat note.
It is the canonical, queryable record of every signal that crosses the customer /
platform boundary OR moves between two internal participants — replacing the legacy
`Interaction` table (kept on the schema for back-compat; live API is this entity).

Key design decisions
--------------------
- ``related_entity_type`` + ``related_entity_id`` = polymorphic optional pointer to
  the business object the message belongs to (customer, ticket, order, …). NO FK
  (mirrors ``approval.target_entity_key`` / ``approval.target_record_id`` —
  ``app/models/approval.py:58, 66``). The Timeline projection (file 04 B4) reads
  this pair so a Customer's tab automatically picks up every message threaded to it.
- ``participant_type`` + ``participant_id`` = polymorphic counterpart (EMPLOYEE /
  ROLE / DEPARTMENT / TEAM / CUSTOMER). Also no FK — participants live in five
  different tables and the standard chose enum + id over five nullable FKs.
- ``reference_number`` is human-visible (COM-000001, COM-000002, …). Issued by a
  per-tenant ``SELECT COUNT+1`` at create time; the DB UNIQUE ``(tenant_id,
  reference_number)`` is the final fence against a race writing the same number.
- All UUIDs use ``default=uuid7`` (file 08 Standard 8 — ID).
- ``created_by`` FK → ``app_user.id``; ``tenant_id`` FK → ``tenant.id``.

Enums (file 14 — UPPER_SNAKE_CASE)
----------------------------------
- channel:         WHATSAPP, MESSENGER, SMS, EMAIL, CALLS, INTERNAL_CHAT,
                   PORTAL_MESSAGE, SYSTEM_MESSAGE
- direction:       INBOUND, OUTBOUND, INTERNAL, SYSTEM
- participant_type:EMPLOYEE, ROLE, DEPARTMENT, TEAM, CUSTOMER  (RecipientType)
- status:          DRAFT, QUEUED, SENT, DELIVERED, READ, FAILED, RECEIVED, ARCHIVED

Lifecycle (router-enforced; no GXL workflow yet)
------------------------------------------------
DRAFT → QUEUED → SENT → DELIVERED → READ
                                  → FAILED
                  RECEIVED (for INBOUND from a vendor webhook)
                  ARCHIVED (terminal from any state)

Indexes
-------
1. (tenant_id, related_entity_type, related_entity_id) — Timeline projection.
2. (tenant_id, participant_type, participant_id)       — "all messages with X".
3. (tenant_id, status)                                  — queue sweeps.
4. UNIQUE (tenant_id, reference_number)                 — COM-### fence.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Text, ForeignKey, DateTime, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


# Validation sets — mirrored by the router and migration. UPPER_SNAKE_CASE per B1.
COMMUNICATION_CHANNELS = frozenset({
    "WHATSAPP", "MESSENGER", "SMS", "EMAIL", "CALLS",
    "INTERNAL_CHAT", "PORTAL_MESSAGE", "SYSTEM_MESSAGE",
})
COMMUNICATION_DIRECTIONS = frozenset({"INBOUND", "OUTBOUND", "INTERNAL", "SYSTEM"})
COMMUNICATION_PARTICIPANT_TYPES = frozenset({
    "EMPLOYEE", "ROLE", "DEPARTMENT", "TEAM", "CUSTOMER",
})
COMMUNICATION_STATUSES = frozenset({
    "DRAFT", "QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "RECEIVED", "ARCHIVED",
})


class Communication(Base):
    """One observable communication touchpoint (file 12 — Customer Communication Standard).

    Replaces the legacy ``Interaction`` table (still on the schema for back-compat,
    not exposed via the API). Polymorphic ``related_entity_*`` + ``participant_*``
    let one table cover messages threaded against any business object and exchanged
    with any of the five participant kinds (EMPLOYEE, ROLE, DEPARTMENT, TEAM,
    CUSTOMER) without proliferating per-channel tables.
    """
    __tablename__ = "communication"
    __table_args__ = (
        # Timeline projection on the related object (Customer.timeline, Ticket.timeline, …).
        Index("ix_communication_related", "tenant_id", "related_entity_type", "related_entity_id"),
        # "All messages to/from this participant" — supports the inbox view per participant.
        Index("ix_communication_participant", "tenant_id", "participant_type", "participant_id"),
        # Queue sweeps (e.g. find QUEUED rows for the channel adapter to ship).
        Index("ix_communication_status", "tenant_id", "status"),
        # COM-### fence — per-tenant unique reference number.
        UniqueConstraint("tenant_id", "reference_number", name="uq_communication_tenant_refnum"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    reference_number: Mapped[str] = mapped_column(String(20), nullable=False)  # "COM-000001"
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)

    # Channel + direction (file 14 enums).
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    direction: Mapped[str] = mapped_column(String(20), nullable=False)

    # Polymorphic related-entity pointer (no FK — Approval precedent at approval.py:58/66).
    related_entity_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    related_entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Polymorphic participant counterpart (no FK — five possible target tables).
    participant_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    participant_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Payload.
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    message_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # content_reference = pointer to attachment / external storage / vendor record id.
    content_reference: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Lifecycle.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")

    # Provenance + audit timestamps.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Trace keys (file 06 / M1) — surface on the substrate Event for end-to-end correlation.
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    event_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # Deletion / Archive / Restore Standard (file 12 — D14). Separate from lifecycle `status`
    # (which already carries ARCHIVED as a TERMINAL message-lifecycle state; deletion_state
    # is the orthogonal data-lifecycle axis — both may say ACTIVE simultaneously).
    # 5-value enum: ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED. Default ACTIVE.
    deletion_state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="'ACTIVE'")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
