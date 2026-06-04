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
import { useEffect, useMemo, useState } from 'react'
import { BarChart3, TrendingUp, TrendingDown, Users, Banknote, AlertTriangle, PieChart, ArrowRight, Calendar, Activity, Inbox, CheckSquare, Settings, type LucideIcon } from 'lucide-react'
import { GearIcon, ChartIcon } from '../components/icons'
import { money } from '../lib/money'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { BASE, authH } from '../lib/billing'
import { loadSelected, saveSelected } from '../lib/dashboard-catalog'
import ChartPicker from '../components/ChartPicker'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
// DF-1/DF-2/AC-2 — DashboardView is the vertical-slice migration target.
// All 23 useEffect+fetch+alive blocks below have been replaced with
// useFetched / useFetch calls. See docs/standards/SERVER_STATE_STANDARD.md.
import { useAuth } from '../context/AuthContext'
import { useFetch, useFetched, type Fetched } from '../hooks/useFetch'

type Range = '7d' | '30d' | 'qtd' | 'ytd'

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

// Bar chart — revenue (azure-interactive) + churn indicator (gold band at bottom)
function BarChart({ data }: { data: { label: string; primary: number; secondary?: number }[] }) {
  const maxP = Math.max(...data.map(d => d.primary), 1)
  const maxS = Math.max(...data.map(d => d.secondary ?? 0), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }}>
        {data.map(b => (
          <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 2 }} title={b.label}>
            {/* D18: primary revenue bar = drillable/active series → --gx-chart-active (= --gx-interactive). Gradient routed via --gx-interactive-hover → --gx-interactive-active to keep the depth cue without touching Tier-0 azure scales. */}
            <div style={{ height: `${b.primary / maxP * 82}%`, background: 'linear-gradient(180deg,var(--gx-interactive-hover),var(--gx-interactive-active))', borderRadius: '4px 4px 0 0', minHeight: b.primary > 0 ? 4 : 0 }} />
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
          {/* D18: area chart fill + stroke = active drillable series → --gx-chart-active (= --gx-interactive). */}
          <linearGradient id="areafill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gx-chart-active)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gx-chart-active)" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#areafill)" />
        <polyline points={polyline} fill="none" stroke="var(--gx-chart-active)" strokeWidth="2" strokeLinejoin="round" />
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
        {/* D18: series 1 = primary drillable line → --gx-chart-active; series 2 = peak/highlight → --gx-gold (dashed). */}
        <polyline points={pts1} fill="none" stroke="var(--gx-chart-active)" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={pts2} fill="none" stroke="var(--gx-gold)" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 3" />
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--gx-text-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 2, background: 'var(--gx-chart-active)', display: 'inline-block', borderRadius: 1 }} />{series1Label}
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
            {/* D18: KPI sparkline default is passive/decorative → --gx-chart-default (= slate-400). Caller may override with a semantic state color (success/danger). */}
            <polyline points={pts} fill="none" stroke={color ?? 'var(--gx-chart-default)'} strokeWidth="1.5" strokeLinejoin="round" />
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

// D18: distinct-identity palette (plan slices, lead sources, sankey nodes) →
// categorical viz palette --viz-1..--viz-8 (locked, color-blind aware). Raw
// Tier-0 azure + inline hex previously here both violated D18: component code
// must never reach raw scales, and the family must be slate/viz/semantic, not
// the interactive azure family used for chart series.
const PLAN_COLORS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-5)', 'var(--viz-4)', 'var(--viz-7)']

// Gantt — projects as horizontal bars positioned by date range
function GanttChart({ projects }: { projects: { id: string; name: string; start_date: string; due_date: string; status: string; owner?: string }[] }) {
  if (projects.length === 0) return null
  // Compute overall time range from all start/end dates
  const starts = projects.map(p => new Date(p.start_date).getTime()).filter(t => !isNaN(t))
  const ends   = projects.map(p => new Date(p.due_date).getTime()).filter(t => !isNaN(t))
  const minT = Math.min(...starts)
  const maxT = Math.max(...ends)
  const span = Math.max(1, maxT - minT)
  // D18: Gantt status colors — PLANNING (neutral slate), ACTIVE = the
  // in-progress drillable bar → --gx-chart-active (= --gx-interactive),
  // ON_HOLD/DONE/CANCELLED → semantic family (warning/success/danger).
  const statusColor = (s: string) => ({
    'PLANNING':  'var(--gx-text-3)',
    'ACTIVE':    'var(--gx-chart-active)',
    'ON_HOLD':   'var(--gx-warning,#f59e0b)',
    'DONE':      'var(--gx-success,#22c55e)',
    'CANCELLED': 'var(--gx-danger,#ef4444)',
  }[s] ?? 'var(--gx-text-3)')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto', padding: 4 }}>
      {projects.slice(0, 12).map(p => {
        const s = new Date(p.start_date).getTime()
        const e = new Date(p.due_date).getTime()
        const leftPct  = ((s - minT) / span) * 100
        const widthPct = Math.max(2, ((e - s) / span) * 100)
        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ width: 110, textAlign: 'right', color: 'var(--gx-text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.name}>{p.name}</span>
            <div style={{ flex: 1, position: 'relative', height: 16, background: 'var(--gx-surface-2)', borderRadius: 3 }}>
              <div title={`${p.start_date} to ${p.due_date} - ${p.status}`}
                style={{
                  position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`,
                  top: 1, bottom: 1, background: statusColor(p.status), borderRadius: 3,
                }} />
            </div>
            <span style={{ width: 60, fontSize: 10, color: 'var(--gx-text-3)', textAlign: 'right' }}>{p.status}</span>
          </div>
        )
      })}
    </div>
  )
}

// Pareto — bar chart with cumulative-% line overlay
function ParetoChart({ data }: { data: { category: string; count: number; cum_pct: number }[] }) {
  if (data.length === 0) return null
  const maxCount = Math.max(...data.map(d => d.count), 1)
  return (
    <div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 4, height: 160 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', position: 'relative' }} title={`${d.category}: ${d.count} (${d.cum_pct}% cum)`}>
            {/* D18: Pareto top-3 = highlighted drillable bars → --gx-chart-active; rest = passive slate → --gx-chart-default. */}
            <div style={{
              height: `${(d.count / maxCount) * 80}%`,
              background: i < 3 ? 'var(--gx-chart-active)' : 'var(--gx-chart-default)',
              borderRadius: '3px 3px 0 0',
            }} />
            <span style={{ fontSize: 9, color: 'var(--gx-text-3)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{d.category}</span>
          </div>
        ))}
        {/* Cumulative % overlay line */}
        <svg viewBox={`0 0 ${data.length} 100`} preserveAspectRatio="none"
             style={{ position: 'absolute', inset: 0, height: '80%', pointerEvents: 'none' }}>
          <polyline
            points={data.map((d, i) => `${i + 0.5},${100 - d.cum_pct}`).join(' ')}
            fill="none" stroke="var(--gx-gold)" strokeWidth="0.8" vectorEffect="non-scaling-stroke"
          />
          <line x1="0" y1="20" x2={data.length} y2="20" stroke="var(--gx-warning,#f59e0b)" strokeDasharray="2 2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: 'var(--gx-text-3)' }}>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, background: 'var(--gx-chart-active)', borderRadius: 2, marginRight: 4 }} />Top 3</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 2, background: 'var(--gx-gold)', verticalAlign: 'middle', marginRight: 4 }} />Cumulative %</span>
        <span style={{ marginLeft: 'auto' }}>80% target line</span>
      </div>
    </div>
  )
}

// Sankey — simple horizontal flow with 4 stacked columns + connecting bands
function SankeyChart({ data }: { data: { nodes: { id: string; name: string; value: number }[]; links: { source: string; target: string; value: number }[] } }) {
  const max = Math.max(...data.nodes.map(n => n.value), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 160 }}>
        {data.nodes.map((n, i) => {
          const h = (n.value / max) * 100
          const conv = i > 0 ? Math.round((n.value / Math.max(data.nodes[i - 1].value, 1)) * 100) : null
          return (
            <>
              <div key={n.id} style={{ flex: '0 0 16%', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ width: '80%', height: `${Math.max(h, 5)}%`,
                  background: PLAN_COLORS[i % PLAN_COLORS.length], borderRadius: 3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: 13,
                }}>{n.value}</div>
                <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600 }}>{n.name}</div>
                {conv !== null && (
                  <div style={{ fontSize: 10, color: 'var(--gx-text-3)' }}>{conv}% conv</div>
                )}
              </div>
              {i < data.nodes.length - 1 && (
                <div key={`arrow-${i}`} style={{
                  flex: 1, height: 2,
                  // D18: connector encodes flow direction (active → passive). Start = active drillable
                  // (--gx-chart-active), end = passive default text → keep --gx-text-3.
                  background: 'linear-gradient(90deg, var(--gx-chart-active), var(--gx-text-3))',
                  position: 'relative',
                }}>
                  <div style={{
                    position: 'absolute', right: -5, top: -3, width: 0, height: 0,
                    borderLeft: '6px solid var(--gx-text-3)',
                    borderTop: '4px solid transparent', borderBottom: '4px solid transparent',
                  }} />
                </div>
              )}
            </>
          )
        })}
      </div>
    </div>
  )
}

// Geographic — simple lat/lon dots projected into a bounding box
function GeoMap({ points }: { points: { id: string; kind: string; name: string; lat: number; lon: number; status: string | null }[] }) {
  if (points.length === 0) return null
  const lats = points.map(p => p.lat)
  const lons = points.map(p => p.lon)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const latSpan = Math.max(0.01, maxLat - minLat)
  const lonSpan = Math.max(0.01, maxLon - minLon)
  // D18: geo point kinds = distinct-identity categories → categorical viz
  // palette. Tower's previous --gx-gold + customer's inline #22c55e + the
  // coverage_check inline #ec4899 all violated D18 (gold is brand signature
  // only, semantic green is for status, raw hex is Tier-0). Route all four
  // through --viz-1..--viz-8 so the map is color-blind aware.
  const kindColor = (k: string) => ({
    site: 'var(--viz-1)',
    tower: 'var(--viz-2)',
    customer: 'var(--viz-3)',
    coverage_check: 'var(--viz-4)',
  } as Record<string, string>)[k] ?? 'var(--gx-text-3)'
  const W = 100, H = 70
  return (
    <div>
      <div style={{
        position: 'relative', width: '100%', height: 180, background: 'var(--gx-surface-2)',
        borderRadius: 4, overflow: 'hidden', border: '1px solid var(--gx-border)',
      }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          {/* dotted grid */}
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={`gx-${i}`} x1={i * 10} y1="0" x2={i * 10} y2={H} stroke="var(--gx-border)" strokeWidth="0.2" />
          ))}
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={`gy-${i}`} x1="0" y1={i * 10} x2={W} y2={i * 10} stroke="var(--gx-border)" strokeWidth="0.2" />
          ))}
          {points.slice(0, 200).map(p => {
            const x = ((p.lon - minLon) / lonSpan) * (W - 4) + 2
            // Invert lat — north is up
            const y = ((maxLat - p.lat) / latSpan) * (H - 4) + 2
            return (
              <circle key={p.id} cx={x} cy={y} r="1.2" fill={kindColor(p.kind)} opacity="0.85">
                <title>{`${p.name} (${p.kind})`}</title>
              </circle>
            )
          })}
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--gx-text-3)', flexWrap: 'wrap' }}>
        {Object.entries(points.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc }, {} as Record<string, number>)).map(([k, n]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: kindColor(k) }} />
            {k.replace(/_/g, ' ')} ({n})
          </span>
        ))}
      </div>
    </div>
  )
}

// Net Subscriber Growth — bar chart with net (new - churn) per week
function NetGrowthChart({ data }: { data: { week: string; new: number; churned: number; net: number }[] }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => Math.max(d.new, d.churned, 1)))
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140 }}>
        {data.map(d => (
          <div key={d.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 1 }} title={`${d.week}: +${d.new} new, -${d.churned} churn, net ${d.net}`}>
            <div style={{
              height: `${(d.new / max) * 50}%`,
              background: 'var(--gx-success,#22c55e)',
              borderRadius: '2px 2px 0 0',
              minHeight: d.new > 0 ? 2 : 0,
            }} />
            <div style={{
              height: `${(d.churned / max) * 50}%`,
              background: 'var(--gx-danger,#ef4444)',
              borderRadius: '0 0 2px 2px',
              minHeight: d.churned > 0 ? 2 : 0,
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--gx-text-3)' }}>
        <span>Net change: {data.reduce((s, d) => s + d.net, 0)}</span>
        <span style={{ display: 'flex', gap: 10 }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--gx-success,#22c55e)', borderRadius: 2, marginRight: 4 }} />New</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--gx-danger,#ef4444)', borderRadius: 2, marginRight: 4 }} />Churned</span>
        </span>
      </div>
    </div>
  )
}

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
              {/* D18: "this period" = the active drillable series → gradient routed via --gx-interactive-hover/-active. "Last period" stays as faded slate text-3 (passive prior-period reference). */}
              <div style={{ width: '40%', height: `${d.thisVal / max * 100}%`,
                background: 'linear-gradient(180deg,var(--gx-interactive-hover),var(--gx-interactive-active))',
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
          <span style={{ width: 10, height: 10, background: 'var(--gx-chart-active)', borderRadius: 2 }} />This period
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
  const pareto      = useFetched<any[]>('/api/analytics/pareto/lead?group_field=source&limit=8', nonEmptyArr)
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
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '18px', marginBottom: '18px' }}>

            {isShown('revenue-bar') && showRevenue && (
              <Card title="Revenue vs Churn" icon={BarChart3}>
                {revTrend.state === 'loading' && <ChartSkeleton />}
                {revTrend.state === 'ok' && (
                  <>
                    <BarChart data={revTrend.value.map(b => ({
                      label: b.month, primary: b.collected, secondary: b.churn ?? 0
                    }))} />
                    <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--gx-text-3)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {/* D18: legend swatch matches BarChart primary fill → --gx-chart-active. */}
                        <span style={{ width: 10, height: 10, background: 'var(--gx-chart-active)', borderRadius: 2 }} />Collected
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 10, height: 10, background: 'var(--gx-gold)', borderRadius: 2 }} />Churn events
                      </span>
                    </div>
                  </>
                )}
              </Card>
            )}

            {isShown('sub-donut') && (
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
            )}
          </div>
        )}

        {/* Row 2: Revenue area + Customer growth line */}
        {(isShown('payment-area') || isShown('customer-line')) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '18px' }}>

          {isShown('payment-area') && showRevenue && (
            <Card title="Payment Trend" icon={TrendingUp}>
              {revTrend.state === 'loading' && <ChartSkeleton h={120} />}
              {revTrend.state === 'ok' && (
                <AreaChart data={revTrend.value.map(b => ({ label: b.month, value: b.collected }))} />
              )}
            </Card>
          )}

          {isShown('customer-line') && (
          <Card title="New vs Churned Subs" icon={Users}>
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
            {customerData.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No customer activity data</div>}
          </Card>
          )}
        </div>
        )}

        {/* Row 3: AR aging + Revenue metrics line + Funnel */}
        {(isShown('ar-aging') || isShown('monthly-revenue') || isShown('funnel')) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '18px', marginBottom: '18px' }}>

          {isShown('ar-aging') && showRevenue && (
            <Card title="AR Aging" icon={AlertTriangle}>
              {arAging.state === 'loading' && <ChartSkeleton h={100} />}
              {/* D18: AR aging buckets — Current (success), 1-30 = sequential intermediate (slate default, not yet a warning), 31-60 (warning), 61-90 (danger-adjacent, was inline #f97316 → semantic warning is closest), 90+ (danger). */}
              {arAging.state === 'ok' && (
                <HorizontalBarChart buckets={[
                  { label: 'Current',   value: arAging.value.current, color: 'var(--gx-success,#22c55e)' },
                  { label: '1-30 days', value: arAging.value.d1_30,   color: 'var(--gx-chart-default)' },
                  { label: '31-60 days',value: arAging.value.d31_60,  color: 'var(--gx-warning,#f59e0b)' },
                  { label: '61-90 days',value: arAging.value.d61_90,  color: 'var(--gx-warning,#f59e0b)' },
                  { label: '90+ days',  value: arAging.value.d90_plus,color: 'var(--gx-danger,#ef4444)' },
                ].filter(b => b.value > 0)} />
              )}
              {arAging.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No outstanding AR</div>}
            </Card>
          )}

          {isShown('monthly-revenue') && showRevenue && (
            <Card title="Monthly Revenue vs Prior" icon={BarChart3}>
              {revMetrics.state === 'loading' && <ChartSkeleton h={100} />}
              {revMetrics.state === 'ok' && (
                <BarChart data={revMetrics.value.map((b: any) => ({
                  label: b.month, primary: b.revenue, secondary: b.churn
                }))} />
              )}
            </Card>
          )}

          {isShown('funnel') && (
          <Card title="Sales Funnel" icon={ArrowRight}>
            {funnel.state === 'loading' && <ChartSkeleton h={100} />}
            {funnel.state === 'ok' && <FunnelChart stages={funnel.value} />}
            {funnel.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No pipeline data</div>}
          </Card>
          )}
        </div>
        )}

        {/* === SECTION: Week vs Week Comparisons === */}
        {isShown('wow-cards') && compare.state === 'ok' && (
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
          </>
        )}

        {/* === SECTION: Month vs Last Month === */}
        {isShown('mom-cards') && compare.state === 'ok' && (
          <>
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
          </>
        )}

        {/* === SECTION: Quarter & Year Comparisons === */}
        {(isShown('qoq-bars') || isShown('yoy-bars')) && compare.state === 'ok' && (
          <>
            <div style={{ marginTop: '8px', marginBottom: '14px', fontSize: 13, fontWeight: 700, color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Quarter & Year Comparisons
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '18px' }}>
              {isShown('qoq-bars') && (
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
              )}
              {isShown('yoy-bars') && (
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
              )}
            </div>
          </>
        )}

        {/* === SECTION: Weekly Trend (multi-series) + Heatmap === */}
        {(isShown('weekly-trend') || isShown('heatmap')) && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '18px', marginBottom: '18px' }}>
          {isShown('weekly-trend') && (
          <Card title="Weekly Trend — Revenue, Customers, Churn" icon={TrendingUp}>
            {weekly.state === 'loading' && <ChartSkeleton h={130} />}
            {/* D18: three distinct-identity series in one multi-line chart. Revenue = primary drillable series → --gx-chart-active. New customers (was inline #22c55e) is the "good growth" line — keep semantic success. Churns stays on semantic danger. */}
            {weekly.state === 'ok' && (
              <MultiLineChart
                labels={weekly.value.map((w: any) => w.week)}
                series={[
                  { name: 'Revenue (x1k AMD)',  values: weekly.value.map((w: any) => Math.round(w.revenue / 100000)), color: 'var(--gx-chart-active)' },
                  { name: 'New customers',      values: weekly.value.map((w: any) => w.customers),                    color: 'var(--gx-success,#22c55e)' },
                  { name: 'Churns',             values: weekly.value.map((w: any) => w.churns),                       color: 'var(--gx-danger,#ef4444)' },
                ]}
              />
            )}
            {weekly.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No weekly data</div>}
          </Card>
          )}

          {isShown('heatmap') && (
          <Card title="Daily Payment Heatmap" icon={Activity}>
            {heatmap.state === 'loading' && <ChartSkeleton h={130} />}
            {heatmap.state === 'ok' && <HeatmapChart data={heatmap.value} />}
            {heatmap.state === 'hide' && <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No payment activity</div>}
          </Card>
          )}
        </div>
        )}

        {/* === SECTION: Status Breakdown (individually toggleable) === */}
        {statusBreak.state === 'ok' && (isShown('status-workitems') || isShown('status-tickets') || isShown('status-invoices') || isShown('status-subs')) && (
          <>
            <div style={{ marginTop: '8px', marginBottom: '14px', fontSize: 13, fontWeight: 700, color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Current Status Breakdown
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px', marginBottom: '18px' }}>
              {isShown('status-workitems') && (
              <Card title="Workitems by Status" icon={CheckSquare}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.workitems).reduce((s: number, v) => s + (v as number), 0) as number}
                  // D18: IN_PROGRESS = actively-being-worked status → --gx-chart-active (interactive). Other states use slate (todo), semantic danger (blocked), semantic success (done).
                  buckets={[
                    { label: 'TODO',        value: statusBreak.value.workitems.TODO ?? 0,        color: 'var(--gx-text-3)' },
                    { label: 'In Progress', value: statusBreak.value.workitems.IN_PROGRESS ?? 0, color: 'var(--gx-chart-active)' },
                    { label: 'Blocked',     value: statusBreak.value.workitems.BLOCKED ?? 0,     color: 'var(--gx-danger,#ef4444)' },
                    { label: 'Done',        value: statusBreak.value.workitems.DONE ?? 0,        color: 'var(--gx-success,#22c55e)' },
                  ]}
                />
              </Card>
              )}

              {isShown('status-tickets') && (
              <Card title="Tickets by Status" icon={Inbox}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.tickets).reduce((s: number, v) => s + (v as number), 0) as number}
                  // D18: OPEN = the active drillable ticket bucket → --gx-chart-active. Pending (warning), Resolved (success), Closed (slate).
                  buckets={[
                    { label: 'Open',     value: statusBreak.value.tickets.OPEN ?? 0,        color: 'var(--gx-chart-active)' },
                    { label: 'Pending',  value: statusBreak.value.tickets.PENDING ?? 0,     color: 'var(--gx-warning,#f59e0b)' },
                    { label: 'Resolved', value: statusBreak.value.tickets.RESOLVED ?? 0,    color: 'var(--gx-success,#22c55e)' },
                    { label: 'Closed',   value: statusBreak.value.tickets.CLOSED ?? 0,      color: 'var(--gx-text-3)' },
                  ]}
                />
              </Card>
              )}

              {isShown('status-invoices') && (
              <Card title="Invoices by Status" icon={Banknote}>
                <StatusBreakdown
                  total={Object.values(statusBreak.value.invoices).reduce((s: number, v) => s + (v as number), 0) as number}
                  // D18: ISSUED = the active drillable invoice bucket awaiting payment → --gx-chart-active. Paid (success), Overdue (danger), Draft/Void (slate).
                  buckets={[
                    { label: 'Draft',   value: statusBreak.value.invoices.DRAFT ?? 0,   color: 'var(--gx-text-3)' },
                    { label: 'Issued',  value: statusBreak.value.invoices.ISSUED ?? 0,  color: 'var(--gx-chart-active)' },
                    { label: 'Paid',    value: statusBreak.value.invoices.PAID ?? 0,    color: 'var(--gx-success,#22c55e)' },
                    { label: 'Overdue', value: statusBreak.value.invoices.OVERDUE ?? 0, color: 'var(--gx-danger,#ef4444)' },
                    { label: 'Void',    value: statusBreak.value.invoices.VOID ?? 0,    color: 'var(--gx-text-3)' },
                  ]}
                />
              </Card>
              )}

              {isShown('status-subs') && (
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
              )}
            </div>
          </>
        )}

        {/* === SECTION: New charts (RAG, aging, risk, leads, sales) === */}
        {(isShown('rag-health') || isShown('task-aging') || isShown('issue-aging') || isShown('risk-heatmap') || isShown('lead-source-donut') || isShown('salesperson-rank')) && (
          <>
            <div style={{ marginTop: '8px', marginBottom: '14px', fontSize: 13, fontWeight: 700, color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Execution Insights
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px', marginBottom: '18px' }}>

              {isShown('rag-health') && ragHealth.state === 'ok' && (
                <Card title="RAG Execution Health" icon={AlertTriangle}>
                  <DonutChart slices={[
                    { label: 'Red',   value: ragHealth.value.red,   color: 'var(--gx-danger,#ef4444)' },
                    { label: 'Amber', value: ragHealth.value.amber, color: 'var(--gx-warning,#f59e0b)' },
                    { label: 'Green', value: ragHealth.value.green, color: 'var(--gx-success,#22c55e)' },
                  ].filter(s => s.value > 0)} />
                </Card>
              )}

              {isShown('task-aging') && taskAging.state === 'ok' && (
                <Card title="Task Aging" icon={CheckSquare}>
                  {/* D18: aging sequence (0-7 success, 8-15 intermediate slate, 16-30 warning, 30+ danger). 8-15 was --azure-400 (Tier-0 violation) — now slate default. */}
                  <HorizontalBarChart buckets={[
                    { label: '0-7 days',   value: taskAging.value.d0_7,     color: 'var(--gx-success,#22c55e)' },
                    { label: '8-15 days',  value: taskAging.value.d8_15,    color: 'var(--gx-chart-default)' },
                    { label: '16-30 days', value: taskAging.value.d16_30,   color: 'var(--gx-warning,#f59e0b)' },
                    { label: '30+ days',   value: taskAging.value.d30_plus, color: 'var(--gx-danger,#ef4444)' },
                  ].filter(b => b.value > 0).map(b => ({ ...b, value: b.value * 100 }))} />
                  <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Open workitems by age</div>
                </Card>
              )}

              {isShown('issue-aging') && ticketAging.state === 'ok' && (
                <Card title="Issue Aging" icon={Inbox}>
                  {/* D18: aging sequence mirror of Task Aging — 8-15 was --azure-400 (Tier-0 violation) → --gx-chart-default (slate). */}
                  <HorizontalBarChart buckets={[
                    { label: '0-7 days',   value: ticketAging.value.d0_7,     color: 'var(--gx-success,#22c55e)' },
                    { label: '8-15 days',  value: ticketAging.value.d8_15,    color: 'var(--gx-chart-default)' },
                    { label: '16-30 days', value: ticketAging.value.d16_30,   color: 'var(--gx-warning,#f59e0b)' },
                    { label: '30+ days',   value: ticketAging.value.d30_plus, color: 'var(--gx-danger,#ef4444)' },
                  ].filter(b => b.value > 0).map(b => ({ ...b, value: b.value * 100 }))} />
                  <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Open tickets by age</div>
                </Card>
              )}

              {isShown('risk-heatmap') && riskHeatmap.state === 'ok' && (
                <Card title="Risk Heat Map" icon={AlertTriangle}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(3, 1fr)', gap: 3, padding: 6 }}>
                    <div></div>
                    {['Low', 'Medium', 'High'].map(im => (
                      <div key={im} style={{ fontSize: 10, textAlign: 'center', color: 'var(--gx-text-3)', padding: '4px 0' }}>{im}</div>
                    ))}
                    {['high', 'medium', 'low'].map(li => (
                      <>
                        <div key={li} style={{ fontSize: 10, color: 'var(--gx-text-3)', alignSelf: 'center', paddingRight: 6, textAlign: 'right' }}>{li[0].toUpperCase() + li.slice(1)}</div>
                        {['low', 'medium', 'high'].map(im => {
                          const v = Number(riskHeatmap.value[`${li}_${im}`] ?? 0)
                          // color intensity: low_low = green, high_high = red
                          const score = (li === 'high' ? 2 : li === 'medium' ? 1 : 0) + (im === 'high' ? 2 : im === 'medium' ? 1 : 0)
                          const bg = score >= 3 ? 'rgba(239,68,68,0.7)'
                                  : score >= 2 ? 'rgba(245,158,11,0.7)'
                                  : score >= 1 ? 'rgba(234,179,8,0.5)'
                                  : 'rgba(34,197,94,0.5)'
                          return (
                            <div key={`${li}-${im}`} style={{
                              background: v > 0 ? bg : 'var(--gx-surface-2)',
                              height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              borderRadius: 4, fontSize: 14, fontWeight: 700, color: v > 0 ? '#fff' : 'var(--gx-text-3)',
                            }}>{v}</div>
                          )
                        })}
                      </>
                    ))}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 6, textAlign: 'center' }}>Impact -&gt;</div>
                </Card>
              )}

              {isShown('lead-source-donut') && leadSources.state === 'ok' && (
                <Card title="Lead Source Distribution" icon={Users}>
                  <DonutChart slices={Object.entries(leadSources.value).map(([src, cnt], i) => ({
                    label: String(src), value: Number(cnt), color: PLAN_COLORS[i % PLAN_COLORS.length],
                  }))} />
                </Card>
              )}

              {isShown('salesperson-rank') && salesByUser.state === 'ok' && (
                <Card title="Customers by Account Manager" icon={Users}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(salesByUser.value)
                      .sort((a, b) => Number(b[1]) - Number(a[1]))
                      .slice(0, 10)
                      .map(([name, cnt]) => {
                        const max = Math.max(...Object.values(salesByUser.value).map((v: any) => Number(v)))
                        return (
                          <div key={name}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                              <span>{name}</span>
                              <span style={{ fontWeight: 600 }}>{Number(cnt)}</span>
                            </div>
                            <div style={{ height: 6, borderRadius: 3, background: 'var(--gx-surface-2)' }}>
                              {/* D18: ranked-list bar = drillable per-rep performance → --gx-chart-active. */}
                              <div style={{ height: '100%', width: `${(Number(cnt) / max) * 100}%`, background: 'var(--gx-chart-active)', borderRadius: 3 }} />
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </Card>
              )}

            </div>
          </>
        )}

        {/* === SECTION: Advanced execution charts === */}
        {(isShown('gantt') || isShown('exec-summary') || isShown('sankey-leads') || isShown('pareto-leads') || isShown('geographic-map') || isShown('net-subscriber-growth')) && (
          <>
            <div style={{ marginTop: '8px', marginBottom: '14px', fontSize: 13, fontWeight: 700, color: 'var(--gx-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Strategic & Operational Charts
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px', marginBottom: '18px' }}>

              {isShown('gantt') && gantt.state === 'ok' && (
                <Card title="Project Gantt" icon={Calendar}>
                  <GanttChart projects={gantt.value} />
                </Card>
              )}
              {isShown('gantt') && gantt.state === 'hide' && (
                <Card title="Project Gantt" icon={Calendar}>
                  <div className="muted" style={{ padding: '18px', fontSize: 13 }}>No projects with start/due dates</div>
                </Card>
              )}

              {isShown('pareto-leads') && pareto.state === 'ok' && (
                <Card title="Lead Sources Pareto" icon={BarChart3}>
                  <ParetoChart data={pareto.value} />
                </Card>
              )}

              {isShown('sankey-leads') && sankey.state === 'ok' && (
                <Card title="Sales Conversion Flow (Sankey)" icon={ArrowRight}>
                  <SankeyChart data={sankey.value} />
                </Card>
              )}

              {isShown('geographic-map') && geoPoints.state === 'ok' && (
                <Card title="Geographic Distribution" icon={Activity}>
                  <GeoMap points={geoPoints.value} />
                </Card>
              )}

              {isShown('net-subscriber-growth') && netGrowth.state === 'ok' && (
                <Card title="Net Subscriber Growth (Weekly)" icon={Users}>
                  <NetGrowthChart data={netGrowth.value} />
                </Card>
              )}

            </div>
          </>
        )}

        {/* Empty state */}
        {selected.size === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--gx-text-3)' }}>
            <Settings size={40} style={{ marginBottom: 16, opacity: 0.4 }} />
            <p style={{ fontSize: 14 }}>No charts selected. Click <strong>Customize</strong> above to choose what to display.</p>
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
