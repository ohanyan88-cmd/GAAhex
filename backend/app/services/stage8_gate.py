"""Phase B.1 — Stage 8 Control Gate predicate (SPEC §3 / §10.4).

The kernel module ``kernel/control_gate.py`` enforces the gate (raises ``ControlGateNotPassed``
when ``order.control_pass != True``). THIS module is the upstream service that *computes* whether
``control_pass`` should be TRUE — it inspects the order + linked payment_method + mandatory
approvals + credit verdict and returns a structured per-check result so the UI can render the
"Stage 8 status" panel and the router can decide whether to advance.

Predicate (formal):
    pass = TRUE iff
      order.credit_check_status == 'PASS'                                AND
      (deposit_required IS NULL                                          OR
       deposit_collected IS NOT NULL AND deposit_collected >= deposit_required) AND
      (payment_method_id IS NULL                                         OR
       linked payment_method exists AND status='active' AND not expired) AND
      no PENDING mandatory_approvals rows targeting (entity='order', id=order_id)

Two functions are exposed:
  * ``compute_stage8_status`` — pure read; returns {pass, blockers, checks}
  * ``apply_stage8_result``   — writes order.control_pass + control_pass_at/by + block_reason
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.approval import Approval
from ..models.order import Order
from ..models.payment_method import PaymentMethod


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _load_order(s: AsyncSession, order_id: uuid.UUID) -> Order:
    o = (await s.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if o is None:
        raise ValueError(f"Order {order_id} not found")
    return o


async def _load_payment_method(
    s: AsyncSession, payment_method_id: uuid.UUID | None,
) -> PaymentMethod | None:
    if payment_method_id is None:
        return None
    return (await s.execute(
        select(PaymentMethod).where(PaymentMethod.id == payment_method_id)
    )).scalar_one_or_none()


async def _count_pending_approvals(s: AsyncSession, order_id: uuid.UUID) -> int:
    """How many SPEC §4.5 mandatory-approval rows are still PENDING for this order?

    Reads the ``approval`` table — the SPEC §4.5 canonical mandatory-approvals registry — using
    ``target_entity_key`` + ``target_record_id`` as the polymorphic pointer. The ``pending_approval``
    table (workflow-transition parking lot) is intentionally NOT consulted here; Stage 8 is the
    SPEC §4.5 gate, not the M12 workflow gate.
    """
    rows = (await s.execute(
        select(Approval).where(
            Approval.target_entity_key == "order",
            Approval.target_record_id == order_id,
            Approval.status == "PENDING",
        )
    )).scalars().all()
    return len(rows)


def _is_card_expired(pm: PaymentMethod, *, now: datetime | None = None) -> bool:
    """True when the (exp_year, exp_month) tuple is in the past relative to ``now`` (UTC).

    A card expiring in May 2026 stays valid through 2026-05-31 23:59 UTC and becomes expired
    on 2026-06-01 00:00 UTC. We compare (year, month) tuples — calendar day is irrelevant for
    standard card expiry semantics.
    """
    now = now or _now()
    return (pm.exp_year, pm.exp_month) < (now.year, now.month)


async def compute_stage8_status(
    s: AsyncSession, order_id: uuid.UUID,
) -> dict:
    """Stage 8 predicate (read-only).

    Returns:
        {
            'pass': bool,
            'blockers': list[str],   # human-readable reasons (empty when pass=True)
            'checks': {
                'credit_check':         'PASS' | 'FAIL' | 'PENDING',
                'deposit':              'PASS' | 'FAIL' | 'NOT_REQUIRED',
                'payment_method':       'PASS' | 'FAIL' | 'EXPIRED' | 'NOT_LINKED',
                'mandatory_approvals':  'PASS' | 'PENDING',
            },
        }

    Does NOT mutate the order. Safe to call repeatedly (UI polling, idempotency).
    """
    order = await _load_order(s, order_id)
    pm = await _load_payment_method(s, order.payment_method_id)
    pending_approvals = await _count_pending_approvals(s, order_id)

    checks: dict[str, str] = {}
    blockers: list[str] = []

    # ---- credit check -----------------------------------------------------------------
    cc = (order.credit_check_status or "").upper()
    if cc == "PASS":
        checks["credit_check"] = "PASS"
    elif cc == "FAIL":
        checks["credit_check"] = "FAIL"
        blockers.append("credit check failed")
    else:
        # NULL or any non-PASS/FAIL string — treat as pending
        checks["credit_check"] = "PENDING"
        blockers.append("credit check pending")

    # ---- deposit ----------------------------------------------------------------------
    req = order.deposit_required
    col = order.deposit_collected
    if req is None or Decimal(req) <= Decimal("0"):
        checks["deposit"] = "NOT_REQUIRED"
    else:
        collected = Decimal(col) if col is not None else Decimal("0")
        if collected >= Decimal(req):
            checks["deposit"] = "PASS"
        else:
            checks["deposit"] = "FAIL"
            blockers.append(
                f"deposit not collected (required {Decimal(req)}, collected {collected})"
            )

    # ---- payment method ---------------------------------------------------------------
    if order.payment_method_id is None:
        # Spec: a NULL payment_method_id is allowed (treated as PASS — order can still pass
        # Stage 8 without a card on file; the card is needed downstream at billing time).
        checks["payment_method"] = "NOT_LINKED"
    elif pm is None:
        # The order points at a payment_method that no longer exists (was soft-deleted or the
        # row was never created). Surface as FAIL — caller must relink.
        checks["payment_method"] = "FAIL"
        blockers.append("payment method not found")
    elif _is_card_expired(pm):
        checks["payment_method"] = "EXPIRED"
        blockers.append(f"payment method expired ({pm.exp_month:02d}/{pm.exp_year})")
    elif pm.status != "active":
        checks["payment_method"] = "FAIL"
        blockers.append(f"payment method status is {pm.status!r}, expected 'active'")
    else:
        checks["payment_method"] = "PASS"

    # ---- mandatory approvals ----------------------------------------------------------
    if pending_approvals == 0:
        checks["mandatory_approvals"] = "PASS"
    else:
        checks["mandatory_approvals"] = "PENDING"
        blockers.append(f"{pending_approvals} mandatory approval(s) pending")

    return {
        "pass": len(blockers) == 0,
        "blockers": blockers,
        "checks": checks,
    }


async def apply_stage8_result(
    s: AsyncSession,
    order_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> Order:
    """Run the Stage 8 predicate and persist the verdict to the order.

    Writes:
      * ``control_pass``               — True / False (never NULL; this function decides)
      * ``control_pass_at``            — now() (UTC)
      * ``control_pass_by``            — actor_id (the caller's user.id)
      * ``control_gate_block_reason``  — ' | '.join(blockers) when not pass, else None

    Returns the updated (in-session) Order. Caller is responsible for the surrounding commit.
    Idempotent: repeated calls produce the same result for the same inputs.
    """
    result = await compute_stage8_status(s, order_id)
    order = await _load_order(s, order_id)

    order.control_pass = bool(result["pass"])
    order.control_pass_at = _now()
    order.control_pass_by = actor_id
    order.control_gate_block_reason = (
        None if result["pass"] else " | ".join(result["blockers"])
    )
    return order
