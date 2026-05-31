"""KPI read API — metadata listing + lazy computation over the kernel KPI engine.

SPEC alignment:
  - §3   Canonical Pipeline — the 14 stage KPIs the UI dashboards bind to.
  - §9   KPI Binding — one owner, one formula, one denominator (enforced by the
         kpi_def model's unique (tenant_id, key) constraint).
  - §5.4 (KPI catalog) — the consumer of GET /api/kpis (metadata) and GET
         /api/kpis/{key}/value (computed value).

Three endpoints — all read-only:
  - GET /api/kpis                 — metadata for every KPI def (no compute).
  - GET /api/kpis/{key}/value     — compute (or return cached) one KPI.
  - GET /api/kpis/values          — bulk-compute, with optional owner/stage filters.

Auth: every endpoint requires a valid principal (Bearer or X-API-Key). The dashboards
hit these on every page load, so we don't gate behind config.manage — KPI READ is a
universally-available primitive (analogous to the existing analytics router). The
`assert_can(action='view', entity_key='kpi')` adoption is transitional — the permission
likely doesn't exist in the role catalog yet; the call will fall back to role-only and
emit a one-shot WARN (matching the documented escape hatch in invariants.py). That's
fine: KPI metadata is intentionally cross-cutting read, not a sensitive write surface.

Fixed paths under /api ("/api/kpis"), so register BEFORE records.router ("/api/{slug}")
in main.py.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.kernel_defs import KpiDef
from ..kernel import (
    KpiEvaluationError,
    evaluate_all_kpis,
    evaluate_kpi,
)
from .auth import current_user


router = APIRouter(prefix="/api/kpis", tags=["kpis"])


# ---------------------------------------------------------------- serializers

def _kpi_def_to_dict(row: KpiDef) -> dict:
    """Flat wire shape — no computed value; that's what GET /value is for."""
    return {
        "key": row.key,
        "name": row.name,
        "owner_module": row.owner_module,
        "formula": row.formula,
        "denominator": row.denominator,
        "formula_spec": row.formula_spec,
        "bound_stage_key": row.bound_stage_key,
        "bound_workflow_key": row.bound_workflow_key,
        "has_formula": row.formula_spec is not None,
        "last_computed_at": row.last_computed_at.isoformat() if row.last_computed_at else None,
        "last_computed_value": float(row.last_computed_value) if row.last_computed_value is not None else None,
    }


# ---------------------------------------------------------------- endpoints

@router.get("")
async def list_kpis(
    owner_module: str | None = Query(None, description="Filter to KPIs owned by this module (SPEC §3 owner_module)."),
    stage_key: str | None = Query(None, description="Filter to KPIs bound to this stage_def.key."),
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """List all KPI defs for the tenant. Does NOT compute values; metadata only.

    Filters:
      - owner_module — e.g. 'Marketing', 'Revenue Control'. Maps directly to kpi_def.owner_module.
      - stage_key    — e.g. 'lead'. Maps to kpi_def.bound_stage_key.

    RLS scopes the query to the caller's tenant; no manual tenant filter needed.
    """
    q = select(KpiDef)
    if owner_module:
        q = q.where(KpiDef.owner_module == owner_module)
    if stage_key:
        q = q.where(KpiDef.bound_stage_key == stage_key)
    q = q.order_by(KpiDef.key.asc())
    rows = (await s.execute(q)).scalars().all()
    return [_kpi_def_to_dict(r) for r in rows]


@router.get("/values")
async def get_all_kpi_values(
    owner_module: str | None = Query(None),
    stage_key: str | None = Query(None),
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Bulk-evaluate. Returns a list of value dicts (one per KPI matching the filters).

    Same filters as GET / — designed for dashboard widgets that show all the Marketing
    KPIs in one panel, or all KPIs bound to the Lead stage.

    NOTE: route is declared BEFORE the path-param `/{key}/value` so FastAPI doesn't
    swallow 'values' as a key match.
    """
    try:
        return await evaluate_all_kpis(
            s, tenant_id=user.tenant_id,
            owner_module=owner_module, stage_key=stage_key,
        )
    except KpiEvaluationError as e:
        # Malformed formula_spec → authoring error, surface as 422 so the kpi editor
        # can show the message inline rather than a generic 500.
        raise HTTPException(422, f"KPI evaluation error: {e}")


@router.get("/{key}/value")
async def get_kpi_value(
    key: str,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Compute or return cached value for one KPI by key.

    Behavior matches the engine contract (see app/kernel/kpi_engine.py):
      - Missing formula_spec ⇒ value=None, reason='no formula'
      - Denominator zero    ⇒ value=None, reason='denominator zero'
      - Fresh cache (<60s)  ⇒ from_cache=True
      - Otherwise           ⇒ fresh compute + cache write
    """
    try:
        return await evaluate_kpi(s, tenant_id=user.tenant_id, kpi_key=key)
    except KpiEvaluationError as e:
        # Distinguish "no such kpi" from "malformed spec":
        msg = str(e)
        if msg.startswith("kpi_def not found"):
            raise HTTPException(404, msg)
        raise HTTPException(422, f"KPI evaluation error: {e}")
