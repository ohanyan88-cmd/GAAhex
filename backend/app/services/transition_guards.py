"""Named transition guards — config declares a guard by name; the kernel holds the implementation.

PERFECT-TARGET I3: a WorkflowDef transition may reference a guard (e.g. `guard: "control_gate:stage8"`).
The transition path resolves the name through NAMED_GUARDS and runs the registered implementation. The
Revenue-Control domain owns the Stage-8 control gate — the revenue safety that blocks fulfillment until
credit / deposit / payment-method / mandatory-approvals clear. Config declares it; the kernel enforces it.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from ..kernel import assert_can_advance_to_scheduling, ControlGateNotPassed
from .stage8_gate import compute_stage8_status


async def control_gate_stage8(s: AsyncSession, order) -> tuple[bool, str | None]:
    """SPEC §3 / §10.4 Stage-8 Control Gate. Blocks order_validated → scheduling unless the control
    predicate passes. Returns (ok, reason). Behaviour is identical to the prior inline check in
    orders.advance — when control_pass isn't already TRUE, compute the full predicate so callers get a
    precise blocker list; then defer to the kernel gate.
    """
    if order.control_pass is not True:
        stage8 = await compute_stage8_status(s, order.id)
        if not stage8["pass"]:
            return False, "Stage 8 Control Gate not passed: " + " | ".join(stage8["blockers"])
    try:
        await assert_can_advance_to_scheduling(s, order_id=order.id, control_pass=order.control_pass)
    except ControlGateNotPassed as e:
        return False, str(e)
    return True, None


# name → guard implementation. A WorkflowDef transition references the name; the kernel runs the impl.
NAMED_GUARDS = {
    "control_gate:stage8": control_gate_stage8,
}
