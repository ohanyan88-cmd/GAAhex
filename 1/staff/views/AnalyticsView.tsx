import { useEffect, useState } from 'react'
import { bget } from '../lib/billing'
import { money } from '../lib/money'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { ChartIcon, ArrowUpIcon, ArrowDownIcon } from '../components/icons'
import { useI18n } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'

// Analytics (A18 /api/analytics/*) — KPIs + inline-SVG/CSS charts in the existing dashboard style.
// No charting library. Degrades on 404 (Stage-1 dormant) and per-section on error.
const PALETTE = ['#3A6FB5', '#C5A059', '#2ECC71', '#F5A623', '#E63946', '#4A82CC', '#D4B26C', '#AEB7C2']
const fmtNum = (n: number) => n.toLocaleString('en-US')

type Overview = Record<string, any>
type TrendPoint = { month: string; collected: number; invoiced: number }
type MixSlice = { product: string; count: number; mrr: number }

function pick(o: Overview, key: string): { value: number; prev?: number } {
  const raw = o?.[key]
  if (raw && typeof raw === 'object') return { value: Number(raw.value) || 0, prev: raw.prev != null ? Number(raw.prev) : undefined }
  const p = o?.[`${key}_prev`]
  return { value: Number(raw) || 0, prev: p != null ? Number(p) : undefined }
}

export default function AnalyticsView({ token, configVersion = 0 }: { token: string; configVersion?: number }) {
  const { t } = useI18n()
  const cfg = usePageConfig(token, 'analytics', configVersion)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [trend, setTrend] = useState<TrendPoint[] | null>(null)
  const [mix, setMix] = useState<MixSlice[] | null>(null)
  const [aging, setAging] = useState<{ bucket: string; amount: number }[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setUnavailable(false); setDenied(false); setError('')
    const ov = await bget<Overview>(token, '/api/analytics/overview')
    if (ov.status === 404) { setUnavailable(true); setLoading(false); return }
    if (ov.status === 403) { setDenied(true); setLoading(false); return }
    if (!ov.ok) { setError(t('analytics.loadError', 'Failed to load analytics')); setLoading(false); return }
    setOverview(ov.data || {})

    const [tr, mx, ag] = await Promise.all([
      bget<any>(token, '/api/analytics/revenue-trend?months=6'),
      bget<MixSlice[]>(token, '/api/analytics/subscription-mix'),
      bget<any>(token, '/api/analytics/ar-aging'),
    ])
    setTrend(tr.ok && Array.isArray(tr.data) ? tr.data.map((d: any) => ({ month: String(d.month ?? ''), collected: Number(d.collected) || 0, invoiced: Number(d.invoiced) || 0 })) : [])
    setMix(mx.ok && Array.isArray(mx.data) ? mx.data.map((d: any) => ({ product: String(d.product ?? '—'), count: Number(d.count) || 0, mrr: Number(d.mrr) || 0 })) : [])
    setAging(ag.ok ? normalizeAging(ag.data) : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [token])

  if (denied) return <PermissionDenied message={t('analytics.denied', "You don't have permission to view analytics.")} />

  return (
    <div>
      <ViewHead icon={<ChartIcon size={20} />} title={cfg.title} />

      {loading && <p className="muted">{t('common.loading', 'Loading…')}</p>}
      {error && <ErrorBanner message={error} onRetry={load} />}
      {unavailable && <EmptyState icon={<ChartIcon size={40} />} title={t('analytics.unavailable', "Analytics aren't available yet")} message={t('analytics.unavailableMsg', 'KPIs and charts will appear here once the analytics service is enabled.')} />}

      {!loading && !unavailable && !error && overview && (
        <>
          <div className="widgets kpi-row">
            <Kpi label={t('analytics.mrr', 'MRR')} m={pick(overview, 'mrr')} money goodUp t={t} />
            <Kpi label={t('analytics.activeSubs', 'Active subscriptions')} m={pick(overview, 'active_subscriptions')} goodUp t={t} />
            <Kpi label={t('analytics.arOutstanding', 'AR outstanding')} m={pick(overview, 'ar_outstanding')} money t={t} />
            <Kpi label={t('analytics.overdue', 'Overdue')} m={pick(overview, 'overdue')} money t={t} />
            <Kpi label={t('analytics.collected', 'Collected this month')} m={pick(overview, 'collected_this_month')} money goodUp t={t} />
            <Kpi label={t('analytics.newLeads', 'New leads (30d)')} m={pick(overview, 'new_leads_30d')} goodUp t={t} />
          </div>

          <div className="widgets">
            <div className="widget">
              <div className="widget-label">{t('analytics.revenueTrend', 'Revenue trend (collected vs invoiced)')}</div>
              {trend && trend.length > 0 ? <RevenueTrend data={trend} t={t} /> : <p className="muted">{t('common.noData', 'No data.')}</p>}
            </div>

            <div className="widget">
              <div className="widget-label">{t('analytics.subscriptionMix', 'Subscription mix')}</div>
              {mix && mix.length > 0 ? <MixDonut data={mix} /> : <p className="muted">{t('common.noData', 'No data.')}</p>}
            </div>

            <div className="widget">
              <div className="widget-label">{t('analytics.arAging', 'AR aging')}</div>
              {aging && aging.some((b) => b.amount > 0) ? <Aging data={aging} /> : <p className="muted">{t('common.noData', 'No data.')}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, m, money: isMoney, goodUp, t }: { label: string; m: { value: number; prev?: number }; money?: boolean; goodUp?: boolean; t: (k: string, d?: string) => string }) {
  const hasDelta = m.prev != null
  const diff = hasDelta ? m.value - (m.prev as number) : 0
  const up = diff > 0
  const pct = hasDelta && m.prev ? (diff / (m.prev as number)) * 100 : null
  const good = up === !!goodUp
  return (
    <div className="widget widget-kpi">
      <div className="widget-label">{label}</div>
      <div className="kpi">{isMoney ? money(m.value) : fmtNum(m.value)}</div>
      {hasDelta && diff !== 0 && (
        <div className={'kpi-delta ' + (good ? 'pos' : 'neg')}>
          {up ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />}
          <span>{pct != null ? `${Math.abs(pct).toFixed(0)}%` : (isMoney ? money(Math.abs(diff)) : fmtNum(Math.abs(diff)))} {t('analytics.vsPrev', 'vs prev')}</span>
        </div>
      )}
    </div>
  )
}

function RevenueTrend({ data, t }: { data: TrendPoint[]; t: (k: string, d?: string) => string }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.collected, d.invoiced]))
  return (
    <div>
      <div className="trend">
        {data.map((d, i) => (
          <div className="trend-col" key={i}>
            <div className="trend-bars">
              <div className="trend-bar" style={{ height: (d.collected / max) * 100 + '%', background: PALETTE[0] }} title={`${t('analytics.collected', 'Collected')}: ${money(d.collected)}`} />
              <div className="trend-bar" style={{ height: (d.invoiced / max) * 100 + '%', background: PALETTE[1] }} title={`${t('analytics.invoiced', 'Invoiced')}: ${money(d.invoiced)}`} />
            </div>
            <div className="trend-x">{d.month}</div>
          </div>
        ))}
      </div>
      <div className="legend trend-legend">
        <div className="legend-row"><span className="legend-dot" style={{ background: PALETTE[0] }} /><span className="legend-name">{t('analytics.collected', 'Collected')}</span></div>
        <div className="legend-row"><span className="legend-dot" style={{ background: PALETTE[1] }} /><span className="legend-name">{t('analytics.invoiced', 'Invoiced')}</span></div>
      </div>
    </div>
  )
}

function MixDonut({ data }: { data: MixSlice[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  const R = 42, C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 100 100" className="donut" role="img">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#262D37" strokeWidth="14" />
        {total > 0 && data.map((d, i) => {
          const len = (d.count / total) * C
          const seg = (
            <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="14"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />
          )
          offset += len
          return seg
        })}
        <text x="50" y="53" textAnchor="middle" className="donut-total">{fmtNum(total)}</text>
      </svg>
      <div className="legend">
        {data.map((d, i) => (
          <div key={i} className="legend-row">
            <span className="legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="legend-name" title={d.product}>{d.product}</span>
            <span className="legend-val">{fmtNum(d.count)} · {money(d.mrr)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Aging({ data }: { data: { bucket: string; amount: number }[] }) {
  const max = data.reduce((m, d) => Math.max(m, d.amount), 0)
  return (
    <div className="bars">
      {data.map((d, i) => (
        <div key={i} className="bar-row">
          <span className="bar-label" title={d.bucket}>{d.bucket}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: (max > 0 ? (d.amount / max) * 100 : 0) + '%' }} /></div>
          <span className="bar-val">{money(d.amount)}</span>
        </div>
      ))}
    </div>
  )
}

// Accept {current, '1_30'|d1_30, …} object OR [{bucket, amount}]; produce ordered buckets.
function normalizeAging(raw: any): { bucket: string; amount: number }[] {
  const order: [string, string[]][] = [
    ['Current', ['current']],
    ['1–30', ['1_30', 'd1_30', 'b1_30']],
    ['31–60', ['31_60', 'd31_60', 'b31_60']],
    ['61–90', ['61_90', 'd61_90', 'b61_90']],
    ['90+', ['90_plus', 'd90_plus', 'over_90', 'b90_plus']],
  ]
  if (Array.isArray(raw)) return raw.map((d) => ({ bucket: String(d.bucket ?? d.label ?? '—'), amount: Number(d.amount ?? d.value) || 0 }))
  if (raw && typeof raw === 'object') {
    return order.map(([label, keys]) => ({ bucket: label, amount: Number(keys.map((k) => raw[k]).find((v) => v != null)) || 0 }))
  }
  return []
}
