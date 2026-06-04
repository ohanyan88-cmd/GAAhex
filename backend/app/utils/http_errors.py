"""Canonical HTTPException constructors (BL-10, PC-2).

Two recurring patterns lived as inline string-literal HTTPExceptions across
30+ routers:

* `_deny(perm)` — uniform 403 for permission failures. Was redefined locally
  in 16 router files (BL-10).
* `approval_required(approval_id, action_type)` — uniform 202 for SPEC §4.5
  mandatory-approval gates. Was inlined as a duplicate shape in 9+ sites
  spread across billing_invoice, billing_credit_note, billing_payment,
  billing_subscription, assets, procurement, roles, services, records (PC-2).

Migration: routers should import from here. The legacy local `_deny`
functions in `_billing_shared.py` (and the inline `HTTPException(202, ...)`
patterns) stay as thin aliases / can delete once all callers move.
"""
from __future__ import annotations

import uuid as _uuid
from typing import Union

from fastapi import HTTPException


def deny(perm: str) -> None:
    """Raise a 403 HTTPException for a permission failure.

    Match the legacy ``_deny(perm)`` shape exactly: callers wrote ``_deny(perm)``
    (no ``raise``) and trusted the function to interrupt control flow. Returning
    the exception object would silently break those 16+ call sites — non-admins
    would get a 201 instead of a 403.

    Detail is a string ``"Not allowed: <perm>"`` for backwards compat with the
    legacy responses; any caller parsing the body sees the same shape.
    """
    raise HTTPException(status_code=403, detail=f"Not allowed: {perm}")


def approval_required(
    approval_id: Union[_uuid.UUID, str],
    action_type: str,
) -> HTTPException:
    """Return a 202 HTTPException signalling a mandatory-approval gate (SPEC §4.5).

    Body shape::

        {
            "status": "approval_required",
            "approval_id": "<uuid string>",
            "action_type": "<action_type>"
        }

    The shape is part of the public API contract — every frontend caller
    parses this exact dict to surface the approval workflow. If we ever add
    a field (e.g. ``message``), it lands here once and every site sees it
    immediately.
    """
    return HTTPException(
        status_code=202,
        detail={
            "status": "approval_required",
            "approval_id": str(approval_id),
            "action_type": action_type,
        },
    )
