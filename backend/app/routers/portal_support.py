"""Portal support (B36) — customer-facing ticket management.

SECURITY invariant: every query is filtered by customer_id == cu.customer_id.
- Ticket creation FORCES customer_id from the auth token (client-supplied customer_id ignored).
- Reply model: PortalTicketReply (separate from staff Interaction which requires agent_user_id NOT NULL).
- Customers see only ticket subject/body/status/priority — no internal assignee/SLA fields.
- Staff-only actions (assign, change queue, resolve) are not exposed here.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models.helpdesk import HelpdeskTicket
from ..models.portal_ticket_reply import PortalTicketReply
from ..models.customer_user import CustomerUser
from .portal_auth import current_customer

router = APIRouter(prefix="/portal", tags=["portal-support"])


def _iso(dt):
    return dt.isoformat() if dt else None


def _ticket_out(t: HelpdeskTicket) -> dict:
    return {
        "id": str(t.id),
        "subject": t.subject,
        "body": t.body,
        "status": t.status,
        "priority": t.priority,
        "created_at": _iso(t.created_at),
    }


def _reply_out(r: PortalTicketReply) -> dict:
    return {
        "id": str(r.id),
        "body": r.body,
        "direction": r.direction,
        "created_at": _iso(r.created_at),
    }


async def _own_ticket(s: AsyncSession, cu: CustomerUser, ticket_id: uuid.UUID) -> HelpdeskTicket:
    t = (await s.execute(
        select(HelpdeskTicket).where(  # noqa: tenant-filter cross-tenant — customer-portal; explicit customer_id ownership check
            HelpdeskTicket.id == ticket_id,
            HelpdeskTicket.customer_id == cu.customer_id,
        )
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Ticket not found")
    return t


class NewTicketIn(BaseModel):
    subject: str
    body: str | None = None
    priority: str | None = None


class ReplyIn(BaseModel):
    body: str


@router.get("/me/tickets")
async def list_tickets(
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    tickets = (await s.execute(
        select(HelpdeskTicket).where(HelpdeskTicket.customer_id == cu.customer_id)  # noqa: tenant-filter cross-tenant — customer-portal; scoped by cu.customer_id (auth-bound)
        .order_by(HelpdeskTicket.created_at.desc())
    )).scalars().all()
    return [_ticket_out(t) for t in tickets]


@router.post("/me/tickets", status_code=201)
async def create_ticket(
    body: NewTicketIn,
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """Create a helpdesk ticket. customer_id FORCED from auth token."""
    priority = (body.priority or "NORMAL").upper()
    if priority not in {"LOW", "NORMAL", "HIGH", "URGENT"}:
        raise HTTPException(422, "Invalid priority")

    ticket = HelpdeskTicket(
        tenant_id=cu.tenant_id,
        customer_id=cu.customer_id,   # FORCED — never from client
        subject=body.subject,
        body=body.body,
        priority=priority,
        status="OPEN",
    )
    s.add(ticket)
    await s.commit()
    await s.refresh(ticket)
    return _ticket_out(ticket)


@router.get("/me/tickets/{ticket_id}")
async def get_ticket(
    ticket_id: uuid.UUID,
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    ticket = await _own_ticket(s, cu, ticket_id)
    replies = (await s.execute(
        select(PortalTicketReply).where(  # noqa: tenant-filter cross-tenant — ticket ownership verified by _own_ticket above
            PortalTicketReply.ticket_id == ticket.id,
        ).order_by(PortalTicketReply.created_at)
    )).scalars().all()
    return {"ticket": _ticket_out(ticket), "replies": [_reply_out(r) for r in replies]}


@router.post("/me/tickets/{ticket_id}/reply", status_code=201)
async def reply_ticket(
    ticket_id: uuid.UUID,
    body: ReplyIn,
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """Add a customer-side reply to an own ticket."""
    ticket = await _own_ticket(s, cu, ticket_id)

    reply = PortalTicketReply(
        tenant_id=cu.tenant_id,
        ticket_id=ticket.id,
        customer_user_id=cu.id,
        body=body.body,
        direction="INBOUND",
    )
    s.add(reply)
    await s.commit()
    await s.refresh(reply)
    return _reply_out(reply)
