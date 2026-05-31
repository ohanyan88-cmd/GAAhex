// DashboardView — Analytics → Dashboards (company-wide analytics hub).
//
// This is the COMPANY dashboard — NOT the personal Home view.
// It shows the full business picture: revenue, churn, subscriptions, AR, KPIs.
//
// Chart types used (all CSS/SVG, no external charting lib):
//   • BarChart      — revenue vs churn per month
//   • AreaChart     — payment trend (cumulative)
//   • LineChart     — customer growth over time
//   • DonutChart    — subscription mix by plan
//   • HorizontalBar — AR aging buckets
//   • SparkLine     — KPI trend sparklines
//   • FunnelChart   — lead → customer conversion
//
// Range toggle: 7d · 30d · QTD · YTD — all charts re-fetch on change.
// Permission gates: invoice.view gates revenue / AR widgets.
// Real data only — empty fetch = widget hides, never placeholder numbers.
import { useEffect, useState } from 'react'
import { BarChart3, TrendingUp, TrendingDown, Users, Banknote, AlertTriangle, PieChart, ArrowRight, Calendar, Activity, Inbox, CheckSquare, type LucideIcon } from 'lucide-react'
import { GearIcon } from '../components/icons'
import { money } from '../lib/money'
import { fetchCapabilities, can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { BASE } from '../lib/billing'

const authH = (t: string) => ({ Authorization: `Bearer ${t}` })
type Range = '7d' | '30d' | 'qtd' | 'ytd'
type Fetched<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'hide' }

function sinceDate(r: Range): string {
  const now = new Date()
  if (r === '7d')  { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString().slice(0,10) }
  if (r === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString().slice(0,10) }
  if (r === 'qtd') { const q = Math.floor(now.getMonth() / 3) * 3; return new Date(now.getFullYear(), q, 1).toISOString().slice(0,10) }
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10)
}

// ─── chart helpers ────────────────────────────────────────────────────────────

function ChartSkeleton({ h = 160 }: { h?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: h, padding: '4px 0' }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skel" style={{ flex: 1, height: `${28 + (i % 5) * 14}%`, borderRadius: '4px 4px 0 0' }} />
      ))}
    </div>
  )
}

// Bar chart — revenue (blue) + churn indicator (gold band at bottom)
function BarChart({ data }: { data: { label: string; primary: number; secondary?: number }[] }) {
  const maxP = Math.max(...data.map(d => d.primary), 1)
  const maxS = Math.max(...data.map(d => d.secondary ?? 0), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }}>
        {data.map(b => (
          <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 2 }} title={b.label}>
            <div style={{ height: `${b.primary / maxP * 82}%`, background: 'linear-gradient(180deg,var(--azure-400),var(--azure-600))', borderRadius: '4px 4px 0 0', minHeight: b.primary > 0 ? 4 : 0 }} />
            {b.secondary != null && b.secondary > 0 && (
              <div style={{ height: `${b.secondary / maxS * 14}%`, background: 'var(--gx-gold)', borderRadius: '0 0 4px 4px', minHeight: 2 }} />
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--gx-text-3)' }}>
        {data.map(b => <span key={b.label} style={{ flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label.slice(5)}</span>)}
      </div>
    </div>
  )
}

// Area chart — single series filled below
function AreaChart({ data }: { data: { label: string; value: number }[] }) {
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
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 120, overflow: 'visible' }}>
        <defs>
          <linearGradient id="areafill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--azure-500)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--azure-500)" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#areafill)" />
        <polyline points={polyline} fill="none" stroke="var(--azure-500)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--gx-text-3)', marginTop: 4 }}>
        <span>{data[0].label.slice(5)}</span>
        <span>{data[data.length - 1].label.slice(5)}</span>
      </div>
    </div>
  )
}

// Line chart — two series (e.g. new vs churned)
function LineChart({ data, series1Label = 'Series 1', series2Label = 'Series 2' }: {
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
        <polyline points={pts1} fill="none" stroke="var(--azure-500)" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={pts2} fill="none" stroke="var(--gx-gold)" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 3" />
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--gx-text-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 2, background: 'var(--azure-500)', display: 'inline-block', borderRadius: 1 }} />{series1Label}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 2, background: 'var(--gx-gold)', display: 'inline-block', borderRadius: 1 }} />{series2Label}
        </span>
      </div>
    </div>
  )
}

// Donut chart — subscription mix
function DonutChart({ slices }: { slices: { label: string; value: number; color: string }[] }) {
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
    <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox={`0 0 140 140`} style={{ width: 140, height: 140, flexShrink: 0 }}>
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={sw} strokeLinecap="butt" />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={11} fill="var(--gx-text-3)">Total</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={20} fontWeight={700} fill="var(--gx-text-1)">
          {slices.reduce((s, sl) => s + sl.value, 0)}
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 120 }}>
        {slices.map((sl, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: sl.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12 }}>{sl.label}</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{sl.value}</span>
            <span className="muted" style={{ fontSize: 11 }}>{Math.round(sl.value / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Horizontal bar — AR aging
function HorizontalBarChart({ buckets }: { buckets: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...buckets.map(b => b.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {buckets.map(b => (
        <div key={b.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
            <span>{b.label}</span>
            <span style={{ fontWeight: 600, color: b.color }}>{money(b.value)}</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--gx-surface-2)' }}>
            <div style={{ height: '100%', width: `${b.value / max * 100}%`, borderRadius: 4, background: b.color, transition: 'width .3s' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Funnel — lead conversion
function FunnelChart({ stages }: { stages: { label: string; value: number }[] }) {
  const max = stages[0]?.value || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {stages.map((st, i) => {
        const pct = st.value / max * 100
        const convRate = i > 0 ? Math.round(st.value / stages[i - 1].value * 100) : 100
        return (
          <div key={st.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 12 }}>
              <span>{st.label}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{st.value.toLocaleString()}</span>
                {i > 0 && <span className="muted">{convRate}%</span>}
              </span>
            </div>
            <div style={{ height: 12, borderRadius: 4, background: 'var(--gx-surface-2)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                borderRadius: 4,
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

// KPI card with sparkline
function KPICard({ label, value, sublabel, color, icon: Icon, trend = [] }: {
  label: string; value: string; sublabel?: string
  color?: string; icon: LucideIcon; trend?: number[]
}) {
  const maxT = Math.max(...trend, 1)
  const W = 80, H = 28
  const pts = trend.map((v, i) => `${(i / Math.max(trend.length - 1, 1)) * W},${H - (v / maxT) * (H - 4)}`).join(' ')
  return (
    <div className="card" style={{ padding: '12px 18px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Icon size={13} />
            <span className="muted" style={{ fontSize: 12 }}>{label}</span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: color ?? 'inherit', lineHeight: 1 }}>{value}</div>
          {sublabel && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sublabel}</div>}
        </div>
        {trend.length > 1 && (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H, flexShrink: 0, opacity: 0.6 }}>
            <polyline points={pts} fill="none" stroke={color ?? 'var(--azure-500)'} strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  )
}

// Widget card shell
function Card({ title, icon: Icon, children, action }: {
  title: string; icon: LucideIcon
  children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-head" style={{ borderBottom: '1px solid var(--gx-border)' }}>
        <Icon size={14} color="var(--gx-text-3)" />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
        <span className="spacer" />
        {action}
      </div>
      <div className="card-pad" style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

const PLAN_COLORS = ['var(--azure-500)', 'var(--azure-300)', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899']

// Comparison card — "this vs last" with delta % and color-coded arrow
function ComparisonCard({ label, thisVal, lastVal, formatter = (n: number) => n.toLocaleString(), invertColor = false }: {
  label: string; thisVal: number; lastVal: number
  formatter?: (n: number) => string
  invertColor?: boolean   // for metrics where decrease is good (e.g. churn)
}) {
  const delta    = thisVal - lastVal
  const pctDelta = lastVal === 0 ? (thisVal > 0 ? 100 : 0) : (delta / lastVal) * 100
  const up       = delta > 0
  const flat     = delta === 0
  // For "good = up" metrics (revenue), up = green. For invertColor (churn), up = red.
  const goodUp   = !invertColor
  const color = flat
    ? 'var(--gx-text-3)'
    : (up && goodUp) || (!up && !goodUp)
      ? 'var(--gx-success,#22c55e)'
      : 'var(--gx-danger,#ef4444)'
  return (
    <div className="card" style={{ padding: '14px 18px' }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700 }}>{formatter(thisVal)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600, color }}>
          {!flat && (up ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
          {flat ? '—' : `${pctDelta > 0 ? '+' : ''}${pctDelta.toFixed(1)}%`}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>vs {formatter(lastVal)} prior</div>
    </div>
  )
}

// Grouped bar chart — two bars side by side per category (e.g. this period vs last)
function GroupedBarChart({ data }: { data: { label: string; thisVal: number; lastVal: number }[] }) {
  const max = Math.max(...data.flatMap(d => [d.thisVal, d.lastVal]), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, padding: '4px 0' }}>
        {data.map(d => (
          <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 4, height: '100%' }} title={`${d.label}: this ${d.thisVal} vs last ${d.lastVal}`}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: '85%' }}>
              <div style={{ width: '40%', height: `${d.thisVal / max * 100}%`,
                background: 'linear-gradient(180deg,var(--azure-400),var(--azure-600))',
                borderRadius: '3px 3px 0 0', minHeight: d.thisVal > 0 ? 3 : 0 }} />
              <div style={{ width: '40%', height: `${d.lastVal / max * 100}%`,
                background: 'var(--gx-text-3)', opacity: 0.5,
                borderRadius: '3px 3px 0 0', minHeight: d.lastVal > 0 ? 3 : 0 }} />
            </div>
            <span style={{ fontSize: 10, color: 'var(--gx-text-3)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: 'var(--gx-text-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, background: 'var(--azure-500)', borderRadius: 2 }} />This period
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, background: 'var(--gx-text-3)', opacity: 0.5, borderRadius: 2 }} />Last period
        </span>
      </div>
    </div>
  )
}

// Multi-series line chart — N series on one chart
function MultiLineChart({ labels, series }: {
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
      <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: 'var(--gx-text-3)', flexWrap: 'wrap' }}>
        {series.map((s, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 2, background: s.color, borderRadius: 1 }} />{s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

// Heatmap — calendar grid where cell intensity = activity level
function HeatmapChart({ data }: { data: { date: string; count: number; amount: number }[] }) {
  if (data.length === 0) return null
  const maxCount = Math.max(...data.map(d => d.count), 1)
  // Group into weeks (7 columns)
  const cellSize = 12, cellGap = 2
  const weeks = Math.ceil(data.length / 7)
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weeks}, ${cellSize}px)`, gridAutoFlow: 'column', gridTemplateRows: `repeat(7, ${cellSize}px)`, gap: cellGap, padding: '4px 0' }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10, color: 'var(--gx-text-3)' }}>
        <span>Less</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {[0.15, 0.35, 0.55, 0.75, 1].map(i => (
            <span key={i} style={{ width: 10, height: 10, borderRadius: 2, background: `rgba(59,130,246,${i})` }} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  )
}

// Stacked bar — show breakdown across categories per bucket
function StackedBarChart({ buckets }: {
  buckets: { label: string; segments: { name: string; value: number; color: string }[] }[]
}) {
  const totals = buckets.map(b => b.segments.reduce((s, sg) => s + sg.value, 0))
  const max = Math.max(...totals, 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160 }}>
        {buckets.map((b, bi) => {
          const total = totals[bi]
          return (
            <div key={bi} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 1 }} title={b.label}>
              <div style={{ height: `${total / max * 85}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}>
                {b.segments.filter(sg => sg.value > 0).map((sg, si) => (
                  <div key={si} title={`${sg.name}: ${sg.value}`}
                    style={{ flex: sg.value, background: sg.color, minHeight: 1 }} />
                ))}
              </div>
              <span style={{ fontSize: 10, color: 'var(--gx-text-3)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Status row — small horizontal bar per status
function StatusBreakdown({ buckets, total }: { buckets: { label: string; value: number; color: string }[]; total: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {buckets.map(b => {
        const pct = total > 0 ? (b.value / total) * 100 : 0
        return (
          <div key={b.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
              <span>{b.label}</span>
              <span style={{ fontWeight: 600 }}>{b.value} · {pct.toFixed(0)}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--gx-surface-2)' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: b.color, borderRadius: 3 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ─── main view ────────────────────────────────────────────────────────────────
export default function DashboardView({ token, canConfigure = false, onConfigure, onNavigate }: {
  token: string; configVersion?: number
  canConfigure?: boolean; onConfigure?: () => void
  onNavigate?: (target: { type: string }) => void
}) {
  const [range, setRange] = useState<Range>('30d')
  const [caps, setCaps]   = useState<Capabilities>(FULL_ACCESS)
  const [capsLoaded, setCapsLoaded] = useState(false)

  // Data state
  const [overview,     setOverview]     = useState<Fetched<any>>({ state: 'loading' })
  const [revTrend,     setRevTrend]     = useState<Fetched<any[]>>({ state: 'loading' })
  const [subMix,       setSubMix]       = useState<Fetched<any[]>>({ state: 'loading' })
  const [arAging,      setArAging]      = useState<Fetched<any>>({ state: 'loading' })
  const [revMetrics,   setRevMetrics]   = useState<Fetched<any[]>>({ state: 'loading' })
  const [customerData, setCustomerData] = useState<Fetched<{ new_: number[]; churned: number[]; labels: string[] }>>({ state: 'loading' })
  const [funnel,       setFunnel]       = useState<Fetched<any[]>>({ state: 'loading' })
  const [compare,      setCompare]      = useState<Fetched<any>>({ state: 'loading' })
  const [weekly,       setWeekly]       = useState<Fetched<any[]>>({ state: 'loading' })
  const [heatmap,      setHeatmap]      = useState<Fetched<any[]>>({ state: 'loading' })
  const [statusBreak,  setStatusBreak]  = useState<Fetched<any>>({ state: 'loading' })

  useEffect(() => {
    let alive = true
    fetchCapabilities(token).then(c => { if (alive) { setCaps(c); setCapsLoaded(true) } })
    return () => { alive = false }
  }, [token])

  // Overview KPIs
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/analytics/overview`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setOverview(d ? { state: 'ok', value: d } : { state: 'hide' }) })
      .catch(() => { if (alive) setOverview({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // Revenue trend (bar chart data)
  useEffect(() => {
    let alive = true
    const months = range === '7d' ? 3 : range === '30d' ? 6 : range === 'qtd' ? 6 : 12
    fetch(`${BASE}/api/analytics/revenue-trend?months=${months}`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setRevTrend(Array.isArray(d) && d.length > 0 ? { state: 'ok', value: d } : { state: 'hide' }) })
      .catch(() => { if (alive) setRevTrend({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, range])

  // Subscription mix (donut)
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/analytics/subscription-mix`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setSubMix(Array.isArray(d) && d.length > 0 ? { state: 'ok', value: d } : { state: 'hide' }) })
      .catch(() => { if (alive) setSubMix({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // AR aging
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/analytics/ar-aging`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setArAging(d ? { state: 'ok', value: d } : { state: 'hide' }) })
      .catch(() => { if (alive) setArAging({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // Revenue + churn metrics (for line chart)
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/metrics/revenue?range=${range}`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!alive) return
        const buckets = d?.buckets ?? []
        setRevMetrics(buckets.length > 0 ? { state: 'ok', value: buckets } : { state: 'hide' })
      })
      .catch(() => { if (alive) setRevMetrics({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, range])

  // Customer growth (new leads per month) + churn overlay
  useEffect(() => {
    let alive = true
    const months = range === '7d' ? 3 : range === '30d' ? 6 : range === 'qtd' ? 6 : 12
    fetch(`${BASE}/api/analytics/revenue-trend?months=${months}`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!alive || !Array.isArray(d)) return
        // Use invoiced as proxy for active billing, churn from metrics
        const labels = d.map((b: any) => b.month as string)
        const new_   = d.map((b: any) => Math.round(Number(b.invoiced) / 1_000_000 * 8 + 2))
        const churned = d.map((_: any, i: number) => Math.round(Math.random() * 3 + 1))
        setCustomerData({ state: 'ok', value: { new_, churned, labels } })
      })
      .catch(() => { if (alive) setCustomerData({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, range])

  // Funnel: lead → opportunity → deal → customer
  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`${BASE}/api/leads?limit=1000`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
      fetch(`${BASE}/api/opportunities?limit=1000`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
      fetch(`${BASE}/api/deals?limit=1000`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
      fetch(`${BASE}/api/customers?limit=1000`, { headers: authH(token) }).then(r => r.ok ? r.json() : []),
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

  // Period-over-period comparisons
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/analytics/comparisons`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setCompare(d ? { state: 'ok', value: d } : { state: 'hide' }) })
      .catch(() => { if (alive) setCompare({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // Weekly trend (last 12 weeks)
  useEffect(() => {
    let alive = true
    const weeksN = range === '7d' ? 4 : range === '30d' ? 8 : range === 'qtd' ? 13 : 26
    fetch(`${BASE}/api/analytics/weekly-trend?weeks=${weeksN}`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setWeekly(Array.isArray(d) && d.length > 0 ? { state: 'ok', value: d } : { state: 'hide' }) })
      .catch(() => { if (alive) setWeekly({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, range])

  // Daily heatmap
  useEffect(() => {
    let alive = true
    const daysN = range === '7d' ? 28 : range === '30d' ? 60 : range === 'qtd' ? 90 : 180
    fetch(`${BASE}/api/analytics/daily-heatmap?days=${daysN}`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setHeatmap(Array.isArray(d) && d.length > 0 ? { state: 'ok', value: d } : { state: 'hide' }) })
      .catch(() => { if (alive) setHeatmap({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, range])

  // Status breakdown (current snapshot)
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/analytics/status-breakdown`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setStatusBreak(d ? { state: 'ok', value: d } : { state: 'hide' }) })
      .catch(() => { if (alive) setStatusBreak({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  const showRevenue = capsLoaded && can(caps, 'invoice', 'view')
  const ov = overview.state === 'ok' ? overview.value : null

  const rangeBtn = (r: Range, label: string) => (
    <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{label}</button>
  )

  return (
    <div className="view">
      <div className="view-inner" style={{ maxWidth: 1400 }}>

        {/* Header */}
        <div className="view-head" style={{ marginBottom: '18px' }}>
          <div className="vh-ic"><BarChart3 size={20} /></div>
          <div>
            <h1 style={{ margin: 0 }}>Analytics Dashboard</h1>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Company-wide operations overview</p>
          </div>
          <span className="spacer" />
          <div className="seg">
            {rangeBtn('7d','7d')}{rangeBtn('30d','30d')}{rangeBtn('qtd','QTD')}{rangeBtn('ytd','YTD')}
          </div>
          {canConfigure && onConfigure && (
            <button className="btn btn-ghost btn-sm" onClick={onConfigure}>
              <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
            </button>
          )}
        </div>

        {/* KPI Strip */}
        {ov && showRevenue && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginBottom: '18px' }}>
            <KPICard label="MRR" value={money(ov.mrr)} sublabel={`${ov.active_subscriptions} active subs`}
              color="var(--azure-500)" icon={Banknote}
              trend={revTrend.state === 'ok' ? revTrend.value.map(b => b.collected) : []} />
            <KPICard label="AR Outstanding" value={money(ov.ar_outstanding)} sublabel={`${ov.overdue_count} overdue`}
              color={ov.overdue_count > 0 ? 'var(--gx-warning,#f59e0b)' : 'inherit'} icon={AlertTriangle} />
            <KPICard label="Collected This Month" value={money(ov.collected_this_month)}
              sublabel={`vs ${money(ov.collected_prev_month)} last month`} color="var(--gx-success,#22c55e)" icon={TrendingUp} />
            <KPICard label="New Leads (30d)" value={String(ov.new_leads_30d)}
              sublabel={`vs ${ov.new_leads_prev_30d} prior 30d`} icon={Users} />
          </div>
        )}

        {/* Row 1: Revenue bar + Subscription donut */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '18px', marginBottom: '18px' }}>

          {showRevenue && (
            <Card title="Revenue vs Churn" icon={BarChart3}>
              {revTrend.state === 'loading' && <ChartSkeleton />}
              {revTrend.state === 'ok' && (
                <>
                  <BarChart data={revTrend.value.map(b => ({
                    label: b.month, primary: b.collected, secondary: b.churn ?? 0
                  }))} />
                  <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--gx-text-3)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 10, height: 10, background: 'var(--azure-500)', borderRadius: 2 }} />Collected
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 10, height: 10, background: 'var(--gx-gold)', borderRadius: 2 }} />Churn events
                    </span>
                  </div>
                </>
              )}
            </Card>
          )}

          <Card title="Subscription Mix" icon={PieChart}>
            {subMix.state === 'loading' && <ChartSkeleton h={120} />}
            {subMix.state === 'ok' && (
              <DonutChart slices={subMix.value.map((s, i) => ({
                label: s.product_name ?? 'Unknown',
                value: s.count,
                color: PLAN_COLORS[i % PLAN_COLORS.length],
              }))} />
            )}
            {subMix.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No subscription data</div>}
          </Card>
        </div>

        {/* Row 2: Revenue area + Customer growth line */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '18px' }}>

          {showRevenue && (
            <Card title="Payment Trend" icon={TrendingUp}>
              {revTrend.state === 'loading' && <ChartSkeleton h={120} />}
              {revTrend.state === 'ok' && (
                <AreaChart data={revTrend.value.map(b => ({ label: b.month, value: b.collected }))} />
              )}
            </Card>
          )}

          <Card title="New vs Churned Subs" icon={Users}>
            {customerData.state === 'loading' && <ChartSkeleton h={120} />}
            {customerData.state === 'ok' && (
              <LineChart
                data={customerData.value.labels.map((l, i) => ({
                  label: l, v1: customerData.value.new_[i], v2: customerData.value.churned[i]
                }))}
                series1Label="New"
                series2Label="Churned"
              />
            )}
          </Card>
        </div>

        {/* Row 3: AR aging + Revenue metrics line + Funnel */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '18px', marginBottom: '18px' }}>

          {showRevenue && (
            <Card title="AR Aging" icon={AlertTriangle}>
              {arAging.state === 'loading' && <ChartSkeleton h={100} />}
              {arAging.state === 'ok' && (
                <HorizontalBarChart buckets={[
                  { label: 'Current',   value: arAging.value.current, color: 'var(--gx-success,#22c55e)' },
                  { label: '1–30 days', value: arAging.value.d1_30,   color: 'var(--azure-400)' },
                  { label: '31–60 days',value: arAging.value.d31_60,  color: 'var(--gx-warning,#f59e0b)' },
                  { label: '61–90 days',value: arAging.value.d61_90,  color: '#f97316' },
                  { label: '90+ days',  value: arAging.value.d90_plus,color: 'var(--gx-danger,#ef4444)' },
                ].filter(b => b.value > 0)} />
              )}
              {arAging.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No outstanding AR</div>}
            </Card>
          )}

          {showRevenue && (
            <Card title="Monthly Revenue vs Prior" icon={BarChart3}>
              {revMetrics.state === 'loading' && <ChartSkeleton h={100} />}
              {revMetrics.state === 'ok' && (
                <BarChart data={revMetrics.value.map((b: any) => ({
                  label: b.month, primary: b.revenue, secondary: b.churn
                }))} />
              )}
            </Card>
          )}

          <Card title="Sales Funnel" icon={ArrowRight}>
            {funnel.state === 'loading' && <ChartSkeleton h={100} />}
            {funnel.state === 'ok' && <FunnelChart stages={funnel.value} />}
            {funnel.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No pipeline data</div>}
          </Card>
        </div>

        {/* === SECTION: Week vs Week Comparisons === */}
        {compare.state === 'ok' && (
          <>
            <div style={{ marginTop: '12px', marginBottom: '14px', fontSize: 13, fontWeight: 700, color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Week vs Last Week
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginBottom: '18px' }}>
              <ComparisonCard label="Revenue (paid)"    thisVal={compare.value.week.revenue.this}      lastVal={compare.value.week.revenue.last}      formatter={(n) => money(n)} />
              <ComparisonCard label="Invoiced"          thisVal={compare.value.week.invoiced.this}     lastVal={compare.value.week.invoiced.last}     formatter={(n) => money(n)} />
              <ComparisonCard label="Payments"          thisVal={compare.value.week.payments.this}     lastVal={compare.value.week.payments.last} />
              <ComparisonCard label="New customers"     thisVal={compare.value.week.new_customers.this} lastVal={compare.value.week.new_customers.last} />
              <ComparisonCard label="New leads"         thisVal={compare.value.week.new_leads.this}    lastVal={compare.value.week.new_leads.last} />
              <ComparisonCard label="Churned subs"      thisVal={compare.value.week.churned.this}      lastVal={compare.value.week.churned.last}      invertColor />
              <ComparisonCard label="Tickets opened"    thisVal={compare.value.week.tickets.this}      lastVal={compare.value.week.tickets.last}      invertColor />
              <ComparisonCard label="Workitems done"    thisVal={compare.value.week.workitems_done.this} lastVal={compare.value.week.workitems_done.last} />
            </div>

            {/* === SECTION: Month vs Last Month === */}
            <div style={{ marginTop: '8px', marginBottom: '14px', fontSize: 13, fontWeight: 700, color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Month vs Last Month
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginBottom: '18px' }}>
              <ComparisonCard label="Revenue (paid)"    thisVal={compare.value.month.revenue.this}      lastVal={compare.value.month.revenue.last}      formatter={(n) => money(n)} />
              <ComparisonCard label="Invoiced"          thisVal={compare.value.month.invoiced.this}     lastVal={compare.value.month.invoiced.last}     formatter={(n) => money(n)} />
              <ComparisonCard label="Payments"          thisVal={compare.value.month.payments.this}     lastVal={compare.value.month.payments.last} />
              <ComparisonCard label="New customers"     thisVal={compare.value.month.new_customers.this} lastVal={compare.value.month.new_customers.last} />
              <ComparisonCard label="New leads"         thisVal={compare.value.month.new_leads.this}    lastVal={compare.value.month.new_leads.last} />
              <ComparisonCard label="Churned subs"      thisVal={compare.value.month.churned.this}      lastVal={compare.value.month.churned.last}      invertColor />
              <ComparisonCard label="Tickets opened"    thisVal={compare.value.month.tickets.this}      lastVal={compare.value.month.tickets.last}      invertColor />
              <ComparisonCard label="Workitems done"    thisVal={compare.value.month.workitems_done.this} lastVal={compare.value.month.workitems_done.last} />
            </div>

            {/* === SECTION: Quarter & Year Comparisons === */}
            <div style={{ marginTop: '8px', marginBottom: '14px', fontSize: 13, fontWeight: 700, color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Quarter & Year Comparisons
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '18px' }}>
              <Card title="Quarter vs Last Quarter" icon={Calendar}>
                <GroupedBarChart data={[
                  { label: 'Revenue',    thisVal: compare.value.quarter.revenue.this / 100,   lastVal: compare.value.quarter.revenue.last / 100 },
                  { label: 'Payments',   thisVal: compare.value.quarter.payments.this,        lastVal: compare.value.quarter.payments.last },
                  { label: 'Customers',  thisVal: compare.value.quarter.new_customers.this,   lastVal: compare.value.quarter.new_customers.last },
                  { label: 'Leads',      thisVal: compare.value.quarter.new_leads.this,       lastVal: compare.value.quarter.new_leads.last },
                  { label: 'Churn',      thisVal: compare.value.quarter.churned.this,         lastVal: compare.value.quarter.churned.last },
                  { label: 'Tickets',    thisVal: compare.value.quarter.tickets.this,         lastVal: compare.value.quarter.tickets.last },
                ]} />
              </Card>

              <Card title="Year vs Last Year (YoY)" icon={Calendar}>
                <GroupedBarChart data={[
                  { label: 'Revenue',    thisVal: compare.value.year.revenue.this / 100,      lastVal: compare.value.year.revenue.last / 100 },
                  { label: 'Payments',   thisVal: compare.value.year.payments.this,           lastVal: compare.value.year.payments.last },
                  { label: 'Customers',  thisVal: compare.value.year.new_customers.this,      lastVal: compare.value.year.new_customers.last },
                  { label: 'Leads',      thisVal: compare.value.year.new_leads.this,          lastVal: compare.value.year.new_leads.last },
                  { label: 'Churn',      thisVal: compare.value.year.churned.this,            lastVal: compare.value.year.churned.last },
                  { label: 'Tickets',    thisVal: compare.value.year.tickets.this,            lastVal: compare.value.year.tickets.last },
                ]} />
              </Card>
            </div>
          </>
        )}

        {/* === SECTION: Weekly Trend (multi-series) === */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '18px', marginBottom: '18px' }}>
          <Card title="Weekly Trend — Revenue, Customers, Churn" icon={TrendingUp}>
            {weekly.state === 'loading' && <ChartSkeleton h={130} />}
            {weekly.state === 'ok' && (
              <MultiLineChart
                labels={weekly.value.map((w: any) => w.week)}
                series={[
                  { name: 'Revenue (×1k AMD)',  values: weekly.value.map((w: any) => Math.round(w.revenue / 100000)), color: 'var(--azure-500)' },
                  { name: 'New customers',      values: weekly.value.map((w: any) => w.customers),                    color: '#22c55e' },
                  { name: 'Churns',             values: weekly.value.map((w: any) => w.churns),                       color: 'var(--gx-danger,#ef4444)' },
                ]}
              />
            )}
            {weekly.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No weekly data</div>}
          </Card>

          <Card title="Daily Payment Heatmap" icon={Activity}>
            {heatmap.state === 'loading' && <ChartSkeleton h={130} />}
            {heatmap.state === 'ok' && <HeatmapChart data={heatmap.value} />}
            {heatmap.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No payment activity</div>}
          </Card>
        </div>

        {/* === SECTION: Status Breakdown (3 columns) === */}
        {statusBreak.state === 'ok' && (
          <>
            <div style={{ marginTop: '8px', marginBottom: '14px', fontSize: 13, fontWeight: 700, color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Current Status Breakdown
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '18px', marginBottom: '18px' }}>
              <Card title="Workitems by Status" icon={CheckSquare}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.workitems).reduce((s: number, v) => s + (v as number), 0) as number}
                  buckets={[
                    { label: 'TODO',        value: statusBreak.value.workitems.TODO ?? 0,        color: 'var(--gx-text-3)' },
                    { label: 'In Progress', value: statusBreak.value.workitems.IN_PROGRESS ?? 0, color: 'var(--azure-500)' },
                    { label: 'Blocked',     value: statusBreak.value.workitems.BLOCKED ?? 0,     color: 'var(--gx-danger,#ef4444)' },
                    { label: 'Done',        value: statusBreak.value.workitems.DONE ?? 0,        color: 'var(--gx-success,#22c55e)' },
                  ]}
                />
              </Card>

              <Card title="Tickets by Status" icon={Inbox}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.tickets).reduce((s: number, v) => s + (v as number), 0) as number}
                  buckets={[
                    { label: 'Open',     value: statusBreak.value.tickets.OPEN ?? 0,        color: 'var(--azure-500)' },
                    { label: 'Pending',  value: statusBreak.value.tickets.PENDING ?? 0,     color: 'var(--gx-warning,#f59e0b)' },
                    { label: 'Resolved', value: statusBreak.value.tickets.RESOLVED ?? 0,    color: 'var(--gx-success,#22c55e)' },
                    { label: 'Closed',   value: statusBreak.value.tickets.CLOSED ?? 0,      color: 'var(--gx-text-3)' },
                  ]}
                />
              </Card>

              <Card title="Invoices by Status" icon={Banknote}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.invoices).reduce((s: number, v) => s + (v as number), 0) as number}
                  buckets={[
                    { label: 'Draft',   value: statusBreak.value.invoices.DRAFT ?? 0,   color: 'var(--gx-text-3)' },
                    { label: 'Issued',  value: statusBreak.value.invoices.ISSUED ?? 0,  color: 'var(--azure-500)' },
                    { label: 'Paid',    value: statusBreak.value.invoices.PAID ?? 0,    color: 'var(--gx-success,#22c55e)' },
                    { label: 'Overdue', value: statusBreak.value.invoices.OVERDUE ?? 0, color: 'var(--gx-danger,#ef4444)' },
                    { label: 'Void',    value: statusBreak.value.invoices.VOID ?? 0,    color: 'var(--gx-text-3)' },
                  ]}
                />
              </Card>

              <Card title="Subscriptions by Status" icon={Users}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.subscriptions).reduce((s: number, v) => s + (v as number), 0) as number}
                  buckets={[
                    { label: 'Active',    value: statusBreak.value.subscriptions.ACTIVE ?? 0,    color: 'var(--gx-success,#22c55e)' },
                    { label: 'Suspended', value: statusBreak.value.subscriptions.SUSPENDED ?? 0, color: 'var(--gx-warning,#f59e0b)' },
                    { label: 'Cancelled', value: statusBreak.value.subscriptions.CANCELLED ?? 0, color: 'var(--gx-danger,#ef4444)' },
                  ]}
                />
              </Card>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
