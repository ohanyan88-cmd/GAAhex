import { useEffect, useState } from 'react'
import { bget, bpost, type Subscription } from './billing'
import { money, toMinor } from './money'
import { Modal } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from './States'
import { ChartIcon, CheckIcon, ReceiptIcon, DownloadIcon } from './icons'
import { t } from './i18n'
import ViewHead from './ViewHead'
import { usePageConfig } from './pageConfig'
import { useCustomFields } from './CustomCells'

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

export default function UsageView({ token, configVersion = 0 }: { token: string; configVersion?: number }) {
  const cfg = usePageConfig(token, 'usage', configVersion)
  const [list, setList] = useState<Usage[] | null>(null)
  const cf = useCustomFields(token, 'usage', cfg.customFields, (list ?? []).map((u) => u.id))
  const [subs, setSubs] = useState<Subscription[]>([])
  const [rated, setRated] = useState('')   // '' | 'true' | 'false'
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

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

  const subName = (sid: string | null | undefined) => (sid ? (subs.find((s) => s.id === sid)?.plan_name ?? sid.slice(0, 8)) : '—')

  if (denied) return <PermissionDenied message={t('usage.denied', "You don't have permission to view usage.")} />

  return (
    <div>
      <ViewHead
        icon={<ChartIcon size={20} />}
        title={cfg.title}
        sub="Bandwidth & metered records · rated via subscription rules"
        actions={!unavailable && (
          <>
            <button className="btn btn-ghost btn-sm"><DownloadIcon size={13} /> Export</button>
            <button className="btn btn-primary btn-sm" onClick={() => setLogOpen(true)}>Record usage</button>
          </>
        )}
      />

      <div className="list-toolbar">
        <div className="bill-filter">
          <span className="muted export-label">Rated</span>
          <select className="inp inp-sm" aria-label="Filter by rated" value={rated} onChange={(e) => setRated(e.target.value)}>
            <option value="">All</option>
            <option value="false">Unrated</option>
            <option value="true">Rated</option>
          </select>
        </div>
      </div>

      {list && list.length > 0 && (() => {
        const all = list
        const rated = all.filter(u => u.rated).length
        const totalAmt = all.reduce((a, u) => a + (u.amount ?? 0), 0)
        const metrics = [...new Set(all.map(u => u.metric).filter(Boolean))]
        return (
          <div className="widgets" style={{ marginBottom: 18 }}>
            <div className="widget">
              <div className="widget-label">Records</div>
              <div className="kpi">{all.length}</div>
              <div className="kpi-sub">{rated} rated · {all.length - rated} unrated</div>
            </div>
            <div className="widget">
              <div className="widget-label">Total amount</div>
              <div className="kpi"><span className="kpi-cur">֏</span>{(totalAmt / 1000).toFixed(1)}k</div>
              <div className="kpi-sub">billed via subscription rules</div>
            </div>
            {metrics.length > 0 && (
              <div className="widget">
                <div className="widget-label">Metric types</div>
                <div className="kpi" style={{ fontSize: 22 }}>{metrics.length}</div>
                <div className="kpi-sub">{metrics.slice(0, 4).join(' · ')}</div>
              </div>
            )}
          </div>
        )
      })()}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <SkeletonRows />}
      {unavailable && <EmptyState icon={<ReceiptIcon size={40} />} title={t('usage.unavailable', "Usage isn't available yet")} message={t('usage.unavailableMsg', 'Metered usage will appear here once the rating service is enabled.')} />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<ReceiptIcon size={40} />} title="No usage records" message="Nothing matches this filter." />
      )}

      {list && list.length > 0 && (
        <div className="grid-wrap"><table className="grid">
          <thead>
            <tr>
              {cfg.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
              {cf.headers()}
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                {cfg.columns.map((c) => {
                  let cell: React.ReactNode
                  switch (c.key) {
                    case 'subscription': cell = subName(u.subscription_id); break
                    case 'metric': cell = u.metric ?? '—'; break
                    case 'quantity': cell = u.quantity ?? '—'; break
                    case 'rate': cell = money(u.unit_rate); break
                    case 'amount': cell = money(u.amount); break
                    case 'rated': cell = u.rated
                      ? <span className="pill pill-success"><CheckIcon size={12} /> rated</span>
                      : <span className="pill pill-muted">unrated</span>; break
                    default: cell = '—'
                  }
                  return <td key={c.key}>{cell}</td>
                })}
                {cf.cells(u.id)}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {logOpen && <RecordUsageModal token={token} subs={subs} onClose={() => setLogOpen(false)} onDone={() => { setLogOpen(false); load() }} />}
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
