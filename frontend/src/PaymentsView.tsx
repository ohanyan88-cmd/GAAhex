import { useEffect, useState } from 'react'
import { bget, loadCustomers, type Payment, type Invoice } from './billing'
import { money } from './money'
import { EmptyState, ErrorBanner } from './States'
import { CreditCardIcon, ReceiptIcon, DownloadIcon } from './icons'
import ViewHead from './ViewHead'
import { usePageConfig } from './pageConfig'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function methodPill(method: string | null | undefined) {
  const m = (method ?? '').toLowerCase()
  const cls = m === 'card' ? 'pill pill-accent'
    : m === 'cash' ? 'pill pill-success'
    : 'pill pill-muted'
  return <span className={cls}>{method ?? '—'}</span>
}

export default function PaymentsView({ token, configVersion = 0 }: { token: string; configVersion?: number }) {
  const cfg = usePageConfig(token, 'payments', configVersion)
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [invoiceMap, setInvoiceMap] = useState<Record<string, Invoice>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  async function load() {
    setError('')
    setPayments(null)

    const [pr, ir, customers] = await Promise.all([
      bget<Payment[]>(token, '/api/payments'),
      bget<Invoice[]>(token, '/api/invoices'),
      loadCustomers(token),
    ])

    if (!pr.ok) {
      setError('Failed to load payments')
      setPayments([])
      return
    }

    const pList = Array.isArray(pr.data) ? pr.data : []
    setPayments(pList)

    const imap: Record<string, Invoice> = {}
    if (ir.ok && Array.isArray(ir.data)) {
      for (const inv of ir.data) imap[inv.id] = inv
    }
    setInvoiceMap(imap)
    setNames(customers)
  }

  useEffect(() => { load() }, [token])

  function invoiceRef(p: Payment): string {
    const inv = invoiceMap[p.invoice_id]
    if (inv?.number) return inv.number
    return p.invoice_id.slice(0, 8)
  }

  function customerName(p: Payment): string {
    const inv = invoiceMap[p.invoice_id]
    if (!inv?.customer_id) return '—'
    return names[inv.customer_id] ?? inv.customer_id.slice(0, 8)
  }

  const pList = payments ?? []
  const totalSettled = pList.reduce((a, p) => a + (p.amount ?? 0), 0)

  return (
    <div>
      <ViewHead
        icon={<CreditCardIcon size={18} />}
        title={cfg.title}
        sub={`Inbound payments · adapters: Card, Bank, Cash · ${pList.length} records`}
        actions={
          <button className="btn btn-ghost btn-sm">
            <DownloadIcon size={13} /> Reconcile
          </button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}
      {payments === null && !error && <p className="muted">Loading…</p>}

      {payments !== null && payments.length === 0 && !error && (
        <EmptyState
          icon={<CreditCardIcon size={40} />}
          title="No payments recorded yet."
          message="Payments will appear here once invoices have been paid."
        />
      )}

      {payments !== null && payments.length > 0 && (
        <>
          <div className="widgets" style={{ marginBottom: 18 }}>
            <div className="widget">
              <div className="widget-label">Total collected</div>
              <div className="kpi"><span className="kpi-cur">֏</span>{(totalSettled / 1000).toFixed(1)}k</div>
              <div className="kpi-sub">{pList.length} settlement{pList.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="widget">
              <div className="widget-label">Methods</div>
              <div className="kpi" style={{ fontSize: 24 }}>
                {[...new Set(pList.map(p => p.method).filter(Boolean))].join(' · ') || '—'}
              </div>
              <div className="kpi-sub">adapters active</div>
            </div>
          </div>

          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {cfg.columns.map((c) => (
                    <th key={c.key} scope="col" className={c.key === 'amount' ? 'num' : ''}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pList.map(p => (
                  <tr key={p.id}>
                    {cfg.columns.map((c) => {
                      if (c.key === 'invoice') return (
                        <td key={c.key}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <ReceiptIcon size={13} />
                            <span className="mono" style={{ color: 'var(--accent)' }}>{invoiceRef(p)}</span>
                          </span>
                        </td>
                      )
                      if (c.key === 'customer') return <td key={c.key}>{customerName(p)}</td>
                      if (c.key === 'method') return <td key={c.key}>{methodPill(p.method)}</td>
                      if (c.key === 'date') return <td key={c.key} className="mono">{fmtDate(p.paid_at)}</td>
                      if (c.key === 'amount') return <td key={c.key} className="num">֏{(p.amount ?? 0).toLocaleString()}</td>
                      if (c.key === 'note') return <td key={c.key} className="muted">{p.note ?? '—'}</td>
                      return <td key={c.key}>—</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
