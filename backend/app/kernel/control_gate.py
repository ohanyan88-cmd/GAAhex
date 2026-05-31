"""SPEC §3 Stage 8 / §10.4 — Order Validation Control Gate (kernel enforcement).

The canonical 14-stage pipeline (SPEC §3) defines Stage 8 as the **single mandatory gate** between
Sales (stages 1–7) and Fulfillment (stages 9–14):

    7  Order Created          (Owner: Orders)
    8  Order Validation       (Owner: Revenue Control)   ← CONTROL GATE
    9  Scheduling             (Owner: Dispatch)

SPEC §3 control rule (verbatim):

    "Stage 8 is the single mandatory gate between Sales and Fulfillment. The validator
    (Revenue Control) is organizationally separate from the order creator (Sales).
    No order advances to Scheduling without Control Pass = TRUE."

SPEC §10.4 (Kernel enforcement) restates this in code-contract form:

    "advance_to_scheduling is impossible while control_pass != TRUE."

This module is the kernel implementation of that contract. The verdict trio
(`order.control_pass`, `control_pass_at`, `control_pass_by`) is written by Revenue Control once
the KYC + Credit/Risk + Fraud + Tariff/Product checks have all passed. Until that flip happens,
`control_pass` is NULL (pending); an explicit failure sets it FALSE. The gate refuses both — only
literal TRUE permits the transition.

Public surface:
    - ControlGateNotPassed         — typed exception, map to HTTP 409 at the router boundary.
    - assert_can_advance_to_scheduling — read-only check; raises ControlGateNotPassed on closed gate.

The matching role gate ("only Revenue Control may flip control_pass to TRUE") lands in Step 6 with
the full default-deny matrix. KPI computation for "Control Pass Rate" (the §3 stage-8 KPI) lands
with the KPI engine in a later step.
"""
from __future__ import annotations

import uuid


class ControlGateNotPassed(Exception):
    """SPEC §3 Stage 8 — order tried to advance from Order Created (stage 7) to Scheduling
    (stage 9) without Revenue Control having set `control_pass = TRUE`.

    Map to HTTP 409 Conflict. The caller must obtain a Revenue Control PASS verdict before retry —
    the gate itself does not say which specific check failed (KYC vs. Credit vs. Fraud vs. Tariff);
    that's a Revenue Control concern that lives in its own routing.
    """


async def assert_can_advance_to_scheduling(
    s,
    *,
    order_id: uuid.UUID,
    control_pass: bool | None,
) -> None:
    """SPEC §3 Stage 8 / §10.4 — refuse the transition Order Created → Scheduling unless
    `control_pass` is exactly TRUE.

    Args:
        s:            AsyncSession placeholder. Currently unused — the verdict is passed in by the
                      caller (the order row is already loaded at the call site). Kept in the
                      signature so a later step can rehydrate from DB inside the gate if a caller
                      ever wants to skip loading the row themselves, without a breaking change.
        order_id:     The order being advanced — included in the exception text for debuggability.
        control_pass: The verdict on the order's `control_pass` column. NULL = not yet validated,
                      FALSE = Revenue Control explicitly rejected, TRUE = Revenue Control passed.

    Raises:
        ControlGateNotPassed: when `control_pass is not True`. Both NULL (pending) and FALSE
        (rejected) are blocked — only literal TRUE permits Scheduling.

    Side effects: NONE. Read-only check, safe to call multiple times.
    """
    if control_pass is not True:
        raise ControlGateNotPassed(
            "SPEC §3 Stage 8 violation: control_pass must be TRUE before Scheduling. "
            f"Order {order_id} attempted advance with control_pass={control_pass}."
        )
