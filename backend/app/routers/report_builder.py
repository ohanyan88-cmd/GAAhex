"""Report builder (H71) — saved reports on the existing aggregation engine.

A ReportDef is a named, re-runnable aggregation. It uses the SAME `query` shape as a dashboard
widget ({entity, metric, field?, group_by?, filter?, columns?}) and is computed by the SAME engine
(dashboards._compute) with the SAME org-scope filtering as reports.py — so saved reports and
dashboard widgets fully interoperate. Read/compute is fail-soft; saving needs only `{entity}.view`.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import EntityDef, Record, User
from ..models.report import ReportDef
from ..access import load_grants, can
from ..gxl import evaluate
from .auth import current_user
# build ON the existing aggregation — reuse, don't reinvent
from .dashboards import _node_paths, _record_path, _filter_context, _compute, ALLOWED_METRICS

router = APIRouter(prefix="/api/reports-builder", tags=["report-builder"])


def _serialize(r: ReportDef, user_id) -> dict:
    return {
        "id": str(r.id),
        "key": r.key,
        "name": r.name,
        "description": r.description,
        "query": r.query,
        "owner_user_id": str(r.owner_user_id) if r.owner_user_id else None,
        "shared": r.owner_user_id is None,
        "mine": r.owner_user_id == user_id,
    }


async def _load_visible(s: AsyncSession, user: User, report_id) -> ReportDef:
    """A report the caller may see: their own or a shared one. Else 404 (don't reveal others')."""
    r = (await s.execute(
        select(ReportDef).where(ReportDef.id == report_id, ReportDef.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not r or (r.owner_user_id is not None and r.owner_user_id != user.id):
        raise HTTPException(404, "Report not found")
    return r


async def _require_owner(s: AsyncSession, user: User, r: ReportDef) -> None:
    """Edit/delete gate: owner only. A shared report (no owner) is a tenant-wide asset, so it takes
    config.manage to change."""
    if r.owner_user_id is None:
        grants = await load_grants(s, user)
        if not can(grants, "config", "manage"):
            raise HTTPException(403, "Shared reports can only be changed by a configuration manager")
    elif r.owner_user_id != user.id:
        raise HTTPException(403, "Only the report owner can change it")


async def _validate_query(s: AsyncSession, user: User, query) -> None:
    """The query must name a real entity the caller can view, with a known metric — same rules a
    dashboard widget is held to."""
    if not isinstance(query, dict) or not query.get("entity"):
        raise HTTPException(422, "query.entity is required")
    metric = query.get("metric", "count")
    if metric not in ALLOWED_METRICS:
        raise HTTPException(422, f"Unknown metric '{metric}'")
    entity_key = query["entity"]
    ent = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == user.tenant_id, EntityDef.key == entity_key)
    )).scalar_one_or_none()
    if not ent:
        raise HTTPException(422, f"Unknown entity '{entity_key}'")
    grants = await load_grants(s, user)
    if not can(grants, entity_key, "view"):
        raise HTTPException(403, f"Not allowed: {entity_key}.view")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check. Saved-report
    # config borrows the entity's view permission (you can save a report over what you can view).
    try:
        await assert_can(s, user, action="view", entity_key=entity_key,
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


@router.get("")
async def list_reports(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The caller's own reports plus the tenant's shared ones."""
    rows = (await s.execute(
        select(ReportDef).where(
            ReportDef.tenant_id == user.tenant_id,
            or_(ReportDef.owner_user_id == user.id, ReportDef.owner_user_id.is_(None)),
        ).order_by(ReportDef.name)
    )).scalars().all()
    return [_serialize(r, user.id) for r in rows]


@router.post("", status_code=201)
async def create_report(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Save a report. No config.manage needed — anyone who can view the entity may save a report over
    it. `shared: true` makes it tenant-wide (owner NULL); otherwise it's private to the creator."""
    key = (payload.get("key") or "").strip()
    name = (payload.get("name") or "").strip()
    if not key or not name:
        raise HTTPException(422, "key and name are required")
    await _validate_query(s, user, payload.get("query"))

    owner_id = None if payload.get("shared") else user.id
    owner_clause = ReportDef.owner_user_id.is_(None) if owner_id is None else (ReportDef.owner_user_id == owner_id)
    clash = (await s.execute(
        select(ReportDef).where(ReportDef.tenant_id == user.tenant_id, ReportDef.key == key, owner_clause)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"A report with key '{key}' already exists")

    r = ReportDef(
        tenant_id=user.tenant_id, owner_user_id=owner_id, key=key, name=name,
        description=payload.get("description"), query=payload["query"],
    )
    s.add(r)
    await s.commit()
    await s.refresh(r)
    return _serialize(r, user.id)


@router.get("/{report_id}/run")
async def run_report(report_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Compute a saved report, org-scope filtered exactly like reports.py. Returns {value} or
    [{group, value}] plus the matched record count. Fail-soft: a broken query returns an `error`
    field, never a 500."""
    r = await _load_visible(s, user, report_id)
    base = {"id": str(r.id), "key": r.key, "name": r.name}
    try:
        query = r.query or {}
        entity_key = query.get("entity")
        if not entity_key:
            raise ValueError("report query missing 'entity'")
        grants = await load_grants(s, user)
        if not can(grants, entity_key, "view"):
            return {**base, "error": "forbidden"}
        recs = (await s.execute(
            select(Record).where(Record.tenant_id == user.tenant_id, Record.entity_key == entity_key)
        )).scalars().all()
        paths = await _node_paths(s, user.tenant_id)
        flt = query.get("filter")
        visible = [
            rec for rec in recs
            if can(grants, entity_key, "view", _record_path(paths, rec))
            and (not flt or evaluate(flt, _filter_context(rec)))
        ]
        return {**base, "matched": len(visible), "result": _compute(query, visible)}
    except Exception as e:
        return {**base, "error": str(e)}


@router.patch("/{report_id}")
async def update_report(report_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit a report's name/description/query. Owner only (shared ⇒ config.manage)."""
    r = (await s.execute(
        select(ReportDef).where(ReportDef.id == report_id, ReportDef.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Report not found")
    await _require_owner(s, user, r)

    allowed = {"name", "description", "query"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(422, f"Cannot patch {sorted(unknown)}; allowed: {sorted(allowed)}")
    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        r.name = v
    if "description" in payload:
        r.description = payload["description"]
    if "query" in payload:
        await _validate_query(s, user, payload["query"])
        r.query = payload["query"]

    await s.commit()
    await s.refresh(r)
    return _serialize(r, user.id)


@router.delete("/{report_id}", status_code=204)
async def delete_report(report_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a report. Owner only (shared ⇒ config.manage)."""
    r = (await s.execute(
        select(ReportDef).where(ReportDef.id == report_id, ReportDef.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Report not found")
    await _require_owner(s, user, r)
    await s.delete(r)
    await s.commit()
