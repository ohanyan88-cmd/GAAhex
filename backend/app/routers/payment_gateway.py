"""Payment gateway router (Batch 33): initiate · confirm · callback · list · reconcile.

Fixed paths under /api — register BEFORE records.router in main.py to avoid slug shadowing.
The router covers:
  POST /api/invoices/{inv_id}/pay             — initiate an online payment order
  POST /api/payment-orders/{id}/confirm-dev   — dev/test confirm (DevGateway only)
  POST /api/payment/callback/{provider}       — unauthenticated provider webhook
  GET  /api/payment-orders                    — list orders (status/invoice filter)
  POST /api/payment-orders/reconcile          — trigger reconcile sweep

`run_payment_reconcile` is a plain async function (no FastAPI Depends) so the scheduler can call
it directly, mirroring helpdesk.run_sla_breach_sweep / billing.run_dunning patterns.

NOTE: `POST /api/invoices/{inv_id}/pay` shares the /api/invoices prefix with billing.router but
lives here because it touches PaymentOrder, not just the invoice. Since main.py registers billing
first, we rely on FastAPI route precedence (exact path beats prefix) — billing has
/api/invoices/{inv_id}/payments (plural) so there is NO conflict with the singular /pay suffix.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session, OwnerSessionLocal, set_tenant_guc
from ..models import User
from ..models.billing import Invoice, Payment
from ..models.payment_gateway import PaymentOrder
from ..models.job import JobRun
from ..access import load_grants, can
from ..kernel import assert_can, AccessDenied
from .. import workflow
from ..payment_gateway import get_gateway, settle_order
from ..services.payment_allocation import outstanding_for_invoice
from .auth import current_user
from .records import _node_paths, _paginate

router = APIRouter(prefix="/api", tags=["payments-gateway"])


# ---------------------------------------------------------------------------
# helpers (shared with billing.py style)
# ---------------------------------------------------------------------------

def _deny(perm: str):
    raise HTTPException(403, f"Not allowed: {perm}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _order(o: PaymentOrder) -> dict:
    return {
        "id": str(o.id),
        "tenant_id": str(o.tenant_id),
        "owner_node_id": str(o.owner_node_id) if o.owner_node_id else None,
        "invoice_id": str(o.invoice_id),
        "customer_id": str(o.customer_id) if o.customer_id else None,
        "payment_id": str(o.payment_id) if o.payment_id else None,
        "provider": o.provider,
        "amount": o.amount,
        "currency": o.currency,
        "status": o.status,
        "provider_ref": o.provider_ref,
        "redirect_url": o.redirect_url,
        "initiated_at": _iso(o.initiated_at),
        "confirmed_at": _iso(o.confirmed_at),
    }


def _record_job_run(
    s: AsyncSession, user: User, job_key: str, status: str, summary: dict,
    started_at: datetime, owner_node_id=None,
) -> None:
    """Add a JobRun row to the session (same pattern as billing._record_job_run). Caller commits."""
    s.add(JobRun(
        tenant_id=user.tenant_id, owner_node_id=owner_node_id, job_key=job_key, status=status,
        summary=summary, actor_user_id=user.id, started_at=started_at, finished_at=_now(),
    ))


async def _get_order(s: AsyncSession, user: User, order_id) -> PaymentOrder:
    o = (await s.execute(
        select(PaymentOrder).where(
            PaymentOrder.id == order_id,
            PaymentOrder.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if not o:
        raise HTTPException(404, "Payment order not found")
    return o


async def _get_invoice(s: AsyncSession, user: User, inv_id) -> Invoice:
    inv = (await s.execute(
        select(Invoice).where(Invoice.id == inv_id, Invoice.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    return inv


# ---------------------------------------------------------------------------
# POST /api/invoices/{inv_id}/pay
# Initiate an online payment order against a payable invoice.
# Gate: payment.create (same permission billing.add_payment uses — "payment" resource + "create").
# ---------------------------------------------------------------------------

@router.post("/invoices/{inv_id}/pay", status_code=201)
async def initiate_payment(
    inv_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Initiate an online payment order for the invoice. Returns redirect_url for the payer."""
    inv = await _get_invoice(s, user, inv_id)

    grants = await load_grants(s, user)
    # Gate on payment_order.collect (the perm B33 seeds + grants to manager/sales_agent) so
    # non-admins can actually collect online payments. super_admin (*) passes regardless.
    from .records import _node_path  # noqa: PLC0415
    if not can(grants, "payment_order", "collect", await _node_path(s, inv.owner_node_id)):
        _deny("payment_order.collect")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="collect", entity_key="payment_order",
                         region_id=getattr(inv, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # Only ISSUED or OVERDUE invoices may be paid online
    if inv.status not in {"ISSUED", "OVERDUE"}:
        raise HTTPException(
            409, f"Invoice must be ISSUED or OVERDUE to pay online (status is {inv.status})"
        )

    # BL-1 — single canonical balance: includes legacy payments AND applied credit notes.
    balance = int(await outstanding_for_invoice(s, inv.id))

    callback_base = getattr(settings_ref(), "payment_callback_base_url", None) or ""

    order = PaymentOrder(
        tenant_id=user.tenant_id,
        owner_node_id=inv.owner_node_id,
        invoice_id=inv.id,
        customer_id=inv.customer_id,
        provider=_active_provider_name(),
        amount=balance,
        currency="AMD",
        status="PENDING",
    )
    s.add(order)
    await s.flush()  # get order.id for the provider

    redir = await get_gateway().initiate(order, callback_url=callback_base)
    order.redirect_url = redir["redirect_url"]
    order.provider_ref = redir.get("provider_ref") or None

    await workflow.emit(
        s, user.tenant_id, "create", "payment_order", order.id, user.id,
        {"invoice_id": str(inv.id), "amount": balance, "provider": order.provider,
         "provider_ref": order.provider_ref},
    )
    await s.commit()
    await s.refresh(order)
    return {
        "order_id": str(order.id),
        "redirect_url": order.redirect_url,
        "status": order.status,
        "amount": order.amount,
        "provider": order.provider,
    }


def settings_ref():
    """Lazy access to settings to avoid a circular import at module load."""
    from ..config import settings  # noqa: PLC0415
    return settings


def _active_provider_name() -> str:
    """Return the provider name label for the currently-registered gateway instance."""
    gw = get_gateway()
    # DevGateway → "dev"; real adapters should expose a `name` attr, fall back to class name
    return getattr(gw, "name", gw.__class__.__name__.replace("Gateway", "").lower())


# ---------------------------------------------------------------------------
# POST /api/payment-orders/{id}/confirm-dev
# Dev / test confirm: simulates the user completing payment on the dev page.
# Only works when the order's provider == "dev"; returns 400 otherwise.
# Gate: current_user (authenticated; any role may confirm their own order in dev mode)
# ---------------------------------------------------------------------------

@router.post("/payment-orders/{order_id}/confirm-dev")
async def confirm_dev(
    order_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Confirm a dev-mode payment order. Simulates a successful gateway callback without any
    external call — the full settle path runs exactly as it would for a real provider callback."""
    order = await _get_order(s, user, order_id)

    if order.provider != "dev":
        raise HTTPException(
            400,
            f"confirm-dev is only available for dev-provider orders (this order uses '{order.provider}')",
        )

    await settle_order(s, order, actor_id=user.id)
    await s.commit()
    await s.refresh(order)
    return _order(order)


# ---------------------------------------------------------------------------
# POST /api/payment/callback/{provider}
# UNAUTHENTICATED: the payment provider POSTs here to report payment outcome.
# Uses OwnerSessionLocal (RLS-bypass) because there is no JWT in an inbound webhook.
# Always returns HTTP 200 with {ok: true} on a verified callback; 400 on bad sig.
# ---------------------------------------------------------------------------

@router.post("/payment/callback/{provider}")
async def payment_callback(provider: str, request: Request):
    """Inbound provider webhook. Verifies the signature, then settles or fails the order.

    Security: the gateway's verify_callback checks the HMAC/signature before we touch the DB.
    If verification fails we return 400 immediately — no DB write.

    Session: uses OwnerSessionLocal (same as the scheduler) because this endpoint has no
    authenticated user context — the request is from the payment provider's server.
    The tenant GUC is set via set_tenant_guc after resolving the order, exactly as the scheduler
    resolves a system actor before calling job handlers.
    """
    body = await request.body()
    headers = dict(request.headers)

    res = get_gateway().verify_callback(body, headers)
    if not res.get("ok"):
        raise HTTPException(400, "Callback signature verification failed")

    provider_ref_val = res.get("provider_ref") or ""
    cb_status = res.get("status", "FAILED")

    async with OwnerSessionLocal() as s:
        # Pre-tenant inbound webhook: provider_ref is the cluster-unique key used to resolve the
        # order (and from it, the tenant). The tenant GUC is bound below after lookup.
        await s.connection(execution_options={"audit_tenant_filter": False})
        # Find the order by provider_ref (dev: injected into verify_callback; real: from body)
        # For DevGateway, provider_ref is empty in the verify response — look up by the order
        # embedded in the request path or fall back to a body parse.  For real providers, the
        # verify_callback will return the real provider_ref.
        order = None
        if provider_ref_val:
            order = (await s.execute(
                select(PaymentOrder).where(PaymentOrder.provider_ref == provider_ref_val)
            )).scalar_one_or_none()

        if order is None:
            # Verified callback but no matching order (unknown/empty provider_ref) — 404 so the
            # caller knows it wasn't applied (real providers will retry or log).
            raise HTTPException(404, "No payment order found for provider_ref")

        # Wave 1 multi-tenant cross-check: when the verified callback payload includes a tenant_id
        # claim, it MUST match the order's tenant_id. Defense against a provider-ref collision or
        # a forged callback that targets the wrong tenant. Real providers wire tenant into the
        # HMAC-signed payload; if absent (dev mode for now) we skip — provider_ref still uniquely
        # identifies the order via the DB lookup above.
        claimed_tenant = res.get("tenant_id")
        if claimed_tenant is not None and str(claimed_tenant) != str(order.tenant_id):
            raise HTTPException(400, "Callback tenant mismatch")

        # Set the tenant GUC so RLS on any subsequent queries is satisfied
        await set_tenant_guc(s, order.tenant_id)

        if cb_status == "PAID":
            await settle_order(s, order, actor_id=None, provider_ref=provider_ref_val or None,
                               raw=res)
        else:
            order.status = "FAILED"
            order.raw_callback = res

        await s.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# GET /api/payment-orders
# List payment orders for the tenant, optionally filtered by status or invoice.
# Gate: payment_order.view, org-scoped via _node_paths.
# ---------------------------------------------------------------------------

@router.get("/payment-orders")
async def list_payment_orders(
    status: str | None = None,
    invoice: uuid.UUID | None = None,
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "payment_order", "view"):
        _deny("payment_order.view")

    paths = await _node_paths(s, user.tenant_id)
    q = (
        select(PaymentOrder)
        .where(PaymentOrder.tenant_id == user.tenant_id)
        .order_by(PaymentOrder.initiated_at.desc())
    )
    if status:
        q = q.where(PaymentOrder.status == status)
    if invoice:
        q = q.where(PaymentOrder.invoice_id == invoice)

    rows = (await s.execute(q)).scalars().all()
    visible = [
        o for o in rows
        if can(grants, "payment_order", "view",
               paths.get(str(o.owner_node_id)) if o.owner_node_id else None)
    ]
    return [_order(o) for o in _paginate(visible, limit, offset)]


# ---------------------------------------------------------------------------
# POST /api/payment-orders/reconcile
# Trigger the reconcile sweep manually (gate: payment_order.view).
# The real sweep logic lives in run_payment_reconcile (scheduler-callable).
# ---------------------------------------------------------------------------

@router.post("/payment-orders/reconcile")
async def reconcile_payment_orders(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Manually trigger the payment reconcile sweep for this tenant."""
    grants = await load_grants(s, user)
    if not can(grants, "payment_order", "view"):
        _deny("payment_order.view")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation (tenant-wide sweep).
    try:
        await assert_can(s, user, action="view", entity_key="payment_order",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    return await run_payment_reconcile(user=user, s=s)


# ---------------------------------------------------------------------------
# run_payment_reconcile — scheduler-callable (no FastAPI Depends)
# Mirror of helpdesk.run_sla_breach_sweep / billing.run_dunning patterns.
# ---------------------------------------------------------------------------

async def run_payment_reconcile(user: User, s: AsyncSession) -> dict:
    """Sweep PENDING orders; settle PAID ones; expire stale ones.

    - PENDING orders > 15 min old → call get_gateway().check_status(); if PAID → settle_order.
    - PENDING orders > 60 min old (and still PENDING after status check) → mark EXPIRED.

    Logs a JobRun (SUCCESS/ERROR) exactly like run_dunning. Returns {reconciled, expired}.

    Signature: accept `user=` and `s=` kwargs so the scheduler _JOBS lambda can call it as
    run_payment_reconcile(user=actor, s=s) — no FastAPI Depends injected here.
    """
    started = _now()
    reconciled = 0
    expired = 0

    try:
        now = _now()
        stale_cutoff = now - timedelta(minutes=15)
        expire_cutoff = now - timedelta(minutes=60)

        pending_orders = (await s.execute(
            select(PaymentOrder).where(
                PaymentOrder.tenant_id == user.tenant_id,
                PaymentOrder.status == "PENDING",
                PaymentOrder.initiated_at <= stale_cutoff,
            )
        )).scalars().all()

        for order in pending_orders:
            try:
                st = await get_gateway().check_status(order)
            except Exception:
                # Provider error — skip this order, continue sweeping others
                continue

            if st == "PAID":
                await settle_order(s, order, actor_id=user.id)
                reconciled += 1
            elif order.initiated_at <= expire_cutoff and order.status == "PENDING":
                # Still PENDING after 60 min — expire it
                order.status = "EXPIRED"
                expired += 1

        summary = {"reconciled": reconciled, "expired": expired}
        _record_job_run(s, user, "payment.reconcile", "SUCCESS", summary, started)
        await s.commit()

    except Exception as e:
        await s.rollback()
        _record_job_run(s, user, "payment.reconcile", "ERROR", {"message": str(e)}, started)
        await s.commit()
        raise

    return {"reconciled": reconciled, "expired": expired}
