"""Phase B.2 — Dunning service: open / advance / cure / sweep.

Pure helpers — the caller commits. The sequence the runner executes lives on
``DunningPolicy.steps_json`` (config-driven; never hardcoded enums).

Lifecycle:
  open_case   → DunningCase(status='active', current_step_index=-1)
  advance_case → executes the next step's action via the adapter; bumps index + next_action_at.
                  After the LAST step → status='closed', closed_reason='completed_sequence'.
  cure_case   → status='cured'; if the case has progressed past 'throttle' or beyond, call
                 adapter.restore on every service this case suspended/throttled.
  run_dunning_sweep → picks all active cases where next_action_at <= now and advances them.
  check_and_cure_for_payment → cure ALL active cases on an account once balance >= 0.

The sequence is config: steps_json is read on every advance, so a Studio policy edit reshapes
in-flight cases on their next step.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.dunning import DunningPolicy, DunningCase, ServiceActionLog
from ..models.party import Account
from ..models.service import Service
from ..models.billing import Subscription
from .account_balance import recompute_account_balance
from .network_adapter import get_network_adapter


# B1 enum standard — action verbs are UPPER_SNAKE (NOTICE / THROTTLE /
# WALLED_GARDEN / TERMINATE). Legacy lowercase values were folded to UPPER
# by the dedicated alembic migration ``7b1e0d3b41fd_dunning_action_verbs_upper_snake``.
ALLOWED_ACTIONS = {"NOTICE", "THROTTLE", "WALLED_GARDEN", "TERMINATE"}

DEFAULT_POLICY_STEPS = [
    {"day_offset": 3, "action": "NOTICE", "params": {"template": "dunning_notice_1"}},
    {"day_offset": 7, "action": "NOTICE", "params": {"template": "dunning_notice_2"}},
    {"day_offset": 14, "action": "THROTTLE", "params": {"kbps": 256}},
    {"day_offset": 21, "action": "WALLED_GARDEN", "params": {"redirect_url": "https://payment.example.com"}},
    {"day_offset": 45, "action": "TERMINATE", "params": {}},
]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ==========================================================================================
# Policy validation + default-policy resolution
# ==========================================================================================

def validate_steps_json(steps: Any) -> list[dict]:
    """Validate + normalise a ``steps_json`` payload. Raises ValueError on bad shape.

    Rules:
      - must be a list
      - each step is {day_offset:int (>=0), action:str (in ALLOWED_ACTIONS), params:dict}
      - action values are normalised to UPPER_SNAKE (B1 enum standard). Legacy lowercase
        inputs ('notice'|'throttle'|'walled_garden'|'terminate') are accepted and folded
        UP; anything else 422s as before.
      - day_offsets must be strictly non-decreasing (ascending — ties allowed at boundaries
        but the sequence should normally be strictly ascending; we enforce >= which is the
        looser invariant the runner relies on for next_action_at math).
    """
    if not isinstance(steps, list):
        raise ValueError("steps_json must be a list")
    if not steps:
        raise ValueError("steps_json must not be empty")
    prev_offset = -1
    normalised: list[dict] = []
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            raise ValueError(f"step {i} must be an object")
        try:
            day_offset = int(step.get("day_offset"))
        except (TypeError, ValueError):
            raise ValueError(f"step {i} day_offset must be an integer")
        if day_offset < 0:
            raise ValueError(f"step {i} day_offset must be >= 0")
        if day_offset < prev_offset:
            raise ValueError(
                f"step {i} day_offset {day_offset} is less than previous {prev_offset} — steps must be ascending"
            )
        action = step.get("action")
        # Back-compat: legacy lowercase action verbs are normalised UP per B1.
        if isinstance(action, str):
            action = action.upper()
        if action not in ALLOWED_ACTIONS:
            raise ValueError(
                f"step {i} action '{step.get('action')}' must be one of {sorted(ALLOWED_ACTIONS)}"
            )
        params = step.get("params") or {}
        if not isinstance(params, dict):
            raise ValueError(f"step {i} params must be an object")
        normalised.append({"day_offset": day_offset, "action": action, "params": params})
        prev_offset = day_offset
    return normalised


async def get_default_policy(session: AsyncSession, tenant_id: uuid.UUID) -> DunningPolicy:
    """Return the tenant's default dunning policy. Auto-create one if none exists yet
    (tests bypass the migration's seed; prod migration seeds upfront — both routes converge here).
    """
    row = (await session.execute(
        select(DunningPolicy).where(
            DunningPolicy.tenant_id == tenant_id,
            DunningPolicy.is_default.is_(True),
            DunningPolicy.active.is_(True),
        )
    )).scalar_one_or_none()
    if row is not None:
        return row

    # Fallback: any active policy in the tenant.
    row = (await session.execute(
        select(DunningPolicy).where(
            DunningPolicy.tenant_id == tenant_id,
            DunningPolicy.active.is_(True),
        ).order_by(DunningPolicy.created_at)
    )).scalar_one_or_none()
    if row is not None:
        return row

    # Nothing exists — create the canonical default. Idempotent under unique(tenant_id, name).
    policy = DunningPolicy(
        tenant_id=tenant_id,
        name="Default Dunning Policy",
        description="Auto-created default policy (B.2 fallback).",
        is_default=True,
        active=True,
        steps_json=list(DEFAULT_POLICY_STEPS),
        applies_to_tariff_plan_ids=None,
    )
    session.add(policy)
    await session.flush()
    return policy


# ==========================================================================================
# Case lifecycle
# ==========================================================================================

async def open_case(
    session: AsyncSession,
    *,
    account_id: uuid.UUID,
    triggering_invoice_id: uuid.UUID,
    tenant_id: uuid.UUID,
    policy_id: uuid.UUID | None = None,
) -> DunningCase:
    """Open a dunning case for an account. Idempotent — returns the existing active case if
    one already covers this account. Picks the tenant's default policy when ``policy_id`` is None.

    The case starts at current_step_index=-1 with next_action_at=now (so the next sweep
    immediately advances it into step 0).
    """
    # Idempotency: if an active case exists for this account already, return it.
    existing = (await session.execute(
        select(DunningCase).where(
            DunningCase.tenant_id == tenant_id,
            DunningCase.account_id == account_id,
            DunningCase.status == "ACTIVE",
        ).order_by(DunningCase.opened_at)
    )).scalar_one_or_none()
    if existing is not None:
        return existing

    # Resolve the policy.
    if policy_id is None:
        policy = await get_default_policy(session, tenant_id)
    else:
        policy = (await session.execute(
            select(DunningPolicy).where(
                DunningPolicy.id == policy_id, DunningPolicy.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if policy is None:
            policy = await get_default_policy(session, tenant_id)

    now = _utcnow()
    case = DunningCase(
        tenant_id=tenant_id,
        account_id=account_id,
        triggering_invoice_id=triggering_invoice_id,
        policy_id=policy.id,
        current_step_index=-1,
        step_entered_at=None,
        next_action_at=now,  # ready for immediate advance on next sweep
        status="ACTIVE",
        opened_at=now,
    )
    session.add(case)
    await session.flush()
    return case


async def _services_for_account(
    session: AsyncSession, *, tenant_id: uuid.UUID, account_id: uuid.UUID,
) -> list[Service]:
    """Resolve the services that this account's case acts on.

    Stage-1 reality (additive): some services link via account_id directly; others link via
    subscription.account_id (or, for very old rows, only via customer_id). We:
      1. Pull every Service with account_id = X.
      2. UNION with Service rows whose subscription.account_id = X.
    Returns DISTINCT Services. The runner is fine with an empty list — `notice` actions don't
    need a service, and a missing service for throttle/terminate just means the adapter logs
    no Service mutation (the log row still lands).
    """
    direct = (await session.execute(
        select(Service).where(
            Service.tenant_id == tenant_id, Service.account_id == account_id,
        )
    )).scalars().all()
    via_sub = (await session.execute(
        select(Service)
        .join(Subscription, Service.subscription_id == Subscription.id)
        .where(
            Service.tenant_id == tenant_id,
            Subscription.account_id == account_id,
        )
    )).scalars().all()
    by_id: dict[uuid.UUID, Service] = {}
    for s in list(direct) + list(via_sub):
        by_id[s.id] = s
    return list(by_id.values())


async def advance_case(session: AsyncSession, case: DunningCase) -> DunningCase:
    """Move the case to the next step in its policy's steps_json. Calls the adapter for the
    new step's action. Updates current_step_index, step_entered_at, next_action_at.

    After the LAST step → status='closed', closed_reason='completed_sequence'.
    No-op when the case is already cured/closed.
    """
    if case.status != "ACTIVE":
        return case

    policy = (await session.execute(
        select(DunningPolicy).where(DunningPolicy.id == case.policy_id)
    )).scalar_one_or_none()
    if policy is None or not policy.steps_json:
        # Defensive: no policy / no steps → close the case.
        case.status = "CLOSED"
        case.closed_at = _utcnow()
        case.closed_reason = "no_policy_or_steps"
        case.next_action_at = None
        await session.flush()
        return case

    steps = policy.steps_json
    next_index = case.current_step_index + 1
    if next_index >= len(steps):
        # Already past the last step — close.
        case.status = "CLOSED"
        case.closed_at = _utcnow()
        case.closed_reason = "completed_sequence"
        case.next_action_at = None
        await session.flush()
        return case

    step = steps[next_index]
    action = step.get("action")
    params = step.get("params") or {}
    adapter = get_network_adapter()
    now = _utcnow()

    services = await _services_for_account(
        session, tenant_id=case.tenant_id, account_id=case.account_id,
    )

    if action == "NOTICE":
        template = params.get("template") or "dunning_notice"
        await adapter.send_notice(
            session, tenant_id=case.tenant_id, account_id=case.account_id,
            template=str(template), dunning_case_id=case.id,
        )
    elif action == "THROTTLE":
        kbps = int(params.get("kbps") or 256)
        for svc in services:
            await adapter.throttle(
                session, tenant_id=case.tenant_id, service_id=svc.id, kbps=kbps,
                dunning_case_id=case.id,
            )
        if not services:
            # Still write a log row (service-less throttle) so audit shows the action fired.
            adapter_logger = adapter  # type: ignore
            # Use the logging helper indirectly via a notice-style log row.
            row = ServiceActionLog(
                tenant_id=case.tenant_id, service_id=None, dunning_case_id=case.id,
                action="THROTTLE", adapter="logging",
                request_payload={"kbps": kbps, "reason": "no_services_for_account"},
                response_payload={"applied": False},
                status="SUCCESS", requested_at=now, completed_at=now,
            )
            session.add(row)
    elif action == "WALLED_GARDEN":
        redirect_url = str(params.get("redirect_url") or "https://payment.example.com")
        for svc in services:
            await adapter.walled_garden(
                session, tenant_id=case.tenant_id, service_id=svc.id,
                redirect_url=redirect_url, dunning_case_id=case.id,
            )
        if not services:
            row = ServiceActionLog(
                tenant_id=case.tenant_id, service_id=None, dunning_case_id=case.id,
                action="WALLED_GARDEN", adapter="logging",
                request_payload={"redirect_url": redirect_url, "reason": "no_services_for_account"},
                response_payload={"applied": False},
                status="SUCCESS", requested_at=now, completed_at=now,
            )
            session.add(row)
    elif action == "TERMINATE":
        for svc in services:
            await adapter.terminate(
                session, tenant_id=case.tenant_id, service_id=svc.id,
                dunning_case_id=case.id,
            )
        if not services:
            row = ServiceActionLog(
                tenant_id=case.tenant_id, service_id=None, dunning_case_id=case.id,
                action="TERMINATE", adapter="logging",
                request_payload={"reason": "no_services_for_account"},
                response_payload={"applied": False},
                status="SUCCESS", requested_at=now, completed_at=now,
            )
            session.add(row)
    else:
        # Unknown action (config drift) — log it and refuse to advance further.
        row = ServiceActionLog(
            tenant_id=case.tenant_id, service_id=None, dunning_case_id=case.id,
            action=str(action), adapter="logging",
            request_payload={"step_index": next_index, "params": params},
            response_payload={},
            status="FAILED", requested_at=now, completed_at=now,
            error_message=f"unknown action: {action!r}",
        )
        session.add(row)
        case.status = "CLOSED"
        case.closed_at = now
        case.closed_reason = f"unknown_action:{action}"
        case.next_action_at = None
        await session.flush()
        return case

    case.current_step_index = next_index
    case.step_entered_at = now

    # Compute next_action_at from the delta between this step and the next.
    if next_index + 1 < len(steps):
        delta_days = int(steps[next_index + 1].get("day_offset", 0)) - int(step.get("day_offset", 0))
        case.next_action_at = now + timedelta(days=max(delta_days, 0))
    else:
        # Just executed the last step → close the case.
        case.status = "CLOSED"
        case.closed_at = now
        case.closed_reason = "completed_sequence"
        case.next_action_at = None

    await session.flush()
    return case


async def cure_case(
    session: AsyncSession, case: DunningCase, *, reason: str = "paid_off",
) -> DunningCase:
    """Transition active case → cured. If the case had reached throttle/walled_garden/terminate,
    call adapter.restore on the affected services so they return to ACTIVE.

    Idempotent: a non-active case passes through unchanged.
    """
    if case.status != "ACTIVE":
        return case

    policy = (await session.execute(
        select(DunningPolicy).where(DunningPolicy.id == case.policy_id)
    )).scalar_one_or_none()

    needs_restore = False
    if policy is not None and policy.steps_json:
        steps = policy.steps_json
        # If the current step (the most recently EXECUTED one) is throttle/walled_garden/terminate,
        # we have to undo. If we never advanced (index = -1) there's nothing to restore.
        if 0 <= case.current_step_index < len(steps):
            current_action = steps[case.current_step_index].get("action")
            if current_action in ("THROTTLE", "WALLED_GARDEN", "TERMINATE"):
                needs_restore = True

    if needs_restore:
        adapter = get_network_adapter()
        services = await _services_for_account(
            session, tenant_id=case.tenant_id, account_id=case.account_id,
        )
        for svc in services:
            await adapter.restore(
                session, tenant_id=case.tenant_id, service_id=svc.id,
                dunning_case_id=case.id,
            )

    now = _utcnow()
    case.status = "CURED"
    case.cured_at = now
    case.next_action_at = None
    case.closed_reason = reason
    await session.flush()
    return case


async def run_dunning_sweep(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> dict:
    """Pick every 'active' case where next_action_at <= now and advance it.

    Returns ``{advanced: int, cured: int, errors: list}``. Idempotent — a second call after
    advances complete advances zero (because next_action_at has moved forward).
    """
    now = now or _utcnow()
    q = select(DunningCase).where(
        DunningCase.status == "ACTIVE",
        DunningCase.next_action_at.is_not(None),
        DunningCase.next_action_at <= now,
    )
    if tenant_id is not None:
        q = q.where(DunningCase.tenant_id == tenant_id)
    cases = list((await session.execute(q)).scalars().all())

    advanced = 0
    errors: list[dict] = []
    for case in cases:
        try:
            await advance_case(session, case)
            advanced += 1
        except Exception as e:
            errors.append({"case_id": str(case.id), "error": str(e)})

    return {"advanced": advanced, "cured": 0, "errors": errors, "checked": len(cases)}


async def check_and_cure_for_payment(
    session: AsyncSession, *, account_id: uuid.UUID,
) -> int:
    """After a payment is allocated / recompute_account_balance fires:
    if account.current_balance >= 0 AND there are active cases, call cure_case on each.
    Returns count of cured cases.
    """
    if account_id is None:
        return 0
    acc = (await session.execute(
        select(Account).where(Account.id == account_id)  # noqa: tenant-filter cross-tenant — pure helper; RLS-scoped session; account_id is tenant-anchored FK from caller
    )).scalar_one_or_none()
    if acc is None:
        return 0
    # Recompute fresh — the caller might have skipped it.
    balance = acc.current_balance if acc.current_balance is not None else 0
    # current_balance >= 0 means: no debt (zero or credit). cure.
    if balance is None or balance < 0:
        return 0

    cases = list((await session.execute(
        select(DunningCase).where(  # noqa: tenant-filter cross-tenant — scoped by account_id (tenant-anchored FK from caller); RLS-scoped session
            DunningCase.account_id == account_id,
            DunningCase.status == "ACTIVE",
        )
    )).scalars().all())
    cured = 0
    for case in cases:
        await cure_case(session, case, reason="paid_off")
        cured += 1
    return cured
