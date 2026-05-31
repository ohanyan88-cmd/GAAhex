"""Per-page presentation config — the "configure in place" store for BESPOKE pages.

A bespoke page (e.g. Services) keeps ALL of its hand-built data + tools; this layers a small
presentation descriptor on top: a title override and per-column controls (visible / label / order).
One row per (tenant, page_key); `config` is an open JSON blob so each page owns its own shape.

Tenant-scoped. READ is open to any authenticated tenant user (the view fetches + applies it on
every load). WRITE is gated on `config.manage` (super_admin's `*` covers it) — same gate as Studio
and the entity Configure drawer. Every write emits an audit Event through the usual chokepoint.

NOTE: fixed path under /api ("/api/page-config"), so register BEFORE records.router ("/api/{slug}").
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User
from ..models.page_config import PageConfig
from ..models.page_field_value import PageFieldValue
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
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="config_manage", entity_key="page_config",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


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


# -----------------------------------------------------------------------------
# Custom field VALUES — the per-row data for the custom fields a superadmin adds to a page.
#
# DEFINITIONS live in the page-config descriptor (config.customFields) and need no backend change
# (PUT above already accepts arbitrary config). These two endpoints store/return the VALUE each row
# carries for those fields, generically — so the page's hand-coded engine is never touched.
#
# READ is open to any authenticated tenant user. WRITE is open too: setting a field's value is a
# data edit, not a config change (config.manage gates the DEFS, not the data).
# -----------------------------------------------------------------------------
def _allowed_field_keys(config: dict | None) -> set[str] | None:
    """The set of declared customFields keys for the page, or None if we can't determine them
    (in which case we accept-and-store rather than reject)."""
    if not isinstance(config, dict):
        return None
    defs = config.get("customFields")
    if not isinstance(defs, list):
        return None
    keys = {str(d["key"]) for d in defs if isinstance(d, dict) and d.get("key")}
    return keys


@router.get("/{page_key}/values")
async def get_page_values(
    page_key: str,
    ids: str = Query("", description="comma-separated row ids to fetch values for"),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """The custom-field VALUES for the given page rows. Readable by any authenticated tenant user.

    Response: { "<row_id>": { "<field_key>": value, ... }, ... } — only rows that have values
    (missing rows are omitted). Empty `ids` ⇒ {}.
    """
    key = _norm_key(page_key)
    id_list = [r.strip() for r in ids.split(",") if r.strip()]
    if not id_list:
        return {}
    rows = (await s.execute(
        select(PageFieldValue).where(
            PageFieldValue.tenant_id == user.tenant_id,
            PageFieldValue.page_key == key,
            PageFieldValue.row_id.in_(id_list),
        )
    )).scalars().all()
    return {r.row_id: (r.data or {}) for r in rows}


@router.put("/{page_key}/values/{row_id}")
async def put_page_value(
    page_key: str,
    row_id: str,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Upsert one row's custom-field values. Writable by any authenticated tenant user (data edit).

    Request:  { "<field_key>": value, ... }  (the full data map for the row; replaces prior value)
    Response: { "row_id", "data" }

    field_keys are validated against the page's `customFields` defs when those defs can be loaded;
    unknown keys are dropped. If no defs are saved yet, values are accepted and stored as-is.
    """
    key = _norm_key(page_key)
    rid = (row_id or "").strip()
    if not rid:
        raise HTTPException(422, "row_id is required")
    if len(rid) > 255:
        raise HTTPException(422, "row_id too long")
    if not isinstance(payload, dict):
        raise HTTPException(422, "body must be an object of {field_key: value}")

    # SPEC §0.2 default-deny (Step 7.2) — kernel gate before mutation. Page field VALUES are data
    # edits (not config) — gated on edit for the page_field_value entity.
    try:
        await assert_can(s, user, action="edit", entity_key="page_field_value",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # Validate against the page's declared custom fields if we can load them (else accept-and-store).
    cfg_row = (await s.execute(
        select(PageConfig).where(PageConfig.tenant_id == user.tenant_id, PageConfig.page_key == key)
    )).scalar_one_or_none()
    allowed = _allowed_field_keys(cfg_row.config if cfg_row else None)
    data = {k: v for k, v in payload.items() if allowed is None or k in allowed}

    row = (await s.execute(
        select(PageFieldValue).where(
            PageFieldValue.tenant_id == user.tenant_id,
            PageFieldValue.page_key == key,
            PageFieldValue.row_id == rid,
        )
    )).scalar_one_or_none()

    if row is None:
        row = PageFieldValue(tenant_id=user.tenant_id, page_key=key, row_id=rid, data=data)
        s.add(row)
        verb = "create"
    else:
        row.data = data
        verb = "update"

    await workflow.emit(s, user.tenant_id, verb, "page_field_value", row.id, user.id, {"page_key": key, "row_id": rid})
    await s.commit()
    # Same RLS constraint as above — do NOT s.refresh(); return the values we hold.
    return {"row_id": rid, "data": data}
