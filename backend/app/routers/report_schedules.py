"""Scheduled reports (A24) — a saved report turned into a recurring, adapter-delivered job.

A ReportSchedule says: render a ReportDef on a cadence (daily/weekly/monthly) and deliver it on a
channel to a set of recipients. The batch job POST /api/report-schedules/run-due picks up every
ACTIVE schedule whose `next_run_at <= as_of`, RENDERS the report (reusing report_builder.run_report
— the exact same org-scoped aggregation a manual run uses), DELIVERS it via the channel adapter
layer (channels.dispatch — the same path notifications/dunning use), advances `next_run_at` by the
cadence, stamps `last_run_at`, and records a JobRun (reusing billing._record_job_run). This stitches
the jobs + adapters layers (batch 23) onto the report engine — nothing is reimplemented.

NOTE on namespacing: "/api/report-schedules" is a FIXED path under /api. The generic record router
serves "/api/{slug}", so this router MUST be registered BEFORE records.router in main.py (and, by the
same rule, alongside the other fixed /api routers). See the wiring report.

AUTH choice (headless): reads are gated on authentication + tenant scope (these are operational
config rows, not customer data, and the query is tenant-scoped + RLS). Writes and run-due require
`config.manage` — a schedule is a tenant-wide automation asset, the same gate shared reports take to
change. If a looser/tighter gate is wanted later it is a one-line change.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User
from ..models.report import ReportDef
from ..models.report_schedule import ReportSchedule
from ..access import load_grants, can
from .auth import current_user
from .records import _paginate
# REUSE — do not reimplement:
from .report_builder import run_report          # renders a saved report, org-scoped + fail-soft
from .billing import _record_job_run, _now      # JobRun helper + tz-aware now (J96 job log)
from .. import channels                          # dispatch(...) — the channel adapter delivery path
from ..utils.http_errors import deny as _deny  # BL-10


async def _kernel_gate(s, user) -> None:
    """Step 7.2 kernel gate for report-schedule writes — config-manage on report_schedule."""
    try:
        await assert_can(s, user, action="config_manage", entity_key="report_schedule",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

router = APIRouter(prefix="/api/report-schedules", tags=["report-schedules"])

_CADENCES = {"daily", "weekly", "monthly"}
_STATUSES = {"ACTIVE", "PAUSED"}




def _iso(dt):
    return dt.isoformat() if dt else None


def _serialize(r: ReportSchedule) -> dict:
    return {
        "id": str(r.id),
        "report_id": str(r.report_id),
        "owner_node_id": str(r.owner_node_id) if r.owner_node_id else None,
        "cadence": r.cadence,
        "channel": r.channel,
        "recipients": r.recipients or [],
        "next_run_at": _iso(r.next_run_at),
        "last_run_at": _iso(r.last_run_at),
        "status": r.status,
        "created_at": _iso(r.created_at),
    }


def _advance(dt: datetime, cadence: str) -> datetime:
    """Advance a run-time by one cadence step. daily/weekly are simple deltas; monthly clamps the day
    to the target month's length (so the 31st rolls to the 28th/30th, never overflows)."""
    if cadence == "daily":
        return dt + timedelta(days=1)
    if cadence == "weekly":
        return dt + timedelta(weeks=1)
    # monthly
    year = dt.year + (dt.month // 12)
    month = dt.month % 12 + 1
    import calendar
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


async def _get_owned(s: AsyncSession, user: User, schedule_id) -> ReportSchedule:
    r = (await s.execute(
        select(ReportSchedule).where(
            ReportSchedule.id == schedule_id, ReportSchedule.tenant_id == user.tenant_id
        )
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Report schedule not found")
    return r


async def _require_report(s: AsyncSession, user: User, report_id) -> ReportDef:
    """The schedule must point at a report that exists in this tenant."""
    rep = (await s.execute(
        select(ReportDef).where(ReportDef.id == report_id, ReportDef.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not rep:
        raise HTTPException(422, "report_id does not reference a known report")
    return rep


# ---- CRUD ----

@router.get("")
async def list_schedules(status: str | None = None, limit: int = 200, offset: int = 0,
                         user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """All report schedules for this tenant, newest first. Optional `?status=ACTIVE|PAUSED`."""
    q = select(ReportSchedule).where(ReportSchedule.tenant_id == user.tenant_id)
    if status:
        q = q.where(ReportSchedule.status == status.upper())
    q = q.order_by(ReportSchedule.created_at.desc())
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(r) for r in _paginate(list(rows), limit, offset)]


@router.get("/{schedule_id}")
async def get_schedule(schedule_id: uuid.UUID, user: User = Depends(current_user),
                       s: AsyncSession = Depends(get_session)):
    return _serialize(await _get_owned(s, user, schedule_id))


@router.post("", status_code=201)
async def create_schedule(payload: dict, user: User = Depends(current_user),
                          s: AsyncSession = Depends(get_session)):
    """Schedule a saved report for recurring delivery. Requires config.manage (a tenant-wide
    automation asset). `report_id`, `cadence`, `channel` required; `recipients` a list of addresses;
    `next_run_at` optional (defaults to now, i.e. due immediately on the next run-due)."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    await _kernel_gate(s, user)  # SPEC §0.2 default-deny (Step 7.2)

    try:
        report_id = uuid.UUID(str(payload.get("report_id")))
    except (TypeError, ValueError):
        raise HTTPException(422, "report_id is required (uuid)")
    await _require_report(s, user, report_id)

    cadence = (payload.get("cadence") or "").strip().lower()
    if cadence not in _CADENCES:
        raise HTTPException(422, f"cadence must be one of {sorted(_CADENCES)}")

    channel = (payload.get("channel") or "").strip()
    if not channel:
        raise HTTPException(422, "channel is required")

    recipients = payload.get("recipients") or []
    if not isinstance(recipients, list):
        raise HTTPException(422, "recipients must be a list of addresses")

    next_run_at = _now()
    if payload.get("next_run_at"):
        try:
            next_run_at = datetime.fromisoformat(str(payload["next_run_at"]))
        except ValueError:
            raise HTTPException(422, "next_run_at must be an ISO-8601 datetime")
        if next_run_at.tzinfo is None:
            next_run_at = next_run_at.replace(tzinfo=timezone.utc)

    owner_node_id = None
    if payload.get("owner_node_id"):
        try:
            owner_node_id = uuid.UUID(str(payload["owner_node_id"]))
        except (TypeError, ValueError):
            raise HTTPException(422, "owner_node_id must be a uuid")

    r = ReportSchedule(
        tenant_id=user.tenant_id, owner_node_id=owner_node_id, report_id=report_id,
        cadence=cadence, channel=channel, recipients=recipients,
        next_run_at=next_run_at, status="ACTIVE",
    )
    s.add(r)
    await s.commit()
    await s.refresh(r)
    return _serialize(r)


@router.patch("/{schedule_id}")
async def update_schedule(schedule_id: uuid.UUID, payload: dict, user: User = Depends(current_user),
                          s: AsyncSession = Depends(get_session)):
    """Edit a schedule. Requires config.manage. Patch cadence/channel/recipients/next_run_at/status
    (status flips ACTIVE<->PAUSED = pause/resume)."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    await _kernel_gate(s, user)  # SPEC §0.2 default-deny (Step 7.2)
    r = await _get_owned(s, user, schedule_id)

    allowed = {"cadence", "channel", "recipients", "next_run_at", "status", "owner_node_id"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(422, f"Cannot patch {sorted(unknown)}; allowed: {sorted(allowed)}")

    if "cadence" in payload:
        v = (payload["cadence"] or "").strip().lower()
        if v not in _CADENCES:
            raise HTTPException(422, f"cadence must be one of {sorted(_CADENCES)}")
        r.cadence = v
    if "channel" in payload:
        v = (payload["channel"] or "").strip()
        if not v:
            raise HTTPException(422, "channel cannot be empty")
        r.channel = v
    if "recipients" in payload:
        if not isinstance(payload["recipients"], list):
            raise HTTPException(422, "recipients must be a list of addresses")
        r.recipients = payload["recipients"]
    if "next_run_at" in payload:
        try:
            nra = datetime.fromisoformat(str(payload["next_run_at"]))
        except ValueError:
            raise HTTPException(422, "next_run_at must be an ISO-8601 datetime")
        if nra.tzinfo is None:
            nra = nra.replace(tzinfo=timezone.utc)
        r.next_run_at = nra
    if "status" in payload:
        v = (payload["status"] or "").strip().upper()
        if v not in _STATUSES:
            raise HTTPException(422, f"status must be one of {sorted(_STATUSES)}")
        r.status = v
    if "owner_node_id" in payload:
        if payload["owner_node_id"] is None:
            r.owner_node_id = None
        else:
            try:
                r.owner_node_id = uuid.UUID(str(payload["owner_node_id"]))
            except (TypeError, ValueError):
                raise HTTPException(422, "owner_node_id must be a uuid")

    await s.commit()
    await s.refresh(r)
    return _serialize(r)


@router.post("/{schedule_id}/pause")
async def pause_schedule(schedule_id: uuid.UUID, user: User = Depends(current_user),
                         s: AsyncSession = Depends(get_session)):
    """Pause a schedule (status -> PAUSED). Convenience action over PATCH; requires config.manage."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    await _kernel_gate(s, user)  # SPEC §0.2 default-deny (Step 7.2)
    r = await _get_owned(s, user, schedule_id)
    r.status = "PAUSED"
    await s.commit()
    await s.refresh(r)
    return _serialize(r)


@router.post("/{schedule_id}/resume")
async def resume_schedule(schedule_id: uuid.UUID, user: User = Depends(current_user),
                          s: AsyncSession = Depends(get_session)):
    """Resume a schedule (status -> ACTIVE). Convenience action over PATCH; requires config.manage."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    await _kernel_gate(s, user)  # SPEC §0.2 default-deny (Step 7.2)
    r = await _get_owned(s, user, schedule_id)
    r.status = "ACTIVE"
    await s.commit()
    await s.refresh(r)
    return _serialize(r)


@router.delete("/{schedule_id}", status_code=204)
async def delete_schedule(schedule_id: uuid.UUID, user: User = Depends(current_user),
                          s: AsyncSession = Depends(get_session)):
    """Delete a schedule. Requires config.manage."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    await _kernel_gate(s, user)  # SPEC §0.2 default-deny (Step 7.2)
    r = await _get_owned(s, user, schedule_id)
    await s.delete(r)
    await s.commit()


# ---- batch job: run due reports ----

def _render_body(report_result: dict) -> tuple[str, str]:
    """Turn a rendered report into a (subject, body) for delivery. Fail-soft: a report that rendered
    an `error` still delivers a body noting it (the run-due summary also counts it)."""
    name = report_result.get("name") or report_result.get("key") or "Report"
    if report_result.get("error"):
        return f"Report: {name} (error)", f"Report '{name}' could not be rendered: {report_result['error']}"
    matched = report_result.get("matched")
    result = report_result.get("result")
    return f"Report: {name}", f"Report '{name}' — matched {matched} record(s):\n{result}"


@router.post("/run-due")
async def run_due(as_of: str | None = None, user: User = Depends(current_user),
                  s: AsyncSession = Depends(get_session)):
    """Render + deliver every ACTIVE schedule due at `as_of` (default now). For each due schedule:
    render the report (reuse report_builder.run_report), dispatch to each recipient via
    channels.dispatch, advance next_run_at by the cadence, stamp last_run_at. Records ONE JobRun
    (`report.run_due`, SUCCESS/ERROR) with summary `{rendered, delivered, errors}`.

    Idempotent per `as_of`: advancing next_run_at past `as_of` means a re-run with the same `as_of`
    re-selects nothing (the slot is consumed). Fail-soft per schedule — one bad render/delivery does
    not abort the rest. Gated on config.manage (a tenant automation job, like the other run-* jobs)."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    await _kernel_gate(s, user)  # SPEC §0.2 default-deny (Step 7.2)

    if as_of:
        try:
            cutoff = datetime.fromisoformat(as_of)
        except ValueError:
            raise HTTPException(422, "as_of must be an ISO-8601 datetime")
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=timezone.utc)
    else:
        cutoff = _now()

    started = _now()
    rendered = delivered = errors = 0
    try:
        due = (await s.execute(
            select(ReportSchedule).where(
                ReportSchedule.tenant_id == user.tenant_id,
                ReportSchedule.status == "ACTIVE",
                ReportSchedule.next_run_at <= cutoff,
            ).order_by(ReportSchedule.next_run_at)
        )).scalars().all()

        for sch in due:
            try:
                # RENDER — reuse the exact saved-report run (org-scoped, fail-soft; returns dict).
                report_result = await run_report(sch.report_id, user=user, s=s)
                if report_result.get("error"):
                    errors += 1
                else:
                    rendered += 1
                subject, body = _render_body(report_result)

                # DELIVER — reuse the channel adapter dispatch (logs an OutboundMessage, never raises).
                targets = sch.recipients or [None]   # no recipients ⇒ a single channel-level send
                for to in targets:
                    msg = await channels.dispatch(
                        s, tenant_id=user.tenant_id, channel=sch.channel, to=to,
                        subject=subject, body=body, def_key="report.scheduled", user_id=user.id,
                    )
                    # dispatch returns None for inapp (no-op delivery) — count it as delivered;
                    # otherwise count a non-FAILED OutboundMessage as delivered.
                    if msg is None or msg.status != "FAILED":
                        delivered += 1
                    else:
                        errors += 1

                # ADVANCE the slot past the cutoff so this as_of won't re-select it (idempotency).
                nxt = sch.next_run_at
                while nxt <= cutoff:
                    nxt = _advance(nxt, sch.cadence)
                sch.next_run_at = nxt
                sch.last_run_at = started
            except Exception as e:   # fail-soft per schedule — keep going
                errors += 1
                # leave next_run_at untouched so the schedule is retried next run-due

        summary = {"rendered": rendered, "delivered": delivered, "errors": errors, "due": len(due)}
        _record_job_run(s, user, "report.run_due", "SUCCESS", summary, started)
        await s.commit()
        return summary
    except Exception as e:
        await s.rollback()
        _record_job_run(s, user, "report.run_due", "ERROR", {"message": str(e)}, started)
        await s.commit()
        raise
