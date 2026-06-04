import { useEffect, useState } from 'react'
import { api, type PortalInvoice, type PortalPayment } from '../lib/api'
import { fmt } from '../lib/money'  // DF-7 — canonical AMD formatter
import { useI18n } from '../lib/i18n'  // T-P4-2

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

export default function BillsView() {
  const [invoices, setInvoices]   = useState<PortalInvoice[]>([])
  const [payments, setPayments]   = useState<PortalPayment[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [paying, setPaying]       = useState<string | null>(null)
  const { t } = useI18n()

  // T-P4-2 — translate the status-pill text. UPPER_SNAKE_CASE remains the
  // canonical wire/value (B1); the user-visible label is what gets localized.
  const statusLabel = (s: string): string => {
    const map: Record<string, string> = {
      PAID:    t('bills.statusPaid', 'PAID'),
      ISSUED:  t('bills.statusIssued', 'ISSUED'),
      OVERDUE: t('bills.statusOverdue', 'OVERDUE'),
      DRAFT:   t('bills.statusDraft', 'DRAFT'),
      VOID:    t('bills.statusVoid', 'VOID'),
    }
    return map[s] ?? s
  }

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

  if (loading) return <div className="loading-state">{t('common.loading', 'Loading...')}</div>
  if (error)   return (
    <div className="error-banner">
      <span className="error-banner-title">{t('common.error', 'Error')}</span>
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
          <h2>{t('bills.title', 'Bills')}</h2>
          <span className="view-sub">{t('bills.subtitle', 'Invoices and payment history')}</span>
        </div>
      </div>

      {totalBalance > 0 && (
        <div className="toast toast-warning" style={{ position: 'static', marginBottom: 20, width: '100%', boxSizing: 'border-box' }}>
          <div className="toast-msg">
            <b>{t('dash.balanceDue', 'Balance due')}</b>
            <span>{fmt(totalBalance)} {t('bills.outstandingMsg', 'outstanding — please pay to avoid service interruption')}</span>
          </div>
        </div>
      )}

      {/* Invoices section */}
      <div className="section-head">{t('bills.invoices', 'Invoices')}</div>

      {invoices.length === 0 ? (
        <div className="empty-state">
          <h3>{t('bills.empty', 'No invoices yet')}</h3>
          <p>{t('bills.emptyHint', 'Your invoices will appear here once they are issued.')}</p>
        </div>
      ) : (
        <table className="grid" style={{ marginBottom: 32 }}>
          <thead>
            <tr>
              <th>{t('bills.number', 'Invoice')}</th>
              <th>{t('bills.status', 'Status')}</th>
              <th className="num">{t('bills.total', 'Total')}</th>
              <th className="num">{t('bills.balance', 'Balance')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id}>
                <td style={{ fontWeight: 600 }}>{inv.number}</td>
                <td><span className={statusPillClass(inv.status)}>{statusLabel(inv.status)}</span></td>
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
                      {paying === inv.id ? t('bills.processing', 'Processing...') : t('bills.pay', 'Pay now')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Payment history section */}
      <div className="section-head">{t('bills.payments', 'Payment history')}</div>

      {payments.length === 0 ? (
        <div className="empty-state">
          <h3>{t('bills.paymentsEmpty', 'No payments yet')}</h3>
          <p>{t('bills.paymentsEmptyHint', 'Completed payments will appear here.')}</p>
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th className="num">{t('bills.amount', 'Amount')}</th>
              <th>{t('bills.method', 'Method')}</th>
              <th>{t('bills.paidAt', 'Date')}</th>
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
