"""KPI computation engine — runtime evaluator for `kpi_def.formula_spec`.

SPEC alignment:
  - §3   Canonical Pipeline — the 14 stage KPIs (Lead Capture Rate, …, 30-Day Retention).
  - §9   KPI Binding — "one KPI = one owner = one formula = one valid denominator. No
         shared ownership, no activity-only metrics."
  - §0.7 (7th invariant) — same constraint, kernel-level.

The KpiDef row carries TWO representations of the formula side-by-side:

  - `formula` (VARCHAR) — free-form human-readable / future-GXL text. NOT executed.
  - `formula_spec` (JSONB) — structured spec the engine evaluates. The four supported
    shapes are documented on the KpiDef model docstring (see app/models/kernel_defs.py)
    and in docs/kernel-build/KPI-ENGINE.md.

This module is intentionally small — 4 shapes cover all 14 SPEC KPIs adequately. A
richer DSL (GXL) is a forward-compat option, not an M0 requirement.

Cache semantics:
  - Per-row DB cache: `last_computed_at` + `last_computed_value` columns. The engine
    treats a value <60s old as fresh and returns it without re-running the query
    (`from_cache=True` on the response). Each `evaluate_kpi` invocation that runs the
    underlying SQL writes both columns back, so a follow-up call within the window is
    cheap regardless of which request / process makes it.
  - Filtering by `owner_module` / `stage_key` happens after the formula_spec lookup so
    dashboards can scope a bulk evaluate by SPEC §3 stage owner without re-emitting the
    KPI metadata client-side.

Real-data-only posture:
  - Missing formula_spec → value=None + reason='no formula'. Never fakes a number.
  - Denominator == 0 → value=None + reason='denominator zero'. Never divides by zero or
    swallows the case into a 0-rate.
  - Unknown table / shape → KpiEvaluationError. Loud failure during boot/seed, never
    silent fallback to "0".

Tenant scoping: every query carries `tenant_id == :tid` explicitly. RLS would also
filter (the engine session is tenant-bound by the auth dep) but the explicit AND is
defense-in-depth and lets the engine run from non-request contexts (a CLI/seed).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import EntityDef, Record
from ..models.billing import Subscription, Invoice, Payment
from ..models.order import Order
from ..models.kernel_defs import KpiDef, StageDef
from ..models.workitem import WorkItem


_log = logging.getLogger("gaaex.kpi_engine")


# 60s cross-request memo on the row. Dashboards polling at 5s intervals get fresh
# numbers without each request hammering the same aggregation.
CACHE_TTL_SECONDS = 60


# ---------------------------------------------------------------- typed exceptions

class KpiEvaluationError(Exception):
    """Raised when a kpi_def has a malformed formula_spec or its sources are missing.

    Surfaces in routers as HTTP 422 (we trust the formula author to fix the spec; a
    botched formula isn't a 500 — it's an authoring error in the kpi_def row).
    """


# ---------------------------------------------------------------- table dispatch

# Whitelist: only these tables can appear in a `count` spec's `table` key. Anything
# else → KpiEvaluationError. Keeps the engine from being a generic SQL-injection
# surface; new tables become first-class by being added here (intentional choke point).
_COUNT_TABLES = {
    "record":       Record,
    "order":        Order,
    "subscription": Subscription,
    "invoice":      Invoice,
    "payment":      Payment,
    "workitem":     WorkItem,
}


# ---------------------------------------------------------------- shape: count

def _apply_where(model, where: dict[str, Any]):
    """Translate the `where` map into SQLAlchemy column expressions.

    Key conventions:
      - `data.<json_key>`        → JSONB ->> on Record.data (Record only)
      - `<col>__not_null`        → <col> IS NOT NULL (suffix sentinel)
      - everything else          → <col> == <value>

    All comparisons are parameterized — no string concatenation.
    """
    conds = []
    for raw_key, value in (where or {}).items():
        if "." in raw_key and raw_key.startswith("data."):
            # JSONB path. Only `record` carries `data`; emit a clear error otherwise.
            if model is not Record:
                raise KpiEvaluationError(
                    f"formula_spec error: data.* keys only valid on `record` table, got {model.__tablename__!r}"
                )
            json_key = raw_key[len("data."):]
            conds.append(Record.data[json_key].astext == str(value))
            continue

        if raw_key.endswith("__not_null"):
            col_name = raw_key[: -len("__not_null")]
            col = getattr(model, col_name, None)
            if col is None:
                raise KpiEvaluationError(
                    f"formula_spec error: unknown column {col_name!r} on {model.__tablename__!r}"
                )
            conds.append(col.isnot(None))
            continue

        # `<col>__lte_col2_plus_hours_<N>` — col ≤ col2 + N hours. Used for SLA compliance.
        # Example: "first_response_at__lte_assigned_at_plus_hours_4"
        if "__lte_" in raw_key and "_plus_hours_" in raw_key:
            parts = raw_key.split("__lte_")
            lhs_name = parts[0]
            rhs_parts = parts[1].split("_plus_hours_")
            rhs_name, hours_str = rhs_parts[0], rhs_parts[1]
            lhs = getattr(model, lhs_name, None)
            rhs = getattr(model, rhs_name, None)
            if lhs is None or rhs is None:
                raise KpiEvaluationError(
                    f"formula_spec error: __lte_*_plus_hours_* references unknown column on {model.__tablename__!r}"
                )
            try:
                hours = int(hours_str)
            except ValueError:
                raise KpiEvaluationError(f"formula_spec error: __lte_*_plus_hours_* hours must be int, got {hours_str!r}")
            from sqlalchemy import func as sqlfunc
            conds.append(lhs <= rhs + sqlfunc.make_interval(0, 0, 0, 0, hours))
            continue

        col = getattr(model, raw_key, None)
        if col is None:
            raise KpiEvaluationError(
                f"formula_spec error: unknown column {raw_key!r} on {model.__tablename__!r}"
            )
        conds.append(col == value)
    return conds


async def _eval_count(s: AsyncSession, *, tenant_id: uuid.UUID, spec: dict) -> int:
    table = spec.get("table")
    model = _COUNT_TABLES.get(table)
    if model is None:
        raise KpiEvaluationError(
            f"formula_spec error: unsupported table {table!r}; expected one of {sorted(_COUNT_TABLES)}"
        )
    conds = [model.tenant_id == tenant_id, *_apply_where(model, spec.get("where") or {})]
    q = select(func.count()).select_from(model).where(and_(*conds))
    return int((await s.execute(q)).scalar_one())


# ---------------------------------------------------------------- shape: stage_total

async def _eval_stage_total(s: AsyncSession, *, tenant_id: uuid.UUID, spec: dict) -> int:
    """Count of records currently AT the named pipeline stage.

    Today: records don't carry a `stage_key` column — stage attribution is derived
    via the entity_def's `owner_module` matching the stage_def's `owner_module`. This
    is an APPROXIMATION (an entity owned by Sales doesn't pin every one of its records
    to the Sales stage); it'll be sharpened once Step 5+ wires explicit stage_key onto
    record. The engine emits a one-shot WARNING when this shape fires, so observers
    know the result is approximate.

    Returns 0 honestly when the stage_def doesn't exist or no entities have the
    matching owner — never NaN, never an error.
    """
    stage_key = spec.get("stage_key")
    if not stage_key:
        raise KpiEvaluationError("formula_spec error: stage_total requires `stage_key`")

    stage_row = (await s.execute(
        select(StageDef.owner_module)
        .where(StageDef.tenant_id == tenant_id, StageDef.key == stage_key)
    )).first()
    if stage_row is None:
        _log.warning("kpi_engine: stage_total: stage_def %r not found for tenant %s — returning 0", stage_key, tenant_id)
        return 0

    owner_module = stage_row[0]
    _log.warning(
        "kpi_engine: stage_total %r computed via entity_def.owner_module=%r (approximate; "
        "no stage attribution wired yet — see KPI-ENGINE.md deferred list)",
        stage_key, owner_module,
    )

    q = (
        select(func.count())
        .select_from(Record)
        .join(EntityDef, and_(
            EntityDef.tenant_id == Record.tenant_id,
            EntityDef.key == Record.entity_key,
        ))
        .where(Record.tenant_id == tenant_id, EntityDef.owner_module == owner_module)
    )
    return int((await s.execute(q)).scalar_one())


# ---------------------------------------------------------------- shape: ratio

async def _eval_ratio(s: AsyncSession, *, tenant_id: uuid.UUID, spec: dict) -> tuple[int, int, float | None, str | None]:
    """Return (numerator, denominator, value, reason).

    value is None + reason='denominator zero' when the denominator is 0 (real-data
    posture — we never fake a non-zero rate to hide an empty denominator).
    """
    num_spec = spec.get("numerator")
    den_spec = spec.get("denominator")
    if not isinstance(num_spec, dict) or not isinstance(den_spec, dict):
        raise KpiEvaluationError("formula_spec error: ratio requires `numerator` and `denominator` dicts")

    numerator   = await _eval_nested_scalar(s, tenant_id=tenant_id, spec=num_spec)
    denominator = await _eval_nested_scalar(s, tenant_id=tenant_id, spec=den_spec)

    if denominator == 0:
        return numerator, denominator, None, "denominator zero"
    return numerator, denominator, float(numerator) / float(denominator), None


# ---------------------------------------------------------------- shape: rate

async def _eval_rate(s: AsyncSession, *, tenant_id: uuid.UUID, spec: dict) -> tuple[int, int, float]:
    """Return (numerator, since_days, rate).

    rate = numerator / since_days. Today the engine does NOT add an implicit time
    filter to the numerator's `where` — the formula author is expected to scope by
    a date column themselves if they want strict "events in the window" semantics.
    For lead_capture_rate (the seeded example) the numerator is `count(entity=lead)`
    over ALL leads, which on a fresh demo DB is "leads ever / 30 days" — adequate
    for M0 dashboards; a stricter form is a config edit, not an engine change.
    """
    num_spec = spec.get("numerator")
    if not isinstance(num_spec, dict):
        raise KpiEvaluationError("formula_spec error: rate requires `numerator` dict")
    since_days = int(spec.get("since_days") or 30)
    if since_days <= 0:
        raise KpiEvaluationError("formula_spec error: rate.since_days must be positive")

    numerator = await _eval_nested_scalar(s, tenant_id=tenant_id, spec=num_spec)
    return numerator, since_days, float(numerator) / float(since_days)


# ---------------------------------------------------------------- dispatcher

async def _eval_nested_scalar(s: AsyncSession, *, tenant_id: uuid.UUID, spec: dict) -> int:
    """Resolve a nested spec to a single integer. Used inside ratio's numerator/denominator."""
    t = (spec or {}).get("type")
    if t == "count":
        return await _eval_count(s, tenant_id=tenant_id, spec=spec)
    if t == "stage_total":
        return await _eval_stage_total(s, tenant_id=tenant_id, spec=spec)
    raise KpiEvaluationError(
        f"formula_spec error: nested spec must be `count` or `stage_total`, got {t!r}"
    )


def _unit_for(spec: dict) -> str:
    """Map a formula_spec to a display unit. Drives client formatting (percent vs raw)."""
    t = (spec or {}).get("type")
    if t == "ratio":
        return "percent"  # 0..1 in value; client renders × 100
    if t == "rate":
        return "ratio"    # e.g. "12.0 / day"
    return "count"        # count / stage_total → integer-ish


# ---------------------------------------------------------------- public API

async def evaluate_kpi(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    kpi_key: str,
) -> dict:
    """Compute one KPI by key.

    Returns:
        {
          "key": str, "name": str, "owner_module": str, "stage_key": str | None,
          "value": float | None,
          "numerator": int | None, "denominator": int | None,
          "unit": "percent" | "count" | "ratio",
          "computed_at": iso-8601 str,
          "from_cache": bool,
          "reason": str | None,   # set when value is None — e.g. 'no formula', 'denominator zero'
        }

    Behavior:
        - kpi_def row missing for this tenant → KpiEvaluationError
        - formula_spec NULL → value=None, reason='no formula'
        - last_computed_at <60s old → return cached value, from_cache=True
        - Otherwise: compute, persist (last_computed_*), commit, return fresh

    Raises:
        KpiEvaluationError — malformed spec, unknown table, bad shape.
    """
    row = (await s.execute(
        select(KpiDef).where(KpiDef.tenant_id == tenant_id, KpiDef.key == kpi_key)
    )).scalar_one_or_none()
    if row is None:
        raise KpiEvaluationError(f"kpi_def not found: {kpi_key!r} for tenant {tenant_id}")

    base = {
        "key": row.key,
        "name": row.name,
        "owner_module": row.owner_module,
        "stage_key": row.bound_stage_key,
    }

    if not row.formula_spec:
        return {
            **base,
            "value": None, "numerator": None, "denominator": None,
            "unit": "count", "computed_at": _now_iso(),
            "from_cache": False, "reason": "no formula",
        }

    # ---- cache check (60s window). last_computed_value may be NULL even when the
    # ts is fresh (we cache None results too) — re-run in that edge case for clarity.
    now = datetime.now(timezone.utc)
    if (
        row.last_computed_at is not None
        and now - row.last_computed_at < timedelta(seconds=CACHE_TTL_SECONDS)
        and row.last_computed_value is not None
    ):
        return {
            **base,
            "value": float(row.last_computed_value),
            "numerator": None, "denominator": None,   # cached form doesn't store breakdown
            "unit": _unit_for(row.formula_spec),
            "computed_at": row.last_computed_at.isoformat(),
            "from_cache": True, "reason": None,
        }

    # ---- compute fresh
    numerator: int | None = None
    denominator: int | None = None
    value: float | None = None
    reason: str | None = None

    t = row.formula_spec.get("type")
    if t == "count":
        numerator = await _eval_count(s, tenant_id=tenant_id, spec=row.formula_spec)
        value = float(numerator)
    elif t == "stage_total":
        numerator = await _eval_stage_total(s, tenant_id=tenant_id, spec=row.formula_spec)
        value = float(numerator)
    elif t == "ratio":
        numerator, denominator, value, reason = await _eval_ratio(
            s, tenant_id=tenant_id, spec=row.formula_spec,
        )
    elif t == "rate":
        numerator, since_days, value = await _eval_rate(
            s, tenant_id=tenant_id, spec=row.formula_spec,
        )
        denominator = since_days
    else:
        raise KpiEvaluationError(
            f"formula_spec error: unsupported top-level type {t!r}; "
            "expected one of count|ratio|stage_total|rate"
        )

    # ---- write cache (skip when value is None — we don't want to cache a missing reason)
    if value is not None:
        row.last_computed_at = now
        row.last_computed_value = Decimal(str(value))
        try:
            await s.commit()
        except Exception:
            # Cache write is best-effort — never fail the KPI compute over it.
            await s.rollback()
            _log.warning("kpi_engine: cache write failed for %s (rolled back)", row.key, exc_info=True)

    return {
        **base,
        "value": value, "numerator": numerator, "denominator": denominator,
        "unit": _unit_for(row.formula_spec),
        "computed_at": now.isoformat(),
        "from_cache": False, "reason": reason,
    }


async def evaluate_all_kpis(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    owner_module: str | None = None,
    stage_key: str | None = None,
) -> list[dict]:
    """Bulk-evaluate. Optional filters scope to one stage owner or one stage.

    Order: by KpiDef.key asc (stable client rendering). Each KPI evaluated in series —
    cheaper than running 14 queries concurrently against the same session, and the
    per-row 60s cache makes subsequent dashboard polls effectively free.
    """
    conds = [KpiDef.tenant_id == tenant_id]
    if owner_module:
        conds.append(KpiDef.owner_module == owner_module)
    if stage_key:
        conds.append(KpiDef.bound_stage_key == stage_key)

    rows = (await s.execute(
        select(KpiDef.key).where(and_(*conds)).order_by(KpiDef.key.asc())
    )).all()

    out = []
    for (kpi_key,) in rows:
        out.append(await evaluate_kpi(s, tenant_id=tenant_id, kpi_key=kpi_key))
    return out


# ---------------------------------------------------------------- internal helpers

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
