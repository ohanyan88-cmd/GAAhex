import { useEffect, useState } from 'react'
import { bget, loadCustomers, type Payment, type Invoice } from './billing'
import { money } from './money'
import { EmptyState, ErrorBanner } from './States'
import { CreditCardIcon, ReceiptIcon } from './icons'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export default function PaymentsView({ token }: { token: string }) {
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

  return (
    <div>
      <div className="view-head">
        <CreditCardIcon size={20} />
        <h2 style={{ marginLeft: 8 }}>Payments</h2>
      </div>

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
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Invoice</th>
                <th scope="col">Customer</th>
                <th scope="col">Method</th>
                <th scope="col">Amount (֏)</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td>{fmtDate(p.paid_at)}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <ReceiptIcon size={13} />
                      {invoiceRef(p)}
                    </span>
                  </td>
                  <td>{customerName(p)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{p.method}</td>
                  <td>{money(p.amount)}</td>
                  <td className="muted">{p.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
