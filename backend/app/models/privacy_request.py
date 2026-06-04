"""PrivacyRequest — GDPR Article 15 (right-to-access) + Article 17 (right-to-erasure) tracking.

C2/C3 of the 2026-06-04 audit flagged the platform as having zero infrastructure for the two
GDPR data-subject rights an ISP customer can exercise. This model is the workflow row that
records EACH request, its approver, and (for ACCESS) the eventual export storage key.

Lifecycle (router-enforced; no GXL workflow yet — kept deliberately simple so legal-counsel
review at M1 close can shape the final state machine without code rewrites):

    REQUESTED → APPROVED → COMPLETED       (terminal happy path)
    REQUESTED → REJECTED                   (terminal sad path)

Status transitions are gated by permission strings (privacy.request / privacy.approve /
privacy.complete) — privacy.request defaults to any authenticated user (subject can act on
their own behalf via a portal in M2), the latter two are admin-scoped per file 15.

Note: NO `phone` on this row. The PII lives on the customer Record (data.email, data.phone,
data.name) and on the linked CustomerUser portal-login row — `customer_record_id` is the
single pointer the service uses to load + redact both."""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Text, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PrivacyRequest(Base):
    """GDPR Article 15 (access) / Article 17 (erasure) request tracking. Tenant-scoped."""
    __tablename__ = "privacy_request"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )

    # Who is asking. For staff-initiated requests this is the staff user. For
    # subject-initiated requests (portal-driven) this is the staff user who recorded the
    # ask on behalf of the data subject in M1; in M2 portal-direct, this can be NULL +
    # the actor_type on the audit Event distinguishes CUSTOMER from USER.
    requestor_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False,
    )

    # ACCESS (Article 15) or ERASURE (Article 17). UPPER_SNAKE_CASE per B1.
    request_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # The customer Record (entity_key='customer') the request operates against. No FK at
    # the DB layer — this MAY point to a row that has been PURGED + anonymized by a prior
    # erasure; preserving the audit trail per Article 17 financial-retention exception is
    # the whole point, and a strict FK would block the legitimate "subject re-requests
    # access to their now-anonymized record" follow-up. Indexed for the per-customer query.
    customer_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True,
    )

    # REQUESTED | APPROVED | REJECTED | COMPLETED. UPPER_SNAKE per B1.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="REQUESTED")

    # Optional free-text reason — captured at create (subject's stated reason) and at
    # approve/reject (operator's note). Both edit paths overwrite — single field, latest wins.
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    approver_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ACCESS request: where the JSON export was stored (object-storage key when M1-storage
    # lands; for now responses inline the small payload). ERASURE: NULL — the redacted_fields
    # summary lives on the COMPLETED Event's data payload.
    export_storage_key: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
