import { useEffect, useMemo, useState } from 'react'
import { bget, loadCustomers, type Payment, type Invoice } from '../lib/billing'
import { EmptyState, ErrorBanner } from '../components/States'
import {
  CreditCardIcon, ReceiptIcon, DownloadIcon, SearchIcon, GearIcon,
} from '../components/icons'
import {
  Download, Plus, Filter, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'
import { toast } from '../components/Toast'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// Payment status → StatusPill primitive variant.
type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapPaymentStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'SUCCEEDED' || v === 'PAID' || v === 'SUCCESS') return 'active'
  if (v === 'PENDING') return 'info'
  if (v === 'FAILED') return 'critical'
  if (v === 'REFUNDED') return 'neutral'
  return 'neutral'
}

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

export default function PaymentsView({ token, canConfigure = false, configVersion = 0, onConfigure }: { token: string; canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
  const cfg = usePageConfig(token, 'payments', configVersion)
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const cf = useCustomFields(token, 'payments', cfg.customFields, (payments ?? []).map((p) => p.id))
  const [invoiceMap, setInvoiceMap] = useState<Record<string, Invoice>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  // Interaction state added for the reskin (client-only — no new fetches).
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

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
  useEffect(() => { setPage(1); setSelected(new Set()) }, [query, sortKey, sortDir])

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

  function renderCell(colKey: string, p: Payment) {
    switch (colKey) {
      case 'invoice':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <ReceiptIcon size={13} />
            <span className="mono" style={{ color: 'var(--gx-text-1)' }}>{invoiceRef(p)}</span>
          </span>
        )
      case 'customer': return customerName(p)
      case 'method': return (p as any).method
        ? <StatusPill variant={(p as any).method?.toLowerCase() === 'card' ? 'info' : 'neutral'} label={String((p as any).method)} size="sm" />
        : <span>—</span>
      case 'date': return <span className="mono">{fmtDate(p.paid_at)}</span>
      case 'amount': return <span className="mono tnum">{`֏${(p.amount ?? 0).toLocaleString()}`}</span>
      case 'note': return <span style={{ color: 'var(--gx-text-3)' }}>{p.note ?? '—'}</span>
      case 'status': return (p as any).status
        ? <StatusPill variant={mapPaymentStatus((p as any).status)} label={String((p as any).status)} size="sm" />
        : <span>—</span>
      default: return '—'
    }
  }

  function colThClass(colKey: string): string { return colKey === 'amount' ? 'num' : '' }
  function colTdClass(colKey: string): string { return colKey === 'amount' ? 'num' : '' }

  // Client-side search + sort.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pList
    return pList.filter((p) => {
      const fields = [
        invoiceRef(p),
        customerName(p),
        (p as any).method ?? '',
        String(p.amount ?? ''),
        p.note ?? '',
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pList, query, invoiceMap, names])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (p: Payment): string | number => {
      switch (k) {
        case 'invoice': return invoiceRef(p)
        case 'customer': return customerName(p)
        case 'method': return (p as any).method ?? ''
        case 'date': return p.paid_at ?? ''
        case 'amount': return p.amount ?? 0
        case 'note': return p.note ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, invoiceMap, names])

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

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs"><span>Billing</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>

        <ViewHead
          icon={<CreditCardIcon size={18} />}
          title={cfg.title}
          sub={`Inbound payments · adapters: Card, Bank, Cash · ${pList.length} record${pList.length !== 1 ? 's' : ''}`}
          actions={
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => { console.log('[payments] reconcile'); toast.success('Reconcile triggered') }}>
                <DownloadIcon size={13} /> Reconcile
              </button>
              {canConfigure && onConfigure && (
                <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
                  <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => toast.success(`Export queued for ${sorted.length} payment(s)`)}>
                <Download size={14} /> Export
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => toast.info('Record payment — wiring TBD')}>
                <Plus size={14} /> New payment
              </button>
            </>
          }
        />

        {pList.length > 0 && (
          <div className="kpi-strip">
            <div className="kpi kpi--marquee">
              <span className="klbl">Total collected</span>
              <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-gold)' }}>{`֏${(totalSettled / 1000).toFixed(1)}k`}</div>
              <span className="hint" style={{ fontSize: 11 }}>{pList.length} settlement{pList.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="kpi">
              <span className="klbl">Methods</span>
              <div className="kval tnum" style={{ fontSize: 22 }}>
                {[...new Set(pList.map(p => (p as any).method).filter(Boolean))].join(' · ') || '—'}
              </div>
              <span className="hint" style={{ fontSize: 11 }}>adapters active</span>
            </div>
          </div>
        )}

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
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {selected.size > 0 && (
              <div className="bulkbar">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{selected.size} selected</span>
                <span className="spacer" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { console.log('[payments] bulk export', Array.from(selected)); toast.success(`Export queued for ${selected.size} payment(s)`) }}
                >
                  <DownloadIcon size={13} /> Export
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
                  placeholder="Search payments"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => toast.info('Filter builder — configure in Studio')}>
                <Filter size={14} /> Filter
              </button>
              <span className="spacer" />
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
                          {sortKey === c.key
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-primary)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-primary)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr
                      key={p.id}
                      className={selected.has(p.id) ? 'sel' : ''}
                    >
                      <td onClick={(e) => { e.stopPropagation(); toggleRow(p.id) }} style={{ cursor: 'default' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleRow(p.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select payment ${p.id.slice(0, 8)}`}
                        />
                      </td>
                      {cfg.columns.map((c) => (
                        <td key={c.key} className={colTdClass(c.key)}>
                          {renderCell(c.key, p)}
                        </td>
                      ))}
                      {cf.cells(p.id)}
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 32 }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="iconbtn"
                            aria-label="Row menu"
                            title="Row actions"
                            onClick={(e) => { e.stopPropagation(); console.log('[payments] row menu', p.id) }}
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
                        No matching payments.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span className="hint">
                {sorted.length === 0
                  ? '0 records'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft size={15} />
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map(p => (
                  <button key={p} className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
