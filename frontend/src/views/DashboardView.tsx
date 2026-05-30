import { useEffect, useState } from 'react'
import {
  Users, Banknote, Inbox, Activity, TrendingUp, TrendingDown, BarChart3,
  Download, ArrowRight,
} from 'lucide-react'
import { GearIcon } from '../components/icons'
import { Spark } from '../components/charts/Spark'
import { StatusPill } from '../primitives/StatusPill'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Range = '30d' | 'qtd' | 'ytd'

interface KpiData {
  label: string
  value: string | null
  delta: string | null
  up: boolean
  icon: React.ReactNode
  accent: boolean
  spark: number[] | null
  unavailable?: string
}

interface WorkRow {
  id: string
  subject: string
  status: string
  sla: string
  prio: string
  assignee: string
}

interface ActivityRow {
  who: string
  act: string
  obj: string
  t: string
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}
function initials(s: string): string {
  if (!s) return '??'
  return s.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
function mapWorkStatus(s: string) {
  const v = (s || '').toUpperCase()
  if (v === 'RESOLVED' || v === 'DONE' || v === 'CLOSED') return 'active'
  if (v === 'IN_PROGRESS' || v === 'IN PROGRESS') return 'degraded'
  if (v === 'BLOCKED') return 'critical'
  return 'neutral'
}
function mapPriority(p: string) {
  const v = (p || '').toUpperCase()
  if (v === 'CRITICAL') return 'critical'
  if (v === 'HIGH') return 'degraded'
  if (v === 'NORMAL') return 'info'
  return 'neutral'
}

export default function DashboardView({
  token, canConfigure = false, onConfigure,
}: { token: string; configVersion?: number; canConfigure?: boolean; onConfigure?: () => void }) {
  const [range, setRange] = useState<Range>('30d')
  const [kpis, setKpis] = useState<KpiData[]>([
    { label: 'Active subscribers', value: null, delta: null, up: true, icon: <Users size={16} />, accent: false, spark: null },
    { label: 'MRR', value: null, delta: null, up: true, icon: <Banknote size={16} />, accent: true, spark: null },
    { label: 'Open tickets', value: null, delta: null, up: false, icon: <Inbox size={16} />, accent: false, spark: null },
    { label: 'Network uptime', value: null, delta: null, up: true, icon: <Activity size={16} />, accent: false, spark: null, unavailable: 'No uptime monitor wired yet' },
  ])
  const [workItems, setWorkItems] = useState<WorkRow[] | null>(null)
  const [workItemsErr, setWorkItemsErr] = useState<string | null>(null)
  const [activity, setActivity] = useState<ActivityRow[] | null>(null)
  const [activityErr, setActivityErr] = useState<string | null>(null)
  const [revenue, setRevenue] = useState<number[] | null>(null)
  const [revenueErr, setRevenueErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    // KPI 1 — Active subscribers
    fetch(`${BASE}/api/subscriptions?status=ACTIVE`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: any) => {
        if (!alive) return
        const count = Array.isArray(d) ? d.length : (d?.total ?? d?.count ?? null)
        if (typeof count === 'number') {
          setKpis(k => k.map((x, i) => i === 0 ? { ...x, value: count.toLocaleString() } : x))
        } else {
          setKpis(k => k.map((x, i) => i === 0 ? { ...x, unavailable: 'No subscribers data' } : x))
        }
      })
      .catch(() => alive && setKpis(k => k.map((x, i) => i === 0 ? { ...x, unavailable: 'Subscribers endpoint unreachable' } : x)))

    // KPI 2 — MRR (sum of active subscription monthly amounts via invoices)
    fetch(`${BASE}/api/invoices?status=OPEN`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? [])
        if (Array.isArray(arr) && arr.length) {
          const sum = arr.reduce((s: number, i: any) => s + (Number(i.total ?? i.amount) || 0), 0)
          setKpis(k => k.map((x, i) => i === 1 ? { ...x, value: fmtMoney(sum) } : x))
        } else {
          setKpis(k => k.map((x, i) => i === 1 ? { ...x, unavailable: 'No invoice data' } : x))
        }
      })
      .catch(() => alive && setKpis(k => k.map((x, i) => i === 1 ? { ...x, unavailable: 'Invoices endpoint unreachable' } : x)))

    // KPI 3 — Open tickets
    fetch(`${BASE}/api/work-items?status=OPEN`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? [])
        if (Array.isArray(arr)) {
          setKpis(k => k.map((x, i) => i === 2 ? { ...x, value: arr.length.toLocaleString() } : x))
        } else {
          setKpis(k => k.map((x, i) => i === 2 ? { ...x, unavailable: 'No tickets data' } : x))
        }
      })
      .catch(() => alive && setKpis(k => k.map((x, i) => i === 2 ? { ...x, unavailable: 'Tickets endpoint unreachable' } : x)))

    // Tickets needing attention — top 4
    fetch(`${BASE}/api/work-items?limit=4`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? [])
        const rows: WorkRow[] = arr.slice(0, 4).map((w: any) => ({
          id: String(w.code ?? w.id ?? '—'),
          subject: w.subject ?? w.title ?? '(no subject)',
          status: w.status ?? 'Open',
          sla: w.sla ?? w.sla_remaining ?? '—',
          prio: w.priority ?? 'Normal',
          assignee: initials(w.assignee_name ?? w.owner_name ?? ''),
        }))
        setWorkItems(rows)
      })
      .catch(() => alive && setWorkItemsErr('Work items endpoint not wired yet'))

    // Activity feed — try common endpoint, fall back to err state
    fetch(`${BASE}/api/audit/recent?limit=5`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? [])
        const rows: ActivityRow[] = arr.slice(0, 5).map((a: any) => ({
          who: a.actor_name ?? a.user_name ?? 'System',
          act: a.action ?? a.event ?? 'updated',
          obj: a.target ?? a.object ?? a.entity ?? '—',
          t: a.relative_time ?? a.created_at ?? '—',
        }))
        setActivity(rows)
      })
      .catch(() => alive && setActivityErr('Activity feed endpoint not wired yet'))

    // Revenue/churn — needs a real /api/metrics/revenue endpoint; show empty state for now
    fetch(`${BASE}/api/metrics/revenue?range=${range}`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d?.values) ? d.values : (Array.isArray(d) ? d : null)
        if (Array.isArray(arr) && arr.length) {
          setRevenue(arr.map((v: any) => Number(v) || 0))
        } else {
          setRevenueErr('No revenue data')
        }
      })
      .catch(() => alive && setRevenueErr('Revenue metrics endpoint not wired yet'))

    return () => { alive = false }
  }, [token, range])

  return (
    <div className="view">
      <div className="view-inner gx-dash fade">
        <div className="crumbs">
          <span>Home</span>
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>Operations Dashboard</span>
        </div>

        <div className="view-head">
          <div className="vh-ic"><BarChart3 size={20} /></div>
          <div>
            <h1>Operations Dashboard</h1>
            <div className="sub">Live across all modules</div>
          </div>
          <span className="spacer" />
          <div className="seg">
            <button className={range === '30d' ? 'on' : ''} onClick={() => setRange('30d')}>30d</button>
            <button className={range === 'qtd' ? 'on' : ''} onClick={() => setRange('qtd')}>QTD</button>
            <button className={range === 'ytd' ? 'on' : ''} onClick={() => setRange('ytd')}>YTD</button>
          </div>
          {canConfigure && onConfigure && (
            <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
              <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />Configure page
            </button>
          )}
          <button className="btn btn-secondary btn-sm"><Download size={14} />Export</button>
        </div>

        <div className="kpis">
          {kpis.map(k => (
            <div className="kpi" key={k.label}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="klbl">{k.label}</span>
                <span className="spacer" />
                <span style={{ color: k.accent ? 'var(--gx-gold)' : 'var(--gx-text-3)' }}>{k.icon}</span>
              </div>
              <div className="kval tnum">
                {k.value ?? (k.unavailable ? <span style={{ color: 'var(--gx-text-3)', fontSize: 18 }}>—</span> : <span className="kpi-skeleton" />)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 22 }}>
                {k.delta ? (
                  <span className={'pill ' + (k.up ? 'pill-success' : 'pill-danger')}>
                    {k.up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{k.delta}
                  </span>
                ) : k.unavailable ? (
                  <span className="hint" style={{ fontSize: 11 }}>{k.unavailable}</span>
                ) : null}
                {k.spark && k.spark.length > 0 && (
                  <Spark
                    values={k.spark}
                    color={k.accent ? 'var(--gx-gold)' : (k.up ? 'var(--gx-success)' : 'var(--gx-danger)')}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="cols">
          <div className="card">
            <div className="card-head">
              <BarChart3 size={16} style={{ color: 'var(--gx-text-3)' }} />
              <h3>Revenue vs. churn</h3>
              <span className="spacer" />
              <span className="pill pill-neutral">{range}</span>
            </div>
            <div className="card-pad">
              {revenue ? <RevenueBars data={revenue} /> : (
                <div className="stub">
                  <div className="si"><BarChart3 size={26} /></div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{revenueErr ?? 'Loading…'}</div>
                  <p className="hint" style={{ maxWidth: 320, lineHeight: 1.6 }}>
                    Wire <code className="mono">/api/metrics/revenue?range=…</code> to populate this chart.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <Activity size={16} style={{ color: 'var(--gx-text-3)' }} />
              <h3>Recent activity</h3>
            </div>
            <div style={{ padding: '6px 0', minHeight: 180 }}>
              {activity === null && activityErr === null && <div className="stub" style={{ padding: 24 }}><p className="hint">Loading…</p></div>}
              {activity && activity.length === 0 && <div className="stub" style={{ padding: 24 }}><p className="hint">No recent activity.</p></div>}
              {activity && activity.length > 0 && activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '10px 18px' }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 'var(--gx-radius-sm)',
                    background: 'var(--gx-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--gx-text-2)', flexShrink: 0,
                  }}><Activity size={15} /></span>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600 }}>{a.who}</span>{' '}
                    <span style={{ color: 'var(--gx-text-2)' }}>{a.act}</span>{' '}
                    <span className="mono" style={{ color: 'var(--gx-link)' }}>{a.obj}</span>
                    <div className="hint" style={{ fontSize: 11 }}>{a.t}</div>
                  </div>
                </div>
              ))}
              {activityErr && (
                <div className="stub" style={{ padding: 24 }}>
                  <div className="si"><Activity size={26} /></div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{activityErr}</div>
                  <p className="hint" style={{ maxWidth: 320, lineHeight: 1.6 }}>
                    Wire <code className="mono">/api/audit/recent</code> to populate this feed.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <Inbox size={16} style={{ color: 'var(--gx-text-3)' }} />
            <h3>Tickets needing attention</h3>
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm">View all<ArrowRight size={14} /></button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {workItems === null && !workItemsErr && <div className="stub" style={{ padding: 24 }}><p className="hint">Loading…</p></div>}
            {workItemsErr && (
              <div className="stub" style={{ padding: 24 }}>
                <div className="si"><Inbox size={26} /></div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{workItemsErr}</div>
              </div>
            )}
            {workItems && workItems.length === 0 && (
              <div className="stub" style={{ padding: 24 }}>
                <div className="si"><Inbox size={26} /></div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>No open tickets.</div>
              </div>
            )}
            {workItems && workItems.length > 0 && (
              <table className="grid">
                <thead><tr>
                  <th>Ticket</th><th>Subject</th><th>Status</th><th>SLA</th><th>Priority</th><th>Owner</th>
                </tr></thead>
                <tbody>
                  {workItems.map(r => (
                    <tr key={r.id}>
                      <td className="mono" style={{ color: 'var(--gx-link)' }}>{r.id}</td>
                      <td style={{ maxWidth: 320 }}>{r.subject}</td>
                      <td><StatusPill variant={mapWorkStatus(r.status)} label={r.status} size="sm" /></td>
                      <td className="mono tnum" style={{
                        color: r.sla === '—' ? 'var(--gx-text-3)' : (r.sla < '01:00' ? 'var(--gx-danger-fg)' : 'var(--gx-text-2)'),
                      }}>{r.sla}</td>
                      <td><StatusPill variant={mapPriority(r.prio)} label={r.prio} size="sm" /></td>
                      <td><span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{r.assignee}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RevenueBars({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, padding: '4px 0' }}>
        {data.map((v, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, height: '100%' }}>
            <div style={{ height: (v / max * 100) + '%', background: 'linear-gradient(180deg,var(--azure-400),var(--azure-600))', borderRadius: '4px 4px 0 0' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 11, color: 'var(--gx-text-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--azure-500)' }} />Revenue
        </span>
      </div>
    </div>
  )
}
