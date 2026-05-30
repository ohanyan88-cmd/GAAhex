// DashboardView — the Workspace -> Home page.
//
// Doctrine: every value here is fetched from a real backend endpoint. If a fetch fails
// or returns nothing meaningful, the widget hides itself entirely — no dashes, no demo
// numbers, no "Failed to load" banners. A true fetched `0` (e.g. 0 open tickets in a
// populated tenant) still shows; only "couldn't get any data" hides.
//
// Permission scoping: gates each widget on the entity verb its data depends on, via
// fetchCapabilities() (lib/capabilities.ts). A role without `invoice.view` doesn't even
// see the MRR tile or the revenue chart.
//
// Navigation (P2): every KPI tile is a button that takes the user to its source list
// pre-filtered. Tickets-needing-attention rows open the real ticket. Activity entries
// route to their target record when the audit event carries one. There are no inert
// buttons or "View all" links — those were removed rather than faked.
import { useEffect, useState } from 'react'
import { Users, Banknote, Inbox, Activity, BarChart3, CheckSquare } from 'lucide-react'
import { GearIcon } from '../components/icons'
import { StatusPill } from '../primitives/StatusPill'
import { money } from '../lib/money'
import { fetchCapabilities, can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { fetchRevenueSeries, type RevenueBucket, type RevenueRange } from '../lib/metrics'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// What a click on a Home widget asks the host App to do. Shape mirrors the View union
// in App.tsx + an optional initial-state hint (filter / detail-open).
export type HomeNavTarget =
  | { type: 'subscriptions'; status?: string }
  | { type: 'invoices'; status?: string }
  | { type: 'helpdesk'; status?: string; openTicketId?: string }
  | { type: 'workitems' }
  | { type: 'entity'; slug: string; recordId?: string }

// Fetch state machine — we distinguish "still loading" from "loaded with a real value"
// from "give up and hide". Never carries a placeholder.
type Fetched<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'hide' }

interface TicketRow {
  id: string
  subject: string
  status: string
  prio: string
}

interface ActivityRow {
  id: string
  who: string
  act: string
  obj: string
  t: string
  entity_key: string | null
  record_id: string | null
}

function mapTicketStatus(s: string) {
  // Backend stores helpdesk ticket status in UPPERCASE (OPEN, IN_PROGRESS, ...).
  const v = (s || '').toUpperCase()
  if (v === 'RESOLVED' || v === 'CLOSED') return 'neutral'
  if (v === 'IN_PROGRESS') return 'active'
  if (v === 'PENDING') return 'degraded'
  return 'info'
}

function mapPriority(p: string) {
  const v = (p || '').toLowerCase()
  if (v === 'urgent') return 'critical'
  if (v === 'high') return 'degraded'
  if (v === 'normal') return 'info'
  return 'neutral'
}

// Relative time for the activity feed. The audit endpoint returns ISO timestamps; the
// kit shows things like "12m". Live values only — never invented.
function relTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ''
  const delta = Math.max(0, Date.now() - ts) / 1000
  if (delta < 60) return `${Math.floor(delta)}s`
  if (delta < 3600) return `${Math.floor(delta / 60)}m`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`
  return `${Math.floor(delta / 86400)}d`
}

export default function DashboardView({
  token, canConfigure = false, onConfigure, onNavigate,
}: {
  token: string
  configVersion?: number
  canConfigure?: boolean
  onConfigure?: () => void
  /** Called when the user clicks a KPI tile, a ticket row, or an activity entry. */
  onNavigate?: (target: HomeNavTarget) => void
}) {
  const [range, setRange] = useState<RevenueRange>('30d')

  const [caps, setCaps] = useState<Capabilities>(FULL_ACCESS)
  // Distinguish "haven't asked yet" from "asked and got an answer" so widgets gated on
  // perms don't flash visible before fetchCapabilities resolves.
  const [capsLoaded, setCapsLoaded] = useState(false)

  // Each widget gets its own Fetched<T> — wired to its real source, no shared state.
  const [subs, setSubs] = useState<Fetched<number>>({ state: 'loading' })
  const [mrr, setMrr] = useState<Fetched<number>>({ state: 'loading' })
  const [openTickets, setOpenTickets] = useState<Fetched<number>>({ state: 'loading' })
  const [openWorkItems, setOpenWorkItems] = useState<Fetched<number>>({ state: 'loading' })
  const [revenue, setRevenue] = useState<Fetched<RevenueBucket[]>>({ state: 'loading' })
  const [activity, setActivity] = useState<Fetched<ActivityRow[]>>({ state: 'loading' })
  const [tickets, setTickets] = useState<Fetched<TicketRow[]>>({ state: 'loading' })

  // Capabilities once after login (degrades to full-access on 404 per lib/capabilities.ts).
  useEffect(() => {
    let alive = true
    fetchCapabilities(token).then(c => { if (alive) { setCaps(c); setCapsLoaded(true) } })
    return () => { alive = false }
  }, [token])

  // KPI 1: Active subscribers — count of ACTIVE subscriptions the user can see.
  // Backing table can be empty in dev; if the fetch SUCCEEDS with 0, we show 0.
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/subscriptions?status=ACTIVE`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`subscriptions ${r.status}`)))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? null)
        if (!Array.isArray(arr)) { setSubs({ state: 'hide' }); return }
        setSubs({ state: 'ok', value: arr.length })
      })
      .catch(err => { console.error('[home] subscribers:', err); if (alive) setSubs({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // KPI 2: MRR — sum of outstanding invoices (ISSUED). Backend status enum is
  // DRAFT|ISSUED|PAID|OVERDUE|VOID; ISSUED is the "open / not paid" set. money()
  // converts luma -> AMD for display.
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/invoices?status=ISSUED`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`invoices ${r.status}`)))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? null)
        if (!Array.isArray(arr)) { setMrr({ state: 'hide' }); return }
        const sum = arr.reduce((s: number, i: any) => s + (Number(i.total) || 0), 0)
        setMrr({ state: 'ok', value: sum })
      })
      .catch(err => { console.error('[home] mrr:', err); if (alive) setMrr({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // KPI 3: Open helpdesk tickets — count of tickets in status=OPEN.
  // Sourced from /api/helpdesk/tickets so the count, the table below, and the
  // KPI-tile navigation target all match (clicking the tile goes to HelpdeskView
  // pre-filtered to OPEN).
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/helpdesk/tickets?status=OPEN`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`helpdesk tickets ${r.status}`)))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? null)
        if (!Array.isArray(arr)) { setOpenTickets({ state: 'hide' }); return }
        setOpenTickets({ state: 'ok', value: arr.length })
      })
      .catch(err => { console.error('[home] open tickets:', err); if (alive) setOpenTickets({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // KPI 4: Open work items — count of items in active statuses assigned to this tenant.
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/workitems?status=TODO,IN_PROGRESS,BLOCKED`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`workitems ${r.status}`)))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? null)
        if (!Array.isArray(arr)) { setOpenWorkItems({ state: 'hide' }); return }
        setOpenWorkItems({ state: 'ok', value: arr.length })
      })
      .catch(err => { console.error('[home] open work items:', err); if (alive) setOpenWorkItems({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // Revenue/churn series — new backend endpoint added in this PR. Re-fetches when range
  // toggles, which is also the chart-toggle action (no separate refetch wiring needed).
  useEffect(() => {
    let alive = true
    fetchRevenueSeries(token, range)
      .then(s => {
        if (!alive) return
        if (s.buckets.length === 0) { setRevenue({ state: 'hide' }); return }
        setRevenue({ state: 'ok', value: s.buckets })
      })
      .catch(err => { console.error('[home] revenue:', err); if (alive) setRevenue({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, range])

  // Recent activity — real path is /api/activity (the previous /api/audit/recent 404s).
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/activity?limit=5`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`activity ${r.status}`)))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? null)
        if (!Array.isArray(arr)) { setActivity({ state: 'hide' }); return }
        // Empty array from a successful fetch = no audited events the user can see.
        // Hide rather than show "No activity" so the page stays clean.
        if (arr.length === 0) { setActivity({ state: 'hide' }); return }
        const rows: ActivityRow[] = arr.slice(0, 5).map((a: any) => ({
          id: String(a.id ?? ''),
          who: a.actor_name ?? 'System',
          act: a.summary ?? a.type ?? 'updated',
          obj: a.entity_key ?? '',
          t: relTime(a.at),
          entity_key: a.entity_key ?? null,
          record_id: a.record_id ?? null,
        }))
        setActivity({ state: 'ok', value: rows })
      })
      .catch(err => { console.error('[home] activity:', err); if (alive) setActivity({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // Tickets needing attention — top open helpdesk tickets. Same source as KPI 3, so
  // clicking a row opens the same record the user is already looking at on this page.
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/helpdesk/tickets?status=OPEN&limit=4`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`tickets list ${r.status}`)))
      .then((d: any) => {
        if (!alive) return
        const arr = Array.isArray(d) ? d : (d?.items ?? null)
        if (!Array.isArray(arr)) { setTickets({ state: 'hide' }); return }
        if (arr.length === 0) { setTickets({ state: 'hide' }); return }
        const rows: TicketRow[] = arr.slice(0, 4).map((t: any) => ({
          id: String(t.id ?? ''),
          subject: t.subject ?? '(untitled)',
          status: t.status ?? '',
          prio: t.priority ?? '',
        }))
        setTickets({ state: 'ok', value: rows })
      })
      .catch(err => { console.error('[home] tickets attention:', err); if (alive) setTickets({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // Permission gates — only render a widget if (a) the perm check has resolved AND
  // (b) the role can view the underlying entity. While capabilities are still loading
  // we render nothing for the gated widgets so we don't briefly flash data the role
  // may not be allowed to see.
  const showSubs = capsLoaded && can(caps, 'subscription', 'view')
  const showMrr = capsLoaded && can(caps, 'invoice', 'view')
  const showOpenTickets = capsLoaded && can(caps, 'helpdesk_ticket', 'view')
  const showOpenWorkItems = capsLoaded && can(caps, 'workitem', 'view')
  const showRevenue = capsLoaded && can(caps, 'invoice', 'view')
  const showTickets = capsLoaded && can(caps, 'helpdesk_ticket', 'view')
  // Activity is org-scoped per record on the backend — no single gating perm. Always
  // candidate-visible; the backend filters out anything the caller can't see.
  const showActivity = capsLoaded

  // KPI strip visibility: at least one KPI passes both the perm gate AND has resolved
  // to 'ok'. Otherwise we hide the strip entirely (no half-empty card row).
  const kpiVisible =
    (showSubs && subs.state === 'ok') ||
    (showMrr && mrr.state === 'ok') ||
    (showOpenTickets && openTickets.state === 'ok') ||
    (showOpenWorkItems && openWorkItems.state === 'ok')

  // Nav helper — silently no-ops if the host hasn't wired onNavigate.
  const nav = (target: HomeNavTarget) => { if (onNavigate) onNavigate(target) }

  // Decide if an activity row should be clickable. Backend gives us entity_key + record_id;
  // we only know how to deep-link to entities served by the generic record router.
  const activityHref = (a: ActivityRow): HomeNavTarget | null => {
    if (!a.entity_key || !a.record_id) return null
    if (a.entity_key === 'helpdesk_ticket') {
      return { type: 'helpdesk', openTicketId: a.record_id }
    }
    // For generic entities, the slug matches the key plus an "s". This is a safe pass
    // to the host App which already has the entities array and will resolve the slug.
    return { type: 'entity', slug: a.entity_key, recordId: a.record_id }
  }

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
            <h1>Home</h1>
          </div>
          <span className="spacer" />
          {showRevenue && (
            <div className="seg">
              <button className={range === '7d' ? 'on' : ''} onClick={() => setRange('7d')}>7d</button>
              <button className={range === '30d' ? 'on' : ''} onClick={() => setRange('30d')}>30d</button>
              <button className={range === 'qtd' ? 'on' : ''} onClick={() => setRange('qtd')}>QTD</button>
              <button className={range === 'ytd' ? 'on' : ''} onClick={() => setRange('ytd')}>YTD</button>
            </div>
          )}
          {canConfigure && onConfigure && (
            <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
              <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
            </button>
          )}
        </div>

        {kpiVisible && (
          <div className="kpis">
            {showSubs && <KpiTile
              label="Active subscribers"
              icon={<Users size={16} />}
              fetched={subs}
              format={(n) => n.toLocaleString()}
              onClick={() => nav({ type: 'subscriptions', status: 'ACTIVE' })}
            />}
            {showMrr && <KpiTile
              label="MRR"
              icon={<Banknote size={16} />}
              accent
              fetched={mrr}
              format={(n) => money(n)}
              onClick={() => nav({ type: 'invoices', status: 'ISSUED' })}
            />}
            {showOpenTickets && <KpiTile
              label="Open tickets"
              icon={<Inbox size={16} />}
              fetched={openTickets}
              format={(n) => n.toLocaleString()}
              onClick={() => nav({ type: 'helpdesk', status: 'OPEN' })}
            />}
            {showOpenWorkItems && <KpiTile
              label="Open work items"
              icon={<CheckSquare size={16} />}
              fetched={openWorkItems}
              format={(n) => n.toLocaleString()}
              onClick={() => nav({ type: 'workitems' })}
            />}
          </div>
        )}

        {(showRevenue || showActivity) && (
          <div className="cols">
            {showRevenue && (
              <div className="card">
                <div className="card-head">
                  <BarChart3 size={16} style={{ color: 'var(--gx-text-3)' }} />
                  <h3>Revenue vs. churn</h3>
                  <span className="spacer" />
                  <span className="pill pill-neutral">{range}</span>
                </div>
                <div className="card-pad">
                  {revenue.state === 'loading' && <ChartSkeleton />}
                  {revenue.state === 'ok' && <RevenueChurnChart buckets={revenue.value} />}
                  {/* hide silently on 'hide' — no error banner */}
                </div>
              </div>
            )}

            {showActivity && activity.state !== 'hide' && (
              <div className="card">
                <div className="card-head">
                  <Activity size={16} style={{ color: 'var(--gx-text-3)' }} />
                  <h3>Recent activity</h3>
                </div>
                <div style={{ padding: '6px 0', minHeight: 180 }}>
                  {activity.state === 'loading' && <ActivitySkeleton />}
                  {activity.state === 'ok' && activity.value.map((a) => {
                    const href = activityHref(a)
                    const onClickRow = href ? () => nav(href) : undefined
                    return (
                      <div
                        key={a.id}
                        onClick={onClickRow}
                        role={onClickRow ? 'button' : undefined}
                        tabIndex={onClickRow ? 0 : undefined}
                        onKeyDown={onClickRow ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClickRow() } } : undefined}
                        style={{
                          display: 'flex', gap: 11, alignItems: 'flex-start',
                          padding: '10px 18px',
                          cursor: onClickRow ? 'pointer' : 'default',
                        }}
                      >
                        <span style={{
                          width: 28, height: 28, borderRadius: 'var(--gx-radius-sm)',
                          background: 'var(--gx-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--gx-text-2)', flexShrink: 0,
                        }}><Activity size={15} /></span>
                        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 600 }}>{a.who}</span>{' '}
                          <span style={{ color: 'var(--gx-text-2)' }}>{a.act}</span>{' '}
                          {a.obj && <span className="mono" style={{ color: 'var(--gx-link)' }}>{a.obj}</span>}
                          {a.t && <div className="hint" style={{ fontSize: 11 }}>{a.t}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {showTickets && tickets.state !== 'hide' && (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <Inbox size={16} style={{ color: 'var(--gx-text-3)' }} />
              <h3>Tickets needing attention</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              {tickets.state === 'loading' && <TableSkeleton />}
              {tickets.state === 'ok' && (
                <table className="grid">
                  <thead><tr>
                    <th>Subject</th><th>Status</th><th>Priority</th>
                  </tr></thead>
                  <tbody>
                    {tickets.value.map(r => (
                      <tr
                        key={r.id}
                        onClick={() => nav({ type: 'helpdesk', openTicketId: r.id })}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ maxWidth: 320 }}>{r.subject}</td>
                        <td>{r.status && <StatusPill variant={mapTicketStatus(r.status)} label={r.status} size="sm" />}</td>
                        <td>{r.prio && <StatusPill variant={mapPriority(r.prio)} label={r.prio} size="sm" />}</td>
                      </tr>
                    ))}
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

// ---- subcomponents ------------------------------------------------------------------

function KpiTile({
  label, icon, accent = false, fetched, format, onClick,
}: {
  label: string
  icon: React.ReactNode
  accent?: boolean
  fetched: Fetched<number>
  format: (n: number) => string
  onClick?: () => void
}) {
  const interactive = !!onClick && fetched.state === 'ok'
  return (
    <button
      type="button"
      className="kpi"
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      // The .kpi class targets divs in the kit; make the button render the same.
      style={{
        cursor: interactive ? 'pointer' : 'default',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
        border: 'none',
        background: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className="klbl">{label}</span>
        <span className="spacer" />
        <span style={{ color: accent ? 'var(--gx-gold)' : 'var(--gx-text-3)' }}>{icon}</span>
      </div>
      <div className="kval tnum">
        {fetched.state === 'loading' && <span className="skel" style={{ display: 'inline-block', height: 24, width: 80 }} />}
        {fetched.state === 'ok' && format(fetched.value)}
        {/* 'hide' state: the tile is omitted by the parent before reaching here. */}
      </div>
    </button>
  )
}

function ChartSkeleton() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, padding: '4px 0' }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="skel" style={{ flex: 1, height: `${30 + (i % 5) * 12}%`, borderRadius: '4px 4px 0 0' }} />
      ))}
    </div>
  )
}

function ActivitySkeleton() {
  return (
    <div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skel-row">
          <div className="skel skel-cell" />
        </div>
      ))}
    </div>
  )
}

function TableSkeleton() {
  return (
    <div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skel-row">
          <div className="skel skel-cell" />
          <div className="skel skel-cell" />
          <div className="skel skel-cell" />
        </div>
      ))}
    </div>
  )
}

// Per-bucket revenue + churn bars. Money on the chart is divided by 100 for the AMD scale.
function RevenueChurnChart({ buckets }: { buckets: RevenueBucket[] }) {
  const maxRevenue = Math.max(...buckets.map(b => b.revenue), 1)
  const maxChurn = Math.max(...buckets.map(b => b.churn), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, padding: '4px 0' }}>
        {buckets.map((b) => (
          <div key={b.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, height: '100%' }} title={`${b.month}: ${money(b.revenue)} revenue, ${b.churn} churned`}>
            <div style={{ height: (b.revenue / maxRevenue * 82) + '%', background: 'linear-gradient(180deg,var(--azure-400),var(--azure-600))', borderRadius: '4px 4px 0 0' }} />
            <div style={{ height: (b.churn / maxChurn * 18) + '%', background: 'var(--gx-gold)', borderRadius: '0 0 4px 4px', opacity: .85 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 11, color: 'var(--gx-text-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--azure-500)' }} />Revenue
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--gx-gold)' }} />Churn
        </span>
      </div>
    </div>
  )
}
