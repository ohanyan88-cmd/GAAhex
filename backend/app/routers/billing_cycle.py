"""Billing-cycle run (E20): bill the whole book for a period — idempotently.

The single-subscription endpoint `POST /api/subscriptions/{id}/generate-invoice` mints one invoice
at a time and can't bill a whole tenant for a period. This router adds `POST /api/billing/run-cycle`:
it walks every ACTIVE subscription that is DUE and mints an **ISSUED** invoice for each, in one
transaction, never billing the same subscription twice for the same period.

DUE-LOGIC — chosen column: `last_invoiced_at` (not next_invoice_at).
  Why last_invoiced_at: it records *what already happened* (a fact), so the run is a pure function of
  (subscriptions, as_of) — re-runnable and auditable — whereas next_invoice_at is a mutable *schedule*
  also written by the manual generate-invoice path, so keying idempotency off it would entangle the two
  flows. A subscription is DUE when it was never cycle-billed (`last_invoiced_at IS NULL`) OR its last
  cycle-bill is a full `cycle` (or more) behind `as_of` (`_add_cycle(last_invoiced_at) <= as_of`). After
  billing we stamp `last_invoiced_at = as_of`, so the next due date moves strictly past `as_of` and a
  second run for the same `as_of` generates 0. The cadence derives from each sub's own `cycle` —
  nothing hardcoded.

We REUSE billing.py's primitives (`_add_cycle`, `_next_invoice_number`, `_now`, `_deny`,
DEFAULT_DUE_DAYS) and build each invoice exactly like `generate_invoice`, then issue it in place
(status ISSUED + issued_at + due_at). The existing endpoint is left untouched.

NOTE (wiring): like billing.router, this serves FIXED paths under /api, so the coordinator must
register `billing_cycle.router` BEFORE records.router (which serves /api/{slug}) in main.py.
"""
from datetime import datetime, date, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User
from ..models.billing import Subscription, Invoice, InvoiceLine
from ..access import load_grants, can
from .. import workflow
from .auth import current_user
from .billing import _deny, _add_cycle, _next_invoice_number, _now, _record_job_run, DEFAULT_DUE_DAYS

router = APIRouter(prefix="/api/billing", tags=["billing"])


def _as_of_dt(payload: dict | None) -> datetime:
    """Resolve the run's reference moment from body `{as_of?: 'YYYY-MM-DD'}` or today (UTC), as a
    timezone-aware datetime pinned to midnight so date-only input compares cleanly against the
    timestamp columns."""
    raw = (payload or {}).get("as_of")
    if raw in (None, ""):
        d = _now().date()
    else:
        try:
            d = date.fromisoformat(str(raw))
        except (TypeError, ValueError):
            raise HTTPException(422, "'as_of' must be an ISO date (YYYY-MM-DD)")
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _is_due(sub: Subscription, as_of: datetime) -> bool:
    """Never cycle-billed, or the last cycle-bill is a full `cycle` (or more) behind `as_of`."""
    if sub.last_invoiced_at is None:
        return True
    return _add_cycle(sub.last_invoiced_at, sub.cycle) <= as_of


async def _bill_one(s: AsyncSession, user: User, sub: Subscription, as_of: datetime) -> Invoice:
    """Mint one ISSUED invoice for `sub`'s current period — same construction as generate_invoice,
    then issued in place — and stamp the idempotency markers. Runs inside the caller's savepoint."""
    period_start = sub.next_invoice_at or sub.started_at or as_of
    period_end = _add_cycle(period_start, sub.cycle)
    number = await _next_invoice_number(s, user.tenant_id)
    inv = Invoice(
        tenant_id=user.tenant_id, owner_node_id=sub.owner_node_id, customer_id=sub.customer_id,
        number=number, period_start=period_start, period_end=period_end, status="ISSUED",
        total=sub.amount, issued_at=as_of, due_at=as_of + timedelta(days=DEFAULT_DUE_DAYS),
    )
    s.add(inv)
    await s.flush()
    s.add(InvoiceLine(tenant_id=user.tenant_id, invoice_id=inv.id, description=sub.plan_name,
                      quantity=1, unit_amount=sub.amount, line_total=sub.amount))
    sub.next_invoice_at = period_end          # advance the manual schedule, as generate_invoice does
    sub.last_invoiced_at = as_of              # idempotency marker for the cycle run
    await workflow.emit(s, user.tenant_id, "CREATE", "invoice", inv.id, user.id,
                        {"number": number, "total": sub.amount, "from_subscription": str(sub.id),
                         "status": "ISSUED", "via": "run-cycle"})
    return inv


@router.post("/run-cycle")
async def run_cycle(payload: dict | None = None, user: User = Depends(current_user),
                    s: AsyncSession = Depends(get_session)):
    """Generate an ISSUED invoice for every ACTIVE, due subscription in the tenant. Idempotent per
    `as_of` (a second run for the same `as_of` generates 0). Gated on invoice.create (it mints
    invoices) — the same privileged tenant-wide pattern as run-dunning's invoice.edit gate.

    Fail-soft: each subscription is billed inside its own SAVEPOINT, so one failure rolls back only
    that subscription and is reported in `errors` — it never aborts the batch. One final commit
    persists the whole successful set atomically.
    """
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "create"):
        _deny("invoice.create")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="create", entity_key="invoice",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    started = _now()
    try:
        as_of = _as_of_dt(payload)
        subs = (await s.execute(
            select(Subscription).where(
                Subscription.tenant_id == user.tenant_id, Subscription.status == "ACTIVE"
            ).order_by(Subscription.created_at)
        )).scalars().all()

        generated, skipped, errors, invoice_ids = 0, 0, [], []
        for sub in subs:
            if not _is_due(sub, as_of):
                skipped += 1
                continue
            try:
                async with s.begin_nested():  # per-sub savepoint: a failure rolls back only this sub
                    inv = await _bill_one(s, user, sub, as_of)
                generated += 1
                invoice_ids.append(str(inv.id))
            except Exception as e:            # fail-soft: collect + report, keep the batch going
                errors.append({"subscription_id": str(sub.id), "message": str(e)})

        result = {"as_of": as_of.date().isoformat(), "generated": generated, "skipped": skipped,
                  "errors": errors, "invoices": invoice_ids}
        # J96 job log: SUCCESS — the per-sub fail-soft errors live inside the summary, not a job error.
        _record_job_run(s, user, "billing.run_cycle", "SUCCESS",
                        {"as_of": result["as_of"], "generated": generated, "skipped": skipped,
                         "errors": errors}, started)
        await s.commit()                      # persist invoices + the JobRun atomically
        return result
    except Exception as e:                    # an unexpected failure of the whole run
        await s.rollback()
        _record_job_run(s, user, "billing.run_cycle", "ERROR", {"message": str(e)}, started)
        await s.commit()
        raise
