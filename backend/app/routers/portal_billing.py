"""Portal billing (B35) — customer self-service invoice and payment views.

All endpoints depend on current_customer (from portal_auth.py). Every query is filtered by
customer_id == current_customer.customer_id — the same invariant as B34's /me/summary.

SECURITY: customers can only see their own invoices and payments. The ownership check on
every by-id fetch (404 if not theirs) is the explicit gate; RLS provides a second layer.

S3 (D14) XSS hardening: every dynamic value interpolated into HTMLResponse bodies is wrapped
in html.escape (`_e`) so attacker-controlled fields (customer name/email, invoice number,
status, line descriptions, tenant name, payment method, etc.) cannot inject markup. Static
HTML structure remains unescaped. Mirrors the convention in routers/documents.py.
"""
import uuid
from html import escape as _html_escape

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse


def _e(v) -> str:
    """HTML-escape any value (None / int / str / etc). Mirrors documents.py."""
    return _html_escape("" if v is None else str(v))
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models.billing import Invoice, InvoiceLine, Payment
from ..models.payment_gateway import PaymentOrder
from ..models.customer_user import CustomerUser
from ..models.record import Record
from ..models.tenant import Tenant
from ..payment_gateway import get_gateway
from ..services.payment_allocation import invoice_balance_components
from ..utils.money import amd_format
from .portal_auth import current_customer

router = APIRouter(prefix="/portal", tags=["portal-billing"])


def _iso(dt):
    return dt.isoformat() if dt else None


async def _balance(s: AsyncSession, invoice_id) -> tuple[int, int]:
    """BL-1 — return (paid_total, balance_luma) via the canonical service.

    `paid_total` = net payments (legacy + allocations), `balance` = total − paid − credited.
    """
    comp = await invoice_balance_components(s, invoice_id)
    return int(comp["paid"]), int(comp["outstanding"])


def _invoice_out(inv: Invoice, paid_total: int | None = None, balance: int | None = None) -> dict:
    pt = paid_total if paid_total is not None else 0
    bal = balance if balance is not None else max(0, inv.total - pt)
    return {
        "id": str(inv.id),
        "number": inv.number,
        "status": inv.status,
        "total": inv.total,
        "paid_total": pt,
        "balance": bal,
        "period_start": _iso(inv.period_start),
        "period_end": _iso(inv.period_end),
        "issued_at": _iso(inv.issued_at),
        "due_at": _iso(inv.due_at),
        "created_at": _iso(inv.created_at),
    }


def _payment_out(p: Payment) -> dict:
    return {
        "id": str(p.id),
        "invoice_id": str(p.invoice_id),
        "amount": p.amount,
        "method": p.method,
        "paid_at": _iso(p.paid_at),
    }


async def _own_invoice(s: AsyncSession, cu: CustomerUser, invoice_id: uuid.UUID) -> Invoice:
    """Load invoice; 404 if it doesn't belong to this customer."""
    inv = (await s.execute(
        select(Invoice).where(  # tenant-filter-ok: cross-tenant — customer-portal; scoped by cu.customer_id (auth-bound)
            Invoice.id == invoice_id,
            Invoice.customer_id == cu.customer_id,
        )
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    return inv


# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("/me/invoices")
async def list_invoices(
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    invoices = (await s.execute(
        select(Invoice).where(Invoice.customer_id == cu.customer_id)  # tenant-filter-ok: cross-tenant — customer-portal; scoped by cu.customer_id
        .order_by(Invoice.created_at.desc())
    )).scalars().all()
    result = []
    for inv in invoices:
        pt, bal = await _balance(s, inv.id)
        result.append(_invoice_out(inv, pt, bal))
    return result


@router.get("/me/invoices/{invoice_id}")
async def get_invoice(
    invoice_id: uuid.UUID,
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    inv = await _own_invoice(s, cu, invoice_id)
    pt, bal = await _balance(s, inv.id)
    lines = (await s.execute(
        select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id)  # tenant-filter-ok: cross-tenant — invoice ownership verified by _own_invoice above
    )).scalars().all()
    out = _invoice_out(inv, pt, bal)
    out["lines"] = [
        {"id": str(l.id), "kind": l.kind, "description": l.description,
         "quantity": l.quantity, "unit_amount": l.unit_amount, "line_total": l.line_total}
        for l in lines
    ]
    return out


@router.get("/me/invoices/{invoice_id}/document", response_class=HTMLResponse)
async def invoice_document(
    invoice_id: uuid.UUID,
    request: Request,
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """Branded invoice HTML — same look as staff documents.py, scoped to own customer.

    T-P4-3 — localized: labels resolve via `branding.html_i18n.t(key, locale)`
    where locale is picked from the `Accept-Language` header. Armenian customers
    get an Armenian-labeled invoice; Russian customers get Russian; everyone
    else falls back to English."""
    inv = await _own_invoice(s, cu, invoice_id)

    # Load supporting data
    lines = (await s.execute(
        select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id)  # tenant-filter-ok: cross-tenant — invoice ownership verified by _own_invoice above
    )).scalars().all()
    pt, balance = await _balance(s, inv.id)

    tenant = (await s.execute(select(Tenant))).scalars().first()
    tenant_name = tenant.name if tenant else "GAAhex"

    record = (await s.execute(select(Record).where(Record.id == cu.customer_id))).scalar_one_or_none()  # tenant-filter-ok: cross-tenant — customer-portal; cu.customer_id is auth-bound
    customer_data = record.data or {} if record else {}

    # BL-2 — single canonical money formatter (app.utils.money.amd_format).
    amd = amd_format

    def iso_date(dt) -> str:
        return dt.strftime("%Y-%m-%d") if dt else "—"

    # T-P4-3 — pick the customer's preferred locale from Accept-Language.
    from ..branding.html_i18n import pick_locale as _pick_locale, t as _t  # noqa: PLC0415
    locale = _pick_locale(request.headers.get("accept-language"))
    L = lambda k: _t(k, locale)  # noqa: E731 — tiny rebind for readability

    # S3 (D14): every dynamic value is escaped via _e to prevent stored-XSS via
    # customer name, invoice number, status, line description, tenant name, etc.
    rows = "".join(
        f"<tr><td>{_e(l.description)}</td><td>{_e(l.quantity)}</td>"
        f"<td style='text-align:right'>{_e(amd(l.unit_amount))}</td>"
        f"<td style='text-align:right'>{_e(amd(l.line_total))}</td></tr>"
        for l in lines
    )
    # T-P1-7 — single brand palette.
    from ..branding.theme_constants import status_color as _status_color  # noqa: PLC0415
    status_color = _status_color(inv.status)
    status_label = L(f"status.{(inv.status or '').upper()}") if inv.status else "—"

    html = f"""<!doctype html><html lang="{locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{L("invoice")} {_e(inv.number)}</title>
<style>
body{{font-family:sans-serif;color:#111827;background:#fff;max-width:800px;margin:auto;padding:40px}}
h1{{color:#1C3B68}}table{{width:100%;border-collapse:collapse;margin-top:20px}}
th{{background:#1C3B68;color:#fff;padding:8px 10px;text-align:left}}
td{{padding:8px 10px;border-bottom:1px solid #E2E8F0}}
.pill{{display:inline-block;padding:3px 12px;border-radius:999px;background:{status_color}22;
       color:{status_color};border:1px solid {status_color};font-size:12px;font-weight:600}}
.total-row td{{font-weight:700;border-top:2px solid #E2E8F0}}
@media print {{
  body {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  table {{ page-break-inside: avoid; }}
  @page {{ margin: 16mm; }}
}}
</style></head><body>
<h1>{_e(tenant_name)} — {L("invoice")}</h1>
<p><strong>{L("invoice")} #:</strong> {_e(inv.number)} &nbsp; <span class="pill">{_e(status_label)}</span></p>
<p><strong>{L("customer")}:</strong> {_e(customer_data.get("name","—"))}</p>
<p><strong>{L("period")}:</strong> {_e(iso_date(inv.period_start))} – {_e(iso_date(inv.period_end))}</p>
<p><strong>{L("issued")}:</strong> {_e(iso_date(inv.issued_at))} &nbsp; <strong>{L("due")}:</strong> {_e(iso_date(inv.due_at))}</p>
<table><thead><tr><th>{L("description")}</th><th>{L("qty")}</th><th style="text-align:right">{L("unit_price")}</th><th style="text-align:right">{L("total")}</th></tr></thead>
<tbody>{rows}</tbody>
<tfoot><tr class="total-row"><td colspan="3"><strong>{L("total")}</strong></td><td style="text-align:right">{_e(amd(inv.total))}</td></tr>
<tr><td colspan="3">{L("paid")}</td><td style="text-align:right">{_e(amd(pt))}</td></tr>
<tr class="total-row"><td colspan="3"><strong>{L("balance_due")}</strong></td><td style="text-align:right;color:#E65F00">{_e(amd(balance))}</td></tr>
</tfoot></table>
</body></html>"""
    return HTMLResponse(html)


@router.post("/me/invoices/{invoice_id}/pay", status_code=201)
async def pay_invoice(
    invoice_id: uuid.UUID,
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """Initiate a payment order for the customer's own invoice. Returns order_id + redirect_url."""
    inv = await _own_invoice(s, cu, invoice_id)

    if inv.status not in {"ISSUED", "OVERDUE"}:
        raise HTTPException(409, f"Invoice must be ISSUED or OVERDUE (is {inv.status})")

    _, balance = await _balance(s, inv.id)

    from ..config import settings as _settings  # noqa: PLC0415
    callback_base = getattr(_settings, "payment_callback_base_url", None) or ""

    gw = get_gateway()
    provider_name = type(gw).__name__.replace("Gateway", "").lower()

    order = PaymentOrder(
        tenant_id=cu.tenant_id,
        invoice_id=inv.id,
        customer_id=cu.customer_id,
        provider=provider_name,
        amount=balance,
        currency="AMD",
        status="PENDING",
    )
    s.add(order)
    await s.flush()

    redir = await gw.initiate(order, callback_url=callback_base)
    order.redirect_url = redir["redirect_url"]
    order.provider_ref = redir.get("provider_ref") or None
    await s.commit()
    await s.refresh(order)

    return {
        "order_id": str(order.id),
        "redirect_url": order.redirect_url,
        "status": order.status,
        "amount": order.amount,
    }


@router.get("/me/payments")
async def list_payments(
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """Own payment history — all payments on invoices belonging to this customer."""
    invoice_ids_rows = (await s.execute(
        select(Invoice.id).where(Invoice.customer_id == cu.customer_id)  # tenant-filter-ok: cross-tenant — customer-portal; scoped by cu.customer_id
    )).scalars().all()
    if not invoice_ids_rows:
        return []
    payments = (await s.execute(
        select(Payment).where(Payment.invoice_id.in_(invoice_ids_rows))  # tenant-filter-ok: cross-tenant — payments scoped by customer's own invoice ids (computed above)
        .order_by(Payment.paid_at.desc())
    )).scalars().all()
    return [_payment_out(p) for p in payments]


@router.get("/me/payments/{payment_id}/receipt", response_class=HTMLResponse)
async def payment_receipt(
    payment_id: uuid.UUID,
    request: Request,
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """Branded receipt HTML for own payment. 404 if not theirs.

    T-P4-3 — labels resolve via Accept-Language."""
    # Load the payment and verify ownership via the linked invoice
    payment = (await s.execute(
        select(Payment).where(Payment.id == payment_id)  # tenant-filter-ok: cross-tenant — ownership immediately verified via _own_invoice-style check on lines below
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Payment not found")

    # Ownership: the invoice must belong to this customer
    inv = (await s.execute(
        select(Invoice).where(  # tenant-filter-ok: cross-tenant — explicit customer_id ownership check
            Invoice.id == payment.invoice_id,
            Invoice.customer_id == cu.customer_id,
        )
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Payment not found")

    tenant = (await s.execute(select(Tenant))).scalars().first()
    tenant_name = tenant.name if tenant else "GAAhex"
    record = (await s.execute(select(Record).where(Record.id == cu.customer_id))).scalar_one_or_none()  # tenant-filter-ok: cross-tenant — customer-portal; cu.customer_id is auth-bound
    customer_name = (record.data or {}).get("name", "—") if record else "—"

    # BL-2 — single canonical money formatter (app.utils.money.amd_format).
    amd = amd_format

    # T-P4-3 — pick locale from Accept-Language for receipt labels.
    from ..branding.html_i18n import pick_locale as _pick_locale, t as _t  # noqa: PLC0415
    locale = _pick_locale(request.headers.get("accept-language"))
    L = lambda k: _t(k, locale)  # noqa: E731

    # S3 (D14): escape every dynamic value before HTML interpolation.
    paid_at_str = payment.paid_at.strftime('%Y-%m-%d %H:%M UTC') if payment.paid_at else '—'
    html = f"""<!doctype html><html lang="{locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{L("receipt")} — {_e(inv.number)}</title>
<style>body{{font-family:sans-serif;color:#111827;background:#fff;max-width:600px;margin:auto;padding:40px}}
h1{{color:#1C3B68}}.amount{{font-size:28px;font-weight:700;color:#10B981;margin:16px 0}}
@media print {{
  body {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  @page {{ margin: 16mm; }}
}}
</style></head>
<body>
<h1>{_e(tenant_name)} — {L("payment_receipt")}</h1>
<p><strong>{L("invoice")}:</strong> {_e(inv.number)}</p>
<p><strong>{L("customer")}:</strong> {_e(customer_name)}</p>
<p><strong>{L("method")}:</strong> {_e(payment.method)}</p>
<p><strong>{L("date")}:</strong> {_e(paid_at_str)}</p>
<div class="amount">{L("paid")}: {_e(amd(payment.amount))}</div>
<p style="color:#6B7280;font-size:12px">{L("computer_generated_receipt")}</p>
</body></html>"""
    return HTMLResponse(html)
