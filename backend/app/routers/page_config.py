"""Per-page presentation config — the "configure in place" store for BESPOKE pages.

A bespoke page (e.g. Services) keeps ALL of its hand-built data + tools; this layers a small
presentation descriptor on top: a title override and per-column controls (visible / label / order).
One row per (tenant, page_key); `config` is an open JSON blob so each page owns its own shape.

Tenant-scoped. READ is open to any authenticated tenant user (the view fetches + applies it on
every load). WRITE is gated on `config.manage` (super_admin's `*` covers it) — same gate as Studio
and the entity Configure drawer. Every write emits an audit Event through the usual chokepoint.

NOTE: fixed path under /api ("/api/page-config"), so register BEFORE records.router ("/api/{slug}").
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.page_config import PageConfig
from ..access import load_grants, can
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api/page-config", tags=["page-config"])

# Known bespoke page keys. Kept permissive (any non-empty key is accepted) so adopting the
# mechanism on another bespoke view needs no backend change — this set is just for documentation
# and a light guard against typos in the MVP.
KNOWN_PAGE_KEYS = {"services"}


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")


def _norm_key(page_key: str) -> str:
    key = (page_key or "").strip().lower()
    if not key:
        raise HTTPException(422, "page_key is required")
    if len(key) > 80:
        raise HTTPException(422, "page_key too long")
    return key


@router.get("/{page_key}")
async def get_page_config(page_key: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The presentation descriptor for one page. Readable by any authenticated tenant user.

    Response: {page_key, config} — config is {} when nothing has been saved (⇒ page defaults).
    """
    key = _norm_key(page_key)
    row = (await s.execute(
        select(PageConfig).where(PageConfig.tenant_id == user.tenant_id, PageConfig.page_key == key)
    )).scalar_one_or_none()
    return {"page_key": key, "config": (row.config if row else {})}


@router.put("/{page_key}")
async def put_page_config(page_key: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create-or-replace the descriptor for one page. Gated on config.manage; emits an audit Event.

    Request:  {config: {...}}  (the full descriptor; replaces any prior value)
    Response: {page_key, config}
    """
    await _require_config_manage(s, user)
    key = _norm_key(page_key)

    config = payload.get("config")
    if not isinstance(config, dict):
        raise HTTPException(422, "config must be an object")

    row = (await s.execute(
        select(PageConfig).where(PageConfig.tenant_id == user.tenant_id, PageConfig.page_key == key)
    )).scalar_one_or_none()

    if row is None:
        row = PageConfig(tenant_id=user.tenant_id, page_key=key, config=config)
        s.add(row)
        verb = "create"
    else:
        row.config = config
        verb = "update"

    await workflow.emit(s, user.tenant_id, verb, "page_config", row.id, user.id, {"page_key": key})
    await s.commit()
    # The committed row's attributes are expired; a post-commit s.refresh() fails under the RLS
    # app role ("Could not refresh instance") — same family as the records create fix. We already
    # hold the saved values, so return them directly.
    return {"page_key": key, "config": config}
