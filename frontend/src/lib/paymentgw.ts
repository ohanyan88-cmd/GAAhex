// Payment gateway API client — A33 contract.
// Uses bget/bpost from billing.ts so auth + error handling is consistent.
import { BASE, authH, bget, bpost, type Fetched } from './billing'

// ── Types ────────────────────────────────────────────────────────────────────

export type PaymentOrderStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED'

export type PaymentOrder = {
  id: string
  invoice_id: string
  customer_id?: string | null
  provider?: string | null
  amount?: number | null        // luma
  currency?: string | null
  status: PaymentOrderStatus
  provider_ref?: string | null
  redirect_url?: string | null
  payment_id?: string | null    // set once PAID — links to /api/payments/{id}/receipt
  confirmed_at?: string | null
  initiated_at?: string | null
  [k: string]: any
}

export type InitiatePayResult = {
  order_id: string
  redirect_url: string
  status: PaymentOrderStatus
}

export type ReconcileResult = {
  reconciled: number
  expired: number
}

// ── API helpers ───────────────────────────────────────────────────────────────

/** POST /api/invoices/{inv_id}/pay → creates a PaymentOrder */
export function initiatePayment(token: string, invoiceId: string): Promise<InitiatePayResult> {
  return bpost<InitiatePayResult>(token, `/api/invoices/${invoiceId}/pay`)
}

/** POST /api/payment-orders/{id}/confirm-dev → settles the order (dev flow only) */
export function confirmDevPayment(token: string, orderId: string): Promise<PaymentOrder> {
  return bpost<PaymentOrder>(token, `/api/payment-orders/${orderId}/confirm-dev`)
}

/** GET /api/payment-orders?status=&invoice= */
export function listPaymentOrders(
  token: string,
  filters?: { status?: string; invoice?: string },
): Promise<Fetched<PaymentOrder[]>> {
  const p = new URLSearchParams()
  if (filters?.status) p.set('status', filters.status)
  if (filters?.invoice) p.set('invoice', filters.invoice)
  const qs = p.toString()
  return bget<PaymentOrder[]>(token, `/api/payment-orders${qs ? `?${qs}` : ''}`)
}

/** POST /api/payment-orders/reconcile → {reconciled, expired} */
export function reconcileOrders(token: string): Promise<ReconcileResult> {
  return bpost<ReconcileResult>(token, '/api/payment-orders/reconcile')
}

/** Open GET /api/payments/{payment_id}/receipt in a new tab via authed blob fetch
 *  (same pattern as openDocument in billing.ts — must be called inside a click handler
 *  to avoid popup blocking). Returns error string or null on success. */
export async function openReceipt(token: string, paymentId: string): Promise<string | null> {
  // Open a blank tab synchronously (inside the click gesture) before the async fetch
  // so popup blockers don't block it — then redirect the tab once the blob is ready.
  const win = window.open('', '_blank')
  try {
    const r = await fetch(`${BASE}/api/payments/${paymentId}/receipt`, { headers: authH(token) })
    if (!r.ok) {
      throw new Error(
        r.status === 404 ? 'Receipt not available yet'
          : r.status === 403 ? 'Not allowed'
          : `Failed (${r.status})`,
      )
    }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    if (win) win.location.href = url
    else {
      const a = document.createElement('a')
      a.href = url; a.target = '_blank'; a.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return null
  } catch (e) {
    if (win) win.close()
    return (e as Error).message
  }
}

/** True when redirect_url is the built-in dev-flow simulator */
export function isDevFlow(redirectUrl: string): boolean {
  return redirectUrl.includes('/pay/dev/')
}
