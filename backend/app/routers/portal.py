"""Portal dashboard — customer self-service summary.

All queries are scoped to current_customer.customer_id. This is the foundation that B35/36/37
build on — it proves the scoped-read pattern before adding full detail screens.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models.billing import Invoice
from ..models.helpdesk import HelpdeskTicket
from ..models.service import Service
from ..models.customer_user import CustomerUser
from ..models.record import Record
from ..services.payment_allocation import outstanding_for_invoice
from .portal_auth import current_customer

router = APIRouter(prefix="/portal", tags=["portal"])


@router.get("/me/summary")
async def portal_summary(
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """Customer's own snapshot. Every query filtered by customer_id == cu.customer_id."""
    cid = cu.customer_id

    # Customer record name
    record = (await s.execute(select(Record).where(Record.id == cid))).scalar_one_or_none()  # tenant-filter-ok: cross-tenant — customer-portal; cid is current_customer.customer_id (auth-bound)
    customer_name = record.data.get("name") if record and record.data else None

    # Open invoices (ISSUED or OVERDUE)
    open_invoices = (await s.execute(
        select(func.count()).select_from(Invoice).where(
            Invoice.customer_id == cid,
            Invoice.status.in_(["ISSUED", "OVERDUE"]),
        )
    )).scalar_one()

    # Balance due: sum of canonical outstanding across open invoices. BL-1 — uses the
    # single source of truth (services/payment_allocation.invoice_balance_components) so
    # legacy payments AND applied credit notes are both accounted for.
    open_inv_ids_rows = (await s.execute(
        select(Invoice.id).where(  # tenant-filter-ok: cross-tenant — customer-portal; scoped by cid (current_customer.customer_id)
            Invoice.customer_id == cid,
            Invoice.status.in_(["ISSUED", "OVERDUE"]),
        )
    )).all()
    balance_due_luma = 0
    for (inv_id,) in open_inv_ids_rows:
        balance_due_luma += int(await outstanding_for_invoice(s, inv_id))

    # Open tickets
    open_tickets = (await s.execute(
        select(func.count()).select_from(HelpdeskTicket).where(
            HelpdeskTicket.customer_id == cid,
            HelpdeskTicket.status.in_(["OPEN", "IN_PROGRESS"]),
        )
    )).scalar_one()

    # Active services
    active_services = (await s.execute(
        select(func.count()).select_from(Service).where(
            Service.customer_id == cid,
            Service.status == "ACTIVE",
        )
    )).scalar_one()

    return {
        "customer": {
            "id": str(cid),
            "name": customer_name,
            "email": cu.email,
        },
        "open_invoices_count": open_invoices,
        "open_tickets_count": open_tickets,
        "active_services_count": active_services,
        "balance_due_luma": balance_due_luma,
    }
