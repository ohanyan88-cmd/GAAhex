import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, type Subscription } from '../lib/billing'
import { money, toMinor } from '../lib/money'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import {
  ChartIcon, ReceiptIcon, DownloadIcon, PlusIcon, SearchIcon,
} from '../components/icons'
import {
  Wand2, Download, Plus, Filter, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { t } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'

// Usage metering + rating (E15 /api/usage). List + Record usage. Degrades on 404.
type Usage = {
  id: string
  subscription_id?: string | null
  service_id?: string | null
  metric?: string
  quantity?: number | string
  unit_rate?: number
  amount?: number
  rated?: boolean
  invoice_id?: string | null
  created_at?: string | null
}

const METRICS = ['gb', 'minutes', 'messages', 'other']

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

export default function UsageView({ token, canConfigure = false, configVersion = 0, onGoStudio }: { token: string; canConfigure?: boolean; configVersion?: number; onGoStudio?: () => void }) {
  const cfg = usePageConfig(token, 'usage', configVersion)
  const [list, setList] = useState<Usage[] | null>(null)
  const cf = useCustomFields(token, 'usage', cfg.customFields, (list ?? []).map((u) => u.id))
  const [subs, setSubs] = useState<Subscription[]>([])
  const [rated, setRated] = useState('')   // '' | 'true' | 'false'
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const p = new URLSearchParams()
    if (rated) p.set('rated', rated)
    const qs = p.toString()
    const res = await bget<Usage[]>(token, `/api/usage${qs ? `?${qs}` : ''}`)
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError(t('usage.loadError', 'Failed to load usage')); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token, rated])
  useEffect(() => { bget<Subscription[]>(token, '/api/subscriptions').then((r) => setSubs(r.ok && Array.isArray(r.data) ? r.data : [])) }, [token])
  useEffect(() => { setPage(1); setSelected(new Set()) }, [rated, query, sortKey, sortDir])

  const subName = (sid: string | null | undefined) => (sid ? (subs.find((s) => s.id === sid)?.plan_name ?? sid.slice(0, 8)) : '—')

  const all = list ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((u) => {
      const fields = [
        u.metric ?? '',
        subName(u.subscription_id),
        String(u.quantity ?? ''),
        String(u.amount ?? ''),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, subs])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (u: Usage): string | number => {
      switch (k) {
        case 'subscription': return subName(u.subscription_id)
        case 'metric': return u.metric ?? ''
        case 'quantity': return Number(u.quantity ?? 0)
        case 'rate': return u.unit_rate ?? 0
        case 'amount': return u.amount ?? 0
        case 'rated': return u.rated ? 1 : 0
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, subs])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))

  function colThClass(colKey: string): string {
    return ['quantity', 'rate', 'amount'].includes(colKey) ? 'num' : ''
  }
  function colTdClass(colKey: string): string {
    return ['quantity', 'rate', 'amount'].includes(colKey) ? 'num' : ''
  }

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }
  function toggleRow(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function togglePageAll() {
    setSelected((s) => {
      const n = new Set(s)
      if (allOnPageSelected) pageRows.forEach((r) => n.delete(r.id))
      else pageRows.forEach((r) => n.add(r.id))
      return n
    })
  }

  const ratedCount = all.filter(u => u.rated).length
  const unratedCount = all.length - ratedCount
  const totalAmt = all.reduce((a, u) => a + (u.amount ?? 0), 0)
  const metrics = [...new Set(all.map(u => u.metric).filter(Boolean))]

  if (denied) return <PermissionDenied message={t('usage.denied', "You don't have permission to view usage.")} />

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs"><span>Billing</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>

        <ViewHead
          icon={<ChartIcon size={18} />}
          title={cfg.title}
          sub={`${all.length} record${all.length !== 1 ? 's' : ''} · metered · rated via subscription rules`}
          actions={!unavailable && (
            <>
              {canConfigure && onGoStudio && (
                <button className="btn btn-ghost btn-sm" onClick={onGoStudio} title="Every screen is config — edit this one in Studio">
                  <Wand2 size={14} style={{ color: 'var(--gx-gold)' }} /> Configure page
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => toast.success(`Export queued for ${sorted.length} record(s)`)}>
                <Download size={14} /> Export
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setLogOpen(true)}>
                <Plus size={14} /> Record usage
              </button>
            </>
          )}
        />

        {all.length > 0 && (
          <div className="kpi-strip">
            <div className="kpi">
              <span className="klbl">Records</span>
              <div className="kval tnum" style={{ fontSize: 24 }}>{all.length}</div>
              <span className="hint" style={{ fontSize: 11 }}>{ratedCount} rated · {unratedCount} unrated</span>
            </div>
            <div className="kpi kpi--marquee">
              <span className="klbl">Total amount</span>
              <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-gold)' }}>{`֏${(totalAmt / 1000).toFixed(1)}k`}</div>
              <span className="hint" style={{ fontSize: 11 }}>billed via subscription rules</span>
            </div>
            {metrics.length > 0 && (
              <div className="kpi">
                <span className="klbl">Metric types</span>
                <div className="kval tnum" style={{ fontSize: 24 }}>{metrics.length}</div>
                <span className="hint" style={{ fontSize: 11 }}>{metrics.slice(0, 4).join(' · ')}</span>
              </div>
            )}
          </div>
        )}

        <div className="tabs">
          <button className={'tab' + (rated === '' ? ' on' : '')} onClick={() => setRated('')}>
            All <span className="tab-count">{all.length}</span>
          </button>
          <button className={'tab' + (rated === 'false' ? ' on' : '')} onClick={() => setRated('false')}>
            Unrated <span className="tab-count">{unratedCount}</span>
          </button>
          <button className={'tab' + (rated === 'true' ? ' on' : '')} onClick={() => setRated('true')}>
            Rated <span className="tab-count">{ratedCount}</span>
          </button>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <SkeletonRows />}
        {unavailable && <EmptyState icon={<ReceiptIcon size={40} />} title={t('usage.unavailable', "Usage isn't available yet")} message={t('usage.unavailableMsg', 'Metered usage will appear here once the rating service is enabled.')} />}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<ReceiptIcon size={40} />} title="No usage records" message="Nothing matches this filter." />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {selected.size > 0 && (
              <div className="bulkbar">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{selected.size} selected</span>
                <span className="spacer" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { console.log('[usage] bulk export', Array.from(selected)); toast.success(`Export queued for ${selected.size} record(s)`) }}
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
                  placeholder="Search usage"
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
                      <input type="checkbox" checked={allOnPageSelected} onChange={togglePageAll} aria-label="Select all rows on this page" />
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
                  {pageRows.map((u) => (
                    <tr key={u.id} className={selected.has(u.id) ? 'sel' : ''}>
                      <td onClick={(e) => { e.stopPropagation(); toggleRow(u.id) }} style={{ cursor: 'default' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(u.id)}
                          onChange={() => toggleRow(u.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select usage ${u.id.slice(0, 8)}`}
                        />
                      </td>
                      {cfg.columns.map((c) => {
                        let cell: React.ReactNode
                        switch (c.key) {
                          case 'subscription': cell = subName(u.subscription_id); break
                          case 'metric': cell = <span style={{ textTransform: 'capitalize' }}>{u.metric ?? '—'}</span>; break
                          case 'quantity': cell = <span className="mono tnum">{u.quantity ?? '—'}</span>; break
                          case 'rate': cell = <span className="mono tnum">{money(u.unit_rate)}</span>; break
                          case 'amount': cell = <span className="mono tnum">{money(u.amount)}</span>; break
                          case 'rated': cell = u.rated
                            ? <StatusPill variant="active" label="rated" size="sm" />
                            : <StatusPill variant="neutral" label="unrated" size="sm" />; break
                          default: cell = '—'
                        }
                        return <td key={c.key} className={colTdClass(c.key)}>{cell}</td>
                      })}
                      {cf.cells(u.id)}
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 32 }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="iconbtn"
                            aria-label="Row menu"
                            title="Row actions"
                            onClick={(e) => { e.stopPropagation(); console.log('[usage] row menu', u.id) }}
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
                        No matching usage records.
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

        {logOpen && <RecordUsageModal token={token} subs={subs} onClose={() => setLogOpen(false)} onDone={() => { setLogOpen(false); load() }} />}
      </div>
    </div>
  )
}

function RecordUsageModal({ token, subs, onClose, onDone }: { token: string; subs: Subscription[]; onClose: () => void; onDone: () => void }) {
  const [subscriptionId, setSubscriptionId] = useState('')
  const [metric, setMetric] = useState('gb')
  const [quantity, setQuantity] = useState('')
  const [rate, setRate] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!quantity || saving) return
    setSaving(true)
    try {
      await bpost(token, '/api/usage', {
        subscription_id: subscriptionId || undefined,
        metric, quantity: Number(quantity), unit_rate: toMinor(rate),
      })
      toast.success(t('usage.recorded', 'Usage recorded'))
      onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Record usage" size="sm"
      footer={<>
        <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
        <button className="btn btn-accent btn-md" disabled={saving || !quantity} onClick={submit}>{saving ? 'Saving…' : 'Record'}</button>
      </>}>
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field"><span>Subscription</span>
          <select className="inp inp-md" value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)}>
            <option value="">— none —</option>
            {subs.map((s) => <option key={s.id} value={s.id}>{s.plan_name ?? s.id.slice(0, 8)}</option>)}
          </select>
        </label>
        <label className="field"><span>Metric</span>
          <select className="inp inp-md" value={metric} onChange={(e) => setMetric(e.target.value)}>{METRICS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
        <label className="field"><span>Quantity</span><input className="inp inp-md inp-numeric" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
        <label className="field"><span>Unit rate (֏)</span><input className="inp inp-md inp-numeric" type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
      </div>
    </Modal>
  )
}
