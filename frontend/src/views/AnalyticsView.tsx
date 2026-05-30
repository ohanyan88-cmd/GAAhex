import { useEffect, useState } from 'react'
import { bget } from '../lib/billing'
import { money } from '../lib/money'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { ChartIcon, ArrowUpIcon, ArrowDownIcon, GearIcon } from '../components/icons'
import { useI18n } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { Donut, type DonutDatum } from '../components/charts/Donut'
import { LineChart } from '../components/charts/LineChart'
import { Spark } from '../components/charts/Spark'

// Analytics (A18 /api/analytics/*) — KPIs + charts re-laid into the kit's `gx-dash` dashboard
// pattern: KPI strip on top (.kpis with sparklines + delta pills), two-column charts body
// (.cols) underneath. Uses Donut / LineChart / Spark from frontend/src/components/charts.
// No charting library; no new CSS. Data hooks & fetches unchanged.
const fmtNum = (n: number) => n.toLocaleString('en-US')

type Overview = Record<string, any>
type TrendPoint = { month: string; collected: number; invoiced: number }
type MixSlice = { product: string; count: number; mrr: number }
type Range = '30d' | 'qtd' | 'ytd'

function pick(o: Overview, key: string): { value: number; prev?: number } {
  const raw = o?.[key]
  if (raw && typeof raw === 'object') return { value: Number(raw.value) || 0, prev: raw.prev != null ? Number(raw.prev) : undefined }
  const p = o?.[`${key}_prev`]
  return { value: Number(raw) || 0, prev: p != null ? Number(p) : undefined }
}

export default function AnalyticsView({ token, configVersion = 0, canConfigure = false, onConfigure }: { token: string; configVersion?: number; canConfigure?: boolean; onConfigure?: () => void }) {
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
  // Range toggle — visual-only for now (backend doesn't accept a period parameter).
  const [range, setRange] = useState<Range>('30d')

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
    <div className="view-inner gx-dash fade">
        <div className="crumbs"><span>Insights</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>

        <ViewHead
          icon={<ChartIcon size={20} />}
          title={cfg.title}
          sub={t('analytics.sub', 'Live KPIs and revenue insight')}
          actions={
            <>
              <div className="seg" role="tablist" aria-label="Range">
                <button type="button" className={range === '30d' ? 'on' : ''} onClick={() => setRange('30d')}>30d</button>
                <button type="button" className={range === 'qtd' ? 'on' : ''} onClick={() => setRange('qtd')}>QTD</button>
                <button type="button" className={range === 'ytd' ? 'on' : ''} onClick={() => setRange('ytd')}>YTD</button>
              </div>
              {canConfigure && onConfigure && (
                <button className="btn btn-ghost btn-sm hide-sm" onClick={onConfigure} title="Configure this page">
                  <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />Configure page
                </button>
              )}
            </>
          }
        />

        {loading && <p className="muted">{t('common.loading', 'Loading…')}</p>}
        {error && <ErrorBanner message={error} onRetry={load} />}
        {unavailable && <EmptyState icon={<ChartIcon size={40} />} title={t('analytics.unavailable', "Analytics aren't available yet")} message={t('analytics.unavailableMsg', 'KPIs and charts will appear here once the analytics service is enabled.')} />}

        {!loading && !unavailable && !error && overview && (
          <>
            {/* KPI strip — first KPI gets the gold marquee accent. */}
            <div className="kpis">
              <Kpi label={t('analytics.mrr', 'MRR')} m={pick(overview, 'mrr')} money goodUp marquee t={t} />
              <Kpi label={t('analytics.activeSubs', 'Active subscriptions')} m={pick(overview, 'active_subscriptions')} goodUp t={t} />
              <Kpi label={t('analytics.arOutstanding', 'AR outstanding')} m={pick(overview, 'ar_outstanding')} money t={t} />
              <Kpi label={t('analytics.overdue', 'Overdue')} m={pick(overview, 'overdue')} money t={t} />
              <Kpi label={t('analytics.collected', 'Collected this month')} m={pick(overview, 'collected_this_month')} money goodUp t={t} />
              <Kpi label={t('analytics.newLeads', 'New leads (30d)')} m={pick(overview, 'new_leads_30d')} goodUp t={t} />
            </div>

            {/* Charts body — two columns: revenue trend (line) left, subscription mix (donut) right.
                AR aging cascades as a full-width card underneath. */}
            <div className="cols">
              <div className="card">
                <div className="card-head">
                  <h3>{t('analytics.revenueTrend', 'Revenue trend (collected vs invoiced)')}</h3>
                </div>
                <div className="card-pad">
                  {trend && trend.length > 0
                    ? <RevenueTrendChart data={trend} t={t} />
                    : <p className="muted">{t('common.noData', 'No data.')}</p>}
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3>{t('analytics.subscriptionMix', 'Subscription mix')}</h3>
                </div>
                <div className="card-pad">
                  {mix && mix.length > 0
                    ? <MixDonut data={mix} />
                    : <p className="muted">{t('common.noData', 'No data.')}</p>}
                </div>
              </div>
            </div>

            {aging && aging.some((b) => b.amount > 0) && (
              <div className="card" style={{ marginTop: 18 }}>
                <div className="card-head">
                  <h3>{t('analytics.arAging', 'AR aging')}</h3>
                </div>
                <div className="card-pad">
                  <Aging data={aging} />
                </div>
              </div>
            )}
          </>
        )}
    </div>
  )
}

// ───────────────────────── KPI tile (kit shape) ─────────────────────────
function Kpi({
  label, m, money: isMoney, goodUp, marquee, t,
}: {
  label: string
  m: { value: number; prev?: number }
  money?: boolean
  goodUp?: boolean
  marquee?: boolean
  t: (k: string, d?: string) => string
}) {
  const hasDelta = m.prev != null
  const diff = hasDelta ? m.value - (m.prev as number) : 0
  const up = diff > 0
  const pct = hasDelta && m.prev ? (diff / (m.prev as number)) * 100 : null
  const good = up === !!goodUp
  // Synthesize a small sparkline from value/prev so the strip looks lively even without
  // a historical series. TODO: replace with a real series when the backend returns it.
  const sparkValues: number[] | undefined = hasDelta
    ? [(m.prev as number), m.value]
    : undefined

  const cls = 'kpi' + (marquee ? ' kpi--marquee' : '')
  const sparkColor = marquee
    ? 'var(--gx-gold)'
    : !good && hasDelta
      ? 'var(--gx-danger)'
      : 'var(--gx-success)'

  return (
    <div className={cls}>
      <div className="klbl">{label}</div>
      <div className="kval tnum">{isMoney ? money(m.value) : fmtNum(m.value)}</div>
      <div className="kfoot">
        {hasDelta && diff !== 0 ? (
          <span className={'kdelta ' + (good ? 'up' : 'down')}>
            {up ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />}
            {pct != null
              ? `${Math.abs(pct).toFixed(0)}% ${t('analytics.vsPrev', 'vs prev')}`
              : `${isMoney ? money(Math.abs(diff)) : fmtNum(Math.abs(diff))} ${t('analytics.vsPrev', 'vs prev')}`}
          </span>
        ) : (
          <span className="kdelta" style={{ color: 'var(--gx-text-3)' }}>—</span>
        )}
        <Spark values={sparkValues} color={sparkColor} />
      </div>
    </div>
  )
}

// Revenue trend as a multi-series LineChart (Collected + Invoiced).
function RevenueTrendChart({ data, t }: { data: TrendPoint[]; t: (k: string, d?: string) => string }) {
  const collected = data.map((d) => d.collected)
  const invoiced = data.map((d) => d.invoiced)
  return (
    <LineChart
      series={[
        { label: t('analytics.collected', 'Collected'), values: collected, color: 'var(--viz-1)', fillUnder: true },
        { label: t('analytics.invoiced', 'Invoiced'), values: invoiced, color: 'var(--viz-2)' },
      ]}
    />
  )
}

function MixDonut({ data }: { data: MixSlice[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  const donutData: DonutDatum[] = data.map((d) => ({ label: d.product, value: d.count }))
  return (
    <Donut data={donutData} centerLabel={fmtNum(total)} centerCaption="total" />
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
