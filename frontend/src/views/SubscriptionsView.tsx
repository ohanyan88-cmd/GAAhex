import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, loadCustomers, loadCustomerOptions, loadProducts, type Subscription, type Product } from '../lib/billing'
import { money, toMinor } from '../lib/money'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner } from '../components/States'
import {
  ReceiptIcon, PlusIcon, DownloadIcon, PauseIcon, PlayIcon,
  SearchIcon,
} from '../components/icons'
import {
  Wand2, Download, Plus, Filter, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'

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

export default function SubscriptionsView({ token, canConfigure = false, configVersion = 0, onGoStudio }: { token: string; canConfigure?: boolean; configVersion?: number; onGoStudio?: () => void }) {
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
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
  useEffect(() => { setPage(1); setSelected(new Set()) }, [query, sortKey, sortDir])

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
      case 'plan': return <span className="mono">{s.plan_name ?? '—'}</span>
      case 'cycle': return <span style={{ color: 'var(--gx-text-2)', textTransform: 'capitalize' }}>{s.cycle ?? '—'}</span>
      case 'status': return s.status
        ? <StatusPill variant={mapSubStatus(s.status)} label={s.status} size="sm" />
        : <span>—</span>
      case 'mrr': return <span className="mono tnum">{`֏${(s.amount ?? 0).toLocaleString()}`}</span>
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
          icon={<ReceiptIcon size={18} />}
          title={cfg.title}
          sub={`${all.length} subscription${all.length !== 1 ? 's' : ''} · billed via the WorkItem engine`}
          actions={
            !unavailable ? (
              <>
                {canConfigure && onGoStudio && (
                  <button className="btn btn-ghost btn-sm" onClick={onGoStudio} title="Every screen is config — edit this one in Studio">
                    <Wand2 size={14} style={{ color: 'var(--gx-gold)' }} /> Configure page
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => toast.success(`Export queued for ${sorted.length} subscription(s)`)}>
                  <Download size={14} /> Export
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setDraft(draft ? null : { ...EMPTY })}>
                  <Plus size={14} /> {draft ? 'Close' : 'New subscription'}
                </button>
              </>
            ) : undefined
          }
        />

        {all.length > 0 && (
          <div className="kpi-strip">
            <div className="kpi">
              <span className="klbl">Total subscriptions</span>
              <div className="kval tnum" style={{ fontSize: 24 }}>{all.length}</div>
              <span className="hint" style={{ fontSize: 11 }}>{activeCount} active</span>
            </div>
            <div className="kpi kpi--marquee">
              <span className="klbl">Active</span>
              <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-gold)' }}>{activeCount}</div>
              <span className="hint" style={{ fontSize: 11 }}>recurring revenue</span>
            </div>
            {suspendedCount > 0 && (
              <div className="kpi">
                <span className="klbl">Suspended</span>
                <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-warning-fg)' }}>{suspendedCount}</div>
                <span className="hint" style={{ fontSize: 11 }}>action required</span>
              </div>
            )}
            {cancelledCount > 0 && (
              <div className="kpi">
                <span className="klbl">Cancelled</span>
                <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-text-3)' }}>{cancelledCount}</div>
                <span className="hint" style={{ fontSize: 11 }}>closed</span>
              </div>
            )}
          </div>
        )}

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
        {list === null && !error && <p className="muted">Loading…</p>}
        {unavailable && (
          <EmptyState icon={<ReceiptIcon size={40} />} title="Billing isn't available yet" message="Subscriptions will appear here once the billing service is enabled." />
        )}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<ReceiptIcon size={40} />} title="No subscriptions" message="Subscriptions you create will show up here." />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {selected.size > 0 && (
              <div className="bulkbar">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{selected.size} selected</span>
                <span className="spacer" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { console.log('[subscriptions] bulk export', Array.from(selected)); toast.success(`Export queued for ${selected.size} subscription(s)`) }}
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
                  placeholder="Search subscriptions"
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
                  {pageRows.map((s) => {
                    const st = (s.status ?? '').toUpperCase()
                    const canceled = st === 'CANCELLED' || st === 'CANCELED'
                    return (
                      <tr key={s.id} className={selected.has(s.id) ? 'sel' : ''}>
                        <td onClick={(e) => { e.stopPropagation(); toggleRow(s.id) }} style={{ cursor: 'default' }}>
                          <input
                            type="checkbox"
                            checked={selected.has(s.id)}
                            onChange={() => toggleRow(s.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select subscription ${s.id.slice(0, 8)}`}
                          />
                        </td>
                        {cfg.columns.map((c) => (
                          <td key={c.key} className={colTdClass(c.key)}>
                            {renderCell(c.key, s)}
                          </td>
                        ))}
                        {cf.cells(s.id)}
                        <td onClick={(e) => e.stopPropagation()} style={{ width: 32 }}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {!canceled && (
                              <button className="btn btn-ghost btn-sm" title="Generate invoice" onClick={() => generate(s.id)}>
                                Generate
                              </button>
                            )}
                            {!canceled && (
                              <button className="btn btn-ghost btn-sm" title="Rate usage" onClick={() => rateUsage(s.id)}>
                                Rate
                              </button>
                            )}
                            {st === 'ACTIVE' && (
                              <button className="iconbtn" title="Suspend" onClick={() => action(s.id, 'suspend')}>
                                <PauseIcon size={13} />
                              </button>
                            )}
                            {st === 'SUSPENDED' && (
                              <button className="iconbtn" title="Resume" onClick={() => action(s.id, 'resume')}>
                                <PlayIcon size={13} />
                              </button>
                            )}
                            <button
                              className="iconbtn"
                              aria-label="Row menu"
                              title="Row actions"
                              onClick={(e) => { e.stopPropagation(); console.log('[subscriptions] row menu', s.id) }}
                            >
                              <MoreVerticalIcon size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + 2 + cfg.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching subscriptions.
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
