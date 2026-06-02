"""Attachment Standard (file 04) — first-class attachment entity.

Attachments are secured evidence, not file fields. Governed with id, owner, metadata,
security, audit, timeline, permissions, retention. This module is additive — it does
not replace or modify the existing avatar_url / logo_url base64 data fields on User
and Tenant (those are convenience fields for small images, not file management).

Key design decisions:
  - Files live in object storage (StorageBackend Protocol); DB stores metadata only.
  - storageKey is a system-generated UUID-based path; never the original filename.
  - SHA-256 checksum stored at upload time; compared on download to detect corruption.
  - Soft delete only: deleted rows remain in DB, GET returns "Attachment Deleted".
  - No versioning: each upload is a separate Attachment row.
  - ownerEntityType + ownerEntityId = polymorphic primary owner (Approval precedent).
    Exactly ONE primary owner; may be referenced by others via AttachmentReference rows.
  - Upload flow: UPLOADING → AVAILABLE (v1 skips SCANNING; scan stub is a future add).
    Full flow per spec: UPLOADING → SCANNING → AVAILABLE | QUARANTINED.
  - Sensitive categories (IDENTITY_DOCUMENT, LEGAL_DOCUMENT, FINANCIAL_DOCUMENT, CONTRACT)
    require stricter attachment.view_deleted permission and are audited on download.
  - No per-attachment hold column — central Legal Hold registry (Data Retention Standard).

Scan stub (v1):
  SCAN_QUARANTINED / SCAN_FAILED / SCAN_AVAILABLE transition is defined in the model and
  migration but the actual ClamAV / cloud-scan call is a future addition. The router
  moves UPLOADING → AVAILABLE directly in v1 with a scan_result='SKIPPED' marker.
  The ScanBackend Protocol stub is ready for a real scanner to be plugged in.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, BigInteger, Boolean, ForeignKey, DateTime, Text, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


# Sensitive categories that require stricter permissions (file 04).
SENSITIVE_CATEGORIES = frozenset({
    "IDENTITY_DOCUMENT", "LEGAL_DOCUMENT", "FINANCIAL_DOCUMENT", "CONTRACT",
})


class Attachment(Base):
    """A first-class file attachment (file 04 — Attachment Standard).

    16-value category enum (file 14 AttachmentCategory):
      DOCUMENT, IMAGE, PDF, OFFICE_DOCUMENT, TEXT_FILE, LOG_FILE,
      CONFIGURATION_FILE, CONTRACT, INVOICE, IDENTITY_DOCUMENT, PHOTO_EVIDENCE,
      NETWORK_DIAGRAM, SERVICE_PROOF, LEGAL_DOCUMENT, FINANCIAL_DOCUMENT, OTHER.

    6-value status enum (file 14 AttachmentStatus):
      UPLOADING, SCANNING, AVAILABLE, QUARANTINED, DELETED, FAILED.

    Upload flow v1: UPLOADING → AVAILABLE (scan_result='SKIPPED').
    Full flow: UPLOADING → SCANNING → AVAILABLE | QUARANTINED.
    """
    __tablename__ = "attachment"
    __table_args__ = (
        # "All attachments on this customer/ticket/task"
        Index("ix_attachment_owner", "tenant_id", "owner_entity_type", "owner_entity_id"),
        # Status sweep (e.g. find all SCANNING rows for the scan job)
        Index("ix_attachment_status", "tenant_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)

    # Polymorphic primary owner (Approval / Comment precedent — no FK, indexed).
    # Exactly ONE primary owner per spec (cannot be moved).
    owner_entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    owner_entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # File metadata (file 04 stored fields).
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)           # system storage name
    original_file_name: Mapped[str] = mapped_column(String(255), nullable=False)  # preserved original
    file_extension: Mapped[str] = mapped_column(String(20), nullable=False)       # lowercase: ".pdf"
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)            # bytes
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)             # SHA-256 hex

    # Storage reference — system-generated key in the StorageBackend (never the filename).
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)

    # Category (16-value enum, file 14). Sensitive subset requires stricter perms.
    category: Mapped[str] = mapped_column(String(30), nullable=False, default="DOCUMENT")

    # Status (6-value enum, file 14).
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="UPLOADING")

    # Scan metadata (v1: SKIPPED; future: real scan result).
    scan_result: Mapped[str | None] = mapped_column(String(20), nullable=True)     # CLEAN|INFECTED|SKIPPED
    scan_provider: Mapped[str | None] = mapped_column(String(80), nullable=True)
    scan_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Optional metadata.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    preview_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    download_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    last_downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Soft delete.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)


class AttachmentReference(Base):
    """A non-owner reference link: a second object references an existing Attachment.

    The primary owner never changes. References are soft-delete too (remove the row).
    Unique on (tenant_id, attachment_id, ref_entity_type, ref_entity_id) so an object
    can't reference the same attachment twice.

    Permission: attachment.reference to create; attachment.view to read.
    """
    __tablename__ = "attachment_reference"
    __table_args__ = (
        Index("ix_attachment_ref_attachment", "attachment_id"),
        Index("ix_attachment_ref_entity", "tenant_id", "ref_entity_type", "ref_entity_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    attachment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("attachment.id"), nullable=False)
    ref_entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    ref_entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
