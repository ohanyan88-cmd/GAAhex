from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Text, Index, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PendingApproval(Base):
    """A workflow transition flagged `approval: true` parks here instead of moving the record.

    The record stays at `from_status` while status is PENDING. An eligible approver decides it:
    on APPROVED the move completes (record → `to_status`, transition Event + on-enter actions run);
    on REJECTED the record is left untouched. Never hard-deleted — it's part of the audit story.
    record_id carries no FK (the `record` table is the generic multi-entity store, mirroring how
    `event.record_id` is unconstrained)."""
    __tablename__ = "pending_approval"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    entity_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    from_status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    to_status: Mapped[str] = mapped_column(String(60), nullable=False)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")  # PENDING|APPROVED|REJECTED
    approver_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Deletion / Archive / Restore Standard (file 12 — D14). Separate from lifecycle `status`.
    # 5-value enum: ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED. Default ACTIVE.
    deletion_state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="'ACTIVE'")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Approval(Base):
    """SPEC §4.5 mandatory approval request. Append-only state machine.

    SPEC §4.5 lists 12 high-stakes business actions that MUST go through an approval
    workflow before they can execute: high discount, refund, credit note, invoice
    cancellation, service suspension, contract change, manual payment adjustment,
    customer deletion (soft-delete only), asset write-off, procurement, role permission
    change, and workflow override. This table is the canonical registry of those
    requests, separate from `pending_approval` (which is the M12 workflow-transition
    parking lot — see `PendingApproval` above).

    State machine:
        PENDING (default) -> APPROVED | REJECTED -> EXECUTED

    Transition rule: state only ever moves FORWARD. A PENDING row can be APPROVED or
    REJECTED exactly once (decide_approval refuses a second decision). An APPROVED row
    can be EXECUTED exactly once (mark_approval_executed refuses on non-APPROVED).

    Audit (SPEC §0.4 append-only): every state transition emits an Event via
    `workflow.emit`. The audit types are `create approval`, `update approval`,
    `execute approval` (verb-noun form to match the existing event vocabulary).

    target_entity_key + target_record_id are the OPTIONAL pointer to the thing being
    acted on (e.g. the invoice being cancelled, the service being suspended). They are
    NULL for action types that don't target a single record (e.g. a bulk procurement
    request that lists items in the payload).
    """
    __tablename__ = "approval"
    __table_args__ = (
        Index("ix_approval_tenant_status", "tenant_id", "status"),
        Index("ix_approval_target", "target_entity_key", "target_record_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    # SPEC §4.5 action types — see kernel.MANDATORY_APPROVAL_ACTIONS for the canonical set.
    action_type: Mapped[str] = mapped_column(String(60), nullable=False)
    target_entity_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    target_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")  # PENDING|APPROVED|REJECTED|EXECUTED|CANCELLED
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ── File 02 — Approval Ownership Standard extension ──────────────────────
    # ApprovalDecision (5-value enum, file 14): APPROVE | REJECT | REQUEST_CHANGES | DELEGATE
    # | CANCEL_REQUEST. Distinct from `status` (the lifecycle state). `decision` records
    # the SHAPE of the latest action by an approver; status records WHERE the row sits
    # in the lifecycle. All nullable — back-compat for rows created before this column.
    decision: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # When decision = DELEGATE, the user the request was forwarded to. The request stays
    # PENDING (status unchanged); delegated_to_user_id names the next eligible approver.
    delegated_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True
    )
    # When decision = REQUEST_CHANGES, the approver's note describing what the requester
    # must change before re-submitting. Request stays PENDING.
    change_request_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # File 02 §Digital Signature — opaque blob captured at decision/sign time. Method names
    # the auth mechanism (TOTP | DIGITAL_CERT | INLINE_PASSWORD | …); value is the verified
    # signature payload (token, cert thumbprint, hashed password proof). NULL = unsigned.
    signature_method: Mapped[str | None] = mapped_column(String(40), nullable=True)
    signature_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Deletion / Archive / Restore Standard (file 12 — D14). Separate from lifecycle `status`.
    # 5-value enum: ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED. Default ACTIVE.
    deletion_state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="'ACTIVE'")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
