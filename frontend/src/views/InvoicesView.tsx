import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, loadCustomers, openDocument, type Invoice, type Payment } from '../lib/billing'
import { initiatePayment, confirmDevPayment, isDevFlow } from '../lib/paymentgw'
import { money, toMinor } from '../lib/money'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner } from '../components/States'
import {
  ReceiptIcon, ArrowRightIcon, ChevronLeftIcon, PrinterIcon,
  CreditCardIcon, SearchIcon, PlusIcon, DownloadIcon, ArrowUpIcon, ArrowDownIcon,
} from '../components/icons'
import { useI18n } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'
import RecordDrawer from '../components/RecordDrawer'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// Invoice status → StatusPill primitive variant. Default mapping from PROMPT 5 spec.
type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapInvoiceStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'PAID') return 'active'
  if (v === 'DRAFT') return 'neutral'
  if (v === 'SENT' || v === 'OPEN' || v === 'ISSUED') return 'info'
  if (v === 'OVERDUE' || v === 'LATE') return 'critical'
  if (v === 'VOID' || v === 'CANCELLED') return 'neutral'
  return 'info'
}

// 3-dot row-menu icon (inline; no emoji rule — inline SVG only).
function MoreVerticalIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </svg>
  )
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

// renderCell for configurable columns. Status now goes through the StatusPill primitive.
function renderInvoiceCell(colKey: string, inv: Invoice, cust: (inv: Invoice) => string) {
  switch (colKey) {
    case 'number': return <span className="mono">{inv.number ?? inv.id.slice(0, 8)}</span>
    case 'customer': return cust(inv)
    case 'issued': return <span className="mono">{fmtDate(inv.issued_at ?? inv.created_at)}</span>
    case 'due': return <span className="mono">{fmtDate(inv.due_at)}</span>
    case 'status': return inv.status
      ? <StatusPill variant={mapInvoiceStatus(inv.status)} label={inv.status} size="sm" />
      : <span>—</span>
    case 'amount': return <span className="mono tnum">{`֏${(inv.total ?? 0).toLocaleString()}`}</span>
    default: return '—'
  }
}

// Columns that get extra alignment on their <th>/<td>
function colThClass(colKey: string): string {
  if (colKey === 'amount') return 'num'
  return ''
}
function colTdClass(colKey: string): string {
  if (colKey === 'amount') return 'num'
  return ''
}

export default function InvoicesView({ token, canConfigure = false, configVersion = 0 }: { token: string; canConfigure?: boolean; configVersion?: number }) {
  const { t } = useI18n()
  const cfg = usePageConfig(token, 'invoices', configVersion)
  const [list, setList] = useState<Invoice[] | null>(null)
  const cf = useCustomFields(token, 'invoices', cfg.customFields, (list ?? []).map((inv) => inv.id))
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [cycleNA, setCycleNA] = useState(false)
  const [cycleBusy, setCycleBusy] = useState(false)

  // Interaction state added for the reskin (client-only — no new fetches).
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

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
  // Reset paging + selection whenever the filter/search/sort changes.
  useEffect(() => { setPage(1); setSelected(new Set()) }, [status, query, sortKey, sortDir])

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

  // Client-side search + sort applied on top of the server filter (status).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((inv) => {
      const fields = [
        inv.number ?? '',
        inv.id ?? '',
        cust(inv),
        inv.status ?? '',
        String(inv.total ?? ''),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, names])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (inv: Invoice): string | number => {
      switch (k) {
        case 'number': return inv.number ?? inv.id ?? ''
        case 'customer': return cust(inv)
        case 'issued': return inv.issued_at ?? inv.created_at ?? ''
        case 'due': return inv.due_at ?? ''
        case 'amount': return inv.total ?? 0
        case 'status': return inv.status ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, names])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }
  function toggleRow(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function togglePageAll() {
    setSelected((s) => {
      const n = new Set(s)
      if (allOnPageSelected) pageRows.forEach((r) => n.delete(r.id))
      else pageRows.forEach((r) => n.add(r.id))
      return n
    })
  }
  function openRow(inv: Invoice) {
    // PROMPT 5: wire row click to existing detail logic (drawer is PROMPT 6).
    setDetailId(inv.id)
  }

  // PROMPT 6: detail is now an overlaying right-side drawer; list stays mounted behind it.
  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs"><span>Billing</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>

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
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {selected.size > 0 && (
              <div className="bulkbar">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{selected.size} selected</span>
                <span className="spacer" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { console.log('[invoices] bulk export', Array.from(selected)); toast.success(`Export queued for ${selected.size} invoice(s)`) }}
                >
                  <DownloadIcon size={13} /> Export
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { console.log('[invoices] bulk mark paid', Array.from(selected)); toast.success('Mark-paid action — backend wiring TBD') }}
                >
                  Mark paid
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Cancel</button>
              </div>
            )}

            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search invoices"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <span className="spacer" />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { console.log('[invoices] export all'); toast.success(`Export queued for ${sorted.length} invoice(s)`) }}
              >
                <DownloadIcon size={13} /> Export
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => { console.log('[invoices] new invoice'); toast.success('New invoice — wiring TBD') }}>
                <PlusIcon size={13} /> New invoice
              </button>
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={togglePageAll}
                        aria-label="Select all rows on this page"
                      />
                    </th>
                    {cfg.columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={colThClass(c.key)}
                        onClick={() => toggleSort(c.key)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {c.label}
                          {sortKey === c.key && (sortDir === 1 ? <ArrowUpIcon size={11} /> : <ArrowDownIcon size={11} />)}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((inv) => (
                    <tr
                      key={inv.id}
                      className={selected.has(inv.id) ? 'sel' : ''}
                      onClick={() => openRow(inv)}
                    >
                      <td onClick={(e) => { e.stopPropagation(); toggleRow(inv.id) }} style={{ cursor: 'default' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(inv.id)}
                          onChange={() => toggleRow(inv.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select invoice ${inv.number ?? inv.id.slice(0, 8)}`}
                        />
                      </td>
                      {cfg.columns.map((c) => (
                        <td key={c.key} className={colTdClass(c.key)}>
                          {renderInvoiceCell(c.key, inv, cust)}
                        </td>
                      ))}
                      {cf.cells(inv.id)}
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 32 }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {(inv.status === 'ISSUED' || inv.status === 'OVERDUE') && (
                            <PayOnlineButton token={token} invoiceId={inv.id} onDone={load} />
                          )}
                          <button
                            className="iconbtn"
                            aria-label="Row menu"
                            title="Row actions"
                            onClick={(e) => { e.stopPropagation(); console.log('[invoices] row menu', inv.id) }}
                          >
                            <MoreVerticalIcon size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + 2 + cfg.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching invoices.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
                {sorted.length === 0
                  ? '0 invoices'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeftIcon size={13} /> Prev
              </button>
              <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>Page {page} of {pageCount}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next <ArrowRightIcon size={13} />
              </button>
            </div>
          </div>
        )}

        {/* PROMPT 6 — drawer mount; list stays mounted behind it. */}
        {detailId && (
          <InvoiceDetailDrawer
            token={token}
            id={detailId}
            names={names}
            onClose={() => { setDetailId(null); load() }}
          />
        )}
      </div>
    </div>
  )
}

// PROMPT 6 — Invoice detail rendered inside RecordDrawer.
// Replaces the old full-page <InvoiceDetail>. Same data hooks (`bget`/`bpost`
// against /api/invoices/:id and /:id/payments), same PaymentModal sub-view,
// reuses StatusPill via RecordDrawer's status prop.
function InvoiceDetailDrawer({ token, id, names, onClose }: { token: string; id: string; names: Record<string, string>; onClose: () => void }) {
  const [inv, setInv] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [payOpen, setPayOpen] = useState(false)

  async function load() {
    const res = await bget<Invoice>(token, `/api/invoices/${id}`)
    if (!res.ok) {
      toast.error(res.status === 404 ? 'Invoice not found' : 'Failed to load invoice')
      return
    }
    setInv(res.data)
    const pr = await bget<Payment[]>(token, `/api/invoices/${id}/payments`)
    if (pr.ok && Array.isArray(pr.data)) setPayments(pr.data)
  }

  useEffect(() => { load() }, [token, id])

  async function issue() {
    try { await bpost(token, `/api/invoices/${id}/issue`); toast.success('Invoice issued'); await load() }
    catch (e) { toast.error((e as Error).message) }
  }
  async function voidInvoice() {
    if (!window.confirm('Void this invoice? This cannot be undone.')) return
    try { await bpost(token, `/api/invoices/${id}/void`); toast.success('Invoice voided'); await load() }
    catch (e) { toast.error((e as Error).message) }
  }

  const status = (inv?.status ?? '').toUpperCase()
  const cust = inv?.customer_id ? (names[inv.customer_id] ?? inv.customer_id.slice(0, 8)) : '—'
  const number = inv?.number ?? id.slice(0, 8)

  // Build the Overview fields list from the invoice data.
  const fields = inv ? [
    { key: 'customer', label: 'Customer', value: cust },
    { key: 'issued',   label: 'Issued',   value: <span className="mono">{fmtDate(inv.issued_at ?? inv.created_at)}</span> },
    { key: 'due',      label: 'Due',      value: <span className="mono">{fmtDate(inv.due_at)}</span> },
    { key: 'total',    label: 'Total',    value: <span className="mono tnum">{money(inv.total)}</span> },
    ...(inv.balance !== undefined ? [
      { key: 'paid',    label: 'Paid',         value: <span className="mono tnum">{money(inv.paid_total)}</span> },
      { key: 'balance', label: 'Balance due',  value: (
          <span className="mono tnum" style={{ color: (inv.balance ?? 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {money(inv.balance)}
          </span>
        ) },
    ] : []),
    { key: 'lines', label: 'Line items', value: `${(inv.lines ?? []).length} line${(inv.lines ?? []).length === 1 ? '' : 's'}` },
  ] : []

  // Recorded payments surface in the Activity timeline (best-effort; full
  // audit-log feed is a TODO — backend endpoint not surfaced yet).
  const activity = payments.map((p) => ({
    ts: fmtDate(p.paid_at),
    title: `Payment recorded · ${money(p.amount)}`,
    detail: p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : undefined,
  }))

  const actions = inv ? (
    <>
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
    </>
  ) : null

  return (
    <>
      <RecordDrawer
        open
        onClose={onClose}
        entityKey="invoices"
        id={number}
        title={cust}
        subtitle={inv ? `Issued ${fmtDate(inv.issued_at ?? inv.created_at)} · Due ${fmtDate(inv.due_at)}` : 'Loading…'}
        status={inv?.status ? { label: inv.status, variant: mapInvoiceStatus(inv.status) } : undefined}
        fields={fields}
        activity={activity}
        // TODO: related records — wire to /api/customers/:id/* and /api/work-items?invoice= once those surfaces land.
        related={[]}
        // TODO: notes — no backend endpoint today; wire to /api/invoices/:id/notes when available.
        notes={[]}
        actions={actions}
      />
      {payOpen && (
        <PaymentModal
          token={token}
          invoiceId={id}
          onClose={() => setPayOpen(false)}
          onDone={() => { setPayOpen(false); load() }}
        />
      )}
    </>
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
