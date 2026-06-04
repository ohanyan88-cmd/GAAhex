import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, loadCustomers, loadCustomerOptions, loadProducts, type Subscription, type Product } from '../lib/billing'
import { money, toMinor } from '../lib/money'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner } from '../components/States'
import { humanizeStatus } from '../lib/humanize'
import {
  ReceiptIcon, PauseIcon, PlayIcon, CloseIcon,
  SearchIcon, GearIcon,
} from '../components/icons'
import RowActionsMenu, { type RowAction } from '../components/RowActionsMenu'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { PageShell, type KPISpec } from '../page-shell'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'
import ErrorBoundary from '../components/ErrorBoundary'
import LoadingState from '../components/LoadingState'

type Draft = { customer_id: string; product_id: string; plan_name: string; amount: string; cycle: string }
const EMPTY: Draft = { customer_id: '', product_id: '', plan_name: '', amount: '', cycle: 'monthly' }

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapSubStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'ACTIVE') return 'active'
  if (v === 'TRIALING') return 'info'
  if (v === 'PAST_DUE') return 'degraded'
  if (v === 'SUSPENDED') return 'degraded'
  if (v === 'CANCELLED' || v === 'CANCELED' || v === 'EXPIRED') return 'neutral'
  return 'info'
}

export default function SubscriptionsView({ token, canConfigure = false, configVersion = 0, onConfigure }: { token: string; canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
  const cfg = usePageConfig(token, 'subscriptions', configVersion)
  const [list, setList] = useState<Subscription[] | null>(null)
  const cf = useCustomFields(token, 'subscriptions', cfg.customFields, (list ?? []).map((s) => s.id))
  const [names, setNames] = useState<Record<string, string>>({})
  const [customers, setCustomers] = useState<{ id: string; label: string }[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)

  // Interaction state for reskin.
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError(''); setUnavailable(false); setList(null)
    const res = await bget<Subscription[]>(token, '/api/subscriptions')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (!res.ok) { setError('Failed to load subscriptions'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
    setNames(await loadCustomers(token))
  }

  useEffect(() => { load() }, [token])
  useEffect(() => {
    loadCustomerOptions(token).then(setCustomers)
    loadProducts(token, true).then(setProducts)
  }, [token])
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

  const cust = (s: Subscription) => (s.customer_id ? (names[s.customer_id] ?? s.customer_id.slice(0, 8)) : '—')

  function pickProduct(id: string) {
    const p = products.find((x) => x.id === id)
    setDraft((d) => d && ({
      ...d,
      product_id: id,
      plan_name: p?.name ?? d.plan_name,
      amount: p?.default_amount != null ? String(p.default_amount / 100) : d.amount,
      cycle: p?.cycle ?? d.cycle,
    }))
  }

  async function createSub() {
    if (!draft || !draft.plan_name.trim()) return
    try {
      await bpost(token, '/api/subscriptions', {
        customer_id: draft.customer_id || undefined,
        product_id: draft.product_id || undefined,
        plan_name: draft.plan_name.trim(),
        amount: toMinor(draft.amount),
        cycle: draft.cycle,
      })
      toast.success('Subscription created')
      setDraft(null)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function action(id: string, verb: 'cancel' | 'suspend' | 'resume') {
    try {
      await bpost(token, `/api/subscriptions/${id}/${verb}`)
      toast.success(`Subscription ${verb === 'resume' ? 'resumed' : verb + 'ed'}`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function generate(id: string) {
    try {
      await bpost(token, `/api/subscriptions/${id}/generate-invoice`)
      toast.success('Invoice generated')
    } catch (e) { toast.error((e as Error).message) }
  }

  async function rateUsage(id: string) {
    try {
      const res: any = await bpost(token, '/api/usage/rate', { subscription_id: id })
      const inv = res?.invoice_number ?? res?.number ?? (res?.invoice_id ? `#${String(res.invoice_id).slice(0, 8)}` : '')
      const total = res?.total
      toast.success(`Usage rated${inv ? ` → ${inv}` : ''}${typeof total === 'number' ? ` (${money(total)})` : ''}`)
    } catch (e) {
      const err = e as Error & { status?: number }
      toast.error(err.status === 404 ? "Usage rating isn't available yet" : err.message)
    }
  }

  const all = list ?? []
  const activeCount = all.filter(s => (s.status ?? '').toUpperCase() === 'ACTIVE').length
  const suspendedCount = all.filter(s => (s.status ?? '').toUpperCase() === 'SUSPENDED').length
  const cancelledCount = all.filter(s => {
    const v = (s.status ?? '').toUpperCase()
    return v === 'CANCELLED' || v === 'CANCELED'
  }).length

  function renderCell(colKey: string, s: Subscription) {
    switch (colKey) {
      case 'customer': return cust(s)
      case 'plan': return s.plan_name ? <span className="mono">{s.plan_name}</span> : <span>—</span>
      case 'cycle': return s.cycle
        ? <span style={{ color: 'var(--gx-text-2)', textTransform: 'capitalize' }}>{s.cycle}</span>
        : <span>—</span>
      case 'status': return s.status
        ? <StatusPill variant={mapSubStatus(s.status)} label={humanizeStatus(s.status)} size="sm" />
        : <span>—</span>
      case 'mrr': return s.amount != null
        ? <span className="mono tnum">{money(s.amount)}</span>
        : <span>—</span>
      default: return '—'
    }
  }

  function colThClass(colKey: string): string { return colKey === 'mrr' ? 'num' : '' }
  function colTdClass(colKey: string): string { return colKey === 'mrr' ? 'num' : '' }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((s) => {
      const fields = [
        s.plan_name ?? '',
        cust(s),
        s.status ?? '',
        s.cycle ?? '',
        String(s.amount ?? ''),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, names])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (s: Subscription): string | number => {
      switch (k) {
        case 'customer': return cust(s)
        case 'plan': return s.plan_name ?? ''
        case 'cycle': return s.cycle ?? ''
        case 'status': return s.status ?? ''
        case 'mrr': return s.amount ?? 0
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

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  const kpis: KPISpec[] = all.length > 0 ? [
    { label: 'Total subscriptions', value: all.length, subtitle: `${activeCount} active`, onClick: () => setQuery('') },
    { label: 'Active', value: activeCount, subtitle: 'recurring revenue', onClick: () => setQuery('ACTIVE') },
    ...(suspendedCount > 0 ? [{ label: 'Suspended', value: suspendedCount, subtitle: 'action required', warning: true, onClick: () => setQuery('SUSPENDED') }] : []),
    ...(cancelledCount > 0 ? [{ label: 'Cancelled', value: cancelledCount, subtitle: 'closed', muted: true, onClick: () => setQuery('CANCELLED') }] : []),
  ] : []

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Billing & Revenue', cfg.title]}
      icon={<ReceiptIcon size={18} />}
      title={cfg.title}
      subtitle="Recurring subscription ledger"
      kpis={kpis}
      primaryAction={!unavailable ? {
        label: draft ? 'Close' : 'New subscription',
        icon: <Plus size={14} />,
        onClick: () => setDraft(draft ? null : { ...EMPTY }),
      } : undefined}
      secondaryActions={!unavailable && canConfigure && onConfigure ? [
        { label: 'Configure', icon: <GearIcon size={13} />, onClick: onConfigure },
      ] : undefined}
      // TL-5 — search lifts into PageShell zone D.
      filters={{ search: { value: query, onChange: setQuery, placeholder: 'Search subscriptions' } }}
    >
        {draft && (
          <div className="rec-form">
            <label className="field">
              <span>Customer</span>
              <select className="inp inp-md" value={draft.customer_id} onChange={(e) => setDraft({ ...draft, customer_id: e.target.value })}>
                <option value="">— none —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Product</span>
              <select className="inp inp-md" value={draft.product_id} onChange={(e) => pickProduct(e.target.value)}>
                <option value="">— custom —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Plan name *</span>
              <input className="inp inp-md" value={draft.plan_name} onChange={(e) => setDraft({ ...draft, plan_name: e.target.value })} placeholder="Fiber 100" />
            </label>
            <label className="field">
              <span>Amount (֏)</span>
              <input className="inp inp-md inp-numeric" type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </label>
            <label className="field">
              <span>Cycle</span>
              <select className="inp inp-md" value={draft.cycle} onChange={(e) => setDraft({ ...draft, cycle: e.target.value })}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <div className="rec-form-actions">
              <button className="btn btn-accent btn-md" onClick={createSub} disabled={!draft.plan_name.trim()}>Create</button>
            </div>
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={load} />}
        <ErrorBoundary onReset={load}>
        {list === null && !error && <LoadingState kind="rows" label="Loading subscriptions…" />}
        {unavailable && (
          <EmptyState icon={<ReceiptIcon size={40} />} title="Billing isn't available yet" message="Subscriptions will appear here once the billing service is enabled." />
        )}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<ReceiptIcon size={40} />} title="No subscriptions" message="Subscriptions you create will show up here." />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {/* TL-5 — search lifted to PageShell zone D. */}
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
                    <th scope="col" className="actions-col" aria-label="Actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((s) => {
                    const st = (s.status ?? '').toUpperCase()
                    const canceled = st === 'CANCELLED' || st === 'CANCELED' || st === 'EXPIRED'
                    return (
                      <tr key={s.id}>
                        {cfg.columns.map((c) => (
                          <td key={c.key} className={colTdClass(c.key)}>
                            {renderCell(c.key, s)}
                          </td>
                        ))}
                        {cf.cells(s.id)}
                        <td className="actions-col" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {(() => {
                              const actions: RowAction[] = []
                              if (!canceled) {
                                actions.push({ key: 'gen', label: 'Generate invoice for current period', icon: <ReceiptIcon size={14} />, onClick: () => generate(s.id) })
                                actions.push({ key: 'rate', label: 'Rate metered usage', icon: <GearIcon size={14} />, onClick: () => rateUsage(s.id) })
                              }
                              if (st === 'ACTIVE') {
                                actions.push({ key: 'suspend', label: 'Suspend', icon: <PauseIcon size={14} />, onClick: () => action(s.id, 'suspend') })
                              }
                              if (st === 'SUSPENDED') {
                                actions.push({ key: 'resume', label: 'Resume', icon: <PlayIcon size={14} />, onClick: () => action(s.id, 'resume') })
                              }
                              if (st === 'ACTIVE' || st === 'SUSPENDED') {
                                actions.push({
                                  key: 'cancel',
                                  label: 'Cancel subscription',
                                  icon: <CloseIcon size={14} />,
                                  danger: true,
                                  onClick: () => {
                                    if (window.confirm(`Cancel subscription "${s.plan_name ?? s.id.slice(0, 8)}"? This cannot be undone.`)) {
                                      action(s.id, 'cancel')
                                    }
                                  },
                                })
                              }
                              return <RowActionsMenu actions={actions} ariaLabel="Subscription actions" />
                            })()}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + 1 + cfg.customFields.length} style={{ padding: 0 }}>
                        <EmptyState
                          icon={<SearchIcon size={34} />}
                          title="No matching subscriptions"
                          message="Try a different search term."
                        />
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
        </ErrorBoundary>
    </PageShell>
  )
}
