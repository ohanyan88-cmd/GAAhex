import { useEffect, useState } from 'react'
import { api, type PortalInvoice, type PortalPayment } from '../lib/api'

function statusPillClass(status: string): string {
  const map: Record<string, string> = {
    PAID:    'pill pill-success',
    ISSUED:  'pill pill-warning',
    OVERDUE: 'pill pill-danger',
    DRAFT:   'pill pill-muted',
    VOID:    'pill pill-muted',
  }
  return map[status] ?? 'pill pill-muted'
}

function fmt(luma: number) {
  return (luma / 100).toLocaleString('hy-AM', { minimumFractionDigits: 2 }) + ' ֏'
}

export default function BillsView() {
  const [invoices, setInvoices]   = useState<PortalInvoice[]>([])
  const [payments, setPayments]   = useState<PortalPayment[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [paying, setPaying]       = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.invoices(), api.payments()])
      .then(([inv, pay]) => { setInvoices(inv); setPayments(pay) })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handlePay(invId: string) {
    setPaying(invId)
    try {
      const result = await api.payInvoice(invId)
      if (result.redirect_url.includes('/pay/dev/')) {
        window.location.href = result.redirect_url
      } else {
        window.open(result.redirect_url, '_blank')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Payment initiation failed')
    } finally {
      setPaying(null)
    }
  }

  if (loading) return <div className="loading-state">Loading...</div>
  if (error)   return (
    <div className="error-banner">
      <span className="error-banner-title">Error</span>
      <span className="error-banner-msg">{error}</span>
    </div>
  )

  // Only payable invoices (ISSUED/OVERDUE) count toward "balance due" — matches /me/summary
  // and the per-row Pay button. DRAFT invoices are not payable, so they must not trigger dunning.
  const totalBalance = invoices
    .filter(i => ['ISSUED', 'OVERDUE'].includes(i.status))
    .reduce((s, i) => s + i.balance, 0)

  return (
    <div>
      <div className="view-head">
        <div className="view-title-wrap">
          <h2>Bills</h2>
          <span className="view-sub">Invoices and payment history</span>
        </div>
      </div>

      {totalBalance > 0 && (
        <div className="toast toast-warning" style={{ position: 'static', marginBottom: 20, width: '100%', boxSizing: 'border-box' }}>
          <div className="toast-msg">
            <b>Balance due</b>
            <span>{fmt(totalBalance)} outstanding — please pay to avoid service interruption</span>
          </div>
        </div>
      )}

      {/* Invoices section */}
      <div className="section-head">Invoices</div>

      {invoices.length === 0 ? (
        <div className="empty-state">
          <h3>No invoices yet</h3>
          <p>Your invoices will appear here once they are issued.</p>
        </div>
      ) : (
        <table className="grid" style={{ marginBottom: 32 }}>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Status</th>
              <th className="num">Total</th>
              <th className="num">Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id}>
                <td style={{ fontWeight: 600 }}>{inv.number}</td>
                <td><span className={statusPillClass(inv.status)}>{inv.status}</span></td>
                <td className="num">{fmt(inv.total)}</td>
                <td className="num" style={inv.balance > 0 ? { color: 'var(--danger)', fontWeight: 600 } : { color: 'var(--text-3)' }}>
                  {inv.balance > 0 ? fmt(inv.balance) : '—'}
                </td>
                <td>
                  {['ISSUED', 'OVERDUE'].includes(inv.status) && (
                    <button
                      className="btn btn-accent btn-sm"
                      onClick={() => handlePay(inv.id)}
                      disabled={paying === inv.id}
                    >
                      {paying === inv.id ? 'Processing...' : 'Pay now'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Payment history section */}
      <div className="section-head">Payment history</div>

      {payments.length === 0 ? (
        <div className="empty-state">
          <h3>No payments yet</h3>
          <p>Completed payments will appear here.</p>
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th className="num">Amount</th>
              <th>Method</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id}>
                <td className="num" style={{ color: 'var(--success)', fontWeight: 600 }}>{fmt(p.amount)}</td>
                <td><span className="badge">{p.method}</span></td>
                <td style={{ color: 'var(--text-3)' }}>{new Date(p.paid_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
