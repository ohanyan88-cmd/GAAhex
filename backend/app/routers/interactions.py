"""Contact-center interactions API (doc 27).

Logged customer touchpoints (call/email/chat/sms/note/other), tenant + org scoped exactly like the
record engine (`interaction.*` permission gate + org-scope via owner node). Every write emits an
audit Event through workflow.emit; logging an interaction against a customer/ticket best-effort
notifies that record's owner (fail-soft).

NOTE: fixed paths under /api ("/api/interactions"), so this router MUST be registered BEFORE
records.router (which serves "/api/{slug}"). See the wiring report.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..models.interaction import Interaction
from ..access import load_grants, can
from ..kernel import assert_can, AccessDenied
from .. import workflow, notify_hooks
from .auth import current_user
from .records import _node_path, _node_paths, _paginate     # reuse the records scope + paging helpers

router = APIRouter(prefix="/api/interactions", tags=["interactions"])

CHANNELS = {"call", "email", "chat", "sms", "note", "other"}
DIRECTIONS = {"inbound", "outbound", "internal"}


def _deny(perm: str):
    raise HTTPException(403, f"Not allowed: {perm}")


def _iso(dt):
    return dt.isoformat() if dt else None


def _serialize(x: Interaction) -> dict:
    return {
        "id": str(x.id),
        "customer_id": str(x.customer_id) if x.customer_id else None,
        "ticket_id": str(x.ticket_id) if x.ticket_id else None,
        "owner_node_id": str(x.owner_node_id) if x.owner_node_id else None,
        "channel": x.channel,
        "direction": x.direction,
        "subject": x.subject,
        "body": x.body,
        "agent_user_id": str(x.agent_user_id) if x.agent_user_id else None,
        "occurred_at": _iso(x.occurred_at),
        "created_at": _iso(x.created_at),
    }


async def _get(s: AsyncSession, tenant_id, interaction_id) -> Interaction:
    x = (await s.execute(
        select(Interaction).where(Interaction.id == interaction_id, Interaction.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not x:
        raise HTTPException(404, "Interaction not found")
    return x


async def _ref_record(s: AsyncSession, tenant_id, rec_id, entity_key: str) -> Record:
    rec = (await s.execute(
        select(Record).where(Record.id == rec_id, Record.tenant_id == tenant_id, Record.entity_key == entity_key)
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(422, f"{entity_key}_id does not reference a known {entity_key}")
    return rec


def _parse_dt(value, field: str):
    if value in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"'{field}' must be an ISO datetime")


# ---- endpoints (before /api/{slug}) ----

@router.get("")
async def list_interactions(
    customer: uuid.UUID | None = None,
    ticket: uuid.UUID | None = None,
    channel: str | None = None,
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List interactions (newest first), tenant + org scoped. If `customer` is given, the caller must
    be able to view that customer Record."""
    grants = await load_grants(s, user)
    if not can(grants, "interaction", "view"):
        _deny("interaction.view")
    if customer is not None:
        cust = await _ref_record(s, user.tenant_id, customer, "customer")
        if not can(grants, "customer", "view", await _node_path(s, cust.owner_node_id)):
            _deny("customer.view")

    q = select(Interaction).where(Interaction.tenant_id == user.tenant_id)
    if customer is not None:
        q = q.where(Interaction.customer_id == customer)
    if ticket is not None:
        q = q.where(Interaction.ticket_id == ticket)
    if channel:
        q = q.where(Interaction.channel == channel)
    rows = (await s.execute(q.order_by(Interaction.occurred_at.desc()))).scalars().all()

    paths = await _node_paths(s, user.tenant_id)
    visible = [
        x for x in rows
        if can(grants, "interaction", "view", paths.get(str(x.owner_node_id)) if x.owner_node_id else None)
    ]
    return [_serialize(x) for x in _paginate(visible, limit, offset)]


@router.post("", status_code=201)
async def create_interaction(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Log an interaction. Emits an audit Event; if it references a customer/ticket, best-effort
    notifies that record's owner."""
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "interaction", "create", owner_path):
        _deny("interaction.create")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="interaction",
                         region_id=payload.get("region_id"), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    channel = payload.get("channel")
    if channel not in CHANNELS:
        raise HTTPException(422, f"channel must be one of {sorted(CHANNELS)}")
    direction = payload.get("direction")
    if direction not in DIRECTIONS:
        raise HTTPException(422, f"direction must be one of {sorted(DIRECTIONS)}")
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(422, "body is required")

    customer_id = payload.get("customer_id")
    ticket_id = payload.get("ticket_id")
    cust_rec = await _ref_record(s, user.tenant_id, customer_id, "customer") if customer_id else None
    tick_rec = await _ref_record(s, user.tenant_id, ticket_id, "ticket") if ticket_id else None

    x = Interaction(
        tenant_id=user.tenant_id, owner_node_id=user.primary_node_id,
        customer_id=customer_id, ticket_id=ticket_id,
        channel=channel, direction=direction,
        subject=(payload.get("subject") or None), body=body,
        agent_user_id=user.id,
        occurred_at=_parse_dt(payload.get("occurred_at"), "occurred_at") or datetime.now(timezone.utc),
    )
    s.add(x)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "interaction", x.id, user.id,
                        {"channel": channel, "direction": direction,
                         "customer_id": str(customer_id) if customer_id else None,
                         "ticket_id": str(ticket_id) if ticket_id else None})
    # best-effort: tell the referenced record's owner about the touchpoint (fail-soft inside fire)
    for rec in (cust_rec, tick_rec):
        if rec is not None:
            await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="interaction",
                                    entity_key=rec.entity_key, record=rec, actor_user_id=user.id,
                                    extra={"interaction_id": str(x.id), "channel": channel})
    await s.commit()
    await s.refresh(x)
    return _serialize(x)


@router.get("/{interaction_id}")
async def get_interaction(interaction_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    x = await _get(s, user.tenant_id, interaction_id)
    grants = await load_grants(s, user)
    if not can(grants, "interaction", "view", await _node_path(s, x.owner_node_id)):
        _deny("interaction.view")
    return _serialize(x)


@router.patch("/{interaction_id}")
async def update_interaction(interaction_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit subject/body — author only (the agent who logged it)."""
    x = await _get(s, user.tenant_id, interaction_id)
    if x.agent_user_id != user.id:
        raise HTTPException(403, "Only the author can edit this interaction")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation; agent_user_id is the owner.
    try:
        await assert_can(s, user, action="edit", entity_key="interaction",
                         region_id=getattr(x, "region_id", None),
                         owner_user_id=x.agent_user_id)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    allowed = {"subject", "body"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(422, f"Cannot patch {sorted(unknown)}; allowed: {sorted(allowed)}")
    changed: dict = {}
    if "subject" in payload:
        x.subject = payload["subject"] or None
        changed["subject"] = x.subject
    if "body" in payload:
        v = (payload["body"] or "").strip()
        if not v:
            raise HTTPException(422, "body cannot be empty")
        x.body = v
        changed["body"] = True
    await workflow.emit(s, user.tenant_id, "update", "interaction", x.id, user.id, {"changed": changed})
    await s.commit()
    await s.refresh(x)
    return _serialize(x)


@router.delete("/{interaction_id}", status_code=204)
async def delete_interaction(interaction_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete an interaction — the author, or anyone with interaction.delete at its scope (super_admin
    covered by the `*` grant)."""
    x = await _get(s, user.tenant_id, interaction_id)
    grants = await load_grants(s, user)
    is_author = x.agent_user_id == user.id
    if not is_author and not can(grants, "interaction", "delete", await _node_path(s, x.owner_node_id)):
        _deny("interaction.delete")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation; authors are own-only.
    if not is_author:
        try:
            await assert_can(s, user, action="delete", entity_key="interaction",
                             region_id=getattr(x, "region_id", None),
                             owner_user_id=x.agent_user_id)
        except AccessDenied as e:
            raise HTTPException(403, detail=str(e))
    await workflow.emit(s, user.tenant_id, "delete", "interaction", x.id, user.id,
                        {"channel": x.channel, "customer_id": str(x.customer_id) if x.customer_id else None})
    await s.delete(x)
    await s.commit()
