import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, type Subscription } from '../lib/billing'
import { money, toMinor } from '../lib/money'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import {
  ActivityIcon, ReceiptIcon, GearIcon, MoreVerticalIcon,
} from '../components/icons'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { t } from '../lib/i18n'
import { PageShell, type KPISpec } from '../page-shell'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { Button, Pagination, StatusPill } from '../primitives'

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

export default function UsageView({ token, canConfigure = false, configVersion = 0, onConfigure }: { token: string; canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
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
  useEffect(() => { setPage(1) }, [rated, query, sortKey, sortDir])

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

  const ratedCount = all.filter(u => u.rated).length
  const unratedCount = all.length - ratedCount
  const totalAmt = all.reduce((a, u) => a + (u.amount ?? 0), 0)
  const metrics = [...new Set(all.map(u => u.metric).filter(Boolean))]

  if (denied) return <PermissionDenied message={t('usage.denied', "You don't have permission to view usage.")} />

  const kpis: KPISpec[] = all.length > 0 ? [
    { label: 'Records', value: all.length, subtitle: `${ratedCount} rated · ${unratedCount} unrated`, onClick: () => setRated('') },
    { label: 'Total amount', value: `֏${(totalAmt / 1000).toFixed(1)}k`, subtitle: 'billed via subscription rules' },
    ...(metrics.length > 0 ? [{ label: 'Metric types', value: metrics.length, subtitle: metrics.slice(0, 4).join(' · ') }] : []),
  ] : []

  return (
    <PageShell
      type="ANALYTICS"
      breadcrumb={['Billing & Revenue', cfg.title]}
      icon={<ActivityIcon size={18} />}
      title={cfg.title}
      subtitle="Subscription metering & bandwidth tracking"
      kpis={kpis}
      primaryAction={!unavailable ? {
        label: 'Record usage',
        icon: <Plus size={14} />,
        onClick: () => setLogOpen(true),
      } : undefined}
      secondaryActions={!unavailable && canConfigure && onConfigure ? [
        { label: 'Configure', icon: <GearIcon size={13} />, onClick: onConfigure },
      ] : undefined}
      // TL-5 — search lifts into PageShell zone D.
      filters={{ search: { value: query, onChange: setQuery, placeholder: 'Search usage' } }}
    >
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-2)' }}>
                          {c.label}
                          {sortKey === c.key
                            // D18: active sort indicator = azure (interactive cue)
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-interactive)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-interactive)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((u) => (
                    <tr key={u.id}>
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
                      <td className="actions-col" onClick={(e) => e.stopPropagation()}>
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
                      <td colSpan={cfg.columns.length + 1 + cfg.customFields.length} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                        No matching usage records.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={sorted.length}
              onChange={setPage}
            />
          </div>
        )}

        {logOpen && <RecordUsageModal token={token} subs={subs} onClose={() => setLogOpen(false)} onDone={() => { setLogOpen(false); load() }} />}
    </PageShell>
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
        <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
        <Button variant="gold" size="md" disabled={saving || !quantity} onClick={submit}>{saving ? 'Saving…' : 'Record'}</Button>
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
