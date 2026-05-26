"""Background scheduler (E25 / J92) — auto-fire the batch jobs per active tenant.

Today `run-dunning` (billing), `run-cycle` (billing-cycle) and `run-due` (report schedules) are
endpoints a human (or cron) must call by hand, once per tenant. This module turns them into an
optional, **disabled-by-default** asyncio background task that wakes on an interval and fires all
three for every ACTIVE tenant — reusing the existing handler LOGIC unchanged (nothing here is a
reimplementation of billing/report rules).

DESIGN
------
- **Disabled by default.** The loop is gated on a feature flag read via
  `getattr(settings, "scheduler_enabled", False)`. With the flag unset (tests/dev) `start_scheduler`
  is a complete no-op: it spawns no task, opens no connection, changes zero behavior. The flag is
  read defensively so `config.py` need not be edited (no collision with the coordinator).

- **Cross-tenant via the OWNER session.** A scheduler is pre/cross-tenant, exactly like the
  seed/provisioning path, so it runs on `OwnerSessionLocal` (RLS-bypass). Every reused handler
  already filters by `user.tenant_id`, so the owner session (which carries no tenant GUC) is the
  correct privileged context — the same pattern `routers/admin.py` provisioning uses.

- **System actor per tenant.** Each handler needs a `User` (for the audit/JobRun actor + the
  permission gate). We use the tenant's **first super_admin** — the earliest-created user holding an
  Assignment to the RoleDef whose `key == "super_admin"` (the `*`-granting role the seed/provisioning
  always create). That actor's `*` grant satisfies every job's `can(...)` gate. If a tenant somehow
  has no super_admin we fall back to its earliest-created user; if it has no users at all the tenant
  is skipped (noted, fail-soft).

- **Fail-soft per tenant AND per job.** One tenant's failure never blocks another; one job's failure
  never blocks the other two for the same tenant. Each job runs in its OWN fresh owner session so a
  handler's internal `rollback()`/`commit()` can't bleed across jobs. Each handler already records a
  JobRun (SUCCESS/ERROR) via `billing._record_job_run`, so we don't duplicate that logging.

START/STOP CONTRACT (coordinator wires these into the lifespan in `main.py` — NOT edited here):
    from .scheduler import start_scheduler, stop_scheduler
    @asynccontextmanager
    async def lifespan(app):
        ... existing seeds ...
        await start_scheduler(app)     # no-op unless settings.scheduler_enabled is true
        try:
            yield
        finally:
            await stop_scheduler(app)  # cancels + awaits the task cleanly (no-op if never started)

- `start_scheduler(app)` returns immediately when the flag is false (no task spawned). When enabled
  it spawns one asyncio task and stashes it on `app.state.scheduler_task`.
- `stop_scheduler(app)` cancels that task (if any) and awaits its clean cancellation; idempotent and
  safe to call even when the scheduler never started.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import OwnerSessionLocal
from .models import Tenant, User, RoleDef, Assignment

# Reuse the real handler logic — do NOT reimplement billing/report rules.
from .routers.billing import run_dunning
from .routers.billing_cycle import run_cycle
from .routers.report_schedules import run_due

log = logging.getLogger("gaaex.scheduler")

# Sane default cadence: hourly. Overridable via settings.scheduler_interval_seconds when present.
_DEFAULT_INTERVAL_SECONDS = 3600

_STATE_TASK = "scheduler_task"


# --------------------------------------------------------------------------------------------------
# flag + interval (read defensively so config.py need not change)
# --------------------------------------------------------------------------------------------------

def _enabled() -> bool:
    """The master switch. Default OFF — with the flag unset the whole module is inert."""
    return bool(getattr(settings, "scheduler_enabled", False))


def _interval_seconds() -> float:
    """Wake cadence. Defaults to hourly; honors settings.scheduler_interval_seconds if set."""
    try:
        v = float(getattr(settings, "scheduler_interval_seconds", _DEFAULT_INTERVAL_SECONDS))
        return v if v > 0 else _DEFAULT_INTERVAL_SECONDS
    except (TypeError, ValueError):
        return _DEFAULT_INTERVAL_SECONDS


# --------------------------------------------------------------------------------------------------
# tenant iteration + system actor
# --------------------------------------------------------------------------------------------------

async def _active_tenants(s: AsyncSession) -> list[Tenant]:
    """Every ACTIVE tenant, oldest first (stable order)."""
    return list((await s.execute(
        select(Tenant).where(Tenant.status == "active").order_by(Tenant.created_at)
    )).scalars().all())


async def _system_actor(s: AsyncSession, tenant_id) -> User | None:
    """The tenant's first super_admin = the earliest-created User holding an Assignment to the
    RoleDef keyed 'super_admin' (the `*`-granting role seed/provisioning always create). That actor's
    `*` grant satisfies every job's permission gate. Falls back to the tenant's earliest user; None if
    the tenant has no users at all (caller skips it, fail-soft)."""
    sa = (await s.execute(
        select(User)
        .join(Assignment, Assignment.user_id == User.id)
        .join(RoleDef, RoleDef.id == Assignment.role_id)
        .where(
            User.tenant_id == tenant_id,
            Assignment.tenant_id == tenant_id,
            RoleDef.key == "super_admin",
        )
        .order_by(User.created_at)
    )).scalars().first()
    if sa is not None:
        return sa
    # Fallback: any user (earliest). Note: a non-super_admin actor may be denied by a job's gate —
    # that denial is caught per-job below and reported, never fatal.
    return (await s.execute(
        select(User).where(User.tenant_id == tenant_id).order_by(User.created_at)
    )).scalars().first()


# --------------------------------------------------------------------------------------------------
# per-job invocation (each on its own fresh owner session, fully fail-soft)
# --------------------------------------------------------------------------------------------------

# (label, coroutine-factory). Each factory takes (actor) and returns the handler coroutine, called
# with a fresh owner session. Signatures differ across the three handlers — keyword args keep it
# explicit and bypass FastAPI's Depends() defaults (those only matter under request injection).
_JOBS = (
    ("billing.run_dunning", lambda s, actor: run_dunning(user=actor, s=s)),
    ("billing.run_cycle",   lambda s, actor: run_cycle(payload=None, user=actor, s=s)),
    ("report.run_due",      lambda s, actor: run_due(as_of=None, user=actor, s=s)),
)


async def _run_one_job(label: str, factory, actor: User) -> None:
    """Invoke one reused handler on a fresh owner session. Fail-soft: any exception is logged and
    swallowed so neither the other jobs nor other tenants are affected. The handler itself already
    records a JobRun (SUCCESS/ERROR) — we don't duplicate that."""
    try:
        async with OwnerSessionLocal() as s:
            await factory(s, actor)
    except Exception:  # noqa: BLE001 — fail-soft is the contract
        log.exception("scheduler: job %s failed for tenant %s (actor %s)",
                      label, getattr(actor, "tenant_id", None), getattr(actor, "id", None))


async def _run_tenant(tenant: Tenant) -> None:
    """Run all three jobs for one tenant, fail-soft per job."""
    # Resolve the actor on its own short session.
    async with OwnerSessionLocal() as s:
        actor = await _system_actor(s, tenant.id)
    if actor is None:
        log.warning("scheduler: tenant %s has no usable system actor — skipping", tenant.id)
        return
    for label, factory in _JOBS:
        await _run_one_job(label, factory, actor)


async def _run_once() -> None:
    """One full sweep: every active tenant, all three jobs, fail-soft per tenant + per job."""
    async with OwnerSessionLocal() as s:
        tenants = await _active_tenants(s)
    for t in tenants:
        try:
            await _run_tenant(t)
        except Exception:  # noqa: BLE001 — a tenant-level failure never stops the sweep
            log.exception("scheduler: sweep failed for tenant %s", t.id)


# --------------------------------------------------------------------------------------------------
# the background loop + start/stop contract
# --------------------------------------------------------------------------------------------------

async def _loop() -> None:
    """Wake on the configured interval and run a sweep. Cancellation (from stop_scheduler) propagates
    cleanly out of the sleep. A sweep failure is fully contained — the loop keeps running."""
    interval = _interval_seconds()
    log.info("scheduler: started (interval=%.0fs)", interval)
    try:
        while True:
            try:
                await _run_once()
            except Exception:  # noqa: BLE001 — never let a sweep kill the loop
                log.exception("scheduler: sweep raised; continuing")
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        log.info("scheduler: stopping (cancelled)")
        raise


async def start_scheduler(app) -> None:
    """Coordinator calls this in the lifespan. No-op (no task spawned) unless the feature flag is on.
    Idempotent: a second call while a task is already running does nothing."""
    if not _enabled():
        return
    existing = getattr(app.state, _STATE_TASK, None)
    if existing is not None and not existing.done():
        return
    task = asyncio.create_task(_loop(), name="gaaex-scheduler")
    setattr(app.state, _STATE_TASK, task)


async def stop_scheduler(app) -> None:
    """Coordinator calls this on shutdown. Cancels + awaits the task cleanly. Safe/idempotent even if
    the scheduler never started (flag off) — then there is no task to cancel."""
    task = getattr(app.state, _STATE_TASK, None)
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001 — shutdown must not raise
        log.exception("scheduler: error while stopping")
    finally:
        setattr(app.state, _STATE_TASK, None)
