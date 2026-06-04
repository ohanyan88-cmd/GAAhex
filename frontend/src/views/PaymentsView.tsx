import { useEffect, useMemo, useState } from 'react'
import { bget, loadCustomers, type Payment, type Invoice } from '../lib/billing'
import { money } from '../lib/money'
import { EmptyState, ErrorBanner } from '../components/States'
import { humanizeStatus } from '../lib/humanize'
import {
  CreditCardIcon, ReceiptIcon, SearchIcon, GearIcon,
} from '../components/icons'
import {
  ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { PageShell, type KPISpec } from '../page-shell'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'
import { fmtDate } from '../lib/time'


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
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

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
  const methodsActive = [...new Set(pList.map(p => p.method).filter(Boolean))]

  const kpis: KPISpec[] = pList.length > 0 ? [
    { label: 'Total collected', value: money(totalSettled), subtitle: `${pList.length} settlement${pList.length !== 1 ? 's' : ''}` },
    ...(methodsActive.length > 0 ? [{ label: 'Methods', value: methodsActive.map(humanizeStatus).join(' · '), subtitle: 'used' }] : []),
  ] : []

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
      case 'method': return p.method
        ? <StatusPill variant={p.method.toLowerCase() === 'card' ? 'info' : 'neutral'} label={humanizeStatus(p.method)} size="sm" />
        : <span>—</span>
      case 'date': return <span className="mono">{fmtDate(p.paid_at)}</span>
      case 'amount': return <span className="mono tnum">{money(p.amount)}</span>
      case 'note': return <span style={{ color: 'var(--gx-text-3)' }}>{p.note ?? '—'}</span>
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
        p.method ?? '',
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
        case 'method': return p.method ?? ''
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

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Billing & Revenue', cfg.title]}
      icon={<CreditCardIcon size={18} />}
      title={cfg.title}
      subtitle="Payment ledger"
      kpis={kpis}
      secondaryActions={canConfigure && onConfigure ? [
        { label: 'Configure', icon: <GearIcon size={13} />, onClick: onConfigure },
      ] : undefined}
      filters={{ search: { value: query, onChange: setQuery, placeholder: 'Search payments…' } }}
    >
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
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
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
                            // D18: active sort indicator = azure (interactive cue)
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-interactive)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-interactive)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={p.id}>
                      {cfg.columns.map((c) => (
                        <td key={c.key} className={colTdClass(c.key)}>
                          {renderCell(c.key, p)}
                        </td>
                      ))}
                      {cf.cells(p.id)}
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + cfg.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
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
    </PageShell>
  )
}
