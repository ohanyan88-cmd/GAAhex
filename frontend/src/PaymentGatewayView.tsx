import { useEffect, useState } from 'react'
import {
  listPaymentOrders, reconcileOrders, openReceipt,
  type PaymentOrder, type PaymentOrderStatus,
} from './paymentgw'
import { money } from './money'
import { Modal } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import { CreditCardIcon, ReceiptIcon, ArrowRightIcon } from './icons'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

const ORDER_STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PAID', label: 'Paid' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

// Status pill: PAID=success, PENDING=warning, FAILED|EXPIRED=danger, CANCELLED=muted
function orderStatusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase() as PaymentOrderStatus | ''
  const cls = s === 'PAID' ? 'pill pill-success'
    : s === 'PENDING' ? 'pill pill-warning'
    : s === 'FAILED' || s === 'EXPIRED' ? 'pill pill-danger'
    : s === 'CANCELLED' ? 'pill pill-muted'
    : 'pill'
  return status
    ? <span className={cls}>{status}</span>
    : <span className="muted">—</span>
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function PaymentGatewayView({ token }: { token: string }) {
  const [orders, setOrders] = useState<PaymentOrder[] | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  async function load() {
    setError(''); setUnavailable(false); setOrders(null)
    const res = await listPaymentOrders(token, { status: statusFilter || undefined })
    if (res.status === 404) { setUnavailable(true); setOrders([]); return }
    if (!res.ok) { setError('Failed to load payment orders'); setOrders([]); return }
    setOrders(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token, statusFilter])

  async function handleReconcile() {
    if (reconciling) return
    setReconciling(true)
    try {
      const result = await reconcileOrders(token)
      toast.success(`Reconciled ${result.reconciled} order(s); ${result.expired} expired.`)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setReconciling(false)
    }
  }

  async function handleOpenReceipt(paymentId: string) {
    const err = await openReceipt(token, paymentId)
    if (err) toast.error(err)
  }

  return (
    <div>
      <div className="view-head">
        <CreditCardIcon size={18} />
        <h2 style={{ marginLeft: 8 }}>Payment Gateway</h2>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleReconcile}
          disabled={reconciling}
          style={{ marginLeft: 'auto' }}
        >
          {reconciling ? 'Reconciling…' : 'Reconcile now'}
        </button>
      </div>

      <div className="list-toolbar">
        <div className="bill-filter">
          <span className="muted export-label">Status</span>
          <select
            className="inp inp-sm"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {ORDER_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {orders === null && !error && <p className="muted">Loading…</p>}

      {unavailable && (
        <EmptyState
          icon={<CreditCardIcon size={40} />}
          title="Payment gateway isn't available yet"
          message="Payment orders will appear here once the gateway service is enabled."
        />
      )}

      {orders && !unavailable && orders.length === 0 && !error && (
        <EmptyState
          icon={<CreditCardIcon size={40} />}
          title="No payment orders"
          message="Payment orders will appear here once customers initiate online payments."
        />
      )}

      {orders && orders.length > 0 && (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Order ID</th>
                <th scope="col">Invoice</th>
                <th scope="col">Amount</th>
                <th scope="col">Provider</th>
                <th scope="col">Status</th>
                <th scope="col">Initiated</th>
                <th scope="col">Confirmed</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
                    {o.id.slice(0, 8)}
                  </td>
                  <td className="muted">{o.invoice_id ? o.invoice_id.slice(0, 8) : '—'}</td>
                  <td>{money(o.amount)}</td>
                  <td className="muted" style={{ textTransform: 'capitalize' }}>
                    {o.provider ?? '—'}
                  </td>
                  <td>{orderStatusPill(o.status)}</td>
                  <td>{fmtDate(o.initiated_at)}</td>
                  <td>{fmtDate(o.confirmed_at)}</td>
                  <td className="row-actions">
                    {o.payment_id && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleOpenReceipt(o.payment_id!)}
                        title="Open receipt"
                      >
                        <ReceiptIcon size={13} /> Receipt
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
