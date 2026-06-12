"""Config-driven dashboards / analytics engine.

A DashboardDef is a named board; each WidgetDef declares an aggregation over an entity's records
as configuration (no code). This router is the fixed engine that interprets those declarations and
computes them at request time — always filtered to the viewer's org scope, exactly like reports.py.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import DashboardDef, WidgetDef, Record, OrgNode, User
from ..access import load_grants, can
from ..gxl import evaluate
from .auth import current_user


async def _kernel_gate(s, user, action: str) -> None:
    """Step 7.2 kernel gate for dashboard writes — config-manage on dashboard_def."""
    try:
        await assert_can(s, user, action=action, entity_key="dashboard_def",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

router = APIRouter(prefix="/dashboards", tags=["dashboards"])

ALLOWED_WIDGET_TYPES = {"kpi", "bar", "line", "donut", "table"}
ALLOWED_METRICS = {"count", "sum", "avg"}


# ---- helpers (org-scope filtering mirrors reports.py exactly) ----

async def _node_paths(s: AsyncSession, tenant_id) -> dict[str, str]:
    rows = (await s.execute(select(OrgNode.id, OrgNode.path).where(OrgNode.tenant_id == tenant_id))).all()
    return {str(i): str(p) for i, p in rows}


def _record_path(paths: dict[str, str], rec: Record) -> str | None:
    return paths.get(str(rec.owner_node_id)) if rec.owner_node_id else None


def _field_value(rec: Record, key: str):
    """Read a field by key — `status` is a core column, everything else lives in JSONB `data`
    (consistent with the GXL guard context in workflow.py)."""
    if key == "status":
        return rec.status
    return (rec.data or {}).get(key)


def _filter_context(rec: Record) -> dict:
    """Names a widget's GXL `filter` can reference: all data fields + status."""
    return {**(rec.data or {}), "status": rec.status}


def _to_number(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _measure(metric: str, field: str | None, recs: list[Record]):
    if metric == "count":
        return len(recs)
    if not field:
        raise ValueError(f"metric '{metric}' requires a 'field'")
    nums = [n for n in (_to_number(_field_value(r, field)) for r in recs) if n is not None]
    if metric == "sum":
        return sum(nums)
    return (sum(nums) / len(nums)) if nums else 0          # avg


def _compute(query: dict, recs: list[Record]):
    metric = query.get("metric", "count")
    if metric not in ALLOWED_METRICS:
        raise ValueError(f"unknown metric '{metric}'")
    field = query.get("field")
    group_by = query.get("group_by")
    if group_by:
        buckets: dict = {}
        for r in recs:
            g = _field_value(r, group_by)
            buckets.setdefault(g if g is not None else "(none)", []).append(r)
        return [{"group": g, "value": _measure(metric, field, items)} for g, items in buckets.items()]
    return {"value": _measure(metric, field, recs)}


def _widget_out(w: WidgetDef) -> dict:
    return {"key": w.key, "label": w.label, "type": w.type, "order": w.order, "query": w.query}


async def _get_dashboard(s: AsyncSession, tenant_id, key: str) -> DashboardDef:
    dash = (await s.execute(
        select(DashboardDef).where(DashboardDef.tenant_id == tenant_id, DashboardDef.key == key)
    )).scalar_one_or_none()
    if not dash:
        raise HTTPException(404, f"Unknown dashboard '{key}'")
    return dash


async def _widgets(s: AsyncSession, dashboard_id) -> list[WidgetDef]:
    return (await s.execute(
        select(WidgetDef).where(WidgetDef.dashboard_def_id == dashboard_id).order_by(WidgetDef.order)  # tenant-filter-ok: cross-tenant — RLS-scoped session; dashboard tenant validated by caller via _get_dashboard()
    )).scalars().all()


# ---- endpoints ----

@router.get("")
async def list_dashboards(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """All dashboards in the tenant. (Data is org-scoped per widget at compute time, so listing the
    boards themselves is open to any authenticated tenant user.)"""
    boards = (await s.execute(
        select(DashboardDef).where(DashboardDef.tenant_id == user.tenant_id).order_by(DashboardDef.order)
    )).scalars().all()
    return [{"key": d.key, "label": d.label, "description": d.description, "order": d.order} for d in boards]


@router.get("/{key}")
async def get_dashboard(key: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """A dashboard plus its widget definitions — config only, no computed data."""
    dash = await _get_dashboard(s, user.tenant_id, key)
    widgets = await _widgets(s, dash.id)
    return {
        "key": dash.key,
        "label": dash.label,
        "description": dash.description,
        "order": dash.order,
        "widgets": [_widget_out(w) for w in widgets],
    }


@router.get("/{key}/data")
async def get_dashboard_data(key: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Compute every widget on the board, filtered to the viewer's org scope.

    Fail-soft per widget: a widget the user can't view, or one with a broken query, returns an
    `error` field instead of `result` — one bad widget never 500s the whole board.
    """
    dash = await _get_dashboard(s, user.tenant_id, key)
    widgets = await _widgets(s, dash.id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)

    out = []
    for w in widgets:
        base = {"widget_key": w.key, "type": w.type, "label": w.label}
        try:
            query = w.query or {}
            entity_key = query.get("entity")
            if not entity_key:
                raise ValueError("widget query missing 'entity'")
            # entity-level view gate: skip (don't 403) widgets the viewer can't see at all
            if not can(grants, entity_key, "view"):
                out.append({**base, "error": "forbidden"})
                continue

            recs = (await s.execute(
                select(Record).where(Record.tenant_id == user.tenant_id, Record.entity_key == entity_key)
            )).scalars().all()

            flt = query.get("filter")
            visible = [
                r for r in recs
                if can(grants, entity_key, "view", _record_path(paths, r))
                and (not flt or evaluate(flt, _filter_context(r)))
            ]
            out.append({**base, "result": _compute(query, visible)})
        except Exception as e:
            out.append({**base, "error": str(e)})

    return {"key": dash.key, "label": dash.label, "widgets": out}


@router.patch("/{key}")
async def update_dashboard(key: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Update dashboard metadata (label, description, order) and optionally REPLACE all widgets.
    If the body contains a 'widgets' key, all existing WidgetDef rows for this board are deleted
    and replaced with the payload widgets (same validation as create_dashboard). Requires config.manage."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    await _kernel_gate(s, user, "config_manage")
    dash = await _get_dashboard(s, user.tenant_id, key)

    if "label" in payload:
        v = (payload["label"] or "").strip()
        if not v:
            raise HTTPException(422, "label cannot be empty")
        dash.label = v
    if "description" in payload:
        dash.description = payload["description"]
    if "order" in payload:
        dash.order = int(payload["order"])

    if "widgets" in payload:
        widgets = payload["widgets"] or []
        for w in widgets:
            if not (w.get("key") or "").strip():
                raise HTTPException(422, "every widget needs a 'key'")
            if w.get("type") not in ALLOWED_WIDGET_TYPES:
                raise HTTPException(422, f"Unknown widget type '{w.get('type')}'")
            metric = (w.get("query") or {}).get("metric", "count")
            if metric not in ALLOWED_METRICS:
                raise HTTPException(422, f"Unknown metric '{metric}'")

        # Delete all existing widgets for this dashboard
        existing = await _widgets(s, dash.id)
        for w in existing:
            await s.delete(w)
        await s.flush()

        # Recreate from payload
        for i, w in enumerate(widgets, start=1):
            s.add(WidgetDef(
                tenant_id=user.tenant_id, dashboard_def_id=dash.id, key=w["key"],
                label=w.get("label", w["key"]), type=w["type"], order=i, query=w.get("query"),
            ))

    await s.commit()
    # Re-fetch widgets after commit for consistent response
    widgets_out = await _widgets(s, dash.id)
    return {
        "key": dash.key,
        "label": dash.label,
        "description": dash.description,
        "order": dash.order,
        "widgets": [_widget_out(w) for w in widgets_out],
    }


@router.delete("/{key}", status_code=204)
async def delete_dashboard(key: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a dashboard and all its widget definitions. Requires config.manage."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    await _kernel_gate(s, user, "config_manage")
    dash = await _get_dashboard(s, user.tenant_id, key)

    # Delete all widgets first (FK dependency)
    existing = await _widgets(s, dash.id)
    for w in existing:
        await s.delete(w)
    await s.flush()

    await s.delete(dash)
    await s.commit()


@router.post("", status_code=201)
async def create_dashboard(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a dashboard with its widgets AS CONFIG. Requires config.manage (super_admin),
    gated exactly like meta.py's entity-create."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    await _kernel_gate(s, user, "config_manage")

    key = (payload.get("key") or "").strip()
    label = (payload.get("label") or "").strip()
    if not key or not label:
        raise HTTPException(422, "key and label are required")

    clash = (await s.execute(
        select(DashboardDef).where(DashboardDef.tenant_id == user.tenant_id, DashboardDef.key == key)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"A dashboard with key '{key}' already exists")

    widgets = payload.get("widgets") or []
    for w in widgets:
        if not (w.get("key") or "").strip():
            raise HTTPException(422, "every widget needs a 'key'")
        if w.get("type") not in ALLOWED_WIDGET_TYPES:
            raise HTTPException(422, f"Unknown widget type '{w.get('type')}'")
        metric = (w.get("query") or {}).get("metric", "count")
        if metric not in ALLOWED_METRICS:
            raise HTTPException(422, f"Unknown metric '{metric}'")

    dash = DashboardDef(
        tenant_id=user.tenant_id, key=key, label=label,
        description=payload.get("description"), order=int(payload.get("order") or 0),
    )
    s.add(dash)
    await s.flush()

    for i, w in enumerate(widgets, start=1):
        s.add(WidgetDef(
            tenant_id=user.tenant_id, dashboard_def_id=dash.id, key=w["key"],
            label=w.get("label", w["key"]), type=w["type"], order=i, query=w.get("query"),
        ))

    await s.commit()
    return {"key": dash.key, "label": dash.label, "widgets": len(widgets)}
