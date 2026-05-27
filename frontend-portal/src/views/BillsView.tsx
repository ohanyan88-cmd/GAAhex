import { useEffect, useState } from 'react'
import { api, type PortalInvoice, type PortalPayment } from '../api'

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PAID: 'var(--success)', ISSUED: 'var(--warning)', OVERDUE: 'var(--danger)',
    DRAFT: 'var(--text-3)', VOID: 'var(--text-3)',
  }
  return (
    <span style={{
      background: `${colors[status] ?? 'var(--text-3)'}22`,
      color: colors[status] ?? 'var(--text-3)',
      border: `1px solid ${colors[status] ?? 'var(--text-3)'}`,
      borderRadius: 'var(--pill)',
      padding: '2px 10px',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.04em',
    }}>
      {status}
    </span>
  )
}

function fmt(luma: number) {
  return (luma / 100).toLocaleString('hy-AM', { minimumFractionDigits: 2 }) + ' ֏'
}

export default function BillsView() {
  const [invoices, setInvoices] = useState<PortalInvoice[]>([])
  const [payments, setPayments] = useState<PortalPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState<string | null>(null)

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

  if (loading) return <div style={{ padding: 24, color: 'var(--text-3)' }}>Loading...</div>
  if (error) return <div style={{ padding: 24, color: 'var(--danger)' }}>{error}</div>

  const totalBalance = invoices.reduce((s, i) => s + i.balance, 0)

  return (
    <div style={{ padding: 28 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Bills</h1>

      {totalBalance > 0 && (
        <div style={{
          background: 'var(--warning-soft)',
          border: '1px solid var(--warning)',
          borderRadius: 'var(--radius)',
          padding: '12px 16px',
          marginBottom: 20,
          color: 'var(--warning)',
          fontWeight: 600,
        }}>
          Balance due: {fmt(totalBalance)}
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-2)' }}>Invoices</h2>
      {invoices.length === 0 ? (
        <p style={{ color: 'var(--text-3)', marginBottom: 24 }}>No invoices yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
          {invoices.map(inv => (
            <div key={inv.id} style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}>
              <span style={{ fontWeight: 600, minWidth: 90 }}>{inv.number}</span>
              <StatusPill status={inv.status} />
              <span style={{ color: 'var(--text-2)' }}>{fmt(inv.total)}</span>
              {inv.balance > 0 && (
                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                  Balance: {fmt(inv.balance)}
                </span>
              )}
              <span style={{ flex: 1 }} />
              {['ISSUED', 'OVERDUE'].includes(inv.status) && (
                <button
                  onClick={() => handlePay(inv.id)}
                  disabled={paying === inv.id}
                  style={{
                    background: 'var(--accent)',
                    color: 'var(--accent-text)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 14px',
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  {paying === inv.id ? 'Processing...' : 'Pay now'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-2)' }}>Payment history</h2>
      {payments.length === 0 ? (
        <p style={{ color: 'var(--text-3)' }}>No payments yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {payments.map(p => (
            <div key={p.id} style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px 16px',
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}>
              <span style={{ color: 'var(--success)', fontWeight: 600 }}>{fmt(p.amount)}</span>
              <span style={{ color: 'var(--text-3)' }}>{p.method}</span>
              <span style={{ color: 'var(--text-3)' }}>{new Date(p.paid_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
