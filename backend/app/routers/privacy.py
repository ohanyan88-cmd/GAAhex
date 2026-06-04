"""GDPR privacy router — Article 15 (access) + Article 17 (erasure) request workflow.

Endpoints — all RLS tenant-scoped, all permission-gated:

  POST   /api/privacy/access-request                  create ACCESS request   (privacy.request)
  POST   /api/privacy/erasure-request                 create ERASURE request  (privacy.request)
  POST   /api/privacy/requests/{req_id}/approve       REQUESTED → APPROVED    (privacy.approve)
  POST   /api/privacy/requests/{req_id}/reject        REQUESTED → REJECTED    (privacy.approve)
  POST   /api/privacy/requests/{req_id}/complete      APPROVED  → COMPLETED   (privacy.complete)
  GET    /api/privacy/requests                        list this-tenant requests (privacy.request)
  GET    /api/privacy/requests/{req_id}               read one request          (privacy.request)

Permission keys (file 15 — registered later by Loj; this router only USES them):

  privacy.request    create / list / read — any authenticated staff seat can record a request
                     on behalf of a data subject (M1 staff-mediated; M2 will add a portal-direct
                     path that uses the same permission key under the CUSTOMER actor_type).
  privacy.approve    approve / reject — DPO / privacy officer seat.
  privacy.complete   complete — DPO seat. Holding `complete` does NOT automatically grant
                     `approve` — the two-person rule is intentional (file 15 separation-of-duty).

Substrate emit — pinned to the PrivacyRequest row itself (entity_key='privacy_request') so its
own audit timeline carries the full lifecycle, AND mirrored to the customer Record on COMPLETED
so the customer's timeline shows the erasure / export event:

  PRIVACY_REQUEST_CREATED       on create
  PRIVACY_REQUEST_APPROVED      on approve
  PRIVACY_REQUEST_REJECTED      on reject
  PRIVACY_REQUEST_COMPLETED     on complete (with action summary in data)
  CUSTOMER_PURGED_PII_ANONYMIZED  mirrored to the customer Record on ERASURE completion

Response shape — camelCase wire form per the 2026-06-02 spec amendment.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models import PrivacyRequest
from ..models.user import User
from ..services.privacy import build_access_export, anonymize_customer
from .auth import current_user


router = APIRouter(prefix="/api/privacy", tags=["privacy"])


# Status enum — kept in lockstep with the model docstring.
REQUESTED = "REQUESTED"
APPROVED = "APPROVED"
REJECTED = "REJECTED"
COMPLETED = "COMPLETED"

ACCESS = "ACCESS"
ERASURE = "ERASURE"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(pr: PrivacyRequest) -> dict:
    """PrivacyRequest → camelCase response shape."""
    return {
        "id": str(pr.id),
        "tenantId": str(pr.tenant_id),
        "requestorUserId": str(pr.requestor_user_id),
        "requestType": pr.request_type,
        "customerRecordId": str(pr.customer_record_id),
        "status": pr.status,
        "reason": pr.reason,
        "approverUserId": str(pr.approver_user_id) if pr.approver_user_id else None,
        "approvedAt": pr.approved_at.isoformat() if pr.approved_at else None,
        "completedAt": pr.completed_at.isoformat() if pr.completed_at else None,
        "exportStorageKey": pr.export_storage_key,
        "createdAt": pr.created_at.isoformat() if pr.created_at else None,
    }


async def _load(s: AsyncSession, tenant_id: uuid.UUID, req_id: uuid.UUID) -> PrivacyRequest:
    """Tenant-scoped load by id, or 404. Mirrors the lifecycle router's _load pattern."""
    row = (await s.execute(
        select(PrivacyRequest).where(
            PrivacyRequest.tenant_id == tenant_id,
            PrivacyRequest.id == req_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Privacy request not found")
    return row


def _require_uuid(payload: dict | None, key: str) -> uuid.UUID:
    """Pull `key` from payload as a UUID, or 422. Used for create endpoints."""
    if not payload or key not in payload:
        raise HTTPException(status_code=422, detail=f"Missing required field: {key}")
    try:
        return uuid.UUID(str(payload[key]))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"Field {key!r} must be a UUID")


async def _create_request(
    *,
    request_type: str,
    payload: dict | None,
    user: User,
    s: AsyncSession,
) -> dict:
    """Shared create path for ACCESS + ERASURE — same shape, different request_type."""
    grants = await load_grants(s, user)
    if not can(grants, "privacy", "request"):
        raise HTTPException(status_code=403, detail="Access denied")

    customer_id = _require_uuid(payload, "customerRecordId")
    reason = (payload or {}).get("reason") or None

    pr = PrivacyRequest(
        tenant_id=user.tenant_id,
        requestor_user_id=user.id,
        request_type=request_type,
        customer_record_id=customer_id,
        status=REQUESTED,
        reason=reason,
    )
    s.add(pr)
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "PRIVACY_REQUEST_CREATED", "privacy_request", pr.id, user.id,
        {
            "requestType": request_type,
            "customerRecordId": str(customer_id),
            "reason": reason,
        },
        event_name="PrivacyRequest.Created",
        category="SECURITY",
    )
    return _serialize(pr)


# ──────────────────────────────────────────────────────────────────────────────
# CREATE — access + erasure
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/access-request", status_code=201)
async def create_access_request(
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """GDPR Article 15 right-to-access request. Body: {customerRecordId, reason?}."""
    return await _create_request(request_type=ACCESS, payload=payload, user=user, s=s)


@router.post("/erasure-request", status_code=201)
async def create_erasure_request(
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """GDPR Article 17 right-to-erasure request. Body: {customerRecordId, reason?}."""
    return await _create_request(request_type=ERASURE, payload=payload, user=user, s=s)


# ──────────────────────────────────────────────────────────────────────────────
# APPROVE / REJECT
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/requests/{req_id}/approve")
async def approve_request(
    req_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """REQUESTED → APPROVED. Permission: privacy.approve. Idempotent on APPROVED."""
    grants = await load_grants(s, user)
    if not can(grants, "privacy", "approve"):
        raise HTTPException(status_code=403, detail="Access denied")
    pr = await _load(s, user.tenant_id, req_id)

    if pr.status == APPROVED:
        return _serialize(pr)  # idempotent
    if pr.status != REQUESTED:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot approve from status={pr.status}",
        )

    pr.status = APPROVED
    pr.approver_user_id = user.id
    pr.approved_at = _now()
    note = (payload or {}).get("reason")
    if note:
        pr.reason = note
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "PRIVACY_REQUEST_APPROVED", "privacy_request", pr.id, user.id,
        {"requestType": pr.request_type, "customerRecordId": str(pr.customer_record_id)},
        event_name="PrivacyRequest.Approved",
        category="SECURITY",
    )
    return _serialize(pr)


@router.post("/requests/{req_id}/reject")
async def reject_request(
    req_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """REQUESTED → REJECTED. Permission: privacy.approve (same seat that can approve can reject)."""
    grants = await load_grants(s, user)
    if not can(grants, "privacy", "approve"):
        raise HTTPException(status_code=403, detail="Access denied")
    pr = await _load(s, user.tenant_id, req_id)

    if pr.status == REJECTED:
        return _serialize(pr)  # idempotent
    if pr.status != REQUESTED:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot reject from status={pr.status}",
        )

    pr.status = REJECTED
    pr.approver_user_id = user.id
    pr.approved_at = _now()  # decision_at, semantically — reused for the decision timestamp
    note = (payload or {}).get("reason")
    if note:
        pr.reason = note
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "PRIVACY_REQUEST_REJECTED", "privacy_request", pr.id, user.id,
        {
            "requestType": pr.request_type,
            "customerRecordId": str(pr.customer_record_id),
            "reason": note,
        },
        event_name="PrivacyRequest.Rejected",
        category="SECURITY",
    )
    return _serialize(pr)


# ──────────────────────────────────────────────────────────────────────────────
# COMPLETE — do the actual work (ACCESS export or ERASURE anonymization)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/requests/{req_id}/complete")
async def complete_request(
    req_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """APPROVED → COMPLETED. Permission: privacy.complete (separate from approve, two-person rule).

    For ACCESS: builds the export inline and returns it on the response. M1 stores nothing
    server-side beyond the audit event + the request row; M2 will lift the payload to object
    storage and only return `exportStorageKey`. For now the export is small (one customer + their
    money rows + audit) — well under any reasonable response-size cap.

    For ERASURE: redacts PII on the customer Record + linked CustomerUser. Financial documents
    are preserved per Article 17 financial-retention exception. Returns the redacted-fields summary.
    """
    grants = await load_grants(s, user)
    if not can(grants, "privacy", "complete"):
        raise HTTPException(status_code=403, detail="Access denied")
    pr = await _load(s, user.tenant_id, req_id)

    if pr.status == COMPLETED:
        return _serialize(pr)  # idempotent terminal
    if pr.status != APPROVED:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot complete from status={pr.status} (must be APPROVED)",
        )

    result: dict
    if pr.request_type == ACCESS:
        try:
            result = await build_access_export(s, user.tenant_id, pr.customer_record_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    elif pr.request_type == ERASURE:
        try:
            result = await anonymize_customer(s, user.tenant_id, pr.customer_record_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        # Mirror the anonymization event to the customer Record's own timeline so a future
        # legitimate access request (re-asked by the subject) sees the erasure on the record.
        await workflow.emit(
            s, user.tenant_id, "CUSTOMER_PURGED_PII_ANONYMIZED", "customer",
            pr.customer_record_id, user.id,
            {
                "privacyRequestId": str(pr.id),
                "redactedFields": result.get("redacted_fields", []),
            },
            event_name="Customer.PiiAnonymized",
            category="SECURITY",
        )
    else:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown request_type={pr.request_type}",
        )

    pr.status = COMPLETED
    pr.completed_at = _now()
    await s.flush()

    # The completion event captures the summary (NOT the full export — that would put PII in
    # the audit log, defeating the whole point). For ACCESS we record what was generated; for
    # ERASURE we record the redacted_fields list.
    completion_summary: dict
    if pr.request_type == ACCESS:
        completion_summary = {
            "requestType": ACCESS,
            "customerRecordId": str(pr.customer_record_id),
            "rowCounts": {
                "subscriptions": len(result.get("subscriptions", [])),
                "invoices": len(result.get("invoices", [])),
                "payments": len(result.get("payments", [])),
                "communications": len(result.get("communications", [])),
                "auditEvents": len(result.get("audit_events", [])),
            },
        }
    else:
        completion_summary = {
            "requestType": ERASURE,
            "customerRecordId": str(pr.customer_record_id),
            "redactedFields": result.get("redacted_fields", []),
        }

    await workflow.emit(
        s, user.tenant_id, "PRIVACY_REQUEST_COMPLETED", "privacy_request", pr.id, user.id,
        completion_summary,
        event_name="PrivacyRequest.Completed",
        category="SECURITY",
    )

    return {
        **_serialize(pr),
        "result": result,
    }


# ──────────────────────────────────────────────────────────────────────────────
# LIST + READ
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/requests")
async def list_requests(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List PrivacyRequest rows in the caller's tenant (RLS-scoped). Permission: privacy.request."""
    grants = await load_grants(s, user)
    if not can(grants, "privacy", "request"):
        raise HTTPException(status_code=403, detail="Access denied")
    rows = (await s.execute(
        select(PrivacyRequest)
        .where(PrivacyRequest.tenant_id == user.tenant_id)
        .order_by(PrivacyRequest.created_at.desc())
    )).scalars().all()
    return {"items": [_serialize(r) for r in rows]}


@router.get("/requests/{req_id}")
async def get_request(
    req_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Read a single PrivacyRequest row. Permission: privacy.request."""
    grants = await load_grants(s, user)
    if not can(grants, "privacy", "request"):
        raise HTTPException(status_code=403, detail="Access denied")
    pr = await _load(s, user.tenant_id, req_id)
    return _serialize(pr)
