import { useEffect, useState, type ReactNode } from 'react'
import { bget, bpost, loadCustomers, openDocument, type Invoice, type Payment } from '../lib/billing'
import { initiatePayment, confirmDevPayment, isDevFlow } from '../lib/paymentgw'
import { money, toMinor } from '../lib/money'
import { timeAgo } from '../lib/time'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner } from '../components/States'
import { humanizeStatus } from '../lib/humanize'
import {
  ReceiptIcon, ArrowRightIcon, ChevronLeftIcon, PrinterIcon,
  CreditCardIcon, SearchIcon,
  InfoIcon, ClockIcon, CheckIcon, MessageIcon, PaperclipIcon,
  ShieldIcon, LayersIcon, MailIcon, ActivityIcon,
} from '../components/icons'
import { useI18n } from '../lib/i18n'
import { PageShell, Stack, Inline, Card, SectionHeading, type KPISpec } from '../page-shell'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'

// A.3 endpoints return Decimal STRINGS in major units (e.g. "100.50"). Existing money() expects
// integer luma (minor). Convert at the boundary so we keep one display formatter.
function decStrToLuma(s: string | null | undefined): number {
  if (s === null || s === undefined) return 0
  const n = parseFloat(s)
  return isNaN(n) ? 0 : Math.round(n * 100)
}
function moneyDec(s: string | null | undefined): string {
  return money(decStrToLuma(s))
}

type Outstanding = {
  id: string
  total: string
  paid: string
  credited: string
  outstanding: string
  computed_at?: string | null
}

type Allocation = {
  id: string
  payment_id: string
  invoice_id?: string
  amount: string
  applied_at: string | null
  applied_by: string | null
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// Status → pill style. Uses kit primitives (gx-token-backed) only.
function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase()
  const cls = s === 'PAID' ? 'pill pill-success'
    : s === 'OVERDUE' ? 'pill pill-danger'
    : s === 'VOID' ? 'pill pill-neutral'
    : s === 'ISSUED' ? 'pill pill-info'
    : 'pill pill-neutral'
  return status ? <span className={cls}><span className="pill-dot" />{humanizeStatus(status)}</span> : <span>—</span>
}

// ── Pay online button ─────────────────────────────────────────────────────────
// Recording a gateway payment effectively creates a Payment row on success, so we gate the
// affordance on payment.create just like Record-payment does.
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
    case 'amount': return money(inv.total)
    default: return '—'
  }
}

// Columns that get special class treatment in their <th>/<td>
const COL_CLASS: Record<string, string> = { amount: 'num' }
// Columns that get special inline styling on their <td>
function colTdStyle(colKey: string): React.CSSProperties | undefined {
  if (colKey === 'number') return { color: 'var(--gx-gold)', fontWeight: 600 }
  return undefined
}
// Columns that get extra className on their <td>
function colTdClass(colKey: string): string {
  if (colKey === 'number' || colKey === 'issued' || colKey === 'due') return 'mono'
  if (colKey === 'amount') return 'num'
  return ''
}

export default function InvoicesView({
  token, canConfigure = false, configVersion = 0, initialStatus, capabilities = FULL_ACCESS,
}: {
  token: string
  canConfigure?: boolean
  configVersion?: number
  /** Home-page / Customer 360 deep link: pre-filter the list by this status when set. */
  initialStatus?: string
  /** Per-entity caps; mutation buttons (Issue / Void / Pay / Record) gate on these. */
  capabilities?: Capabilities
}) {
  const { t } = useI18n()
  const cfg = usePageConfig(token, 'invoices', configVersion)
  const [list, setList] = useState<Invoice[] | null>(null)
  const cf = useCustomFields(token, 'invoices', cfg.customFields, (list ?? []).map((inv) => inv.id))
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState(initialStatus ?? '')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [cycleNA, setCycleNA] = useState(false)
  const [cycleBusy, setCycleBusy] = useState(false)

  // Permission gates (rule 6) — backend re-checks too, this just hides buttons the user can't use.
  const canEditInvoice = can(capabilities, 'invoice', 'edit')
  const canCreatePayment = can(capabilities, 'payment', 'create')
  // Allocate is admin-gated server-side — front-end mirrors with payment.edit, or canConfigure as fallback.
  const canAllocatePayment = can(capabilities, 'payment', 'edit') || canConfigure

  // When the parent flips the deep-link status (e.g. switching customers in 360), re-sync the filter.
  useEffect(() => { setStatus(initialStatus ?? '') }, [initialStatus])

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

  const kpis: KPISpec[] = all.length > 0 ? [
    { label: 'Total billed', value: `֏${(totalBilled / 100000).toFixed(1)}k`, subtitle: `${all.length} invoice${all.length !== 1 ? 's' : ''}`, premium: true, onClick: () => setStatus('') },
    { label: 'Outstanding', value: `֏${(outstanding / 100000).toFixed(1)}k`, subtitle: `${countFor('ISSUED')} issued · ${overdueCount} overdue`, warning: outstanding > 0, onClick: () => setStatus('ISSUED') },
    { label: 'Paid', value: paidCount, subtitle: `of ${all.length} invoices`, onClick: () => setStatus('PAID') },
    ...(overdueCount > 0 ? [{ label: 'Overdue', value: overdueCount, subtitle: 'action required', danger: true, onClick: () => setStatus('OVERDUE') }] : []),
  ] : []

  const TAB_DEFS: Array<[string, string]> = [
    ['', 'All'],
    ['DRAFT', 'Draft'],
    ['ISSUED', 'Issued'],
    ['PAID', 'Paid'],
    ['OVERDUE', 'Overdue'],
    ['VOID', 'Void'],
  ]

  if (detailId) return <InvoiceDetail token={token} id={detailId} names={names} canEditInvoice={canEditInvoice} canCreatePayment={canCreatePayment} canAllocatePayment={canAllocatePayment} onBack={() => { setDetailId(null); load() }} />

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Billing & Revenue', cfg.title]}
      icon={<ReceiptIcon size={18} />}
      title={cfg.title}
      subtitle="Immutable billing ledger"
      kpis={kpis}
      secondaryActions={[
        ...(canEditInvoice ? [{ label: 'Run dunning', onClick: runDunning }] : []),
        ...(canConfigure && canEditInvoice && !cycleNA ? [{
          label: cycleBusy ? t('billing.running', 'Running…') : t('billing.runCycle', 'Run billing cycle'),
          onClick: runCycle,
          disabled: cycleBusy,
        }] : []),
      ]}
    >
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
        <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {cfg.columns.map((c) => <th key={c.key} scope="col" className={COL_CLASS[c.key] ?? ''}>{c.label}</th>)}
                  {cf.headers()}
                  <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
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
                    {cf.cells(inv.id)}
                    <td className="actions-col">
                      <div className="row-actions">
                        {canCreatePayment && (inv.status === 'ISSUED' || inv.status === 'OVERDUE') && (
                          <PayOnlineButton token={token} invoiceId={inv.id} onDone={load} />
                        )}
                        <button className="iconbtn" title="Open" onClick={() => setDetailId(inv.id)}>
                          <ArrowRightIcon size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={cfg.columns.length + 1 + cfg.customFields.length} style={{ padding: 0 }}>
                      <EmptyState
                        icon={<SearchIcon size={34} />}
                        title="No matching invoices"
                        message="Try a different status tab."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// InvoiceDetail — file 10 (Object Detail Standard) canonical 9-tab set.
// Tab order: Overview · Timeline · Tasks · Comments · Attachments · Approvals
// · Related · Communications · Audit. The Overview tab WRAPS the existing bill
// detail + lines + totals + payments + AllocationPanel content unchanged.
// ─────────────────────────────────────────────────────────────────────────────
type InvoiceTabKey =
  | 'overview' | 'timeline' | 'tasks' | 'comments' | 'attachments'
  | 'approvals' | 'related' | 'communications' | 'audit'
const INVOICE_TAB_ORDER: InvoiceTabKey[] = [
  'overview', 'timeline', 'tasks', 'comments', 'attachments',
  'approvals', 'related', 'communications', 'audit',
]

function invoiceTabLabel(k: InvoiceTabKey): string {
  switch (k) {
    case 'overview':       return 'Overview'
    case 'timeline':       return 'Timeline'
    case 'tasks':          return 'Tasks'
    case 'comments':       return 'Comments'
    case 'attachments':    return 'Attachments'
    case 'approvals':      return 'Approvals'
    case 'related':        return 'Related'
    case 'communications': return 'Communications'
    case 'audit':          return 'Audit'
  }
}

function invoiceTabIcon(k: InvoiceTabKey): ReactNode {
  switch (k) {
    case 'overview':       return <InfoIcon size={13} />
    case 'timeline':       return <ClockIcon size={13} />
    case 'tasks':          return <CheckIcon size={13} />
    case 'comments':       return <MessageIcon size={13} />
    case 'attachments':    return <PaperclipIcon size={13} />
    case 'approvals':      return <ShieldIcon size={13} />
    case 'related':        return <LayersIcon size={13} />
    case 'communications': return <MailIcon size={13} />
    case 'audit':          return <ActivityIcon size={13} />
  }
}

function InvoiceTabButton({ active, label, icon, onClick }: {
  active: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--gx-primary, #2563eb)' : '2px solid transparent',
        color: active ? 'var(--gx-text-1, #0f172a)' : 'var(--gx-text-3, #64748b)',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        marginBottom: -1,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}{label}
    </button>
  )
}

function InvoiceDetail({ token, id, names, canEditInvoice, canCreatePayment, canAllocatePayment, onBack }: {
  token: string
  id: string
  names: Record<string, string>
  canEditInvoice: boolean
  canCreatePayment: boolean
  canAllocatePayment: boolean
  onBack: () => void
}) {
  const [inv, setInv] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [error, setError] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  // Canonical Object Detail tab — defaults to Overview (file 10).
  const [tab, setTab] = useState<InvoiceTabKey>('overview')

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
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Billing & Revenue', 'Invoices', inv?.number ?? `Invoice ${id.slice(0, 8)}`]}
      icon={<ReceiptIcon size={18} />}
      title={inv?.number ?? `Invoice ${id.slice(0, 8)}`}
      subtitle={inv ? `Customer: ${cust}` : undefined}
      secondaryActions={[
        { label: 'Invoices', icon: <ChevronLeftIcon size={14} />, onClick: onBack },
      ]}
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!inv && !error && <p className="muted">Loading…</p>}

      {inv && (
        <>
          {/* Canonical Object Detail tabs (file 10) — render BEFORE any object-specific tabs.
              The bill detail + lines + totals + payments + AllocationPanel live in Overview. */}
          <div
            role="tablist"
            aria-label="Object Detail tabs"
            style={{
              display: 'flex',
              gap: 4,
              borderBottom: '1px solid var(--gx-border, #e2e8f0)',
              marginBottom: 16,
              overflowX: 'auto',
            }}
          >
            {INVOICE_TAB_ORDER.map((k) => (
              <InvoiceTabButton
                key={k}
                active={tab === k}
                label={invoiceTabLabel(k)}
                icon={invoiceTabIcon(k)}
                onClick={() => setTab(k)}
              />
            ))}
          </div>

          <div role="tabpanel" aria-label={invoiceTabLabel(tab)}>
            {tab === 'overview' && (
              <Stack gap="lg">
                <Card pad="md">
                  <SectionHeading
                    icon={<InfoIcon size={14} />}
                    title="Invoice summary"
                    action={
                      <Inline gap="sm" align="center">
                        {canEditInvoice && status === 'DRAFT' && (
                          <button className="btn btn-primary btn-sm" onClick={issue}>Issue</button>
                        )}
                        {canCreatePayment && (status === 'ISSUED' || status === 'OVERDUE') && (
                          <PayOnlineButton token={token} invoiceId={id} onDone={load} />
                        )}
                        {canCreatePayment && (status === 'ISSUED' || status === 'OVERDUE') && (
                          <button className="btn btn-accent btn-sm" onClick={() => setPayOpen(true)}>Record payment</button>
                        )}
                        {canEditInvoice && (status === 'ISSUED' || status === 'OVERDUE') && (
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
                      </Inline>
                    }
                  />
                  <div className="bill-meta">
                    <div><span className="muted">Customer</span><div>{cust}</div></div>
                    <div><span className="muted">Status</span><div>{statusPill(inv.status)}</div></div>
                    <div><span className="muted">Issued</span><div className="mono">{fmtDate(inv.issued_at ?? inv.created_at)}</div></div>
                    <div><span className="muted">Due</span><div className="mono">{fmtDate(inv.due_at)}</div></div>
                  </div>
                </Card>

                <Card pad="md">
                  <SectionHeading icon={<LayersIcon size={14} />} title="Line items" />
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
                          <span style={{ color: (inv.balance ?? 0) > 0 ? 'var(--gx-danger)' : 'var(--gx-success)' }}>
                            {money(inv.balance)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </Card>

                {payments.length > 0 && (
                  <Card pad="md">
                    <SectionHeading icon={<CreditCardIcon size={14} />} title="Payments recorded" />
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
                  </Card>
                )}

                <AllocationPanel
                  token={token}
                  invoiceId={id}
                  canAllocate={canAllocatePayment}
                  onChanged={load}
                />
              </Stack>
            )}
            {tab === 'timeline'       && <InvoiceTimelineTab token={token} invoiceId={id} />}
            {tab === 'tasks'          && <InvoiceTasksTab token={token} invoiceId={id} />}
            {tab === 'comments'       && <InvoiceCommentsTab token={token} invoiceId={id} />}
            {tab === 'attachments'    && <InvoiceAttachmentsTab token={token} invoiceId={id} />}
            {tab === 'approvals'      && <InvoiceApprovalsTab token={token} invoiceId={id} />}
            {tab === 'related'        && <InvoiceRelatedTab />}
            {tab === 'communications' && <InvoiceCommunicationsTab token={token} invoiceId={id} />}
            {tab === 'audit'          && <InvoiceAuditTab token={token} invoiceId={id} />}
          </div>
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
    </PageShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Object Detail tab bodies (file 10) — invoice-scoped. Each fetches
// on mount; 404 from a missing endpoint degrades to a friendly empty state.
// Same shape as customer-tabs/ and AccountsView tabs.
// ─────────────────────────────────────────────────────────────────────────────
type InvActivityRow = { id: string; action?: string | null; actor?: string | null; message?: string | null; at?: string | null; created_at?: string | null }
type InvTaskRow = { id: string; title?: string | null; status?: string | null; priority?: string | null; assignee?: string | null; due_at?: string | null }
type InvCommentRow = { id: string; author?: string | null; author_name?: string | null; body?: string | null; text?: string | null; created_at?: string | null }
type InvAttachmentRow = { id: string; filename?: string | null; name?: string | null; mime_type?: string | null; size?: number | null; uploaded_by?: string | null; uploaded_at?: string | null; created_at?: string | null; url?: string | null }
type InvApprovalRow = { id: string; request_type?: string | null; status?: string | null; requested_by?: string | null; requested_at?: string | null; decided_at?: string | null }
type InvCommunicationRow = { id: string; channel?: string | null; direction?: string | null; subject?: string | null; from_address?: string | null; to_address?: string | null; occurred_at?: string | null; created_at?: string | null }
type InvAuditRow = { id: string; action?: string | null; actor?: string | null; actor_id?: string | null; field?: string | null; old_value?: string | null; new_value?: string | null; at?: string | null; created_at?: string | null }

function fmtInvDT(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function invTabSkeleton(): ReactNode {
  return (
    <div className="card" style={{ padding: 14 }} aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="kpi-tile-skeleton" style={{ height: 12, width: '100%', marginBottom: 10 }} />
      ))}
    </div>
  )
}

function InvoiceTimelineTab({ token, invoiceId }: { token: string; invoiceId: string }) {
  const [rows, setRows] = useState<InvActivityRow[] | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<InvActivityRow[]>(token, `/api/activity?entity_key=invoice&record_id=${encodeURIComponent(invoiceId)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        const sorted = [...r.data].sort((a, b) => (Date.parse(b.at ?? b.created_at ?? '') || 0) - (Date.parse(a.at ?? a.created_at ?? '') || 0))
        setRows(sorted)
      })
    return () => { cancelled = true }
  }, [token, invoiceId])
  if (rows === undefined) return invTabSkeleton()
  if (rows === null) return <p className="muted">Could not load the activity timeline.</p>
  if (rows.length === 0) return <EmptyState title="No activity recorded yet" message="Changes to this invoice will appear here." />
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--gx-border, #e2e8f0)' }}>
            <div style={{ fontSize: 13 }}>
              <strong>{r.action ?? 'event'}</strong>
              {r.actor && <span className="muted" style={{ marginLeft: 6 }}>· {r.actor}</span>}
            </div>
            {r.message && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r.message}</div>}
            <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>{fmtInvDT(r.at ?? r.created_at)}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function InvoiceTasksTab({ token, invoiceId }: { token: string; invoiceId: string }) {
  const [rows, setRows] = useState<InvTaskRow[] | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<InvTaskRow[]>(token, `/api/tasks?parent_entity_type=invoice&parent_entity_id=${encodeURIComponent(invoiceId)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        setRows(r.data)
      })
    return () => { cancelled = true }
  }, [token, invoiceId])
  if (rows === undefined) return invTabSkeleton()
  if (rows === null) return <p className="muted">Could not load tasks.</p>
  if (rows.length === 0) return <EmptyState title="No tasks recorded yet" message="Tasks linked to this invoice will appear here." />
  return (
    <Card pad="md">
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Assignee</th>
            <th scope="col">Due</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.title ?? <span className="mono">{r.id.slice(0, 8)}</span>}</td>
                <td>{r.status ?? '—'}</td>
                <td>{r.priority ?? '—'}</td>
                <td>{r.assignee ?? '—'}</td>
                <td><span className="mono">{r.due_at ? new Date(r.due_at).toLocaleDateString() : '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function InvoiceCommentsTab({ token, invoiceId }: { token: string; invoiceId: string }) {
  const [rows, setRows] = useState<InvCommentRow[] | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<InvCommentRow[]>(token, `/api/comments?owner_entity_type=invoice&owner_entity_id=${encodeURIComponent(invoiceId)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        setRows(r.data)
      })
    return () => { cancelled = true }
  }, [token, invoiceId])
  if (rows === undefined) return invTabSkeleton()
  if (rows === null) return <p className="muted">Could not load comments.</p>
  if (rows.length === 0) return <EmptyState title="No comments recorded yet" message="Comments on this invoice will appear here." />
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--gx-border, #e2e8f0)' }}>
            <div style={{ fontSize: 13 }}>
              <strong>{r.author_name ?? r.author ?? 'Unknown'}</strong>
              <span className="muted mono" style={{ marginLeft: 8, fontSize: 11 }}>{fmtInvDT(r.created_at)}</span>
            </div>
            <div style={{ fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap' }}>{r.body ?? r.text ?? ''}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function InvoiceAttachmentsTab({ token, invoiceId }: { token: string; invoiceId: string }) {
  const [rows, setRows] = useState<InvAttachmentRow[] | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<InvAttachmentRow[]>(token, `/api/attachments?owner_entity_type=invoice&owner_entity_id=${encodeURIComponent(invoiceId)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        setRows(r.data)
      })
    return () => { cancelled = true }
  }, [token, invoiceId])
  if (rows === undefined) return invTabSkeleton()
  if (rows === null) return <p className="muted">Could not load attachments.</p>
  if (rows.length === 0) return <EmptyState title="No attachments recorded yet" message="Files uploaded against this invoice will appear here." />
  return (
    <Card pad="md">
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">File</th>
            <th scope="col">Type</th>
            <th scope="col">Uploaded by</th>
            <th scope="col">Uploaded at</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const label = r.filename ?? r.name ?? r.id.slice(0, 8)
              return (
                <tr key={r.id}>
                  <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--gx-link)' }}>{label}</a> : <span>{label}</span>}</td>
                  <td>{r.mime_type ?? '—'}</td>
                  <td>{r.uploaded_by ?? '—'}</td>
                  <td><span className="mono">{fmtInvDT(r.uploaded_at ?? r.created_at)}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function InvoiceApprovalsTab({ token, invoiceId }: { token: string; invoiceId: string }) {
  const [rows, setRows] = useState<InvApprovalRow[] | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<InvApprovalRow[]>(token, `/api/approvals?subject_type=invoice&subject_id=${encodeURIComponent(invoiceId)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        setRows(r.data)
      })
    return () => { cancelled = true }
  }, [token, invoiceId])
  if (rows === undefined) return invTabSkeleton()
  if (rows === null) return <p className="muted">Could not load approvals.</p>
  if (rows.length === 0) return <EmptyState title="No approvals recorded yet" message="Approval requests on this invoice will appear here." />
  return (
    <Card pad="md">
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">Request</th>
            <th scope="col">Status</th>
            <th scope="col">Requested by</th>
            <th scope="col">Requested at</th>
            <th scope="col">Decided at</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.request_type ?? <span className="mono">{r.id.slice(0, 8)}</span>}</td>
                <td>{r.status ?? '—'}</td>
                <td>{r.requested_by ?? '—'}</td>
                <td><span className="mono">{fmtInvDT(r.requested_at)}</span></td>
                <td><span className="mono">{fmtInvDT(r.decided_at)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// Related tab — placeholder per spec (no Wave A graph endpoint deployed yet).
function InvoiceRelatedTab() {
  return <EmptyState title="No related records recorded yet" message="Linked records across modules will appear here." />
}

function InvoiceCommunicationsTab({ token, invoiceId }: { token: string; invoiceId: string }) {
  const [rows, setRows] = useState<InvCommunicationRow[] | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<InvCommunicationRow[]>(token, `/api/communications?owner_entity_type=invoice&owner_entity_id=${encodeURIComponent(invoiceId)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        setRows(r.data)
      })
    return () => { cancelled = true }
  }, [token, invoiceId])
  if (rows === undefined) return invTabSkeleton()
  if (rows === null) return <p className="muted">Could not load communications.</p>
  if (rows.length === 0) return <EmptyState title="No communications recorded yet" message="Emails, calls, and messages will appear here." />
  return (
    <Card pad="md">
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">Channel</th>
            <th scope="col">Direction</th>
            <th scope="col">Subject</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">At</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.channel ?? '—'}</td>
                <td>{r.direction ?? '—'}</td>
                <td>{r.subject ?? <span className="muted">—</span>}</td>
                <td>{r.from_address ?? '—'}</td>
                <td>{r.to_address ?? '—'}</td>
                <td><span className="mono">{fmtInvDT(r.occurred_at ?? r.created_at)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function InvoiceAuditTab({ token, invoiceId }: { token: string; invoiceId: string }) {
  const [rows, setRows] = useState<InvAuditRow[] | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<InvAuditRow[]>(token, `/api/events?entity_key=invoice&entity_id=${encodeURIComponent(invoiceId)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        const sorted = [...r.data].sort((a, b) => (Date.parse(b.at ?? b.created_at ?? '') || 0) - (Date.parse(a.at ?? a.created_at ?? '') || 0))
        setRows(sorted)
      })
    return () => { cancelled = true }
  }, [token, invoiceId])
  if (rows === undefined) return invTabSkeleton()
  if (rows === null) return <p className="muted">Could not load audit log.</p>
  if (rows.length === 0) return <EmptyState title="No audit entries recorded yet" message="Field-level changes to this invoice will appear here." />
  return (
    <Card pad="md">
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">When</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Field</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><span className="mono">{fmtInvDT(r.at ?? r.created_at)}</span></td>
                <td>{r.actor ?? r.actor_id ?? '—'}</td>
                <td>{r.action ?? '—'}</td>
                <td>{r.field ?? '—'}</td>
                <td><span className="muted">{r.old_value ?? '—'}</span></td>
                <td>{r.new_value ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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

// ── Phase A.3 allocation panel ────────────────────────────────────────────────
// Renders live outstanding snapshot + allocations list + admin-gated Allocate action.
// All amount values from these endpoints arrive as decimal STRINGS in major units; we
// convert to luma at the boundary so money() stays the only display formatter.
function AllocationPanel({ token, invoiceId, canAllocate, onChanged }: {
  token: string
  invoiceId: string
  canAllocate: boolean
  /** Called after a successful allocate — parent should re-fetch invoice (status may flip to PAID). */
  onChanged: () => void
}) {
  const [out, setOut] = useState<Outstanding | null>(null)
  const [allocs, setAllocs] = useState<Allocation[] | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)

  async function load() {
    setErr(''); setForbidden(false); setUnavailable(false)
    const [oRes, aRes] = await Promise.all([
      bget<Outstanding>(token, `/api/invoices/${invoiceId}/outstanding`),
      bget<Allocation[]>(token, `/api/invoices/${invoiceId}/allocations`),
    ])
    if (oRes.status === 403 || aRes.status === 403) { setForbidden(true); return }
    if (oRes.status === 404 || aRes.status === 404) { setUnavailable(true); return }
    if (!oRes.ok || !aRes.ok) { setErr('Failed to load allocation data'); return }
    setOut(oRes.data)
    setAllocs(Array.isArray(aRes.data) ? aRes.data : [])
  }

  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [token, invoiceId])

  // Refresh both A.3 reads + bubble to parent (so the parent invoice row's status can flip).
  async function refresh() { await load(); onChanged() }

  if (forbidden) {
    return (
      <div className="card" style={{ marginTop: 24, padding: 16, borderColor: 'var(--gx-danger)' }}>
        <strong>Allocations not available</strong>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          You don't have permission to view allocation details for this invoice.
        </p>
      </div>
    )
  }
  if (unavailable) {
    return (
      <div style={{ marginTop: 24 }}>
        <EmptyState
          icon={<ReceiptIcon size={28} />}
          title="Allocation endpoints not yet available"
          message="This invoice's allocation tracking will appear here once the Phase A.3 endpoints are live."
        />
      </div>
    )
  }
  if (err) {
    return (
      <div style={{ marginTop: 24 }}>
        <ErrorBanner message={err} onRetry={load} />
      </div>
    )
  }
  if (!out || allocs === null) {
    return <p className="muted" style={{ marginTop: 24 }}>Loading allocations…</p>
  }

  const totalNum = parseFloat(out.total) || 0
  const outNum = parseFloat(out.outstanding) || 0
  // Color: green if fully settled, red if fully unpaid, amber in between.
  const outColor = outNum <= 0
    ? 'var(--gx-success)'
    : outNum >= totalNum
      ? 'var(--gx-danger)'
      : 'var(--gx-warning)'

  return (
    <div style={{ marginTop: 24 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        Outstanding &amp; allocations
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'end' }}>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Total</div>
            <div className="num mono" style={{ fontSize: 15 }}>{moneyDec(out.total)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Paid</div>
            <div className="num mono" style={{ fontSize: 15 }}>{moneyDec(out.paid)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Credited</div>
            <div className="num mono" style={{ fontSize: 15 }}>{moneyDec(out.credited)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Outstanding</div>
            <div className="num mono" style={{ fontSize: 17, fontWeight: 700, color: outColor }}>
              {moneyDec(out.outstanding)}
            </div>
          </div>
        </div>
        {out.computed_at && (
          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            Last computed {timeAgo(out.computed_at)}
          </div>
        )}
        {canAllocate && outNum > 0 && (
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
              Allocate payment
            </button>
          </div>
        )}
      </div>

      {allocs.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No allocations applied yet.</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Applied</th>
              <th>Payment</th>
              <th className="num">Amount (֏)</th>
            </tr>
          </thead>
          <tbody>
            {allocs.map(a => (
              <tr key={a.id}>
                <td className="mono" title={a.applied_at ?? ''}>{a.applied_at ? timeAgo(a.applied_at) : '—'}</td>
                <td className="mono" title={a.payment_id}>{a.payment_id.slice(0, 8)}</td>
                <td className="num">{moneyDec(a.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <AllocateModal
          token={token}
          invoiceId={invoiceId}
          outstanding={out.outstanding}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); refresh() }}
        />
      )}
    </div>
  )
}

function AllocateModal({ token, invoiceId, outstanding, onClose, onDone }: {
  token: string
  invoiceId: string
  outstanding: string
  onClose: () => void
  onDone: () => void
}) {
  // v1: user pastes a Payment UUID + types an amount in major ֏. Backend (POST /payments/{id}/allocate)
  // rejects over-allocation with 409; we surface the message inline. Autocomplete is out of scope here.
  const [paymentId, setPaymentId] = useState('')
  const [amount, setAmount] = useState(outstanding) // pre-fill with the outstanding amount
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function validUuid(s: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim())
  }

  async function submit() {
    if (saving) return
    setError('')
    const id = paymentId.trim()
    if (!validUuid(id)) { setError('Enter a valid Payment UUID.'); return }
    const amt = parseFloat(amount)
    if (!isFinite(amt) || amt <= 0) { setError('Enter a positive amount.'); return }
    setSaving(true)
    try {
      await bpost(token, `/api/payments/${id}/allocate`, {
        allocations: [{ invoice_id: invoiceId, amount: amt.toFixed(2) }],
      })
      toast.success('Payment allocated')
      onDone()
    } catch (e) {
      const err = e as Error & { status?: number }
      // 409 = over-allocation / state conflict; surface the backend message verbatim.
      // 403 = admin gate; same treatment. Otherwise generic.
      setError(err.message || 'Allocation failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Allocate payment"
      subtitle={`Outstanding ${moneyDec(outstanding)}`}
      size="sm"
      footer={
        <>
          <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-md" disabled={saving || !paymentId || !amount} onClick={submit}>
            {saving ? 'Allocating…' : 'Allocate'}
          </button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Payment UUID</span>
          <input
            className="inp inp-md mono"
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Amount (֏)</span>
          <input
            className="inp inp-md inp-numeric"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {error && (
          <div style={{ marginTop: 8, color: 'var(--gx-danger)', fontSize: 13 }}>
            {error}
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          The backend will reject over-allocation; if amounts change while this dialog is open, the
          server response will explain — just retry after refreshing.
        </p>
      </div>
    </Modal>
  )
}
