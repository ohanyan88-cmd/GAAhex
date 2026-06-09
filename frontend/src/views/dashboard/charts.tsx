// Dashboard chart primitives and card shells.
//
// All components here are pure rendering — no data fetching, no routing,
// no global state. The DashboardView coordinator owns all of that and passes
// data down as props.
//
// D18 color notes are preserved inline on each chart so the rationale is
// co-located with the render code.
import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react'
import { money } from '../../lib/money'
import { t } from '../../lib/i18n'
import { PLAN_COLORS } from './types'

// ─── skeleton ────────────────────────────────────────────────────────────────

export function ChartSkeleton({ h = 160 }: { h?: number }) {
  return (
    <div className="d-skel-row" style={{ height: h }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skel d-skel-bar" style={{ height: `${28 + (i % 5) * 14}%` }} />
      ))}
    </div>
  )
}

// ─── bar chart ───────────────────────────────────────────────────────────────

// Revenue (azure-interactive) + churn indicator (gold band at bottom).
export function BarChart({ data }: { data: { label: string; primary: number; secondary?: number }[] }) {
  const maxP = Math.max(...data.map(d => d.primary), 1)
  const maxS = Math.max(...data.map(d => d.secondary ?? 0), 1)
  return (
    <div>
      <div className="d-bar-row">
        {data.map(b => (
          <div key={b.label} className="d-bar-col" title={b.label}>
            {/* D18: primary revenue bar = drillable/active series → --gx-chart-active (= --gx-interactive). */}
            <div className="d-bar-primary" style={{ height: `${b.primary / maxP * 82}%`, minHeight: b.primary > 0 ? 'var(--gx-space-2)' : 0 }} />
            {b.secondary != null && b.secondary > 0 && (
              <div className="d-bar-secondary" style={{ height: `${b.secondary / maxS * 14}%` }} />
            )}
          </div>
        ))}
      </div>
      <div className="d-bar-labels">
        {data.map(b => <span key={b.label} className="d-bar-xlabel">{b.label.slice(5)}</span>)}
      </div>
    </div>
  )
}

// ─── area chart ──────────────────────────────────────────────────────────────

export function AreaChart({ data }: { data: { label: string; value: number }[] }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const W = 400, H = 120
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - (d.value / max) * (H - 10)
    return `${x},${y}`
  })
  const polyline = pts.join(' ')
  const area = `0,${H} ${polyline} ${W},${H}`
  return (
    <div className="d-area-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 120, overflow: 'visible' }}>
        <defs>
          {/* D18: area chart fill + stroke = active drillable series → --gx-chart-active. */}
          <linearGradient id="areafill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gx-chart-active)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gx-chart-active)" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#areafill)" />
        <polyline points={polyline} fill="none" stroke="var(--gx-chart-active)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="d-area-labels">
        <span>{data[0].label.slice(5)}</span>
        <span>{data[data.length - 1].label.slice(5)}</span>
      </div>
    </div>
  )
}

// ─── line chart ──────────────────────────────────────────────────────────────

export function LineChart({ data, series1Label = 'Series 1', series2Label = 'Series 2' }: {
  data: { label: string; v1: number; v2: number }[]
  series1Label?: string
  series2Label?: string
}) {
  if (data.length < 2) return null
  const max1 = Math.max(...data.map(d => d.v1), 1)
  const max2 = Math.max(...data.map(d => d.v2), 1)
  const maxAll = Math.max(max1, max2)
  const W = 400, H = 110
  const pts1 = data.map((d, i) => `${(i / (data.length - 1)) * W},${H - (d.v1 / maxAll) * (H - 8)}`).join(' ')
  const pts2 = data.map((d, i) => `${(i / (data.length - 1)) * W},${H - (d.v2 / maxAll) * (H - 8)}`).join(' ')
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 110, overflow: 'visible' }}>
        {/* D18: series 1 = primary drillable line → --gx-chart-active; series 2 = peak/highlight → --gx-gold (dashed). */}
        <polyline points={pts1} fill="none" stroke="var(--gx-chart-active)" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={pts2} fill="none" stroke="var(--gx-gold)" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 3" />
      </svg>
      <div className="d-line-legend">
        <span className="d-legend-item">
          <span className="d-swatch-line" style={{ background: 'var(--gx-chart-active)' }} />{series1Label}
        </span>
        <span className="d-legend-item">
          <span className="d-swatch-line" style={{ background: 'var(--gx-gold)' }} />{series2Label}
        </span>
      </div>
    </div>
  )
}

// ─── donut chart ─────────────────────────────────────────────────────────────

export function DonutChart({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((s, sl) => s + sl.value, 0) || 1
  let cum = 0
  const r = 60, cx = 70, cy = 70, sw = 28
  const paths = slices.map(sl => {
    const pct = sl.value / total
    const startAngle = cum * 2 * Math.PI - Math.PI / 2
    cum += pct
    const endAngle = cum * 2 * Math.PI - Math.PI / 2
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle)
    const large = pct > 0.5 ? 1 : 0
    return { d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`, color: sl.color, pct, label: sl.label, value: sl.value }
  })
  return (
    <div className="gx-donut">
      <svg viewBox="0 0 140 140" style={{ width: 140, height: 140, flexShrink: 0 }}>
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={sw} strokeLinecap="butt" />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={11} fill="var(--gx-text-3)">{t('common.total', 'Total')}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={20} fontWeight={700} fill="var(--gx-text-1)">
          {slices.reduce((s, sl) => s + sl.value, 0)}
        </text>
      </svg>
      <div className="d-donut-legend">
        {slices.map((sl, i) => (
          <div key={i} className="d-donut-legend-row">
            <span className="d-donut-swatch" style={{ background: sl.color }} />
            <span className="d-donut-label">{sl.label}</span>
            <span className="d-donut-value">{sl.value}</span>
            <span className="muted" style={{ fontSize: 'var(--gx-text-11)' }}>{Math.round(sl.value / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── horizontal bar chart ────────────────────────────────────────────────────

export function HorizontalBarChart({ buckets }: { buckets: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...buckets.map(b => b.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-5)' }}>
      {buckets.map(b => (
        <div key={b.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--gx-space-2)', fontSize: 'var(--gx-text-sm)' }}>
            <span>{b.label}</span>
            <span style={{ fontWeight: 'var(--gx-weight-semibold)', color: b.color }}>{money(b.value)}</span>
          </div>
          <div style={{ height: 'var(--gx-space-4)', borderRadius: 'var(--gx-radius-xs)', background: 'var(--gx-surface-2)' }}>
            <div style={{ height: '100%', width: `${b.value / max * 100}%`, borderRadius: 'var(--gx-radius-xs)', background: b.color, transition: 'width .3s' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── funnel chart ────────────────────────────────────────────────────────────

export function FunnelChart({ stages }: { stages: { label: string; value: number }[] }) {
  const max = stages[0]?.value || 1
  return (
    <div className="d-funnel-wrap">
      {stages.map((st, i) => {
        const pct = st.value / max * 100
        const convRate = i > 0 ? Math.round(st.value / stages[i - 1].value * 100) : 100
        return (
          <div key={st.label}>
            <div className="d-funnel-label-row">
              <span>{st.label}</span>
              <span className="d-funnel-values">
                <span style={{ fontWeight: 'var(--gx-weight-semibold)' }}>{st.value.toLocaleString()}</span>
                {i > 0 && <span className="muted">{convRate}%</span>}
              </span>
            </div>
            <div style={{ height: 'var(--gx-space-6)', borderRadius: 'var(--gx-radius-xs)', background: 'var(--gx-surface-2)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                borderRadius: 'var(--gx-radius-xs)',
                background: `hsl(${200 + i * 20}, 70%, ${50 + i * 5}%)`,
                transition: 'width .3s',
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── KPI card with sparkline ──────────────────────────────────────────────────

export function KPICard({ label, value, sublabel, color, icon: Icon, trend = [] }: {
  label: string; value: string; sublabel?: string
  color?: string; icon: LucideIcon; trend?: number[]
}) {
  const maxT = Math.max(...trend, 1)
  const W = 80, H = 28
  const pts = trend.map((v, i) => `${(i / Math.max(trend.length - 1, 1)) * W},${H - (v / maxT) * (H - 4)}`).join(' ')
  return (
    <div className="card d-kpicard">
      <div className="d-kpicard-header">
        <div>
          <div className="d-kpicard-meta">
            <Icon size={13} />
            <span className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>{label}</span>
          </div>
          <div className="d-kpicard-value" style={{ color: color ?? 'inherit' }}>{value}</div>
          {sublabel && <div className="muted d-kpicard-sublabel">{sublabel}</div>}
        </div>
        {trend.length > 1 && (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H, flexShrink: 0, opacity: 0.6 }}>
            {/* D18: KPI sparkline default is passive/decorative → --gx-chart-default (= slate-400). */}
            <polyline points={pts} fill="none" stroke={color ?? 'var(--gx-chart-default)'} strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  )
}

// ─── dashboard card shell ────────────────────────────────────────────────────

// T-P2-7 — renamed from `Card` to `DashboardCard` to avoid shadowing the
// canonical `page-shell/primitives/Card.tsx` (surface-only wrapper). This
// is a header-chrome widget (title + icon + optional action) — a different
// concept, kept dashboard-local.
export function DashboardCard({ title, icon: Icon, children, action }: {
  title: string; icon: LucideIcon
  children: ReactNode; action?: ReactNode
}) {
  return (
    <div className="card d-dashcard">
      <div className="card-head">
        <Icon size={14} color="var(--gx-text-3)" />
        <h3>{title}</h3>
        <span className="spacer" />
        {action}
      </div>
      <div className="card-pad d-dashcard-pad">{children}</div>
    </div>
  )
}

// ─── gantt chart ─────────────────────────────────────────────────────────────

export function GanttChart({ projects }: { projects: { id: string; name: string; start_date: string; due_date: string; status: string; owner?: string }[] }) {
  if (projects.length === 0) return null
  const starts = projects.map(p => new Date(p.start_date).getTime()).filter(t => !isNaN(t))
  const ends   = projects.map(p => new Date(p.due_date).getTime()).filter(t => !isNaN(t))
  const minT = Math.min(...starts)
  const maxT = Math.max(...ends)
  const span = Math.max(1, maxT - minT)
  // D18: Gantt status colors — PLANNING (neutral slate), ACTIVE = in-progress
  // drillable bar → --gx-chart-active, ON_HOLD/DONE/CANCELLED → semantic family.
  const statusColor = (s: string) => ({
    'PLANNING':  'var(--gx-text-3)',
    'ACTIVE':    'var(--gx-chart-active)',
    'ON_HOLD':   'var(--gx-warning)',
    'DONE':      'var(--gx-success)',
    'CANCELLED': 'var(--gx-danger)',
  }[s] ?? 'var(--gx-text-3)')
  return (
    <div className="d-gantt-wrap">
      {projects.slice(0, 12).map(p => {
        const s = new Date(p.start_date).getTime()
        const e = new Date(p.due_date).getTime()
        const leftPct  = ((s - minT) / span) * 100
        const widthPct = Math.max(2, ((e - s) / span) * 100)
        return (
          <div key={p.id} className="d-gantt-row">
            <span className="d-gantt-name" title={p.name}>{p.name}</span>
            <div className="d-gantt-track">
              <div className="d-gantt-bar" title={`${p.start_date} to ${p.due_date} - ${p.status}`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: statusColor(p.status) }} />
            </div>
            <span className="d-gantt-status">{p.status}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── pareto chart ────────────────────────────────────────────────────────────

export function ParetoChart({ data }: { data: { category: string; count: number; cum_pct: number }[] }) {
  if (data.length === 0) return null
  const maxCount = Math.max(...data.map(d => d.count), 1)
  return (
    <div>
      <div className="d-pareto-chart">
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', position: 'relative' }} title={`${d.category}: ${d.count} (${d.cum_pct}% cum)`}>
            {/* D18: Pareto top-3 = highlighted drillable bars → --gx-chart-active; rest = passive slate → --gx-chart-default. */}
            <div style={{
              height: `${(d.count / maxCount) * 80}%`,
              background: i < 3 ? 'var(--gx-chart-active)' : 'var(--gx-chart-default)',
              borderRadius: 'var(--gx-radius-xs) var(--gx-radius-xs) 0 0',
            }} />
            <span className="d-chart-xlabel" style={{ marginTop: 'var(--gx-space-1)' }}>{d.category}</span>
          </div>
        ))}
        <svg viewBox={`0 0 ${data.length} 100`} preserveAspectRatio="none"
             style={{ position: 'absolute', inset: 0, height: '80%', pointerEvents: 'none' }}>
          <polyline
            points={data.map((d, i) => `${i + 0.5},${100 - d.cum_pct}`).join(' ')}
            fill="none" stroke="var(--gx-gold)" strokeWidth="0.8" vectorEffect="non-scaling-stroke"
          />
          <line x1="0" y1="20" x2={data.length} y2="20" stroke="var(--gx-warning)" strokeDasharray="2 2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="d-pareto-legend">
        <span><span className="d-pareto-swatch-sq" style={{ background: 'var(--gx-chart-active)' }} />{t('charts.pareto.top3', 'Top 3')}</span>
        <span><span className="d-pareto-swatch-ln" style={{ background: 'var(--gx-gold)' }} />{t('charts.pareto.cumulativePct', 'Cumulative %')}</span>
        <span style={{ marginLeft: 'auto' }}>{t('charts.pareto.target80', '80% target line')}</span>
      </div>
    </div>
  )
}

// ─── sankey chart ────────────────────────────────────────────────────────────

export function SankeyChart({ data }: { data: { nodes: { id: string; name: string; value: number }[]; links: { source: string; target: string; value: number }[] } }) {
  const max = Math.max(...data.nodes.map(n => n.value), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', height: 160 }}>
        {data.nodes.map((n, i) => {
          const h = (n.value / max) * 100
          const conv = i > 0 ? Math.round((n.value / Math.max(data.nodes[i - 1].value, 1)) * 100) : null
          return (
            <>
              <div key={n.id} className="d-sankey-col">
                <div className="d-sankey-bar" style={{ height: `${Math.max(h, 5)}%`, background: PLAN_COLORS[i % PLAN_COLORS.length] }}>{n.value}</div>
                <div className="d-sankey-label">{n.name}</div>
                {conv !== null && (
                  <div className="d-sankey-conv">{conv}% conv</div>
                )}
              </div>
              {i < data.nodes.length - 1 && (
                // D18: connector encodes flow direction → start = active (--gx-chart-active), end = passive (--gx-text-3).
                <div key={`arrow-${i}`} className="d-sankey-arrow">
                  <div className="d-sankey-arrowhead" />
                </div>
              )}
            </>
          )
        })}
      </div>
    </div>
  )
}

// ─── geo map ─────────────────────────────────────────────────────────────────

export function GeoMap({ points }: { points: { id: string; kind: string; name: string; lat: number; lon: number; status: string | null }[] }) {
  if (points.length === 0) return null
  const lats = points.map(p => p.lat)
  const lons = points.map(p => p.lon)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const latSpan = Math.max(0.01, maxLat - minLat)
  const lonSpan = Math.max(0.01, maxLon - minLon)
  // D18: geo point kinds = distinct-identity categories → categorical viz palette.
  const kindColor = (k: string) => ({
    site:           'var(--viz-1)',
    tower:          'var(--viz-2)',
    customer:       'var(--viz-3)',
    coverage_check: 'var(--viz-4)',
  } as Record<string, string>)[k] ?? 'var(--gx-text-3)'
  const W = 100, H = 70
  return (
    <div>
      <div style={{
        position: 'relative', width: '100%', height: 180, background: 'var(--gx-surface-2)',
        borderRadius: 'var(--gx-radius-xs)', overflow: 'hidden', border: '1px solid var(--gx-border)',
      }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={`gx-${i}`} x1={i * 10} y1="0" x2={i * 10} y2={H} stroke="var(--gx-border)" strokeWidth="0.2" />
          ))}
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={`gy-${i}`} x1="0" y1={i * 10} x2={W} y2={i * 10} stroke="var(--gx-border)" strokeWidth="0.2" />
          ))}
          {points.slice(0, 200).map(p => {
            const x = ((p.lon - minLon) / lonSpan) * (W - 4) + 2
            const y = ((maxLat - p.lat) / latSpan) * (H - 4) + 2
            return (
              <circle key={p.id} cx={x} cy={y} r="1.2" fill={kindColor(p.kind)} opacity="0.85">
                <title>{`${p.name} (${p.kind})`}</title>
              </circle>
            )
          })}
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 'var(--gx-space-4)', marginTop: 'var(--gx-space-3)', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', flexWrap: 'wrap' }}>
        {Object.entries(points.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc }, {} as Record<string, number>)).map(([k, n]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-2)' }}>
            <span style={{ width: 'var(--gx-space-4)', height: 'var(--gx-space-4)', borderRadius: '50%', background: kindColor(k) }} />
            {k.replace(/_/g, ' ')} ({n})
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── net subscriber growth ───────────────────────────────────────────────────

export function NetGrowthChart({ data }: { data: { week: string; new: number; churned: number; net: number }[] }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => Math.max(d.new, d.churned, 1)))
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140 }}>
        {data.map(d => (
          <div key={d.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 'var(--gx-space-1)' }} title={`${d.week}: +${d.new} new, -${d.churned} churn, net ${d.net}`}>
            <div style={{ height: `${(d.new / max) * 50}%`, background: 'var(--gx-success)', borderRadius: '2px 2px 0 0', minHeight: d.new > 0 ? 2 : 0 }} />
            <div style={{ height: `${(d.churned / max) * 50}%`, background: 'var(--gx-danger)', borderRadius: '0 0 2px 2px', minHeight: d.churned > 0 ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--gx-space-3)', fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)' }}>
        <span>{t('charts.netGrowth.netChange', 'Net change')}: {data.reduce((s, d) => s + d.net, 0)}</span>
        <span style={{ display: 'flex', gap: 'var(--gx-space-5)' }}>
          <span><span style={{ display: 'inline-block', width: 'var(--gx-space-4)', height: 'var(--gx-space-4)', background: 'var(--gx-success)', borderRadius: 2, marginRight: 'var(--gx-space-2)' }} />{t('charts.netGrowth.new', 'New')}</span>
          <span><span style={{ display: 'inline-block', width: 'var(--gx-space-4)', height: 'var(--gx-space-4)', background: 'var(--gx-danger)', borderRadius: 2, marginRight: 'var(--gx-space-2)' }} />{t('charts.netGrowth.churned', 'Churned')}</span>
        </span>
      </div>
    </div>
  )
}

// ─── comparison card ─────────────────────────────────────────────────────────

export function ComparisonCard({ label, thisVal, lastVal, formatter = (n: number) => n.toLocaleString(), invertColor = false }: {
  label: string; thisVal: number; lastVal: number
  formatter?: (n: number) => string
  invertColor?: boolean
}) {
  const delta    = thisVal - lastVal
  const pctDelta = lastVal === 0 ? (thisVal > 0 ? 100 : 0) : (delta / lastVal) * 100
  const up       = delta > 0
  const flat     = delta === 0
  const goodUp   = !invertColor
  const color = flat
    ? 'var(--gx-text-3)'
    : (up && goodUp) || (!up && !goodUp)
      ? 'var(--gx-success)'
      : 'var(--gx-danger)'
  return (
    <div className="card" style={{ padding: 'var(--gx-space-7) var(--gx-space-18)' }}>
      <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginBottom: 'var(--gx-space-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--gx-space-2)' }}>
        <span style={{ fontSize: 'var(--gx-text-2xl)', fontWeight: 'var(--gx-weight-bold)' }}>{formatter(thisVal)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'var(--gx-text-sm)', fontWeight: 'var(--gx-weight-semibold)', color }}>
          {!flat && (up ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
          {flat ? '—' : `${pctDelta > 0 ? '+' : ''}${pctDelta.toFixed(1)}%`}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 'var(--gx-text-11)' }}>{t('charts.comparison.vs', 'vs')} {formatter(lastVal)} {t('charts.comparison.prior', 'prior')}</div>
    </div>
  )
}

// ─── grouped bar chart ───────────────────────────────────────────────────────

export function GroupedBarChart({ data }: { data: { label: string; thisVal: number; lastVal: number }[] }) {
  const max = Math.max(...data.flatMap(d => [d.thisVal, d.lastVal]), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--gx-space-5)', height: 160, padding: 'var(--gx-space-2) 0' }}>
        {data.map(d => (
          <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 'var(--gx-space-2)', height: '100%' }} title={`${d.label}: this ${d.thisVal} vs last ${d.lastVal}`}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 'var(--gx-space-1)', height: '85%' }}>
              {/* D18: "this period" = active drillable series → gradient via --gx-interactive. "Last period" = faded slate (passive reference). */}
              <div style={{ width: '40%', height: `${d.thisVal / max * 100}%`, background: 'linear-gradient(180deg,var(--gx-interactive-hover),var(--gx-interactive-active))', borderRadius: '3px 3px 0 0', minHeight: d.thisVal > 0 ? 3 : 0 }} />
              <div style={{ width: '40%', height: `${d.lastVal / max * 100}%`, background: 'var(--gx-text-3)', opacity: 0.5, borderRadius: '3px 3px 0 0', minHeight: d.lastVal > 0 ? 3 : 0 }} />
            </div>
            <span style={{ fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--gx-space-7)', marginTop: 'var(--gx-space-3)', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 'var(--gx-space-5)', height: 'var(--gx-space-5)', background: 'var(--gx-chart-active)', borderRadius: 2 }} />{t('charts.groupedBar.thisPeriod', 'This period')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 'var(--gx-space-5)', height: 'var(--gx-space-5)', background: 'var(--gx-text-3)', opacity: 0.5, borderRadius: 2 }} />{t('charts.groupedBar.lastPeriod', 'Last period')}
        </span>
      </div>
    </div>
  )
}

// ─── multi-series line chart ─────────────────────────────────────────────────

export function MultiLineChart({ labels, series }: {
  labels: string[]
  series: { name: string; values: number[]; color: string }[]
}) {
  if (labels.length < 2) return null
  const allValues = series.flatMap(s => s.values)
  const max = Math.max(...allValues, 1)
  const W = 400, H = 130
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }}>
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => `${(i / (labels.length - 1)) * W},${H - (v / max) * (H - 10)}`).join(' ')
          return <polyline key={si} points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
        })}
      </svg>
      <div style={{ display: 'flex', gap: 'var(--gx-space-7)', marginTop: 'var(--gx-space-3)', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', flexWrap: 'wrap' }}>
        {series.map((s, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 'var(--gx-space-6)', height: 'var(--gx-space-1)', background: s.color, borderRadius: 1 }} />{s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── heatmap chart ───────────────────────────────────────────────────────────

export function HeatmapChart({ data }: { data: { date: string; count: number; amount: number }[] }) {
  if (data.length === 0) return null
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const cellSize = 12, cellGap = 2
  const weeks = Math.ceil(data.length / 7)
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weeks}, ${cellSize}px)`, gridAutoFlow: 'column', gridTemplateRows: `repeat(7, ${cellSize}px)`, gap: cellGap, padding: 'var(--gx-space-2) 0' }}>
        {data.map(d => {
          const intensity = d.count / maxCount
          const bg = d.count === 0
            ? 'var(--gx-surface-2)'
            : `rgba(59,130,246,${0.15 + intensity * 0.85})`
          return (
            <div key={d.date}
              title={`${d.date}: ${d.count} payments, ${(d.amount / 100).toLocaleString()} AMD`}
              style={{ width: cellSize, height: cellSize, borderRadius: 2, background: bg, cursor: 'help' }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--gx-space-5)', fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)' }}>
        <span>{t('charts.heatmap.less', 'Less')}</span>
        <div style={{ display: 'flex', gap: 'var(--gx-space-1)' }}>
          {[0.15, 0.35, 0.55, 0.75, 1].map(i => (
            <span key={i} style={{ width: 'var(--gx-space-5)', height: 'var(--gx-space-5)', borderRadius: 2, background: `rgba(59,130,246,${i})` }} />
          ))}
        </div>
        <span>{t('charts.heatmap.more', 'More')}</span>
      </div>
    </div>
  )
}

// ─── stacked bar chart ───────────────────────────────────────────────────────

export function StackedBarChart({ buckets }: {
  buckets: { label: string; segments: { name: string; value: number; color: string }[] }[]
}) {
  const totals = buckets.map(b => b.segments.reduce((s, sg) => s + sg.value, 0))
  const max = Math.max(...totals, 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--gx-space-3)', height: 160 }}>
        {buckets.map((b, bi) => {
          const total = totals[bi]
          return (
            <div key={bi} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 'var(--gx-space-1)' }} title={b.label}>
              <div style={{ height: `${total / max * 85}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}>
                {b.segments.filter(sg => sg.value > 0).map((sg, si) => (
                  <div key={si} title={`${sg.name}: ${sg.value}`}
                    style={{ flex: sg.value, background: sg.color, minHeight: 1 }} />
                ))}
              </div>
              <span style={{ fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── status breakdown ────────────────────────────────────────────────────────

export function StatusBreakdown({ buckets, total }: { buckets: { label: string; value: number; color: string }[]; total: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
      {buckets.map(b => {
        const pct = total > 0 ? (b.value / total) * 100 : 0
        return (
          <div key={b.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--gx-text-11)', marginBottom: 3 }}>
              <span>{b.label}</span>
              <span style={{ fontWeight: 'var(--gx-weight-semibold)' }}>{b.value} · {pct.toFixed(0)}%</span>
            </div>
            <div style={{ height: 'var(--gx-space-3)', borderRadius: 'var(--gx-radius-xs)', background: 'var(--gx-surface-2)' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: b.color, borderRadius: 'var(--gx-radius-xs)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
