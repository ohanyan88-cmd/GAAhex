import { useEffect, useMemo, useState } from 'react'
import { BarChart3, TrendingUp, Users, Banknote, AlertTriangle, PieChart, ArrowRight, Calendar, Activity, Inbox, CheckSquare, Settings } from 'lucide-react'
import { GearIcon, ChartIcon } from '../components/icons'
import { money } from '../lib/money'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { BASE, authH } from '../lib/billing'
import { DASHBOARD_BULK, PARETO_TOP_N } from '../lib/pagination'
import { loadSelected, saveSelected } from '../lib/dashboard-catalog'
import ChartPicker from '../components/ChartPicker'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import { useAuth } from '../context/AuthContext'
import { useFetch, useFetched, type Fetched } from '../hooks/useFetch'
import { PLAN_COLORS, type Range } from './dashboard/types'
import {
  ChartSkeleton, BarChart, AreaChart, LineChart, DonutChart,
  HorizontalBarChart, FunnelChart, DashboardCard,
  GanttChart, ParetoChart, SankeyChart, GeoMap, NetGrowthChart,
  ComparisonCard, GroupedBarChart, MultiLineChart, HeatmapChart,
  StatusBreakdown,
} from './dashboard/charts'

export default function DashboardView({ canConfigure = false, onConfigure, onNavigate, capabilities }: {
  configVersion?: number
  canConfigure?: boolean; onConfigure?: () => void
  onNavigate?: (target: { type: string }) => void
  capabilities?: Capabilities  // SM-2 — App passes its single capabilities snapshot
}) {
  // SM-1 — token + user state consumed from AuthContext instead of being
  // prop-drilled. The view used to start with `token: string` in its props.
  const { token } = useAuth()
  const [range, setRange] = useState<Range>('30d')
  // SM-2 — use App's capabilities prop instead of refetching. capsLoaded stays
  // a flag indicating "App finished its initial capabilities fetch" — we infer
  // it from the prop being present (non-FULL_ACCESS placeholder is also ok).
  const caps: Capabilities = capabilities ?? FULL_ACCESS
  const capsLoaded = capabilities !== undefined

  // DF-1/DF-2 — 23 charts, 23 useFetched calls. Replaces 23 useEffect+alive
  // blocks. Each useFetched returns the legacy `Fetched<T>` discriminated
  // union so the body code (`overview.state === 'ok' ? overview.value : ...`)
  // works unchanged.
  const months    = range === '7d' ? 3 : range === '30d' ? 6 : range === 'qtd' ? 6 : 12
  const weeksN    = range === '7d' ? 6 : range === '30d' ? 10 : range === 'qtd' ? 13 : 26
  const weeksN2   = range === '7d' ? 4 : range === '30d' ? 8 : range === 'qtd' ? 13 : 26
  const daysN     = range === '7d' ? 28 : range === '30d' ? 60 : range === 'qtd' ? 90 : 180
  const nonEmptyArr = (d: unknown) => Array.isArray(d) && d.length > 0

  const overview    = useFetched<any>('/api/analytics/overview')
  const revTrend    = useFetched<any[]>(`/api/analytics/revenue-trend?months=${months}`, nonEmptyArr)
  const subMix      = useFetched<any[]>('/api/analytics/subscription-mix', nonEmptyArr)
  const arAging     = useFetched<any>('/api/analytics/ar-aging')
  const customerRaw = useFetch<any[]>(`/api/analytics/weekly-trend?weeks=${weeksN}`)
  const funnelRaw   = useFetch<any>(null)  // funnel is 4 parallel fetches — kept in a custom useEffect below
  const compare     = useFetched<any>('/api/analytics/comparisons')
  const weekly      = useFetched<any[]>(`/api/analytics/weekly-trend?weeks=${weeksN2}`, nonEmptyArr)
  const heatmap     = useFetched<any[]>(`/api/analytics/daily-heatmap?days=${daysN}`, nonEmptyArr)
  const statusBreak = useFetched<any>('/api/analytics/status-breakdown')
  const taskAging   = useFetched<any>('/api/analytics/task-aging')
  const ticketAging = useFetched<any>('/api/analytics/ticket-aging')
  const riskHeatmap = useFetched<any>('/api/analytics/risk-heatmap',
    (d) => d != null && Object.values(d as Record<string, unknown>).reduce((s: number, v) => s + (Number(v) || 0), 0) > 0)
  const leadSources = useFetched<any>('/api/analytics/leads-by-source',
    (d) => d != null && Object.keys(d as object).length > 0)
  const salesByUser = useFetched<any>('/api/analytics/sales-by-user',
    (d) => d != null && Object.keys(d as object).length > 0)
  const ragHealth   = useFetched<any>('/api/analytics/rag-health',
    (d: any) => d != null && ((d.red ?? 0) + (d.amber ?? 0) + (d.green ?? 0)) > 0)
  const gantt       = useFetched<any[]>('/api/analytics/gantt', nonEmptyArr)
  const pareto      = useFetched<any[]>(`/api/analytics/pareto/lead?group_field=source&limit=${PARETO_TOP_N}`, nonEmptyArr)
  const sankey      = useFetched<any>('/api/analytics/sankey-leads',
    (d: any) => d?.nodes ? d.nodes.reduce((s: number, n: any) => s + (Number(n.value) || 0), 0) > 0 : false)
  const geoPoints   = useFetched<any[]>('/api/analytics/geo-points', nonEmptyArr)
  const netGrowth   = useFetched<any[]>(`/api/analytics/net-subscriber-growth?weeks=${weeksN}`, nonEmptyArr)

  // /api/metrics/revenue?range= returns { buckets: [...] }, so extract via useMemo.
  const revMetricsRaw = useFetch<{ buckets?: any[] }>(`/api/metrics/revenue?range=${range}`)
  const revMetrics: Fetched<any[]> = useMemo(() => {
    if (revMetricsRaw.loading) return { state: 'loading' }
    if (!revMetricsRaw.ok || !revMetricsRaw.data) return { state: 'hide' }
    const buckets = revMetricsRaw.data.buckets ?? []
    return buckets.length > 0 ? { state: 'ok', value: buckets } : { state: 'hide' }
  }, [revMetricsRaw.loading, revMetricsRaw.ok, revMetricsRaw.data])

  // Customer growth — extract labels/new/churned arrays from the weekly-trend response.
  const customerData: Fetched<{ new_: number[]; churned: number[]; labels: string[] }> = useMemo(() => {
    if (customerRaw.loading) return { state: 'loading' }
    if (!customerRaw.ok || !Array.isArray(customerRaw.data) || customerRaw.data.length === 0) return { state: 'hide' }
    const labels  = customerRaw.data.map((b: any) => String(b.week))
    const new_    = customerRaw.data.map((b: any) => Number(b.customers) || 0)
    const churned = customerRaw.data.map((b: any) => Number(b.churns) || 0)
    return { state: 'ok', value: { new_, churned, labels } }
  }, [customerRaw.loading, customerRaw.ok, customerRaw.data])

  // Funnel — 4 parallel fetches; useFetch can't compose them, so keep the
  // custom useEffect for this one. Marker so a future migration finds it.
  const [funnel, setFunnel] = useState<Fetched<any[]>>({ state: 'loading' })
  void funnelRaw  // keep the import live; future migration may use useFetches() style API

  // Layout — which chart IDs the user has chosen
  const [selected, setSelected] = useState<Set<string>>(() => loadSelected())
  const [pickerOpen, setPickerOpen] = useState(false)
  const isShown = (id: string) => selected.has(id)

  // SM-2 — capabilities now flow as a prop from App.tsx; no per-view refetch.

  // DF-1/DF-2 — 22 useEffect+fetch+alive blocks deleted. They've all been
  // replaced with useFetch / useFetched calls above. Funnel (4 parallel
  // fetches) is the one exception — see the dedicated block below.
  useEffect(() => {
    if (!token) return
    let alive = true
    Promise.all([
      fetch(`${BASE}/api/leads?limit=${DASHBOARD_BULK}`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
      fetch(`${BASE}/api/opportunities?limit=${DASHBOARD_BULK}`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
      fetch(`${BASE}/api/deals?limit=${DASHBOARD_BULK}`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
      fetch(`${BASE}/api/customers?limit=${DASHBOARD_BULK}`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
    ]).then(([leads, opps, deals, customers]) => {
      if (!alive) return
      const stages = [
        { label: 'Leads', value: (Array.isArray(leads) ? leads : leads?.items ?? []).length },
        { label: 'Opportunities', value: (Array.isArray(opps) ? opps : opps?.items ?? []).length },
        { label: 'Deals', value: (Array.isArray(deals) ? deals : deals?.items ?? []).length },
        { label: 'Customers', value: (Array.isArray(customers) ? customers : customers?.items ?? []).length },
      ]
      if (stages[0].value > 0) setFunnel({ state: 'ok', value: stages })
      else setFunnel({ state: 'hide' })
    }).catch(() => { if (alive) setFunnel({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, range])

  const showRevenue = capsLoaded && can(caps, 'invoice', 'view')
  const ov = overview.state === 'ok' ? overview.value : null

  // KPIs from overview data — only rendered when data is available and user can view revenue
  const kpis: KPISpec[] | undefined = (isShown('kpi-strip') && ov && showRevenue) ? [
    { label: 'MRR',                 value: money(ov.mrr),                  subtitle: `${ov.active_subscriptions} active subs` },
    { label: 'AR Outstanding',      value: money(ov.ar_outstanding),        subtitle: `${ov.overdue_count} overdue`, warning: ov.overdue_count > 0 },
    { label: 'Collected This Month',value: money(ov.collected_this_month),  subtitle: `vs ${money(ov.collected_prev_month)} last month` },
    { label: 'New Leads (30d)',      value: ov.new_leads_30d,               subtitle: `vs ${ov.new_leads_prev_30d} prior 30d` },
  ] : undefined

  return (
    <PageShell
      type="ANALYTICS"
      breadcrumb={['Analytics & AI', 'Operational Dashboards']}
      icon={<ChartIcon size={18} />}
      title="Dashboards"
      subtitle="Operational KPI dashboards"
      kpis={kpis}
      secondaryActions={[
        { label: `7d`,  onClick: () => setRange('7d') },
        { label: `30d`, onClick: () => setRange('30d') },
        { label: `QTD`, onClick: () => setRange('qtd') },
        { label: `YTD`, onClick: () => setRange('ytd') },
        { label: `Customize (${selected.size})`, onClick: () => setPickerOpen(true) },
      ]}
    >
      <div style={{ maxWidth: 1400, width: '100%' }}>

        {/* Row 1: Revenue bar + Subscription donut */}
        {(isShown('revenue-bar') || isShown('sub-donut')) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 'var(--gx-space-18)', marginBottom: 'var(--gx-space-18)' }}>

            {isShown('revenue-bar') && showRevenue && (
              <DashboardCard title="Revenue vs Churn" icon={BarChart3}>
                {revTrend.state === 'loading' && <ChartSkeleton />}
                {revTrend.state === 'ok' && (
                  <>
                    <BarChart data={revTrend.value.map(b => ({
                      label: b.month, primary: b.collected, secondary: b.churn ?? 0
                    }))} />
                    <div style={{ display: 'flex', gap: 'var(--gx-space-5)', marginTop: 'var(--gx-space-5)', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {/* D18: legend swatch matches BarChart primary fill → --gx-chart-active. */}
                        <span style={{ width: 'var(--gx-space-5)', height: 'var(--gx-space-5)', background: 'var(--gx-chart-active)', borderRadius: 2 }} />Collected
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 'var(--gx-space-5)', height: 'var(--gx-space-5)', background: 'var(--gx-gold)', borderRadius: 2 }} />Churn events
                      </span>
                    </div>
                  </>
                )}
              </DashboardCard>
            )}

            {isShown('sub-donut') && (
              <DashboardCard title="Subscription Mix" icon={PieChart}>
                {subMix.state === 'loading' && <ChartSkeleton h={120} />}
                {subMix.state === 'ok' && (
                  <DonutChart slices={subMix.value.map((s, i) => ({
                    label: s.product_name ?? 'Unknown',
                    value: s.count,
                    color: PLAN_COLORS[i % PLAN_COLORS.length],
                  }))} />
                )}
                {subMix.state === 'hide' && <div className="muted" style={{ padding: 'var(--gx-space-18)', fontSize: 'var(--gx-text-13)' }}>No subscription data</div>}
              </DashboardCard>
            )}
          </div>
        )}

        {/* Row 2: Revenue area + Customer growth line */}
        {(isShown('payment-area') || isShown('customer-line')) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-18)', marginBottom: 'var(--gx-space-18)' }}>

          {isShown('payment-area') && showRevenue && (
            <DashboardCard title="Payment Trend" icon={TrendingUp}>
              {revTrend.state === 'loading' && <ChartSkeleton h={120} />}
              {revTrend.state === 'ok' && (
                <AreaChart data={revTrend.value.map(b => ({ label: b.month, value: b.collected }))} />
              )}
            </DashboardCard>
          )}

          {isShown('customer-line') && (
          <DashboardCard title="New vs Churned Subs" icon={Users}>
            {customerData.state === 'loading' && <ChartSkeleton h={120} />}
            {customerData.state === 'ok' && (
              <LineChart
                data={customerData.value.labels.map((l, i) => ({
                  label: l, v1: customerData.value.new_[i], v2: customerData.value.churned[i]
                }))}
                series1Label="New customers"
                series2Label="Churns"
              />
            )}
            {customerData.state === 'hide' && <div className="muted" style={{ padding: 'var(--gx-space-18)', fontSize: 'var(--gx-text-13)' }}>No customer activity data</div>}
          </DashboardCard>
          )}
        </div>
        )}

        {/* Row 3: AR aging + Revenue metrics line + Funnel */}
        {(isShown('ar-aging') || isShown('monthly-revenue') || isShown('funnel')) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--gx-space-18)', marginBottom: 'var(--gx-space-18)' }}>

          {isShown('ar-aging') && showRevenue && (
            <DashboardCard title="AR Aging" icon={AlertTriangle}>
              {arAging.state === 'loading' && <ChartSkeleton h={100} />}
              {/* D18: AR aging buckets — Current (success), 1-30 = sequential intermediate (slate default, not yet a warning), 31-60 (warning), 61-90 (danger-adjacent, was inline #f97316 → semantic warning is closest), 90+ (danger). */}
              {arAging.state === 'ok' && (
                <HorizontalBarChart buckets={[
                  { label: 'Current',   value: arAging.value.current, color: 'var(--gx-success)' },
                  { label: '1-30 days', value: arAging.value.d1_30,   color: 'var(--gx-chart-default)' },
                  { label: '31-60 days',value: arAging.value.d31_60,  color: 'var(--gx-warning)' },
                  { label: '61-90 days',value: arAging.value.d61_90,  color: 'var(--gx-warning)' },
                  { label: '90+ days',  value: arAging.value.d90_plus,color: 'var(--gx-danger)' },
                ].filter(b => b.value > 0)} />
              )}
              {arAging.state === 'hide' && <div className="muted" style={{ padding: 'var(--gx-space-18)', fontSize: 'var(--gx-text-13)' }}>No outstanding AR</div>}
            </DashboardCard>
          )}

          {isShown('monthly-revenue') && showRevenue && (
            <DashboardCard title="Monthly Revenue vs Prior" icon={BarChart3}>
              {revMetrics.state === 'loading' && <ChartSkeleton h={100} />}
              {revMetrics.state === 'ok' && (
                <BarChart data={revMetrics.value.map((b: any) => ({
                  label: b.month, primary: b.revenue, secondary: b.churn
                }))} />
              )}
            </DashboardCard>
          )}

          {isShown('funnel') && (
          <DashboardCard title="Sales Funnel" icon={ArrowRight}>
            {funnel.state === 'loading' && <ChartSkeleton h={100} />}
            {funnel.state === 'ok' && <FunnelChart stages={funnel.value} />}
            {funnel.state === 'hide' && <div className="muted" style={{ padding: 'var(--gx-space-18)', fontSize: 'var(--gx-text-13)' }}>No pipeline data</div>}
          </DashboardCard>
          )}
        </div>
        )}

        {/* === SECTION: Week vs Week Comparisons === */}
        {isShown('wow-cards') && compare.state === 'ok' && (
          <>
            <div style={{ marginTop: 'var(--gx-space-6)', marginBottom: 'var(--gx-space-7)', fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-bold)', color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Week vs Last Week
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--gx-space-6)', marginBottom: 'var(--gx-space-18)' }}>
              <ComparisonCard label="Revenue (paid)"    thisVal={compare.value.week.revenue.this}      lastVal={compare.value.week.revenue.last}      formatter={(n) => money(n)} />
              <ComparisonCard label="Invoiced"          thisVal={compare.value.week.invoiced.this}     lastVal={compare.value.week.invoiced.last}     formatter={(n) => money(n)} />
              <ComparisonCard label="Payments"          thisVal={compare.value.week.payments.this}     lastVal={compare.value.week.payments.last} />
              <ComparisonCard label="New customers"     thisVal={compare.value.week.new_customers.this} lastVal={compare.value.week.new_customers.last} />
              <ComparisonCard label="New leads"         thisVal={compare.value.week.new_leads.this}    lastVal={compare.value.week.new_leads.last} />
              <ComparisonCard label="Churned subs"      thisVal={compare.value.week.churned.this}      lastVal={compare.value.week.churned.last}      invertColor />
              <ComparisonCard label="Tickets opened"    thisVal={compare.value.week.tickets.this}      lastVal={compare.value.week.tickets.last}      invertColor />
              <ComparisonCard label="Workitems done"    thisVal={compare.value.week.workitems_done.this} lastVal={compare.value.week.workitems_done.last} />
            </div>
          </>
        )}

        {/* === SECTION: Month vs Last Month === */}
        {isShown('mom-cards') && compare.state === 'ok' && (
          <>
            <div style={{ marginTop: 'var(--gx-space-4)', marginBottom: 'var(--gx-space-7)', fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-bold)', color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Month vs Last Month
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--gx-space-6)', marginBottom: 'var(--gx-space-18)' }}>
              <ComparisonCard label="Revenue (paid)"    thisVal={compare.value.month.revenue.this}      lastVal={compare.value.month.revenue.last}      formatter={(n) => money(n)} />
              <ComparisonCard label="Invoiced"          thisVal={compare.value.month.invoiced.this}     lastVal={compare.value.month.invoiced.last}     formatter={(n) => money(n)} />
              <ComparisonCard label="Payments"          thisVal={compare.value.month.payments.this}     lastVal={compare.value.month.payments.last} />
              <ComparisonCard label="New customers"     thisVal={compare.value.month.new_customers.this} lastVal={compare.value.month.new_customers.last} />
              <ComparisonCard label="New leads"         thisVal={compare.value.month.new_leads.this}    lastVal={compare.value.month.new_leads.last} />
              <ComparisonCard label="Churned subs"      thisVal={compare.value.month.churned.this}      lastVal={compare.value.month.churned.last}      invertColor />
              <ComparisonCard label="Tickets opened"    thisVal={compare.value.month.tickets.this}      lastVal={compare.value.month.tickets.last}      invertColor />
              <ComparisonCard label="Workitems done"    thisVal={compare.value.month.workitems_done.this} lastVal={compare.value.month.workitems_done.last} />
            </div>
          </>
        )}

        {/* === SECTION: Quarter & Year Comparisons === */}
        {(isShown('qoq-bars') || isShown('yoy-bars')) && compare.state === 'ok' && (
          <>
            <div style={{ marginTop: 'var(--gx-space-4)', marginBottom: 'var(--gx-space-7)', fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-bold)', color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Quarter & Year Comparisons
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-18)', marginBottom: 'var(--gx-space-18)' }}>
              {isShown('qoq-bars') && (
              <DashboardCard title="Quarter vs Last Quarter" icon={Calendar}>
                <GroupedBarChart data={[
                  { label: 'Revenue',    thisVal: compare.value.quarter.revenue.this / 100,   lastVal: compare.value.quarter.revenue.last / 100 },
                  { label: 'Payments',   thisVal: compare.value.quarter.payments.this,        lastVal: compare.value.quarter.payments.last },
                  { label: 'Customers',  thisVal: compare.value.quarter.new_customers.this,   lastVal: compare.value.quarter.new_customers.last },
                  { label: 'Leads',      thisVal: compare.value.quarter.new_leads.this,       lastVal: compare.value.quarter.new_leads.last },
                  { label: 'Churn',      thisVal: compare.value.quarter.churned.this,         lastVal: compare.value.quarter.churned.last },
                  { label: 'Tickets',    thisVal: compare.value.quarter.tickets.this,         lastVal: compare.value.quarter.tickets.last },
                ]} />
              </DashboardCard>
              )}
              {isShown('yoy-bars') && (
              <DashboardCard title="Year vs Last Year (YoY)" icon={Calendar}>
                <GroupedBarChart data={[
                  { label: 'Revenue',    thisVal: compare.value.year.revenue.this / 100,      lastVal: compare.value.year.revenue.last / 100 },
                  { label: 'Payments',   thisVal: compare.value.year.payments.this,           lastVal: compare.value.year.payments.last },
                  { label: 'Customers',  thisVal: compare.value.year.new_customers.this,      lastVal: compare.value.year.new_customers.last },
                  { label: 'Leads',      thisVal: compare.value.year.new_leads.this,          lastVal: compare.value.year.new_leads.last },
                  { label: 'Churn',      thisVal: compare.value.year.churned.this,            lastVal: compare.value.year.churned.last },
                  { label: 'Tickets',    thisVal: compare.value.year.tickets.this,            lastVal: compare.value.year.tickets.last },
                ]} />
              </DashboardCard>
              )}
            </div>
          </>
        )}

        {/* === SECTION: Weekly Trend (multi-series) + Heatmap === */}
        {(isShown('weekly-trend') || isShown('heatmap')) && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--gx-space-18)', marginBottom: 'var(--gx-space-18)' }}>
          {isShown('weekly-trend') && (
          <DashboardCard title="Weekly Trend — Revenue, Customers, Churn" icon={TrendingUp}>
            {weekly.state === 'loading' && <ChartSkeleton h={130} />}
            {/* D18: three distinct-identity series in one multi-line chart. Revenue = primary drillable series → --gx-chart-active. New customers (was inline #22c55e) is the "good growth" line — keep semantic success. Churns stays on semantic danger. */}
            {weekly.state === 'ok' && (
              <MultiLineChart
                labels={weekly.value.map((w: any) => w.week)}
                series={[
                  { name: 'Revenue (x1k AMD)',  values: weekly.value.map((w: any) => Math.round(w.revenue / 100000)), color: 'var(--gx-chart-active)' },
                  { name: 'New customers',      values: weekly.value.map((w: any) => w.customers),                    color: 'var(--gx-success)' },
                  { name: 'Churns',             values: weekly.value.map((w: any) => w.churns),                       color: 'var(--gx-danger)' },
                ]}
              />
            )}
            {weekly.state === 'hide' && <div className="muted" style={{ padding: 'var(--gx-space-18)', fontSize: 'var(--gx-text-13)' }}>No weekly data</div>}
          </DashboardCard>
          )}

          {isShown('heatmap') && (
          <DashboardCard title="Daily Payment Heatmap" icon={Activity}>
            {heatmap.state === 'loading' && <ChartSkeleton h={130} />}
            {heatmap.state === 'ok' && <HeatmapChart data={heatmap.value} />}
            {heatmap.state === 'hide' && <div className="muted" style={{ padding: 'var(--gx-space-18)', fontSize: 'var(--gx-text-13)' }}>No payment activity</div>}
          </DashboardCard>
          )}
        </div>
        )}

        {/* === SECTION: Status Breakdown (individually toggleable) === */}
        {statusBreak.state === 'ok' && (isShown('status-workitems') || isShown('status-tickets') || isShown('status-invoices') || isShown('status-subs')) && (
          <>
            <div style={{ marginTop: 'var(--gx-space-4)', marginBottom: 'var(--gx-space-7)', fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-bold)', color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Current Status Breakdown
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--gx-space-18)', marginBottom: 'var(--gx-space-18)' }}>
              {isShown('status-workitems') && (
              <DashboardCard title="Workitems by Status" icon={CheckSquare}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.workitems).reduce((s: number, v) => s + (v as number), 0) as number}
                  // D18: IN_PROGRESS = actively-being-worked status → --gx-chart-active (interactive). Other states use slate (todo), semantic danger (blocked), semantic success (done).
                  buckets={[
                    { label: 'TODO',        value: statusBreak.value.workitems.TODO ?? 0,        color: 'var(--gx-text-3)' },
                    { label: 'In Progress', value: statusBreak.value.workitems.IN_PROGRESS ?? 0, color: 'var(--gx-chart-active)' },
                    { label: 'Blocked',     value: statusBreak.value.workitems.BLOCKED ?? 0,     color: 'var(--gx-danger)' },
                    { label: 'Done',        value: statusBreak.value.workitems.DONE ?? 0,        color: 'var(--gx-success)' },
                  ]}
                />
              </DashboardCard>
              )}

              {isShown('status-tickets') && (
              <DashboardCard title="Tickets by Status" icon={Inbox}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.tickets).reduce((s: number, v) => s + (v as number), 0) as number}
                  // D18: OPEN = the active drillable ticket bucket → --gx-chart-active. Pending (warning), Resolved (success), Closed (slate).
                  buckets={[
                    { label: 'Open',     value: statusBreak.value.tickets.OPEN ?? 0,        color: 'var(--gx-chart-active)' },
                    { label: 'Pending',  value: statusBreak.value.tickets.PENDING ?? 0,     color: 'var(--gx-warning)' },
                    { label: 'Resolved', value: statusBreak.value.tickets.RESOLVED ?? 0,    color: 'var(--gx-success)' },
                    { label: 'Closed',   value: statusBreak.value.tickets.CLOSED ?? 0,      color: 'var(--gx-text-3)' },
                  ]}
                />
              </DashboardCard>
              )}

              {isShown('status-invoices') && (
              <DashboardCard title="Invoices by Status" icon={Banknote}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.invoices).reduce((s: number, v) => s + (v as number), 0) as number}
                  // D18: ISSUED = the active drillable invoice bucket awaiting payment → --gx-chart-active. Paid (success), Overdue (danger), Draft/Void (slate).
                  buckets={[
                    { label: 'Draft',   value: statusBreak.value.invoices.DRAFT ?? 0,   color: 'var(--gx-text-3)' },
                    { label: 'Issued',  value: statusBreak.value.invoices.ISSUED ?? 0,  color: 'var(--gx-chart-active)' },
                    { label: 'Paid',    value: statusBreak.value.invoices.PAID ?? 0,    color: 'var(--gx-success)' },
                    { label: 'Overdue', value: statusBreak.value.invoices.OVERDUE ?? 0, color: 'var(--gx-danger)' },
                    { label: 'Void',    value: statusBreak.value.invoices.VOID ?? 0,    color: 'var(--gx-text-3)' },
                  ]}
                />
              </DashboardCard>
              )}

              {isShown('status-subs') && (
              <DashboardCard title="Subscriptions by Status" icon={Users}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.subscriptions).reduce((s: number, v) => s + (v as number), 0) as number}
                  buckets={[
                    { label: 'Active',    value: statusBreak.value.subscriptions.ACTIVE ?? 0,    color: 'var(--gx-success)' },
                    { label: 'Suspended', value: statusBreak.value.subscriptions.SUSPENDED ?? 0, color: 'var(--gx-warning)' },
                    { label: 'Cancelled', value: statusBreak.value.subscriptions.CANCELLED ?? 0, color: 'var(--gx-danger)' },
                  ]}
                />
              </DashboardCard>
              )}
            </div>
          </>
        )}

        {/* === SECTION: New charts (RAG, aging, risk, leads, sales) === */}
        {(isShown('rag-health') || isShown('task-aging') || isShown('issue-aging') || isShown('risk-heatmap') || isShown('lead-source-donut') || isShown('salesperson-rank')) && (
          <>
            <div style={{ marginTop: 'var(--gx-space-4)', marginBottom: 'var(--gx-space-7)', fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-bold)', color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Execution Insights
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--gx-space-18)', marginBottom: 'var(--gx-space-18)' }}>

              {isShown('rag-health') && ragHealth.state === 'ok' && (
                <DashboardCard title="RAG Execution Health" icon={AlertTriangle}>
                  <DonutChart slices={[
                    { label: 'Red',   value: ragHealth.value.red,   color: 'var(--gx-danger)' },
                    { label: 'Amber', value: ragHealth.value.amber, color: 'var(--gx-warning)' },
                    { label: 'Green', value: ragHealth.value.green, color: 'var(--gx-success)' },
                  ].filter(s => s.value > 0)} />
                </DashboardCard>
              )}

              {isShown('task-aging') && taskAging.state === 'ok' && (
                <DashboardCard title="Task Aging" icon={CheckSquare}>
                  {/* D18: aging sequence (0-7 success, 8-15 intermediate slate, 16-30 warning, 30+ danger). 8-15 was --azure-400 (Tier-0 violation) — now slate default. */}
                  <HorizontalBarChart buckets={[
                    { label: '0-7 days',   value: taskAging.value.d0_7,     color: 'var(--gx-success)' },
                    { label: '8-15 days',  value: taskAging.value.d8_15,    color: 'var(--gx-chart-default)' },
                    { label: '16-30 days', value: taskAging.value.d16_30,   color: 'var(--gx-warning)' },
                    { label: '30+ days',   value: taskAging.value.d30_plus, color: 'var(--gx-danger)' },
                  ].filter(b => b.value > 0).map(b => ({ ...b, value: b.value * 100 }))} />
                  <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-4)' }}>Open workitems by age</div>
                </DashboardCard>
              )}

              {isShown('issue-aging') && ticketAging.state === 'ok' && (
                <DashboardCard title="Issue Aging" icon={Inbox}>
                  {/* D18: aging sequence mirror of Task Aging — 8-15 was --azure-400 (Tier-0 violation) → --gx-chart-default (slate). */}
                  <HorizontalBarChart buckets={[
                    { label: '0-7 days',   value: ticketAging.value.d0_7,     color: 'var(--gx-success)' },
                    { label: '8-15 days',  value: ticketAging.value.d8_15,    color: 'var(--gx-chart-default)' },
                    { label: '16-30 days', value: ticketAging.value.d16_30,   color: 'var(--gx-warning)' },
                    { label: '30+ days',   value: ticketAging.value.d30_plus, color: 'var(--gx-danger)' },
                  ].filter(b => b.value > 0).map(b => ({ ...b, value: b.value * 100 }))} />
                  <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-4)' }}>Open tickets by age</div>
                </DashboardCard>
              )}

              {isShown('risk-heatmap') && riskHeatmap.state === 'ok' && (
                <DashboardCard title="Risk Heat Map" icon={AlertTriangle}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(3, 1fr)', gap: 3, padding: 'var(--gx-space-3)' }}>
                    <div></div>
                    {['Low', 'Medium', 'High'].map(im => (
                      <div key={im} style={{ fontSize: 'var(--gx-text-10)', textAlign: 'center', color: 'var(--gx-text-3)', padding: 'var(--gx-space-2) 0' }}>{im}</div>
                    ))}
                    {['high', 'medium', 'low'].map(li => (
                      <>
                        <div key={li} style={{ fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)', alignSelf: 'center', paddingRight: 'var(--gx-space-3)', textAlign: 'right' }}>{li[0].toUpperCase() + li.slice(1)}</div>
                        {['low', 'medium', 'high'].map(im => {
                          const v = Number(riskHeatmap.value[`${li}_${im}`] ?? 0)
                          const score = (li === 'high' ? 2 : li === 'medium' ? 1 : 0) + (im === 'high' ? 2 : im === 'medium' ? 1 : 0)
                          const bg = score >= 3 ? 'rgba(239,68,68,0.7)'
                                  : score >= 2 ? 'rgba(245,158,11,0.7)'
                                  : score >= 1 ? 'rgba(234,179,8,0.5)'
                                  : 'rgba(34,197,94,0.5)'
                          return (
                            <div key={`${li}-${im}`} style={{
                              background: v > 0 ? bg : 'var(--gx-surface-2)',
                              height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              borderRadius: 'var(--gx-radius-xs)', fontSize: 'var(--gx-text-md)', fontWeight: 'var(--gx-weight-bold)', color: v > 0 ? 'var(--gx-on-primary)' : 'var(--gx-text-3)',
                            }}>{v}</div>
                          )
                        })}
                      </>
                    ))}
                  </div>
                  <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-3)', textAlign: 'center' }}>Impact -&gt;</div>
                </DashboardCard>
              )}

              {isShown('lead-source-donut') && leadSources.state === 'ok' && (
                <DashboardCard title="Lead Source Distribution" icon={Users}>
                  <DonutChart slices={Object.entries(leadSources.value).map(([src, cnt], i) => ({
                    label: String(src), value: Number(cnt), color: PLAN_COLORS[i % PLAN_COLORS.length],
                  }))} />
                </DashboardCard>
              )}

              {isShown('salesperson-rank') && salesByUser.state === 'ok' && (
                <DashboardCard title="Customers by Account Manager" icon={Users}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
                    {Object.entries(salesByUser.value)
                      .sort((a, b) => Number(b[1]) - Number(a[1]))
                      .slice(0, 10)
                      .map(([name, cnt]) => {
                        const max = Math.max(...Object.values(salesByUser.value).map((v: any) => Number(v)))
                        return (
                          <div key={name}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--gx-text-sm)', marginBottom: 3 }}>
                              <span>{name}</span>
                              <span style={{ fontWeight: 'var(--gx-weight-semibold)' }}>{Number(cnt)}</span>
                            </div>
                            <div style={{ height: 'var(--gx-space-3)', borderRadius: 'var(--gx-radius-xs)', background: 'var(--gx-surface-2)' }}>
                              {/* D18: ranked-list bar = drillable per-rep performance → --gx-chart-active. */}
                              <div style={{ height: '100%', width: `${(Number(cnt) / max) * 100}%`, background: 'var(--gx-chart-active)', borderRadius: 'var(--gx-radius-xs)' }} />
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </DashboardCard>
              )}

            </div>
          </>
        )}

        {/* === SECTION: Advanced execution charts === */}
        {(isShown('gantt') || isShown('exec-summary') || isShown('sankey-leads') || isShown('pareto-leads') || isShown('geographic-map') || isShown('net-subscriber-growth')) && (
          <>
            <div style={{ marginTop: 'var(--gx-space-4)', marginBottom: 'var(--gx-space-7)', fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-bold)', color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Strategic & Operational Charts
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--gx-space-18)', marginBottom: 'var(--gx-space-18)' }}>

              {isShown('gantt') && gantt.state === 'ok' && (
                <DashboardCard title="Project Gantt" icon={Calendar}>
                  <GanttChart projects={gantt.value} />
                </DashboardCard>
              )}
              {isShown('gantt') && gantt.state === 'hide' && (
                <DashboardCard title="Project Gantt" icon={Calendar}>
                  <div className="muted" style={{ padding: 'var(--gx-space-18)', fontSize: 'var(--gx-text-13)' }}>No projects with start/due dates</div>
                </DashboardCard>
              )}

              {isShown('pareto-leads') && pareto.state === 'ok' && (
                <DashboardCard title="Lead Sources Pareto" icon={BarChart3}>
                  <ParetoChart data={pareto.value} />
                </DashboardCard>
              )}

              {isShown('sankey-leads') && sankey.state === 'ok' && (
                <DashboardCard title="Sales Conversion Flow (Sankey)" icon={ArrowRight}>
                  <SankeyChart data={sankey.value} />
                </DashboardCard>
              )}

              {isShown('geographic-map') && geoPoints.state === 'ok' && (
                <DashboardCard title="Geographic Distribution" icon={Activity}>
                  <GeoMap points={geoPoints.value} />
                </DashboardCard>
              )}

              {isShown('net-subscriber-growth') && netGrowth.state === 'ok' && (
                <DashboardCard title="Net Subscriber Growth (Weekly)" icon={Users}>
                  <NetGrowthChart data={netGrowth.value} />
                </DashboardCard>
              )}

            </div>
          </>
        )}

        {/* Empty state */}
        {selected.size === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--gx-text-3)' }}>
            <Settings size={40} style={{ marginBottom: 'var(--gx-space-5)', opacity: 0.4 }} />
            <p style={{ fontSize: 'var(--gx-text-md)' }}>No charts selected. Click <strong>Customize</strong> above to choose what to display.</p>
          </div>
        )}

      </div>

      {pickerOpen && (
        <ChartPicker
          initialSelected={selected}
          onClose={() => setPickerOpen(false)}
          onSave={(next) => { setSelected(next); saveSelected(next) }}
        />
      )}
    </PageShell>
  )
}
