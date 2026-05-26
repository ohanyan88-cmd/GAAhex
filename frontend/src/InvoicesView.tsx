import { useEffect, useState } from 'react'
import { bget, bpost, loadCustomers, openDocument, type Invoice } from './billing'
import { money, toMinor } from './money'
import { Modal } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import { ReceiptIcon, ArrowRightIcon, ChevronLeftIcon, PrinterIcon } from './icons'
import { useI18n } from './i18n'

const STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID']

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// Status → pill style: PAID success, OVERDUE danger, VOID muted, others default.
function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase()
  const cls = s === 'PAID' ? 'pill pill-success'
    : s === 'OVERDUE' ? 'pill pill-danger'
    : s === 'VOID' ? 'pill pill-muted'
    : 'pill'
  return status ? <span className={cls}>{status}</span> : <span>—</span>
}

export default function InvoicesView({ token, canConfigure = false }: { token: string; canConfigure?: boolean }) {
  const { t } = useI18n()
  const [list, setList] = useState<Invoice[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [cycleNA, setCycleNA] = useState(false)     // hide run-cycle once the endpoint 404s
  const [cycleBusy, setCycleBusy] = useState(false)

  async function load() {
    setError(''); setUnavailable(false); setList(null)
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    const qs = p.toString()
    const res = await bget<Invoice[]>(token, `/api/invoices${qs ? `?${qs}` : ''}`)
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (!res.ok) { setError('Failed to load invoices'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
    setNames(await loadCustomers(token))
  }

  useEffect(() => { load() }, [token, status])

  async function runDunning() {
    try {
      await bpost(token, '/api/invoices/run-dunning')
      toast.success('Dunning run complete')
      await load()
    } catch (e) {
      const err = e as Error & { status?: number }
      toast.error(err.status === 404 ? 'Dunning isn’t available yet' : err.message)
    }
  }

  // Run the billing cycle (super-admin / config-gated): generates invoices for due subscriptions.
  async function runCycle() {
    if (cycleBusy) return
    setCycleBusy(true)
    try {
      const r = await bpost<{ generated?: number; skipped?: number }>(token, '/api/billing/run-cycle')
      const msg = t('billing.cycleResult', 'Billing cycle: {generated} generated, {skipped} skipped')
        .replace('{generated}', String(r?.generated ?? 0)).replace('{skipped}', String(r?.skipped ?? 0))
      toast.success(msg)
      await load()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 404) { setCycleNA(true); toast.error(t('billing.cycleNA', 'Billing cycle isn’t available yet')) }
      else toast.error(err.message)
    } finally { setCycleBusy(false) }
  }

  const cust = (inv: Invoice) => (inv.customer_id ? (names[inv.customer_id] ?? inv.customer_id.slice(0, 8)) : '—')

  if (detailId) return <InvoiceDetail token={token} id={detailId} names={names} onBack={() => { setDetailId(null); load() }} />

  return (
    <div>
      <div className="view-head">
        <h2>Invoices</h2>
        {canConfigure && !cycleNA && (
          <button className="btn btn-primary btn-sm" onClick={runCycle} disabled={cycleBusy}>{cycleBusy ? t('billing.running', 'Running…') : t('billing.runCycle', 'Run billing cycle')}</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={runDunning}>Run dunning</button>
      </div>

      <div className="list-toolbar">
        <div className="bill-filter">
          <span className="muted export-label">Status</span>
          <select className="inp inp-sm" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
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
        <div className="grid-wrap"><table className="grid">
          <thead>
            <tr><th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col">Due</th><th scope="col"></th></tr>
          </thead>
          <tbody>
            {list.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.number ?? inv.id.slice(0, 8)}</td>
                <td>{cust(inv)}</td>
                <td>{statusPill(inv.status)}</td>
                <td>{money(inv.total)}</td>
                <td>{fmtDate(inv.due_at)}</td>
                <td className="row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setDetailId(inv.id)}>Open <ArrowRightIcon size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  )
}

function InvoiceDetail({ token, id, names, onBack }: { token: string; id: string; names: Record<string, string>; onBack: () => void }) {
  const [inv, setInv] = useState<Invoice | null>(null)
  const [error, setError] = useState('')
  const [payOpen, setPayOpen] = useState(false)

  async function load() {
    setError('')
    const res = await bget<Invoice>(token, `/api/invoices/${id}`)
    if (!res.ok) { setError(res.status === 404 ? 'Invoice not found' : 'Failed to load invoice'); return }
    setInv(res.data)
    // payments aren't separately listed by the API — derive nothing; show via record activity if needed
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
  const status = (inv?.status ?? '').toUpperCase()
  const cust = inv?.customer_id ? (names[inv.customer_id] ?? inv.customer_id.slice(0, 8)) : '—'

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
            <div><span className="muted">Customer</span><div>{cust}</div></div>
            <div><span className="muted">Status</span><div>{statusPill(inv.status)}</div></div>
            <div><span className="muted">Due</span><div>{fmtDate(inv.due_at)}</div></div>
            <div className="bill-actions">
              {status === 'DRAFT' && <button className="btn btn-primary btn-sm" onClick={issue}>Issue</button>}
              {(status === 'ISSUED' || status === 'OVERDUE') && <button className="btn btn-accent btn-sm" onClick={() => setPayOpen(true)}>Record payment</button>}
              <button className="btn btn-ghost btn-sm" onClick={async () => { const e = await openDocument(token, `/api/invoices/${id}/document`); if (e) toast.error(e) }}>
                <PrinterIcon size={14} /> Print / Download
              </button>
            </div>
          </div>

          <table className="grid bill-lines">
            <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const negative = (l.line_total ?? 0) < 0
                return (
                  <tr key={l.id ?? i}>
                    <td>{l.description ?? '—'}</td>
                    <td>{l.quantity ?? 1}</td>
                    <td className={negative ? 'amt-neg' : ''}>{money(l.unit_amount)}</td>
                    <td className={negative ? 'amt-neg' : ''}>{money(l.line_total)}</td>
                  </tr>
                )
              })}
              {lines.length === 0 && <tr><td colSpan={4} className="muted">No line items.</td></tr>}
            </tbody>
          </table>

          <div className="bill-totals">
            <div className="bill-total-row"><span>Total</span><span>{money(inv.total)}</span></div>
          </div>
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
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!amount || saving) return
    setSaving(true)
    try {
      await bpost(token, `/api/invoices/${invoiceId}/payments`, { amount: toMinor(amount), method, note: note || undefined })
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
            <option value="transfer">Transfer</option>
            <option value="cash">Cash</option>
          </select>
        </label>
        <label className="field"><span>Note</span><input className="inp inp-md" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
      </div>
    </Modal>
  )
}
