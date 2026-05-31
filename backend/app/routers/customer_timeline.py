"""SPEC §8 Customer Timeline — read-only feed of audit events for one customer.

Single endpoint:

    GET /api/customers/{customer_id}/timeline?limit=&before_ts=

Permission: caller must be able to view the customer Record (the `customer.view`
grant, scope-checked exactly like Customer 360 / activity feed). If a caller can see
the customer, they can see its timeline.

The router is a thin shell over `app.kernel.timeline.get_customer_timeline` — the
SPEC §8 mapping itself lives in the kernel and is tested in isolation. This module
only handles HTTP plumbing: auth, scope, pagination cursors.

Mounted in main.py BEFORE the generic /api/{slug} records router so the fixed
/api/customers/{id}/timeline path is not swallowed as an entity slug.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..access import load_grants, can
from ..kernel import assert_can, AccessDenied, get_customer_timeline
from .auth import current_user
from .records import _get, _node_path

router = APIRouter(prefix="/api/customers", tags=["customer-timeline"])


@router.get("/{customer_id}/timeline")
async def customer_timeline(
    customer_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200, description="Max items returned"),
    before_ts: str | None = Query(
        None,
        description=(
            "Cursor — return events strictly older than this UTC timestamp. "
            "Accepts ISO-8601; the cursor returned in `next_before_ts` is safe to pass "
            "back even when its `+00:00` offset was URL-decoded to a space."
        ),
    ),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """SPEC §8 customer timeline — newest-first append-only feed."""
    # Parse the cursor tolerantly. Our own `next_before_ts` is ISO-8601 with a `+00:00`
    # tz offset; when a client round-trips it in a query string the `+` is decoded as a
    # space (RFC 3986 / application/x-www-form-urlencoded). We fix that up here so the
    # cursor we hand out always survives a round-trip without manual percent-encoding.
    parsed_before_ts: datetime | None = None
    if before_ts:
        s_in = before_ts.strip()
        # If the tz separator arrived as a space, restore the `+` so fromisoformat parses it.
        # Heuristic: a lone space followed by `HH:MM` near the end is the URL-decoded `+HH:MM`.
        if " " in s_in and "T" in s_in:
            head, sep, tail = s_in.rpartition(" ")
            if sep and len(tail) >= 4 and (":" in tail or tail.isdigit()):
                s_in = head + "+" + tail
        # Accept trailing `Z` as UTC.
        if s_in.endswith("Z"):
            s_in = s_in[:-1] + "+00:00"
        try:
            parsed_before_ts = datetime.fromisoformat(s_in)
        except ValueError:
            raise HTTPException(422, detail=f"invalid before_ts: {before_ts!r}")

    # 404 if not a customer (also enforces tenant isolation).
    rec = await _get(s, user.tenant_id, "customer", customer_id)

    # SPEC §0.2 default-deny — entity_key="customer", action="view" — same as Customer 360.
    grants = await load_grants(s, user)
    if not can(grants, "customer", "view", await _node_path(s, rec.owner_node_id)):
        raise HTTPException(403, "Not allowed: customer.view")
    try:
        await assert_can(
            s, user,
            action="view",
            entity_key="customer",
            region_id=getattr(rec, "region_id", None),
            owner_user_id=None,
        )
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    items = await get_customer_timeline(
        s,
        tenant_id=user.tenant_id,
        customer_id=customer_id,
        limit=limit,
        before_ts=parsed_before_ts,
    )

    # Cursor convenience: surface the next-page cursor (the `at` of the last item) so
    # the client doesn't have to compute it. None when the page is short of `limit`
    # (i.e. there's no more data).
    next_before_ts = items[-1]["at"] if len(items) == limit else None

    return {
        "items": items,
        "next_before_ts": next_before_ts,
        "limit": limit,
        "spec": "SPEC §8",
    }
