"""Attachment Standard (file 04) — API routes.

Endpoints — all RLS tenant-scoped, permission-gated:

  POST   /api/{entityKey}/{id}/attachments          upload (multipart/form-data)
  GET    /api/{entityKey}/{id}/attachments          list attachments on an object
  GET    /api/attachments/{attachmentId}            read metadata
  GET    /api/attachments/{attachmentId}/download   download file bytes
  DELETE /api/attachments/{attachmentId}            soft delete
  POST   /api/attachments/{attachmentId}/reference  add reference from another object
  DELETE /api/attachments/{attachmentId}/references/{refId}  remove reference

Permission gate matrix (file 04 + file 15):
  attachment.upload       upload new files
  attachment.view         list/read metadata + non-deleted rows
  attachment.view_deleted metadata of deleted rows (tombstone visibility)
  attachment.download     stream/download file bytes
  attachment.delete       soft delete
  attachment.reference    add a reference from another object

Sensitive category downloads (IDENTITY_DOCUMENT, LEGAL_DOCUMENT, FINANCIAL_DOCUMENT,
CONTRACT) are audited — emits an attachment_downloaded event with the category.

Upload flow v1:
  Receive bytes → store via StorageBackend → write DB row (status=AVAILABLE,
  scan_result='SKIPPED'). Full async scan flow (UPLOADING → SCANNING → AVAILABLE |
  QUARANTINED) activates when a ScanBackend is wired (stub exists).

Blocked file types (file 04 — executables):
  EXE, BAT, CMD, JS, JSE, VBS, VBE, SCR, MSI, COM, PIF, HTA rejected at upload.

Max file size: settings.storage_max_file_bytes (default 100 MB).

Substrate emit (workflow.emit, pinned to owning object so timeline projects — B4):
  attachment_uploaded | attachment_downloaded (sensitive) | attachment_deleted |
  attachment_referenced | attachment_unreferenced
"""
from __future__ import annotations

import hashlib
import mimetypes
import pathlib
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..config import settings
from ..db import get_session
from ..models import Attachment, AttachmentReference
from ..models.attachment import SENSITIVE_CATEGORIES
from ..models.user import User
from ..services.storage import get_storage_backend, StorageError
from .auth import current_user

router = APIRouter(prefix="/api", tags=["attachments"])

# Blocked extensions — file 04: executables never allowed.
BLOCKED_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".js", ".jse", ".vbs", ".vbe",
    ".scr", ".msi", ".com", ".pif", ".hta",
}

VALID_CATEGORIES = {
    "DOCUMENT", "IMAGE", "PDF", "OFFICE_DOCUMENT", "TEXT_FILE", "LOG_FILE",
    "CONFIGURATION_FILE", "CONTRACT", "INVOICE", "IDENTITY_DOCUMENT",
    "PHOTO_EVIDENCE", "NETWORK_DIAGRAM", "SERVICE_PROOF", "LEGAL_DOCUMENT",
    "FINANCIAL_DOCUMENT", "OTHER",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(a: Attachment, include_storage_key: bool = False) -> dict:
    """Serialize metadata. storage_key never returned to callers (internal only)."""
    d = {
        "id": str(a.id),
        "ownerEntityType": a.owner_entity_type,
        "ownerEntityId": str(a.owner_entity_id),
        "fileName": a.file_name,
        "originalFileName": a.original_file_name,
        "fileExtension": a.file_extension,
        "mimeType": a.mime_type,
        "fileSize": a.file_size,
        "checksum": a.checksum,
        "category": a.category,
        "status": a.status,
        "scanResult": a.scan_result,
        "description": a.description,
        "previewAvailable": a.preview_available,
        "downloadCount": a.download_count,
        "lastDownloadedAt": a.last_downloaded_at.isoformat() if a.last_downloaded_at else None,
        "deletedAt": a.deleted_at.isoformat() if a.deleted_at else None,
        "deletedBy": str(a.deleted_by) if a.deleted_by else None,
        "createdAt": a.created_at.isoformat(),
        "createdBy": str(a.created_by),
    }
    return d


def _serialize_ref(r: AttachmentReference) -> dict:
    return {
        "id": str(r.id),
        "attachmentId": str(r.attachment_id),
        "refEntityType": r.ref_entity_type,
        "refEntityId": str(r.ref_entity_id),
        "createdAt": r.created_at.isoformat(),
        "createdBy": str(r.created_by),
    }


async def _get(s: AsyncSession, tenant_id, attachment_id: uuid.UUID) -> Attachment:
    a = (await s.execute(
        select(Attachment).where(
            Attachment.tenant_id == tenant_id,
            Attachment.id == attachment_id,
        )
    )).scalar_one_or_none()
    if a is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return a


# ── UPLOAD ────────────────────────────────────────────────────────────────────

@router.post("/{entity_key}/{parent_id}/attachments", status_code=201)
async def upload_attachment(
    entity_key: str,
    parent_id: uuid.UUID,
    file: UploadFile = File(...),
    category: str = Form(default="DOCUMENT"),
    description: Optional[str] = Form(default=None),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Upload a file and create an Attachment row.

    Multipart form-data: field `file` (required), `category` (optional, default DOCUMENT),
    `description` (optional).

    v1 flow: receive → validate → store → DB row (status=AVAILABLE, scan_result=SKIPPED).
    """
    grants = await load_grants(s, user)
    if not can(grants, "attachment", "upload"):
        raise HTTPException(status_code=403, detail="Access denied")

    # Validate category (rule 8 — no value outside enum).
    category = category.upper()
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"category must be one of {sorted(VALID_CATEGORIES)}")

    # Read bytes — enforce max size.
    file_bytes = await file.read()
    if len(file_bytes) > settings.storage_max_file_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {settings.storage_max_file_bytes // (1024*1024)} MB",
        )
    if not file_bytes:
        raise HTTPException(status_code=422, detail="File is empty")

    # Block executables (file 04).
    original_name = file.filename or "upload"
    ext = pathlib.Path(original_name).suffix.lower()
    if ext in BLOCKED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"File type {ext!r} is not allowed (executable)")

    mime = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    checksum = hashlib.sha256(file_bytes).hexdigest()
    attachment_id = uuid.UUID(str(__import__('app.utils.ids', fromlist=['uuid7']).uuid7() if False else __import__('uuid').uuid4()))
    # Use uuid7 properly
    from ..utils.ids import uuid7 as _uuid7
    attachment_id = _uuid7()

    # Store via backend.
    storage = get_storage_backend()
    try:
        stored = await storage.store(
            tenant_id=str(user.tenant_id),
            attachment_id=str(attachment_id),
            file_bytes=file_bytes,
            original_filename=original_name,
            mime_type=mime,
        )
    except StorageError as e:
        raise HTTPException(status_code=500, detail=f"Storage error: {e}")

    # Verify checksum matches what storage returned (defense-in-depth).
    if stored.checksum_sha256 != checksum:
        raise HTTPException(status_code=500, detail="Checksum mismatch after storage")

    system_name = f"{attachment_id}{ext}"
    a = Attachment(
        id=attachment_id,
        tenant_id=user.tenant_id,
        owner_entity_type=entity_key.lower(),
        owner_entity_id=parent_id,
        file_name=system_name,
        original_file_name=original_name,
        file_extension=ext,
        mime_type=mime,
        file_size=stored.size_bytes,
        checksum=checksum,
        storage_key=stored.storage_key,
        category=category,
        status="AVAILABLE",        # v1: skip scan
        scan_result="SKIPPED",
        description=description,
        created_by=user.id,
    )
    s.add(a)
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "attachment_uploaded", entity_key.lower(), parent_id, user.id,
        {"attachmentId": str(attachment_id), "fileName": original_name,
         "fileSize": stored.size_bytes, "category": category, "mimeType": mime},
        event_name="Attachment.Uploaded", category="ATTACHMENT",
    )
    return _serialize(a)


# ── LIST ──────────────────────────────────────────────────────────────────────

@router.get("/{entity_key}/{parent_id}/attachments")
async def list_attachments(
    entity_key: str,
    parent_id: uuid.UUID,
    include_deleted: bool = False,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "attachment", "view"):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(Attachment).where(
        Attachment.tenant_id == user.tenant_id,
        Attachment.owner_entity_type == entity_key.lower(),
        Attachment.owner_entity_id == parent_id,
    )
    if not include_deleted:
        q = q.where(Attachment.deleted_at.is_(None))
    elif not can(grants, "attachment", "view_deleted"):
        # can see list but not deleted — filter deleted without error
        q = q.where(Attachment.deleted_at.is_(None))

    q = q.order_by(Attachment.created_at)
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(a) for a in rows]


# ── READ METADATA ─────────────────────────────────────────────────────────────

@router.get("/attachments/{attachment_id}")
async def get_attachment(
    attachment_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "attachment", "view"):
        raise HTTPException(status_code=403, detail="Access denied")
    a = await _get(s, user.tenant_id, attachment_id)
    if a.deleted_at and not can(grants, "attachment", "view_deleted"):
        raise HTTPException(status_code=404, detail="Attachment not found")
    return _serialize(a)


# ── DOWNLOAD ──────────────────────────────────────────────────────────────────

@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Stream file bytes. Sensitive category downloads are audited."""
    grants = await load_grants(s, user)
    if not can(grants, "attachment", "download"):
        raise HTTPException(status_code=403, detail="Access denied")
    a = await _get(s, user.tenant_id, attachment_id)
    if a.deleted_at:
        raise HTTPException(status_code=410, detail="Attachment has been deleted")
    if a.status != "AVAILABLE":
        raise HTTPException(status_code=422, detail=f"Attachment is not available (status={a.status})")

    storage = get_storage_backend()
    try:
        file_bytes = await storage.retrieve(storage_key=a.storage_key)
    except StorageError as e:
        raise HTTPException(status_code=500, detail=f"Storage error: {e}")

    # Checksum verification on download (file 04 — integrity check).
    actual = hashlib.sha256(file_bytes).hexdigest()
    if actual != a.checksum:
        raise HTTPException(status_code=500, detail="File integrity check failed")

    # Update download stats.
    a.download_count += 1
    a.last_downloaded_at = _now()
    await s.flush()

    # Audit sensitive category downloads (file 04).
    is_sensitive = a.category in SENSITIVE_CATEGORIES
    await workflow.emit(
        s, user.tenant_id, "attachment_downloaded",
        a.owner_entity_type, a.owner_entity_id, user.id,
        {"attachmentId": str(a.id), "fileName": a.original_file_name,
         "category": a.category, "sensitive": is_sensitive},
        event_name="Attachment.Downloaded", category="ATTACHMENT",
        visibility="INTERNAL" if not is_sensitive else "RESTRICTED",
    )

    return Response(
        content=file_bytes,
        media_type=a.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{a.original_file_name}"'},
    )


# ── SOFT DELETE ───────────────────────────────────────────────────────────────

@router.delete("/attachments/{attachment_id}")
async def delete_attachment(
    attachment_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Soft delete — row stays, file stays in storage, metadata shows 'Attachment Deleted'."""
    grants = await load_grants(s, user)
    if not can(grants, "attachment", "delete"):
        raise HTTPException(status_code=403, detail="Access denied")
    a = await _get(s, user.tenant_id, attachment_id)
    if a.deleted_at:
        return _serialize(a)  # idempotent

    now = _now()
    a.deleted_at = now
    a.deleted_by = user.id
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "attachment_deleted",
        a.owner_entity_type, a.owner_entity_id, user.id,
        {"attachmentId": str(a.id), "fileName": a.original_file_name, "category": a.category},
        event_name="Attachment.Deleted", category="ATTACHMENT",
    )
    return _serialize(a)


# ── REFERENCE ─────────────────────────────────────────────────────────────────

@router.post("/attachments/{attachment_id}/reference", status_code=201)
async def add_reference(
    attachment_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Add a reference link from another object to this attachment (non-owner)."""
    grants = await load_grants(s, user)
    if not can(grants, "attachment", "reference"):
        raise HTTPException(status_code=403, detail="Access denied")
    a = await _get(s, user.tenant_id, attachment_id)
    if a.deleted_at:
        raise HTTPException(status_code=422, detail="Cannot reference a deleted attachment")

    ref_entity_type = (payload.get("refEntityType") or "").lower().strip()
    if not ref_entity_type:
        raise HTTPException(status_code=422, detail="refEntityType is required")
    try:
        ref_entity_id = uuid.UUID(str(payload.get("refEntityId")))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="refEntityId must be a UUID")

    # Idempotent — no duplicate references for (attachment, entity).
    existing = (await s.execute(
        select(AttachmentReference).where(
            AttachmentReference.tenant_id == user.tenant_id,
            AttachmentReference.attachment_id == attachment_id,
            AttachmentReference.ref_entity_type == ref_entity_type,
            AttachmentReference.ref_entity_id == ref_entity_id,
        )
    )).scalar_one_or_none()
    if existing:
        return _serialize_ref(existing)

    ref = AttachmentReference(
        tenant_id=user.tenant_id,
        attachment_id=attachment_id,
        ref_entity_type=ref_entity_type,
        ref_entity_id=ref_entity_id,
        created_by=user.id,
    )
    s.add(ref)
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "attachment_referenced",
        ref_entity_type, ref_entity_id, user.id,
        {"attachmentId": str(attachment_id), "ownerEntityType": a.owner_entity_type,
         "ownerEntityId": str(a.owner_entity_id)},
        event_name="Attachment.Referenced", category="ATTACHMENT",
    )
    return _serialize_ref(ref)


@router.delete("/attachments/{attachment_id}/references/{ref_id}")
async def remove_reference(
    attachment_id: uuid.UUID,
    ref_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "attachment", "reference"):
        raise HTTPException(status_code=403, detail="Access denied")
    ref = (await s.execute(
        select(AttachmentReference).where(
            AttachmentReference.tenant_id == user.tenant_id,
            AttachmentReference.id == ref_id,
            AttachmentReference.attachment_id == attachment_id,
        )
    )).scalar_one_or_none()
    if ref is None:
        raise HTTPException(status_code=404, detail="Reference not found")

    ref_type, ref_eid = ref.ref_entity_type, ref.ref_entity_id
    await s.delete(ref)
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "attachment_unreferenced",
        ref_type, ref_eid, user.id,
        {"attachmentId": str(attachment_id), "refId": str(ref_id)},
        event_name="Attachment.Unreferenced", category="ATTACHMENT",
    )
    return {"deleted": str(ref_id)}
