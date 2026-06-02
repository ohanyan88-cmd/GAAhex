"""Branded document generation (doc 29) — print-ready HTML invoices & statements.

Dependency-light: renders inline-CSS HTML (no template-engine, no native PDF dep) so a browser
"Print → Save as PDF" yields a proper document. Real server-side PDF (reportlab/weasyprint) is a
later hardening step — see the report. Money is integer luma; displayed as AMD ֏ (÷100, grouped).
Documents print on white paper, so this uses the BRAND light/print palette (Cobalt header, Ink
text), not the dark app theme. Invoice-view scope is enforced exactly like the billing router.
"""
import html
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..models.tenant import Tenant
from ..models.billing import Invoice, InvoiceLine, Payment
from ..access import load_grants, can
from .auth import current_user
from .records import _node_path

router = APIRouter(prefix="/api", tags=["documents"])

# BRAND light/print palette (print on white)
_COBALT = "#1C3B68"
_GOLD = "#C5A059"
_INK = "#111827"
_INK2 = "#4B5563"
_INK3 = "#6B7280"
_BORDER = "#E2E8F0"
_SURFACE = "#F1F3F5"

_STATUS_COLOR = {
    "DRAFT": _INK3, "ISSUED": _COBALT, "PAID": "#10B981",
    "OVERDUE": "#E65F00", "VOID": "#D90429",
}


# ---- formatting helpers ----

def _amd(luma: int) -> str:
    """Integer luma → grouped AMD string, e.g. 1500000 → '15,000.00 ֏'."""
    return f"{(luma or 0) / 100:,.2f} ֏"


def _e(v) -> str:
    return html.escape("" if v is None else str(v))


def _date(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%d") if dt else "—"


def _parse_dt(value):
    if value in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, "from/to must be ISO dates")


def _customer_view(rec: Record | None) -> dict:
    if not rec:
        return {"name": "—", "email": "", "phone": ""}
    d = rec.data or {}
    return {"name": d.get("name") or "—", "email": d.get("email") or "", "phone": d.get("phone") or ""}


async def _customer_record(s, tenant_id, customer_id) -> Record | None:
    if not customer_id:
        return None
    return (await s.execute(
        select(Record).where(Record.id == customer_id, Record.tenant_id == tenant_id, Record.entity_key == "customer")
    )).scalar_one_or_none()


# ---- HTML shell (print-clean, A4-ish) ----

def _page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{_e(title)}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #fff; color: {_INK};
         font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         font-size: 14px; line-height: 1.5; }}
  .sheet {{ max-width: 800px; margin: 24px auto; padding: 40px; background: #fff; }}
  .head {{ display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 3px solid {_COBALT}; padding-bottom: 18px; margin-bottom: 24px; }}
  .issuer {{ font-size: 22px; font-weight: 700; color: {_COBALT}; }}
  .issuer .ex {{ color: {_GOLD}; }}
  .doc-title {{ text-align: right; }}
  .doc-title h1 {{ margin: 0; font-size: 24px; color: {_COBALT}; letter-spacing: .5px; }}
  .muted {{ color: {_INK3}; font-size: 13px; }}
  .meta {{ display: flex; justify-content: space-between; gap: 24px; margin-bottom: 24px; }}
  .meta .label {{ color: {_INK3}; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; }}
  .pill {{ display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
          font-weight: 600; color: #fff; }}
  table {{ width: 100%; border-collapse: collapse; margin: 8px 0 20px; }}
  th {{ background: {_SURFACE}; color: {_INK2}; text-align: left; font-size: 11px;
       text-transform: uppercase; letter-spacing: .5px; padding: 10px 12px; border-bottom: 2px solid {_BORDER}; }}
  td {{ padding: 10px 12px; border-bottom: 1px solid {_BORDER}; }}
  .num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .totals {{ width: 320px; margin-left: auto; }}
  .totals td {{ border: none; padding: 6px 12px; }}
  .totals .grand td {{ border-top: 2px solid {_COBALT}; font-weight: 700; font-size: 16px; color: {_COBALT}; }}
  .due {{ color: {_GOLD}; }}
  .foot {{ margin-top: 36px; color: {_INK3}; font-size: 12px; border-top: 1px solid {_BORDER}; padding-top: 12px; }}
  @media print {{ .sheet {{ margin: 0; padding: 24px; max-width: none; }} @page {{ margin: 16mm; }} }}
</style></head>
<body><div class="sheet">{body}</div></body></html>"""


def _pill(status: str) -> str:
    color = _STATUS_COLOR.get(status, _INK3)
    return f'<span class="pill" style="background:{color}">{_e(status)}</span>'


# ==========================================================================================
# Invoice document
# ==========================================================================================

@router.get("/invoices/{invoice_id}/document", response_class=HTMLResponse)
async def invoice_document(invoice_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    inv = (await s.execute(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "view", await _node_path(s, inv.owner_node_id)):
        raise HTTPException(403, "Not allowed: invoice.view")

    tenant = (await s.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    lines = (await s.execute(
        select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id)
    )).scalars().all()
    payments = (await s.execute(
        select(Payment).where(Payment.invoice_id == inv.id).order_by(Payment.paid_at)
    )).scalars().all()
    paid = (await s.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.invoice_id == inv.id)
    )).scalar_one()
    cust = _customer_view(await _customer_record(s, user.tenant_id, inv.customer_id))

    line_rows = "".join(
        f"<tr><td>{_e(l.description)}</td><td class='num'>{l.quantity}</td>"
        f"<td class='num'>{_amd(l.unit_amount)}</td><td class='num'>{_amd(l.line_total)}</td></tr>"
        for l in lines
    ) or "<tr><td colspan='4' class='muted'>No line items.</td></tr>"

    pay_rows = "".join(
        f"<tr><td>{_date(p.paid_at)}</td><td>{_e(p.method)}</td><td class='num'>{_amd(p.amount)}</td></tr>"
        for p in payments
    )
    payments_block = (
        f"<h3 style='color:{_COBALT};font-size:13px;text-transform:uppercase;letter-spacing:.5px'>Payments</h3>"
        f"<table><thead><tr><th>Date</th><th>Method</th><th class='num'>Amount</th></tr></thead>"
        f"<tbody>{pay_rows}</tbody></table>"
    ) if payments else ""

    balance = max(0, (inv.total or 0) - int(paid))
    issuer = _e(tenant.name if tenant else "GAAhex")

    body = f"""
    <div class="head">
      <div><div class="issuer">{issuer}</div><div class="muted">Invoice issuer</div></div>
      <div class="doc-title"><h1>INVOICE</h1><div class="muted">{_e(inv.number)}</div></div>
    </div>
    <div class="meta">
      <div>
        <div class="label">Billed to</div>
        <div style="font-weight:600">{_e(cust['name'])}</div>
        <div class="muted">{_e(cust['email'])}</div>
        <div class="muted">{_e(cust['phone'])}</div>
      </div>
      <div style="text-align:right">
        <div class="label">Status</div><div>{_pill(inv.status)}</div>
        <div class="label" style="margin-top:8px">Period</div>
        <div class="muted">{_date(inv.period_start)} → {_date(inv.period_end)}</div>
        <div class="label" style="margin-top:8px">Issued / Due</div>
        <div class="muted">{_date(inv.issued_at)} / {_date(inv.due_at)}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
      <tbody>{line_rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Total</td><td class="num">{_amd(inv.total)}</td></tr>
      <tr><td>Paid</td><td class="num">{_amd(int(paid))}</td></tr>
      <tr class="grand"><td>Balance due</td><td class="num due">{_amd(balance)}</td></tr>
    </table>
    {payments_block}
    <div class="foot">Generated by {issuer} · GAAhex · All amounts in Armenian Dram (֏).</div>
    """
    return HTMLResponse(_page(f"Invoice {inv.number}", body))


# ==========================================================================================
# Account statement
# ==========================================================================================

@router.get("/customers/{customer_id}/statement", response_class=HTMLResponse)
async def customer_statement(
    customer_id: uuid.UUID,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = Query(default=None),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Branded account statement: a customer's invoices + payments over an optional [from, to]
    window, with a running balance. Gated on customer-view scope."""
    cust_rec = (await s.execute(
        select(Record).where(Record.id == customer_id, Record.tenant_id == user.tenant_id, Record.entity_key == "customer")
    )).scalar_one_or_none()
    if not cust_rec:
        raise HTTPException(404, "Customer not found")
    grants = await load_grants(s, user)
    if not can(grants, "customer", "view", await _node_path(s, cust_rec.owner_node_id)):
        raise HTTPException(403, "Not allowed: customer.view")

    dt_from, dt_to = _parse_dt(from_), _parse_dt(to)
    tenant = (await s.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    cust = _customer_view(cust_rec)

    inv_q = select(Invoice).where(Invoice.tenant_id == user.tenant_id, Invoice.customer_id == customer_id)
    if dt_from:
        inv_q = inv_q.where(Invoice.created_at >= dt_from)
    if dt_to:
        inv_q = inv_q.where(Invoice.created_at <= dt_to)
    invoices = (await s.execute(inv_q)).scalars().all()
    inv_ids = [i.id for i in invoices]

    payments = []
    if inv_ids:
        pay_q = select(Payment).where(Payment.invoice_id.in_(inv_ids))
        if dt_from:
            pay_q = pay_q.where(Payment.paid_at >= dt_from)
        if dt_to:
            pay_q = pay_q.where(Payment.paid_at <= dt_to)
        payments = (await s.execute(pay_q)).scalars().all()

    # build a chronological ledger: invoice = debit (+total), payment = credit (−amount)
    events = []
    for i in invoices:
        when = i.issued_at or i.created_at
        events.append((when, f"Invoice {i.number}", i.total or 0, 0))
    for p in payments:
        events.append((p.paid_at, f"Payment ({p.method})", 0, p.amount or 0))
    events.sort(key=lambda e: e[0] or datetime.min)

    rows, balance = "", 0
    for when, desc, debit, credit in events:
        balance += debit - credit
        rows += (f"<tr><td>{_date(when)}</td><td>{_e(desc)}</td>"
                 f"<td class='num'>{_amd(debit) if debit else '—'}</td>"
                 f"<td class='num'>{_amd(credit) if credit else '—'}</td>"
                 f"<td class='num'>{_amd(balance)}</td></tr>")
    if not events:
        rows = "<tr><td colspan='5' class='muted'>No activity in this period.</td></tr>"

    total_billed = sum(i.total or 0 for i in invoices)
    total_paid = sum(p.amount or 0 for p in payments)
    issuer = _e(tenant.name if tenant else "GAAhex")
    period = f"{_date(dt_from)} → {_date(dt_to)}" if (dt_from or dt_to) else "All time"

    body = f"""
    <div class="head">
      <div><div class="issuer">{issuer}</div><div class="muted">Account statement</div></div>
      <div class="doc-title"><h1>STATEMENT</h1><div class="muted">{_e(period)}</div></div>
    </div>
    <div class="meta">
      <div>
        <div class="label">Account</div>
        <div style="font-weight:600">{_e(cust['name'])}</div>
        <div class="muted">{_e(cust['email'])}</div>
        <div class="muted">{_e(cust['phone'])}</div>
      </div>
      <div style="text-align:right">
        <div class="label">Billed</div><div>{_amd(total_billed)}</div>
        <div class="label" style="margin-top:8px">Paid</div><div>{_amd(total_paid)}</div>
        <div class="label" style="margin-top:8px">Closing balance</div>
        <div class="due" style="font-weight:700">{_amd(balance)}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Description</th><th class="num">Charges</th><th class="num">Payments</th><th class="num">Balance</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
    <div class="foot">Generated by {issuer} · GAAhex · All amounts in Armenian Dram (֏).</div>
    """
    return HTMLResponse(_page(f"Statement — {cust['name']}", body))


# ==========================================================================================
# Payment receipt (A33/E33)
# ==========================================================================================

@router.get("/payments/{payment_id}/receipt", response_class=HTMLResponse)
async def payment_receipt(
    payment_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Branded payment receipt for a single Payment row.

    Auth mirrors the invoice document endpoint: the requesting user must be
    able to see the underlying invoice (``invoice.view`` on its org node).
    Returns a print-ready branded HTML page.

    Lazy-imports ``PaymentOrder`` from A33's model so this file compiles even
    if A33 hasn't landed yet (``payment_order`` table may not exist in dev).
    The receipt uses the billing ``Payment`` row — the settled record created by
    ``settle_order`` — not the PaymentOrder itself.
    """
    # Load the Payment row (tenant-scoped)
    pay = (await s.execute(
        select(Payment).where(Payment.id == payment_id, Payment.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not pay:
        raise HTTPException(404, "Payment not found")

    # Load the Invoice the payment is against
    inv = (await s.execute(
        select(Invoice).where(Invoice.id == pay.invoice_id, Invoice.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Invoice not found")

    # Gate: same scope as invoice.view
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "view", await _node_path(s, inv.owner_node_id)):
        raise HTTPException(403, "Not allowed: invoice.view")

    tenant = (await s.execute(
        select(Tenant).where(Tenant.id == user.tenant_id)
    )).scalar_one_or_none()
    cust = _customer_view(await _customer_record(s, user.tenant_id, inv.customer_id))

    # Attempt to load the originating PaymentOrder for extra provider detail.
    # Lazy import — A33 model may not exist yet in all environments.
    provider_ref: str | None = None
    try:
        from ..models.payment_gateway import PaymentOrder  # noqa: PLC0415
        po = (await s.execute(
            select(PaymentOrder).where(
                PaymentOrder.payment_id == pay.id,
                PaymentOrder.tenant_id == user.tenant_id,
            )
        )).scalar_one_or_none()
        if po:
            provider_ref = po.provider_ref
    except Exception:
        pass  # model not yet migrated — receipt still renders without it

    receipt_no = str(pay.id)[:8].upper()
    issuer = _e(tenant.name if tenant else "GAAhex")
    method_label = _e((pay.method or "").upper())
    provider_detail = f" · ref {_e(provider_ref)}" if provider_ref else ""

    # Build a short "settled invoice" summary line
    inv_summary = f"Invoice {_e(inv.number)}"
    inv_total = _amd(inv.total)

    # Payment status pill — a settled Payment is always confirmed
    paid_pill = _pill("PAID")

    body = f"""
    <div class="head">
      <div>
        <div class="issuer">{issuer}</div>
        <div class="muted">Payment receipt</div>
      </div>
      <div class="doc-title">
        <h1>PAYMENT RECEIPT</h1>
        <div class="muted">No. {receipt_no}</div>
      </div>
    </div>

    <div class="meta">
      <div>
        <div class="label">Customer</div>
        <div style="font-weight:600">{_e(cust['name'])}</div>
        <div class="muted">{_e(cust['email'])}</div>
        <div class="muted">{_e(cust['phone'])}</div>
      </div>
      <div style="text-align:right">
        <div class="label">Status</div>
        <div>{paid_pill}</div>
        <div class="label" style="margin-top:8px">Date paid</div>
        <div class="muted">{_date(pay.paid_at)}</div>
        <div class="label" style="margin-top:8px">Issued by</div>
        <div class="muted">{issuer}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Invoice total</th>
          <th class="num">Amount paid</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{inv_summary}</td>
          <td class="num">{inv_total}</td>
          <td class="num" style="font-weight:700;color:{_COBALT}">{_amd(pay.amount)}</td>
        </tr>
      </tbody>
    </table>

    <table class="totals">
      <tr><td>Method</td><td class="num">{method_label}</td></tr>
      <tr class="grand">
        <td>Total received</td>
        <td class="num due">{_amd(pay.amount)}</td>
      </tr>
    </table>

    {f'<p class="muted" style="font-size:12px;margin-top:4px">Provider reference: {_e(provider_ref)}</p>' if provider_ref else ""}
    {f'<p class="muted" style="font-size:12px;margin-top:4px">Note: {_e(pay.note)}</p>' if pay.note else ""}

    <div class="foot">
      Confirmed by {method_label}{provider_detail} · {issuer} · GAAhex · All amounts in Armenian Dram (֏).
    </div>
    """
    return HTMLResponse(_page(f"Receipt {receipt_no}", body))
