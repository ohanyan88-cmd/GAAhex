"""Studio page versioning — create/list pages and their snapshots, publish, rollback, diff.

All endpoints are gated on `config.manage` (SuperAdmin-tier), the same permission used by
the other Studio routers (roles.py, automations.py, etc.).

Routes are under /api/studio/pages so they are fixed paths that must be registered BEFORE
the catch-all /api/{slug} records router.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.studio_page import StudioPage, StudioPageVersion
from ..access import load_grants, can
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api/studio/pages", tags=["studio-pages"])


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

async def _require_config_manage(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed: config.manage")


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------

def _page_out(page: StudioPage, published_snapshot: dict | None = None) -> dict[str, Any]:
    return {
        "id": str(page.id),
        "tenant_id": str(page.tenant_id),
        "key": page.key,
        "label": page.label,
        "created_at": page.created_at.isoformat() if page.created_at else None,
        "published_snapshot": published_snapshot,
    }


def _version_out(v: StudioPageVersion) -> dict[str, Any]:
    return {
        "id": str(v.id),
        "tenant_id": str(v.tenant_id),
        "page_id": str(v.page_id),
        "version_no": v.version_no,
        "author_user_id": str(v.author_user_id) if v.author_user_id else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "status": v.status,
        "snapshot": v.snapshot,
        "diff": v.diff,
    }


# ---------------------------------------------------------------------------
# Diff helper
# ---------------------------------------------------------------------------

def _compute_diff(old_snapshot: dict, new_snapshot: dict) -> dict:
    """Top-level key diff between two snapshot dicts."""
    old_keys = set(old_snapshot.keys())
    new_keys = set(new_snapshot.keys())

    added = sorted(new_keys - old_keys)
    removed = sorted(old_keys - new_keys)
    changed = sorted(
        k for k in (old_keys & new_keys)
        if old_snapshot[k] != new_snapshot[k]
    )
    return {"added": added, "changed": changed, "removed": removed}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_page(s: AsyncSession, tenant_id: uuid.UUID, page_id: uuid.UUID) -> StudioPage:
    page = (await s.execute(
        select(StudioPage).where(StudioPage.tenant_id == tenant_id, StudioPage.id == page_id)
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, f"Page '{page_id}' not found")
    return page


async def _get_version(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    page_id: uuid.UUID,
    version_id: uuid.UUID,
) -> StudioPageVersion:
    v = (await s.execute(
        select(StudioPageVersion).where(
            StudioPageVersion.tenant_id == tenant_id,
            StudioPageVersion.page_id == page_id,
            StudioPageVersion.id == version_id,
        )
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(404, f"Version '{version_id}' not found")
    return v


async def _next_version_no(s: AsyncSession, tenant_id: uuid.UUID, page_id: uuid.UUID) -> int:
    max_no = (await s.execute(
        select(func.max(StudioPageVersion.version_no)).where(
            StudioPageVersion.tenant_id == tenant_id,
            StudioPageVersion.page_id == page_id,
        )
    )).scalar_one_or_none()
    return (max_no or 0) + 1


async def _current_published(
    s: AsyncSession, tenant_id: uuid.UUID, page_id: uuid.UUID
) -> StudioPageVersion | None:
    return (await s.execute(
        select(StudioPageVersion).where(
            StudioPageVersion.tenant_id == tenant_id,
            StudioPageVersion.page_id == page_id,
            StudioPageVersion.status == "published",
        )
    )).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_page(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a new Studio page definition.

    Request: {key: str (slug), label: str}
    Response: StudioPage (no published_snapshot yet)
    """
    await _require_config_manage(s, user)

    key = (payload.get("key") or "").strip()
    label = (payload.get("label") or "").strip()
    if not key or not label:
        raise HTTPException(422, "key and label are required")

    clash = (await s.execute(
        select(StudioPage).where(StudioPage.tenant_id == user.tenant_id, StudioPage.key == key)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"A page with key '{key}' already exists")

    page = StudioPage(tenant_id=user.tenant_id, key=key, label=label)
    s.add(page)
    await s.commit()
    await s.refresh(page)
    return _page_out(page)


@router.get("")
async def list_pages(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List all Studio pages for the tenant."""
    await _require_config_manage(s, user)

    pages = (await s.execute(
        select(StudioPage).where(StudioPage.tenant_id == user.tenant_id).order_by(StudioPage.key)
    )).scalars().all()
    return [_page_out(p) for p in pages]


@router.get("/{page_id}")
async def get_page(
    page_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Get a page and its current published snapshot (null if none published yet)."""
    await _require_config_manage(s, user)

    page = await _get_page(s, user.tenant_id, page_id)
    pub = await _current_published(s, user.tenant_id, page_id)
    return _page_out(page, published_snapshot=pub.snapshot if pub else None)


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

@router.post("/{page_id}/versions", status_code=201)
async def save_draft(
    page_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Save a new draft snapshot for a page.

    Request: {snapshot: {...}}
    Response: StudioPageVersion with status='draft'
    """
    await _require_config_manage(s, user)
    await _get_page(s, user.tenant_id, page_id)   # ensures page exists + belongs to tenant

    snapshot = payload.get("snapshot")
    if snapshot is None or not isinstance(snapshot, dict):
        raise HTTPException(422, "snapshot must be a JSON object")

    version_no = await _next_version_no(s, user.tenant_id, page_id)
    v = StudioPageVersion(
        tenant_id=user.tenant_id,
        page_id=page_id,
        version_no=version_no,
        author_user_id=user.id,
        status="draft",
        snapshot=snapshot,
        diff=None,
    )
    s.add(v)
    await s.commit()
    await s.refresh(v)
    return _version_out(v)


@router.get("/{page_id}/versions")
async def list_versions(
    page_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List all versions for a page, sorted by version_no descending."""
    await _require_config_manage(s, user)
    await _get_page(s, user.tenant_id, page_id)

    versions = (await s.execute(
        select(StudioPageVersion).where(
            StudioPageVersion.tenant_id == user.tenant_id,
            StudioPageVersion.page_id == page_id,
        ).order_by(StudioPageVersion.version_no.desc())
    )).scalars().all()
    return [_version_out(v) for v in versions]


# ---------------------------------------------------------------------------
# Publish / Rollback (shared logic)
# ---------------------------------------------------------------------------

async def _do_publish(
    s: AsyncSession,
    user: User,
    page_id: uuid.UUID,
    version_id: uuid.UUID,
    audit_type: str,
) -> dict:
    """Core publish logic used by both publish and rollback endpoints."""
    await _get_page(s, user.tenant_id, page_id)
    target = await _get_version(s, user.tenant_id, page_id, version_id)

    # Find the currently published version (to compute diff and demote it)
    prev_pub = await _current_published(s, user.tenant_id, page_id)

    # Compute diff vs previous published snapshot
    diff: dict | None = None
    if prev_pub is not None and prev_pub.id != target.id:
        diff = _compute_diff(prev_pub.snapshot, target.snapshot)
    elif prev_pub is None:
        # First publish — no prior published version to diff against
        diff = None

    # Demote ALL currently-published versions for this page to draft FIRST,
    # then flush so the partial unique index constraint is satisfied before we promote.
    all_versions = (await s.execute(
        select(StudioPageVersion).where(
            StudioPageVersion.tenant_id == user.tenant_id,
            StudioPageVersion.page_id == page_id,
        )
    )).scalars().all()
    for v in all_versions:
        if v.id != target.id and v.status == "published":
            v.status = "draft"

    # Flush the demotions so the partial unique index slot is freed before we claim it.
    await s.flush()

    # Promote target
    target.status = "published"
    target.diff = diff

    # Emit audit event
    await workflow.emit(
        s,
        user.tenant_id,
        audit_type,
        "studio_page",
        page_id,
        user.id,
        {"version_no": target.version_no, "author": str(user.id)},
    )

    await s.commit()
    await s.refresh(target)
    return _version_out(target)


@router.post("/{page_id}/versions/{version_id}/publish")
async def publish_version(
    page_id: uuid.UUID,
    version_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Publish a draft version. All other versions for this page become drafts.
    Computes diff vs previously published snapshot and writes it. Emits publish audit event."""
    await _require_config_manage(s, user)
    return await _do_publish(s, user, page_id, version_id, "publish")


@router.post("/{page_id}/versions/{version_id}/rollback")
async def rollback_version(
    page_id: uuid.UUID,
    version_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Roll back to a previous version (semantically identical to publish, different audit label).
    Emits rollback audit event."""
    await _require_config_manage(s, user)
    return await _do_publish(s, user, page_id, version_id, "rollback")


# ---------------------------------------------------------------------------
# Diff
# ---------------------------------------------------------------------------

@router.get("/{page_id}/versions/{version_id}/diff")
async def get_version_diff(
    page_id: uuid.UUID,
    version_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Return the stored diff for a version, or compute it on-the-fly if null.

    The on-the-fly computation diffs against the immediately preceding version by version_no.
    Returns {added, changed, removed} at top-level snapshot keys.
    """
    await _require_config_manage(s, user)
    await _get_page(s, user.tenant_id, page_id)
    v = await _get_version(s, user.tenant_id, page_id, version_id)

    if v.diff is not None:
        return v.diff

    # Compute on-the-fly against the previous version (by version_no)
    prev = (await s.execute(
        select(StudioPageVersion).where(
            StudioPageVersion.tenant_id == user.tenant_id,
            StudioPageVersion.page_id == page_id,
            StudioPageVersion.version_no < v.version_no,
        ).order_by(StudioPageVersion.version_no.desc()).limit(1)
    )).scalar_one_or_none()

    if prev is None:
        return {"added": [], "changed": [], "removed": []}

    return _compute_diff(prev.snapshot, v.snapshot)
