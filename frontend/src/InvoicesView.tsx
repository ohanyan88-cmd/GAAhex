import { useEffect, useState } from 'react'
import { bget, bpost, type Invoice, type Payment } from './billing'
import { money, toMinor } from './money'
import { timeAgo } from './time'
import { Modal } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import { ReceiptIcon, ArrowRightIcon, ChevronLeftIcon } from './icons'

const STATUSES = ['draft', 'issued', 'paid', 'overdue', 'void']

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
const custName = (x: { customer_name?: string; customer?: string }) => x.customer_name ?? x.customer ?? '—'

export default function InvoicesView({ token }: { token: string }) {
  const [list, setList] = useState<Invoice[] | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  async function load() {
    setError(''); setUnavailable(false); setList(null)
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    const qs = p.toString()
    const res = await bget<Invoice[]>(token, `/api/invoices${qs ? `?${qs}` : ''}`)
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (!res.ok) { setError('Failed to load invoices'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token, status])

  if (detailId) return <InvoiceDetail token={token} id={detailId} onBack={() => { setDetailId(null); load() }} />

  return (
    <div>
      <div className="view-head"><h2>Invoices</h2></div>

      <div className="list-toolbar">
        <div className="bill-filter">
          <span className="muted export-label">Status</span>
          <select className="inp inp-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState icon={<ReceiptIcon size={40} />} title="Billing isn't available yet" message="Invoices will appear here once the billing service is enabled." />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<ReceiptIcon size={40} />} title="No invoices" message="No invoices match this filter." />
      )}

      {list && list.length > 0 && (
        <table className="grid">
          <thead>
            <tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Total</th><th>Due</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.number ?? inv.id.slice(0, 8)}</td>
                <td>{custName(inv)}</td>
                <td>{inv.status ? <span className="pill">{inv.status}</span> : '—'}</td>
                <td>{money(inv.total)}</td>
                <td>{fmtDate(inv.due_date)}</td>
                <td className="row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setDetailId(inv.id)}>Open <ArrowRightIcon size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function InvoiceDetail({ token, id, onBack }: { token: string; id: string; onBack: () => void }) {
  const [inv, setInv] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [error, setError] = useState('')
  const [payOpen, setPayOpen] = useState(false)

  async function load() {
    setError('')
    const res = await bget<Invoice>(token, `/api/invoices/${id}`)
    if (!res.ok) { setError(res.status === 404 ? 'Invoice not found' : 'Failed to load invoice'); return }
    setInv(res.data)
    const pr = await bget<Payment[]>(token, `/api/invoices/${id}/payments`)
    if (pr.ok && Array.isArray(pr.data)) setPayments(pr.data)
  }

  useEffect(() => { load() }, [token, id])

  async function issue() {
    try {
      await bpost(token, `/api/invoices/${id}/issue`)
      toast.success('Invoice issued')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const lines = inv?.lines ?? []
  const status = (inv?.status ?? '').toLowerCase()

  return (
    <div>
      <div className="view-head">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ChevronLeftIcon size={14} /> Invoices</button>
        <h2 style={{ marginLeft: 8 }}>{inv?.number ?? `Invoice ${id.slice(0, 8)}`}</h2>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!inv && !error && <p className="muted">Loading…</p>}

      {inv && (
        <>
          <div className="bill-meta">
            <div><span className="muted">Customer</span><div>{custName(inv)}</div></div>
            <div><span className="muted">Status</span><div>{inv.status ? <span className="pill">{inv.status}</span> : '—'}</div></div>
            <div><span className="muted">Due</span><div>{fmtDate(inv.due_date)}</div></div>
            <div className="bill-actions">
              {status === 'draft' && <button className="btn btn-primary btn-sm" onClick={issue}>Issue</button>}
              <button className="btn btn-accent btn-sm" onClick={() => setPayOpen(true)}>Record payment</button>
            </div>
          </div>

          <table className="grid bill-lines">
            <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.description ?? '—'}</td>
                  <td>{l.quantity ?? 1}</td>
                  <td>{money(l.unit_amount)}</td>
                  <td>{money(l.amount)}</td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={4} className="muted">No line items.</td></tr>}
            </tbody>
          </table>

          <div className="bill-totals">
            {inv.subtotal != null && <div><span className="muted">Subtotal</span><span>{money(inv.subtotal)}</span></div>}
            {inv.tax != null && <div><span className="muted">Tax</span><span>{money(inv.tax)}</span></div>}
            <div className="bill-total-row"><span>Total</span><span>{money(inv.total)}</span></div>
          </div>

          <h3 style={{ marginTop: 20 }}>Payments</h3>
          {payments.length === 0
            ? <p className="muted">No payments recorded.</p>
            : (
              <table className="grid">
                <thead><tr><th>Amount</th><th>Method</th><th>When</th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}><td>{money(p.amount)}</td><td>{p.method ?? '—'}</td><td>{timeAgo(p.created_at ?? null)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
        </>
      )}

      {payOpen && (
        <PaymentModal token={token} invoiceId={id} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); load() }} />
      )}
    </div>
  )
}

function PaymentModal({ token, invoiceId, onClose, onDone }: { token: string; invoiceId: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('card')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!amount || saving) return
    setSaving(true)
    try {
      await bpost(token, `/api/invoices/${invoiceId}/payments`, { amount: toMinor(amount), method, reference: reference || undefined })
      toast.success('Payment recorded')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record payment"
      size="sm"
      footer={
        <>
          <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent btn-md" disabled={saving || !amount} onClick={submit}>{saving ? 'Saving…' : 'Record'}</button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field"><span>Amount (֏)</span><input className="inp inp-md inp-numeric" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field"><span>Method</span>
          <select className="inp inp-md" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="card">Card</option>
            <option value="bank">Bank transfer</option>
            <option value="cash">Cash</option>
          </select>
        </label>
        <label className="field"><span>Reference</span><input className="inp inp-md" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" /></label>
      </div>
    </Modal>
  )
}
