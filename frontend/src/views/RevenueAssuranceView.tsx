// RevenueAssuranceView — Wave A §3 dashboard for revenue leakage / collections health.
//
// Mirrors the DashboardView (Home) pattern from the kit's ModuleDashboard:
//   crumbs → ViewHead (with Configure button) → KPI strip → 2-col (chart + secondary widget)
//   → attention table.
//
// Doctrine: every value is fetched from a real backend endpoint. If a fetch fails or returns
// nothing meaningful, the widget hides itself entirely — no dashes, no placeholders, no toast-only
// banners. Hide-if-missing per CLAUDE_CODE_ALL_PAGES_PROMPTS.md rule 3.
//
// Endpoints used (all already live in backend/app/routers/analytics.py + billing.py):
//   GET /api/analytics/revenue-trend?months=6   — main chart (collected vs invoiced)
//   GET /api/analytics/overview                 — KPIs (AR outstanding, overdue, collections this/prev month)
//   GET /api/analytics/ar-aging                 — secondary widget (aging buckets)
//   GET /api/invoices?status=OVERDUE            — attention table (overdue invoices)
//
// Permissions: gated on `invoice.view` (the data layer all four widgets live on). The Analytics
// endpoints separately gate on analytics.view server-side; if that 403s a widget simply hides.
import { useEffect, useState } from 'react'
import { ShieldIcon, GearIcon, ReceiptIcon } from '../components/icons'
import { Banknote, AlertTriangle, TrendingUp, BarChart3 } from 'lucide-react'
import { bget, loadCustomers, type Invoice } from '../lib/billing'
import { money } from '../lib/money'
import { fetchCapabilities, can as canDo, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { LineChart } from '../components/charts/LineChart'
import { StatusPill } from '../primitives'
import { PermissionDenied } from '../components/States'
import ViewHead from '../components/ViewHead'

// ── Types ────────────────────────────────────────────────────────────────────
type Overview = {
  mrr?: number
  active_subscriptions?: number
  ar_outstanding?: number
  overdue_total?: number
  overdue_count?: number
  collected_this_month?: number
  collected_prev_month?: number
  [k: string]: any
}

type TrendPoint = { month: string; collected: number; invoiced: number }
type AgingBuckets = { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number }

// Per-widget fetch state machine. 'hide' is silent — the widget is omitted, not greyed out.
type Fetched<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'hide' }

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// ── View ─────────────────────────────────────────────────────────────────────
export default function RevenueAssuranceView({
  token, canConfigure = false, onConfigure,
}: {
  token: string
  configVersion?: number
  canConfigure?: boolean
  onConfigure?: () => void
}) {
  const [caps, setCaps] = useState<Capabilities>(FULL_ACCESS)
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [denied, setDenied] = useState(false)

  // Each widget is independently fetched + hideable.
  const [overview, setOverview] = useState<Fetched<Overview>>({ state: 'loading' })
  const [trend, setTrend] = useState<Fetched<TrendPoint[]>>({ state: 'loading' })
  const [aging, setAging] = useState<Fetched<AgingBuckets>>({ state: 'loading' })
  const [overdue, setOverdue] = useState<Fetched<Invoice[]>>({ state: 'loading' })
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})

  // Permissions — capability check is async, so we wait before showing data widgets to avoid
  // briefly flashing values the role can't actually access.
  useEffect(() => {
    let alive = true
    fetchCapabilities(token).then((c) => {
      if (!alive) return
      setCaps(c); setCapsLoaded(true)
    }).catch(() => { if (alive) setCapsLoaded(true) })
    return () => { alive = false }
  }, [token])

  const canView = canDo(caps, 'invoice', 'view')

  // Trend — main chart. Hide on any failure (including a 0-bucket response).
  useEffect(() => {
    if (!capsLoaded || !canView) return
    let alive = true
    bget<any[]>(token, '/api/analytics/revenue-trend?months=6').then((res) => {
      if (!alive) return
      if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
        if (res.status === 403) console.warn('[revenue-assurance] trend 403 (analytics.view denied)')
        else if (!res.ok) console.error('[revenue-assurance] trend fetch failed', res.status)
        setTrend({ state: 'hide' }); return
      }
      const data: TrendPoint[] = res.data.map((d: any) => ({
        month: String(d.month ?? ''),
        collected: Number(d.collected) || 0,
        invoiced: Number(d.invoiced) || 0,
      }))
      setTrend({ state: 'ok', value: data })
    }).catch((e) => { console.error('[revenue-assurance] trend:', e); if (alive) setTrend({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, capsLoaded, canView])

  // Overview — KPI strip source.
  useEffect(() => {
    if (!capsLoaded || !canView) return
    let alive = true
    bget<Overview>(token, '/api/analytics/overview').then((res) => {
      if (!alive) return
      if (!res.ok || !res.data || typeof res.data !== 'object') {
        if (!res.ok) console.error('[revenue-assurance] overview fetch failed', res.status)
        setOverview({ state: 'hide' }); return
      }
      setOverview({ state: 'ok', value: res.data })
    }).catch((e) => { console.error('[revenue-assurance] overview:', e); if (alive) setOverview({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, capsLoaded, canView])

  // AR aging — secondary widget alongside the trend chart.
  useEffect(() => {
    if (!capsLoaded || !canView) return
    let alive = true
    bget<any>(token, '/api/analytics/ar-aging').then((res) => {
      if (!alive) return
      if (!res.ok || !res.data || typeof res.data !== 'object') {
        if (!res.ok) console.error('[revenue-assurance] aging fetch failed', res.status)
        setAging({ state: 'hide' }); return
      }
      const d = res.data
      const buckets: AgingBuckets = {
        current: Number(d.current) || 0,
        d1_30: Number(d.d1_30) || 0,
        d31_60: Number(d.d31_60) || 0,
        d61_90: Number(d.d61_90) || 0,
        d90_plus: Number(d.d90_plus) || 0,
      }
      const sum = buckets.current + buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90_plus
      if (sum === 0) { setAging({ state: 'hide' }); return }
      setAging({ state: 'ok', value: buckets })
    }).catch((e) => { console.error('[revenue-assurance] aging:', e); if (alive) setAging({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, capsLoaded, canView])

  // Overdue invoices — "Needs attention" table.
  useEffect(() => {
    if (!capsLoaded || !canView) return
    let alive = true
    Promise.all([
      bget<Invoice[]>(token, '/api/invoices?status=OVERDUE'),
      loadCustomers(token),
    ]).then(([res, names]) => {
      if (!alive) return
      setCustomerNames(names)
      if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
        if (!res.ok) console.error('[revenue-assurance] overdue fetch failed', res.status)
        setOverdue({ state: 'hide' }); return
      }
      // Top 8 highest-balance overdue invoices.
      const sorted = [...res.data].sort((a, b) => (b.balance ?? b.total ?? 0) - (a.balance ?? a.total ?? 0))
      setOverdue({ state: 'ok', value: sorted.slice(0, 8) })
    }).catch((e) => { console.error('[revenue-assurance] overdue:', e); if (alive) setOverdue({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, capsLoaded, canView])

  if (capsLoaded && !canView) {
    return <PermissionDenied message="You don't have permission to view revenue assurance." />
  }
  if (denied) return <PermissionDenied />
  // silence unused setter warning (kept for symmetry with other views' deny path)
  void setDenied

  // KPI visibility derived from the overview payload — hide each tile if its underlying number
  // is absent (vs. a real 0, which we show).
  const ovOk = overview.state === 'ok' ? overview.value : null
  const showAr = ovOk && typeof ovOk.ar_outstanding === 'number'
  const showOverdue = ovOk && typeof ovOk.overdue_total === 'number'
  const showOverdueCount = ovOk && typeof ovOk.overdue_count === 'number'
  const showCollected = ovOk && typeof ovOk.collected_this_month === 'number'

  // Collections delta — only meaningful if both this/prev are present.
  const collectedDelta = (ovOk && typeof ovOk.collected_this_month === 'number' && typeof ovOk.collected_prev_month === 'number')
    ? (ovOk.collected_this_month - ovOk.collected_prev_month)
    : null
  const collectedPct = (collectedDelta != null && ovOk?.collected_prev_month)
    ? (collectedDelta / ovOk.collected_prev_month) * 100
    : null

  const kpiVisible = showAr || showOverdue || showOverdueCount || showCollected

  return (
    <div className="view">
      <div className="view-inner gx-dash fade">
        <div className="crumbs">
          <span>Revenue</span>
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>Revenue Assurance</span>
        </div>

        <ViewHead
          icon={<ShieldIcon size={20} />}
          title="Revenue Assurance"
          sub="Collections health · leakage · aged receivables"
          actions={canConfigure && onConfigure ? (
            <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
              <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
            </button>
          ) : undefined}
        />

        {kpiVisible && (
          <div className="kpis">
            {showCollected && (
              <KpiTile
                label="Collected this month"
                icon={<Banknote size={16} />}
                accent
                value={money(ovOk!.collected_this_month!)}
                delta={collectedDelta != null
                  ? { sign: collectedDelta >= 0 ? 'up' : 'down',
                      label: collectedPct != null
                        ? `${Math.abs(collectedPct).toFixed(0)}% vs prev`
                        : `${money(Math.abs(collectedDelta))} vs prev`,
                      good: collectedDelta >= 0 }
                  : null}
              />
            )}
            {showAr && (
              <KpiTile
                label="AR outstanding"
                icon={<TrendingUp size={16} />}
                value={money(ovOk!.ar_outstanding!)}
              />
            )}
            {showOverdue && (
              <KpiTile
                label="Overdue value"
                icon={<AlertTriangle size={16} />}
                value={money(ovOk!.overdue_total!)}
                danger
              />
            )}
            {showOverdueCount && (
              <KpiTile
                label="Overdue invoices"
                icon={<ReceiptIcon size={16} />}
                value={(ovOk!.overdue_count!).toLocaleString()}
              />
            )}
          </div>
        )}

        {/* Two-column body: main chart left, AR aging right. Hide each independently. */}
        {(trend.state !== 'hide' || aging.state !== 'hide') && (
          <div className="cols">
            {trend.state !== 'hide' && (
              <div className="card">
                <div className="card-head">
                  <BarChart3 size={16} style={{ color: 'var(--gx-text-3)' }} />
                  <h3>Revenue trend</h3>
                  <span className="spacer" />
                  <span className="pill pill-neutral">6 mo</span>
                </div>
                <div className="card-pad">
                  {trend.state === 'loading' && <p className="muted">Loading…</p>}
                  {trend.state === 'ok' && (
                    <LineChart
                      series={[
                        { label: 'Collected', values: trend.value.map(b => b.collected), color: 'var(--viz-1)', fillUnder: true },
                        { label: 'Invoiced',  values: trend.value.map(b => b.invoiced),  color: 'var(--viz-2)' },
                      ]}
                    />
                  )}
                </div>
              </div>
            )}

            {aging.state !== 'hide' && (
              <div className="card">
                <div className="card-head">
                  <AlertTriangle size={16} style={{ color: 'var(--gx-text-3)' }} />
                  <h3>AR aging</h3>
                </div>
                <div className="card-pad">
                  {aging.state === 'loading' && <p className="muted">Loading…</p>}
                  {aging.state === 'ok' && <AgingBars buckets={aging.value} />}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Needs-attention table: overdue invoices, sorted by balance. */}
        {overdue.state !== 'hide' && (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <AlertTriangle size={16} style={{ color: 'var(--gx-text-3)' }} />
              <h3>Overdue invoices — needs attention</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              {overdue.state === 'loading' && <p className="muted" style={{ padding: 18 }}>Loading…</p>}
              {overdue.state === 'ok' && (
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Customer</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th className="num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.value.map((inv) => {
                      const cust = inv.customer_id
                        ? (customerNames[inv.customer_id] ?? inv.customer_id.slice(0, 8))
                        : '—'
                      const bal = inv.balance ?? inv.total ?? 0
                      return (
                        <tr key={inv.id}>
                          <td><span className="mono">{inv.number ?? inv.id.slice(0, 8)}</span></td>
                          <td>{cust}</td>
                          <td>{fmtDate(inv.due_at)}</td>
                          <td><StatusPill variant="critical" label={inv.status ?? 'OVERDUE'} size="sm" /></td>
                          <td className="num"><span className="mono tnum">{money(bal)}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function KpiTile({
  label, icon, accent = false, danger = false, value, delta,
}: {
  label: string
  icon: React.ReactNode
  accent?: boolean
  danger?: boolean
  value: string
  delta?: { sign: 'up' | 'down'; label: string; good: boolean } | null
}) {
  const valueColor = danger ? 'var(--gx-danger-fg)' : accent ? 'var(--gx-gold)' : undefined
  return (
    <div className={'kpi' + (accent ? ' kpi--marquee' : '')}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className="klbl">{label}</span>
        <span className="spacer" />
        <span style={{ color: accent ? 'var(--gx-gold)' : 'var(--gx-text-3)' }}>{icon}</span>
      </div>
      <div className="kval tnum" style={{ color: valueColor }}>{value}</div>
      {delta && (
        <div className="kfoot">
          <span className={'kdelta ' + (delta.good ? 'up' : 'down')}>{delta.label}</span>
        </div>
      )}
    </div>
  )
}

// AR aging bars — same visual idiom as AnalyticsView.Aging, but driven by the typed buckets shape.
function AgingBars({ buckets }: { buckets: AgingBuckets }) {
  const rows: { label: string; amount: number; danger?: boolean }[] = [
    { label: 'Current', amount: buckets.current },
    { label: '1–30 days', amount: buckets.d1_30 },
    { label: '31–60 days', amount: buckets.d31_60 },
    { label: '61–90 days', amount: buckets.d61_90 },
    { label: '90+ days', amount: buckets.d90_plus, danger: true },
  ]
  const max = rows.reduce((m, r) => Math.max(m, r.amount), 0)
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div key={i} className="bar-row">
          <span className="bar-label">{r.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: (max > 0 ? (r.amount / max) * 100 : 0) + '%',
                ...(r.danger ? { background: 'var(--gx-danger)' } : null),
              }}
            />
          </div>
          <span className="bar-val">{money(r.amount)}</span>
        </div>
      ))}
    </div>
  )
}
