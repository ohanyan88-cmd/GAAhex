import { useEffect, useState } from 'react'
import { bget, bpost, loadCustomers, openDocument, type Invoice, type Payment } from './billing'
import { initiatePayment, confirmDevPayment, isDevFlow } from './paymentgw'
import { money, toMinor } from './money'
import { Modal } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import {
  ReceiptIcon, ArrowRightIcon, ChevronLeftIcon, PrinterIcon,
  CreditCardIcon, DownloadIcon,
} from './icons'
import { useI18n } from './i18n'
import ViewHead from './ViewHead'
import { usePageConfig } from './pageConfig'

const STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID']

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// Status → pill style
function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase()
  const cls = s === 'PAID' ? 'pill pill-success'
    : s === 'OVERDUE' ? 'pill pill-danger'
    : s === 'VOID' ? 'pill pill-muted'
    : s === 'ISSUED' ? 'pill pill-accent'
    : 'pill'
  return status ? <span className={cls}><span className="pill-dot" />{status}</span> : <span>—</span>
}

// ── Pay online button ─────────────────────────────────────────────────────────
function PayOnlineButton({ token, invoiceId, onDone }: { token: string; invoiceId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [devConfirm, setDevConfirm] = useState<{ orderId: string } | null>(null)

  async function handlePay() {
    if (busy) return
    setBusy(true)
    try {
      const result = await initiatePayment(token, invoiceId)
      if (isDevFlow(result.redirect_url)) {
        setDevConfirm({ orderId: result.order_id })
      } else {
        window.open(result.redirect_url, '_blank', 'noopener,noreferrer')
        toast.success('Payment page opened in a new tab.')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmDev() {
    if (!devConfirm) return
    setBusy(true)
    try {
      await confirmDevPayment(token, devConfirm.orderId)
      setDevConfirm(null)
      toast.success('Payment confirmed — invoice is now PAID.')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn btn-primary btn-sm" onClick={handlePay} disabled={busy}>
        <CreditCardIcon size={13} /> {busy ? 'Initiating…' : 'Pay online'}
      </button>

      {devConfirm && (
        <Modal
          open
          onClose={() => { setDevConfirm(null); setBusy(false) }}
          title="Simulate gateway payment?"
          size="sm"
          footer={
            <>
              <button className="btn btn-ghost btn-md" onClick={() => { setDevConfirm(null); setBusy(false) }}>Cancel</button>
              <button className="btn btn-primary btn-md" onClick={handleConfirmDev} disabled={busy}>
                {busy ? 'Confirming…' : 'Confirm payment'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            This is the <strong>dev payment flow</strong>. Clicking Confirm will call{' '}
            <code>confirm-dev</code> and immediately settle the payment order, marking the invoice
            as <strong>PAID</strong>.
          </p>
        </Modal>
      )}
    </>
  )
}

// renderCell for configurable columns. Custom cells keep their styling via helpers below.
function renderInvoiceCell(colKey: string, inv: Invoice, cust: (inv: Invoice) => string) {
  switch (colKey) {
    case 'number': return inv.number ?? inv.id.slice(0, 8)
    case 'customer': return cust(inv)
    case 'issued': return fmtDate(inv.issued_at ?? inv.created_at)
    case 'due': return fmtDate(inv.due_at)
    case 'status': return statusPill(inv.status)
    case 'amount': return `֏${(inv.total ?? 0).toLocaleString()}`
    default: return '—'
  }
}

// Columns that get special class treatment in their <th>/<td>
const COL_CLASS: Record<string, string> = { amount: 'num' }
// Columns that get special inline styling on their <td>
function colTdStyle(colKey: string): React.CSSProperties | undefined {
  if (colKey === 'number') return { color: 'var(--accent)', fontWeight: 600 }
  return undefined
}
// Columns that get extra className on their <td>
function colTdClass(colKey: string): string {
  if (colKey === 'number' || colKey === 'issued' || colKey === 'due') return 'mono'
  if (colKey === 'amount') return 'num'
  return ''
}

export default function InvoicesView({ token, canConfigure = false, configVersion = 0 }: { token: string; canConfigure?: boolean; configVersion?: number }) {
  const { t } = useI18n()
  const cfg = usePageConfig(token, 'invoices', configVersion)
  const [list, setList] = useState<Invoice[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [cycleNA, setCycleNA] = useState(false)
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
      toast.error(err.status === 404 ? "Dunning isn't available yet" : err.message)
    }
  }

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
      if (err.status === 404) { setCycleNA(true); toast.error(t('billing.cycleNA', "Billing cycle isn't available yet")) }
      else toast.error(err.message)
    } finally { setCycleBusy(false) }
  }

  const cust = (inv: Invoice) => (inv.customer_id ? (names[inv.customer_id] ?? inv.customer_id.slice(0, 8)) : '—')

  // Counts + KPI aggregates (computed from loaded list — no extra API)
  const all = list ?? []
  const countFor = (s: string) => all.filter(i => (i.status ?? '').toUpperCase() === s).length
  const totalBilled = all.reduce((a, i) => a + (i.total ?? 0), 0)
  const outstanding = all.filter(i => ['ISSUED', 'OVERDUE'].includes((i.status ?? '').toUpperCase())).reduce((a, i) => a + (i.total ?? 0), 0)
  const paidCount = countFor('PAID')
  const overdueCount = countFor('OVERDUE')

  const TAB_DEFS: Array<[string, string]> = [
    ['', 'All'],
    ['DRAFT', 'Draft'],
    ['ISSUED', 'Issued'],
    ['PAID', 'Paid'],
    ['OVERDUE', 'Overdue'],
    ['VOID', 'Void'],
  ]

  if (detailId) return <InvoiceDetail token={token} id={detailId} names={names} onBack={() => { setDetailId(null); load() }} />

  return (
    <div>
      <ViewHead
        icon={<ReceiptIcon size={18} />}
        title={cfg.title}
        sub={`${all.length} records · currency AMD (֏) · billing engine`}
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={runDunning}>Run dunning</button>
            {canConfigure && !cycleNA && (
              <button className="btn btn-primary btn-sm" onClick={runCycle} disabled={cycleBusy}>
                {cycleBusy ? t('billing.running', 'Running…') : t('billing.runCycle', 'Run billing cycle')}
              </button>
            )}
          </>
        }
      />

      {all.length > 0 && (
        <div className="widgets" style={{ marginBottom: 18 }}>
          <div className="widget">
            <div className="widget-label">Total billed</div>
            <div className="kpi"><span className="kpi-cur">֏</span>{(totalBilled / 1000).toFixed(1)}k</div>
            <div className="kpi-sub">{all.length} invoice{all.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="widget">
            <div className="widget-label">Outstanding</div>
            <div className="kpi" style={{ color: outstanding > 0 ? 'var(--warning)' : 'var(--text)' }}>
              <span className="kpi-cur">֏</span>{(outstanding / 1000).toFixed(1)}k
            </div>
            <div className="kpi-sub">{countFor('ISSUED')} issued · {overdueCount} overdue</div>
          </div>
          <div className="widget">
            <div className="widget-label">Paid</div>
            <div className="kpi" style={{ color: 'var(--success)' }}>{paidCount}</div>
            <div className="kpi-sub">of {all.length} invoices</div>
          </div>
          {overdueCount > 0 && (
            <div className="widget">
              <div className="widget-label">Overdue</div>
              <div className="kpi" style={{ color: 'var(--danger)' }}>{overdueCount}</div>
              <div className="kpi-sub">action required</div>
            </div>
          )}
        </div>
      )}

      <div className="tabs">
        {TAB_DEFS.map(([val, label]) => {
          const count = val === '' ? all.length : countFor(val)
          return (
            <button
              key={val}
              className={'tab' + (status === val ? ' on' : '')}
              onClick={() => setStatus(val)}
            >
              {label} <span className="tab-count">{count}</span>
            </button>
          )
        })}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState icon={<ReceiptIcon size={40} />} title="Billing isn't available yet" message="Invoices will appear here once the billing service is enabled." />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<ReceiptIcon size={40} />} title="No invoices" message="No invoices match this filter." />
      )}

      {list && list.length > 0 && (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                {cfg.columns.map((c) => <th key={c.key} scope="col" className={COL_CLASS[c.key] ?? ''}>{c.label}</th>)}
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((inv) => (
                <tr key={inv.id}>
                  {cfg.columns.map((c) => (
                    <td key={c.key} className={colTdClass(c.key)} style={colTdStyle(c.key)}>
                      {renderInvoiceCell(c.key, inv, cust)}
                    </td>
                  ))}
                  <td>
                    <div className="row-actions">
                      {(inv.status === 'ISSUED' || inv.status === 'OVERDUE') && (
                        <PayOnlineButton token={token} invoiceId={inv.id} onDone={load} />
                      )}
                      <button className="iconbtn" title="Open" onClick={() => setDetailId(inv.id)}>
                        <ArrowRightIcon size={13} />
                      </button>
                    </div>
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

function InvoiceDetail({ token, id, names, onBack }: { token: string; id: string; names: Record<string, string>; onBack: () => void }) {
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

  async function voidInvoice() {
    if (!window.confirm('Void this invoice? This cannot be undone.')) return
    try {
      await bpost(token, `/api/invoices/${id}/void`)
      toast.success('Invoice voided')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const lines = inv?.lines ?? []
  const status = (inv?.status ?? '').toUpperCase()
  const cust = inv?.customer_id ? (names[inv.customer_id] ?? inv.customer_id.slice(0, 8)) : '—'

  return (
    <div>
      <ViewHead
        icon={<ChevronLeftIcon size={16} />}
        title={inv?.number ?? `Invoice ${id.slice(0, 8)}`}
        sub={inv ? `Customer: ${cust}` : undefined}
        actions={
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            <ChevronLeftIcon size={14} /> Invoices
          </button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!inv && !error && <p className="muted">Loading…</p>}

      {inv && (
        <>
          <div className="bill-meta">
            <div><span className="muted">Customer</span><div>{cust}</div></div>
            <div><span className="muted">Status</span><div>{statusPill(inv.status)}</div></div>
            <div><span className="muted">Issued</span><div className="mono">{fmtDate(inv.issued_at ?? inv.created_at)}</div></div>
            <div><span className="muted">Due</span><div className="mono">{fmtDate(inv.due_at)}</div></div>
            <div className="bill-actions">
              {status === 'DRAFT' && (
                <button className="btn btn-primary btn-sm" onClick={issue}>Issue</button>
              )}
              {(status === 'ISSUED' || status === 'OVERDUE') && (
                <PayOnlineButton token={token} invoiceId={id} onDone={load} />
              )}
              {(status === 'ISSUED' || status === 'OVERDUE') && (
                <button className="btn btn-accent btn-sm" onClick={() => setPayOpen(true)}>Record payment</button>
              )}
              {(status === 'ISSUED' || status === 'OVERDUE') && (
                <button className="btn btn-ghost btn-sm" onClick={voidInvoice}>Void</button>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  const e = await openDocument(token, `/api/invoices/${id}/document`)
                  if (e) toast.error(e)
                }}
              >
                <PrinterIcon size={14} /> Print / Download
              </button>
            </div>
          </div>

          <table className="grid bill-lines">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Unit (֏)</th>
                <th className="num">Amount (֏)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const negative = (l.line_total ?? 0) < 0
                return (
                  <tr key={l.id ?? i}>
                    <td>{l.description ?? '—'}</td>
                    <td className="num">{l.quantity ?? 1}</td>
                    <td className={`num${negative ? ' amt-neg' : ''}`}>{money(l.unit_amount)}</td>
                    <td className={`num${negative ? ' amt-neg' : ''}`}>{money(l.line_total)}</td>
                  </tr>
                )
              })}
              {lines.length === 0 && (
                <tr><td colSpan={4} className="muted">No line items.</td></tr>
              )}
            </tbody>
          </table>

          <div className="bill-totals">
            <div className="bill-total-row"><span>Total</span><span>{money(inv.total)}</span></div>
            {inv.balance !== undefined && (
              <>
                <div className="bill-total-row"><span>Paid</span><span>{money(inv.paid_total)}</span></div>
                <div className="bill-total-row">
                  <span>Balance due</span>
                  <span style={{ color: (inv.balance ?? 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {money(inv.balance)}
                  </span>
                </div>
              </>
            )}
          </div>

          {payments.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Payments recorded
              </div>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th className="num">Amount (֏)</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id}>
                      <td className="mono">{fmtDate(p.paid_at)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{p.method}</td>
                      <td className="num">{money(p.amount)}</td>
                      <td className="muted">{p.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {payOpen && (
        <PaymentModal
          token={token}
          invoiceId={id}
          onClose={() => setPayOpen(false)}
          onDone={() => { setPayOpen(false); load() }}
        />
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
          <button className="btn btn-accent btn-md" disabled={saving || !amount} onClick={submit}>
            {saving ? 'Saving…' : 'Record'}
          </button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Amount (֏)</span>
          <input className="inp inp-md inp-numeric" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Method</span>
          <select className="inp inp-md" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="card">Card</option>
            <option value="transfer">Transfer</option>
            <option value="cash">Cash</option>
          </select>
        </label>
        <label className="field">
          <span>Note</span>
          <input className="inp inp-md" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </label>
      </div>
    </Modal>
  )
}
