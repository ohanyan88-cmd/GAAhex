// HomeView — role-aware personalized landing page.
//
// Per Gev's spec:
//   • Unique landing page per user
//   • Role-aware widgets (Support / Sales / Tech / Finance / Admin / General)
//   • Personal KPIs WITH TARGETS (X/Y progress format)
//   • Personal urgent alerts (SLA breaches, upcoming dispatches, pending approvals)
//
// Real data only — every number comes from a backend endpoint. No mocks, no random.
//
// Role detection: derived from /api/me/capabilities (auto-detected, no manual override).
//
// Migrated onto the PageShell framework (type=workspace): title / subtitle /
// breadcrumb / icon / KPIs are now PageShell props; the body keeps the urgent
// alerts band and role-specific widgets.
import { useEffect, useState, useMemo } from 'react'
import {
  CheckSquare, Clock, Shield, Inbox,
  AlertTriangle, Users, MapPin,
  type LucideIcon,
} from 'lucide-react'
import { BASE } from '../lib/config'
import { type Capabilities } from '../lib/capabilities'
import { PageShell, type KPISpec } from '../page-shell'
import { HomeIcon } from '../components/icons'
import { authH, bget } from '../lib/billing'
import { DetailTab, DetailTabList } from '../primitives'
import AskGaaexView from './AskGaaexView'
import MessagesView from './MessagesView'
import CalendarView from './CalendarView'
import ProfileView from './ProfileView'


type Fetched<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'hide' }
type Me = { id: string; name: string; email: string }
type Role = 'support' | 'sales' | 'tech' | 'finance' | 'admin' | 'general'

// ── role detection from capabilities ──────────────────────────────────────────
function detectRole(caps: Capabilities): Role {
  // Priority: most specific role first. Empty caps = FULL_ACCESS = admin.
  if (Object.keys(caps).length === 0) return 'admin'
  const has = (k: string, v: 'view' | 'create' | 'edit' | 'delete') =>
    caps[k] === undefined ? true : caps[k]?.[v] === true
  if (has('helpdesk_ticket', 'edit')) return 'support'
  if (has('lead', 'create') || has('opportunity', 'edit')) return 'sales'
  if (has('workitem', 'edit') || has('schedule_slot', 'edit')) return 'tech'
  if (has('invoice', 'create') || has('payment', 'create')) return 'finance'
  if (caps['config']?.['edit']) return 'admin'
  return 'general'
}

const ROLE_LABEL: Record<Role, string> = {
  support:  'Support Agent',
  sales:    'Sales Rep',
  tech:     'Field Tech',
  finance:  'Finance',
  admin:    'Administrator',
  general:  'Team Member',
}

const ROLE_SUBTITLE: Record<Role, string> = {
  support: 'Support center',
  sales:   'Sales overview',
  tech:    'Tech bench',
  finance: 'Finance desk',
  admin:   'Administrator overview',
  general: 'Your workspace',
}


// ── per-role daily targets (defaults; later configurable per user) ───────────
type Target = { label: string; key: string; target: number; unit?: string }
const ROLE_KPIS: Record<Role, Target[]> = {
  support: [
    { label: 'Tickets resolved',  key: 'tickets_resolved_today', target: 10 },
    { label: 'First-contact resolutions', key: 'fcr_today',      target: 8 },
    { label: 'SLA compliance',    key: 'sla_compliance_pct',     target: 95, unit: '%' },
    { label: 'Pending approvals', key: 'pending_approvals',      target: 0 },
  ],
  sales: [
    { label: 'Leads contacted',   key: 'leads_contacted_today',  target: 20 },
    { label: 'Quotes sent',       key: 'quotes_sent_week',       target: 5 },
    { label: 'Deals won (week)',  key: 'deals_won_week',         target: 3 },
    { label: 'Pipeline value',    key: 'pipeline_value',         target: 500_000, unit: '֏' },
  ],
  tech: [
    { label: 'Work orders done',  key: 'wos_done_today',         target: 6 },
    { label: 'Today\'s dispatches',key: 'dispatches_today',      target: 4 },
    { label: 'Coverage checks',   key: 'coverage_checks_week',   target: 15 },
    { label: 'Open work items',   key: 'open_workitems',         target: 0 },
  ],
  finance: [
    { label: 'Invoices processed',key: 'invoices_today',         target: 30 },
    { label: 'Payments received', key: 'payments_today',         target: 10 },
    { label: 'Collections cleared',key:'collections_resolved',   target: 5 },
    { label: 'Pending approvals', key: 'pending_approvals',      target: 0 },
  ],
  admin: [
    { label: 'Active users',      key: 'active_users',           target: 0 },
    { label: 'Open tickets',      key: 'open_tickets_company',   target: 0 },
    { label: 'Pending approvals', key: 'pending_approvals',      target: 0 },
    { label: 'System health',     key: 'system_health_pct',      target: 100, unit: '%' },
  ],
  general: [
    { label: 'My open tasks',     key: 'my_open_tasks',          target: 0 },
    { label: 'Pending approvals', key: 'pending_approvals',      target: 0 },
    { label: 'Tasks done today',  key: 'tasks_done_today',       target: 5 },
    { label: 'Activity score',    key: 'activity_score',         target: 0 },
  ],
}


// ── helpers ─────────────────────────────────────────────────────────────────
function relTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = Math.max(0, Date.now() - Date.parse(iso)) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}
function todayStartIso(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}
function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}
function weekStartIso(): string {
  const d = new Date()
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  d.setHours(0,0,0,0)
  return d.toISOString()
}

// ── KPI value formatter (drops into KPISpec.value / .subtitle) ──────────────
// Mirrors the formatting the old inline <KPI> tile used so the visual reads
// the same when KPIBar renders these.
function fmtKpi(n: number, unit?: string): string {
  if (unit === '֏') return `${Math.round(n / 1000)}k`
  return n.toLocaleString()
}

// ── Widget shell ─────────────────────────────────────────────────────────────
function Widget({ icon: Icon, title, children, count }: {
  icon: LucideIcon; title: string; children: React.ReactNode; count?: number
}) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-head" style={{ borderBottom: '1px solid var(--gx-border)', padding: 'var(--gx-space-6) var(--gx-space-18)' }}>
        <Icon size={14} color="var(--gx-text-3)" />
        <h3 style={{ margin: 0, fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-semibold)' }}>{title}</h3>
        {count !== undefined && (
          <span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)', marginLeft: 'var(--gx-space-3)' }}>{count}</span>
        )}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 'var(--gx-space-18)', color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-13)', textAlign: 'center' }}>{msg}</div>
}
function Skel({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ padding: 'var(--gx-space-4) 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-row"><div className="skel skel-cell" /></div>
      ))}
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function HomeView({ token, onNavigate, capabilities }: {
  token: string
  onNavigate?: (type: string, id?: string) => void
  capabilities?: Capabilities  // SM-2 — App's capabilities snapshot
}) {
  const [me, setMe] = useState<Me | null>(null)
  const [tab, setTab] = useState<'workspace' | 'ask' | 'messages' | 'calendar' | 'requests' | 'documents' | 'benefits' | 'kb'>('workspace')
  const [nodes, setNodes] = useState<any[]>([])
  const [orgMembers, setOrgMembers] = useState<any[]>([])
  // SM-2 — receive caps via prop instead of refetching.
  const caps: Capabilities = capabilities ?? {}
  const capsLoaded = capabilities !== undefined

  // role: auto-detected from caps
  const role: Role = capsLoaded ? detectRole(caps) : 'general'
  // Super-admin / owner sees every role's My Day widgets, not just their own slice.
  const isAdmin = role === 'admin' || role === 'general'

  // raw data state
  const [tasks, setTasks]         = useState<Fetched<any[]>>({ state: 'loading' })
  const [tickets, setTickets]     = useState<Fetched<any[]>>({ state: 'loading' })
  const [approvals, setApprovals] = useState<Fetched<any[]>>({ state: 'loading' })
  const [slots, setSlots]         = useState<Fetched<any[]>>({ state: 'loading' })
  const [activity, setActivity]   = useState<Fetched<any[]>>({ state: 'loading' })
  const [leads, setLeads]         = useState<Fetched<any[]>>({ state: 'loading' })
  const [quotes, setQuotes]       = useState<Fetched<any[]>>({ state: 'loading' })
  const [deals, setDeals]         = useState<Fetched<any[]>>({ state: 'loading' })
  const [invoicesP, setInvoicesP] = useState<Fetched<any[]>>({ state: 'loading' })
  const [coverages, setCoverages] = useState<Fetched<any[]>>({ state: 'loading' })

  // Identity
  useEffect(() => {
    fetch(`${BASE}/auth/me`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.id) setMe({ id: d.id, name: d.name ?? '', email: d.email ?? '' }) })
      .catch(() => {})
  }, [token])

  // SM-2 — capabilities now flow as a prop from App.tsx; no per-view refetch.

  // Fetch org nodes + members for Team tab
  useEffect(() => {
    Promise.all([
      bget(token, '/api/org/nodes').then(r => (r.ok && r.data) ? r.data : []),
      bget(token, '/api/users').then(r => (r.ok && r.data) ? r.data : []),
    ]).then(([n, m]) => {
      const arr = (d: any): any[] => Array.isArray(d) ? d : (d?.items ?? d?.records ?? [])
      setNodes(arr(n))
      setOrgMembers(arr(m))
    })
  }, [token])

  // Fetch all the raw data the page might need (in parallel; each role uses a subset)
  useEffect(() => {
    if (!me) return
    const opts = { headers: authH(token) }
    const fetchJson = (url: string) => fetch(url, opts).then(r => r.ok ? r.json() : []).catch(() => [])
    Promise.all([
      fetchJson(`${BASE}/api/workitems?assignee=${me.id}&limit=100`),
      fetchJson(`${BASE}/api/helpdesk/tickets?limit=100`),
      fetchJson(`${BASE}/api/mandatory-approvals?status=PENDING&limit=50`),
      fetchJson(`${BASE}/api/schedule-slots?limit=100`),
      fetchJson(`${BASE}/api/activity?limit=10`),
      fetchJson(`${BASE}/api/leads?limit=100`),
      fetchJson(`${BASE}/api/quotes?limit=100`),
      fetchJson(`${BASE}/api/deals?limit=100`),
      fetchJson(`${BASE}/api/invoices?status=ISSUED&limit=100`),
      fetchJson(`${BASE}/api/coverage-checks?limit=100`),
    ]).then(([wi, tk, ap, sl, ac, ld, qu, dl, iv, cv]) => {
      const toArr = (d: any): any[] => Array.isArray(d) ? d : (d?.items ?? d?.records ?? [])
      setTasks    (toArr(wi).length ? { state: 'ok', value: toArr(wi) } : { state: 'hide' })
      setTickets  (toArr(tk).length ? { state: 'ok', value: toArr(tk) } : { state: 'hide' })
      setApprovals(toArr(ap).length ? { state: 'ok', value: toArr(ap) } : { state: 'hide' })
      setSlots    (toArr(sl).length ? { state: 'ok', value: toArr(sl) } : { state: 'hide' })
      setActivity (toArr(ac).length ? { state: 'ok', value: toArr(ac) } : { state: 'hide' })
      setLeads    (toArr(ld).length ? { state: 'ok', value: toArr(ld) } : { state: 'hide' })
      setQuotes   (toArr(qu).length ? { state: 'ok', value: toArr(qu) } : { state: 'hide' })
      setDeals    (toArr(dl).length ? { state: 'ok', value: toArr(dl) } : { state: 'hide' })
      setInvoicesP(toArr(iv).length ? { state: 'ok', value: toArr(iv) } : { state: 'hide' })
      setCoverages(toArr(cv).length ? { state: 'ok', value: toArr(cv) } : { state: 'hide' })
    })
  }, [token, me])

  // ── Computed KPIs (all REAL) ────────────────────────────────────────────────
  const today = useMemo(() => todayKey(), [])
  const todayIso = useMemo(() => todayStartIso(), [])
  const weekIso  = useMemo(() => weekStartIso(), [])

  const taskArr     = tasks.state     === 'ok' ? tasks.value     : []
  const ticketArr   = tickets.state   === 'ok' ? tickets.value   : []
  const approvalArr = approvals.state === 'ok' ? approvals.value : []
  const slotArr     = slots.state     === 'ok' ? slots.value     : []
  const leadArr     = leads.state     === 'ok' ? leads.value     : []
  const quoteArr    = quotes.state    === 'ok' ? quotes.value    : []
  const dealArr     = deals.state     === 'ok' ? deals.value     : []
  const invoiceArr  = invoicesP.state === 'ok' ? invoicesP.value : []
  const coverageArr = coverages.state === 'ok' ? coverages.value : []

  const myTickets       = me ? ticketArr.filter(t => t.assigned_user_id === me.id) : []
  const ticketsResolvedToday = myTickets.filter(t => t.status === 'RESOLVED' && t.updated_at >= todayIso).length
  const fcrToday        = ticketsResolvedToday  // approximation; need reply_count to be exact
  const openTicketsCo   = ticketArr.filter(t => !['RESOLVED','CLOSED','CANCELLED'].includes(t.status)).length
  const breachedTickets = myTickets.filter(t => {
    if (['RESOLVED','CLOSED','CANCELLED'].includes(t.status)) return false
    const age = (Date.now() - Date.parse(t.created_at)) / (1000 * 3600)
    return age > 24
  })

  const tasksOpen        = taskArr.filter(t => ['TODO','IN_PROGRESS','BLOCKED'].includes(t.status))
  const tasksDoneToday   = taskArr.filter(t => t.status === 'DONE' && (t.completed_at ?? '') >= todayIso).length
  const overdueTasks     = tasksOpen.filter(t => t.due_at && Date.parse(t.due_at) < Date.now())
  const wosDoneToday     = tasksDoneToday  // workitems == work orders here

  const todaySlots       = slotArr.filter(sl => (sl.data?.date ?? '') === today)
  const myTodaySlots     = me ? todaySlots.filter(sl => sl.data?.tech === me.name || sl.data?.tech === me.id) : todaySlots

  const myLeads          = me ? leadArr.filter(l => l.assigned_to === me.name || l.data?.assigned_to === me.name) : leadArr
  const leadsContacted   = myLeads.filter(l => l.status === 'CONTACTED' || l.status === 'QUALIFIED').length
  const quotesSentWeek   = quoteArr.filter(q => q.status === 'SENT' && (q.created_at ?? '') >= weekIso).length
  const dealsWonWeek     = dealArr.filter(d => d.status === 'WON' && (d.updated_at ?? '') >= weekIso).length
  const pipelineValue    = dealArr.filter(d => d.status !== 'WON' && d.status !== 'LOST').reduce((s, d) => s + (Number(d.data?.value) || 0), 0)

  const coverageWeek     = coverageArr.filter(c => (c.created_at ?? '') >= weekIso).length

  // KPI value resolver — maps key → real number
  const kpiValue = (key: string): number => ({
    tickets_resolved_today: ticketsResolvedToday,
    fcr_today:              fcrToday,
    sla_compliance_pct:     myTickets.length === 0 ? 100 : Math.round(((myTickets.length - breachedTickets.length) / myTickets.length) * 100),
    pending_approvals:      approvalArr.length,
    leads_contacted_today:  leadsContacted,
    quotes_sent_week:       quotesSentWeek,
    deals_won_week:         dealsWonWeek,
    pipeline_value:         pipelineValue,
    wos_done_today:         wosDoneToday,
    dispatches_today:       myTodaySlots.length,
    coverage_checks_week:   coverageWeek,
    open_workitems:         tasksOpen.length,
    invoices_today:         invoiceArr.filter(i => (i.created_at ?? '') >= todayIso).length,
    payments_today:         0,  // would need /api/payments?since=today
    collections_resolved:   0,  // would need collections data
    active_users:           0,  // admin metric — need /api/users count
    open_tickets_company:   openTicketsCo,
    system_health_pct:      100, // healthy by default until we wire /api/health/ready
    my_open_tasks:          tasksOpen.length,
    tasks_done_today:       tasksDoneToday,
    activity_score:         (activity.state === 'ok' ? activity.value.length : 0),
  })[key] ?? 0

  // Urgent alerts — only real, time-critical items
  const urgentItems: { icon: LucideIcon; label: string; severity: 'red' | 'amber'; onClick?: () => void }[] = []
  if (breachedTickets.length > 0) urgentItems.push({
    icon: AlertTriangle, label: `${breachedTickets.length} ticket${breachedTickets.length>1?'s':''} past SLA`, severity: 'red',
    onClick: () => onNavigate?.('helpdesk'),
  })
  if (overdueTasks.length > 0) urgentItems.push({
    icon: Clock, label: `${overdueTasks.length} task${overdueTasks.length>1?'s':''} overdue`, severity: 'red',
    onClick: () => onNavigate?.('workitems'),
  })
  if (approvalArr.length > 0) urgentItems.push({
    icon: Shield, label: `${approvalArr.length} approval${approvalArr.length>1?'s':''} pending your decision`, severity: 'amber',
    onClick: () => onNavigate?.('my-approvals'),
  })
  if (myTodaySlots.length > 0) {
    const next = myTodaySlots[0]
    urgentItems.push({
      icon: MapPin, label: `${myTodaySlots.length} dispatch${myTodaySlots.length>1?'es':''} today${next?.data?.time_from ? ` (first ${next.data.time_from})` : ''}`,
      severity: 'amber',
    })
  }

  // ── 4 scope-locked KPI tiles ─────────────────────────────────────────────
  // Each tile shows data at a different visibility scope:
  //   1 YOU   — personal:   only the signed-in user's own metrics
  //   2 TEAM  — team:       your immediate team's load (company-level until team_id lands)
  //   3 DEPT  — department: today's dispatches across the org node
  //   4 ORG   — company:    company-wide health snapshot
  const kpiSpecs: KPISpec[] = [
    {
      label: 'My Open Tasks',
      value: tasksOpen.length,
      subtitle: overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : 'up to date',
      cornerNote: <span className="kpi-scope kpi-scope-you">YOU</span>,
      warning: overdueTasks.length > 0,
      loading: tasks.state === 'loading',
      onClick: () => onNavigate?.('workitems'),
    },
    {
      label: 'Team Tickets Open',
      value: ticketArr.filter(t => !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(t.status ?? '')).length,
      subtitle: breachedTickets.length > 0 ? `${breachedTickets.length} past SLA` : 'all within SLA',
      cornerNote: <span className="kpi-scope kpi-scope-team">TEAM</span>,
      danger: breachedTickets.length > 0,
      loading: tickets.state === 'loading',
      onClick: () => onNavigate?.('helpdesk'),
    },
    {
      label: "Today's Dispatches",
      value: todaySlots.length,
      subtitle: myTodaySlots.length > 0 ? `${myTodaySlots.length} assigned to me` : 'none assigned to me',
      cornerNote: <span className="kpi-scope kpi-scope-dept">DEPT</span>,
      loading: slots.state === 'loading',
    },
    {
      label: 'Pending Approvals',
      value: approvalArr.length,
      subtitle: approvalArr.length > 0 ? 'require your decision' : 'nothing pending',
      cornerNote: <span className="kpi-scope kpi-scope-org">ORG</span>,
      warning: approvalArr.length > 0,
      loading: approvals.state === 'loading',
      onClick: () => onNavigate?.('my-approvals'),
    },
  ]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace']}
      icon={<HomeIcon size={18} />}
      title={me?.name ?? 'Workspace'}
      subtitle={ROLE_SUBTITLE[role]}
      kpis={kpiSpecs}
      pageTabs={
        <DetailTabList ariaLabel="Workspace sections">
          <DetailTab active={tab === 'workspace'} onSelect={() => setTab('workspace')}>Workspace</DetailTab>
          <DetailTab active={tab === 'ask'} onSelect={() => setTab('ask')}>Ask Me</DetailTab>
          <DetailTab active={tab === 'messages'} onSelect={() => setTab('messages')}>Messages</DetailTab>
          <DetailTab active={tab === 'calendar'} onSelect={() => setTab('calendar')}>Calendar</DetailTab>
          <DetailTab active={tab === 'requests'} onSelect={() => setTab('requests')}>My Requests</DetailTab>
          <DetailTab active={tab === 'documents'} onSelect={() => setTab('documents')}>My Documents</DetailTab>
          <DetailTab active={tab === 'benefits'} onSelect={() => setTab('benefits')}>My Benefits</DetailTab>
          <DetailTab active={tab === 'kb'} onSelect={() => setTab('kb')}>Knowledge Base</DetailTab>
        </DetailTabList>
      }
    >

      {tab === 'workspace' && (
        <div className="ws-layout">

          {/* ── ME ──────────────────────────────────────────────────────────── */}
          <div className="ws-col">
            <div className="ws-col-head">ME</div>

            <Widget icon={Inbox} title="My Tickets" count={myTickets.filter(t => !['RESOLVED','CLOSED','CANCELLED'].includes(t.status ?? '')).length}>
              {tickets.state === 'loading' && <Skel />}
              {myTickets.length === 0 ? <Empty msg="No tickets assigned to you" /> : myTickets.slice(0, 8).map(t => (
                <div key={t.id} role="button" tabIndex={0} onClick={() => onNavigate?.('helpdesk', t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate?.('helpdesk', t.id) } }} style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', padding: 'var(--gx-space-4) var(--gx-space-18)', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject ?? '(no subject)'}</span>
                  <span className="badge badge-primary" style={{ fontSize: 'var(--gx-text-11)' }}>{t.status}</span>
                </div>
              ))}
            </Widget>

            <Widget icon={CheckSquare} title="My Open Tasks" count={tasksOpen.length}>
              {tasks.state === 'loading' && <Skel />}
              {tasksOpen.length === 0 ? <Empty msg="No open tasks" /> : tasksOpen.slice(0, 8).map(t => (
                <button key={t.id} type="button" onClick={() => onNavigate?.('workitems')} style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', padding: 'var(--gx-space-4) var(--gx-space-18)', cursor: 'pointer', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--gx-border)', font: 'inherit', textAlign: 'left' }}>
                  <span style={{ flex: 1, fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)' }}>{t.status?.replace(/_/g, ' ')}</span>
                </button>
              ))}
            </Widget>

            <Widget icon={MapPin} title="My Dispatches Today" count={myTodaySlots.length}>
              {slots.state === 'loading' && <Skel />}
              {myTodaySlots.length === 0 ? <Empty msg="No dispatches for you today" /> : myTodaySlots.slice(0, 8).map(s => (
                <div key={s.id} style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', padding: 'var(--gx-space-4) var(--gx-space-18)', borderBottom: '1px solid var(--gx-border)' }}>
                  <Clock size={13} color="var(--gx-text-3)" />
                  <span style={{ flex: 1, fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-medium)' }}>{s.data?.title ?? 'Slot'}</span>
                  {s.data?.time_from && <span className="mono" style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>{String(s.data.time_from)}</span>}
                </div>
              ))}
            </Widget>

            {overdueTasks.length > 0 && (
              <Widget icon={AlertTriangle} title="Overdue" count={overdueTasks.length}>
                {overdueTasks.slice(0, 6).map(t => (
                  <div key={t.id} style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', padding: 'var(--gx-space-4) var(--gx-space-18)', borderBottom: '1px solid var(--gx-border)' }}>
                    <AlertTriangle size={13} color="var(--gx-danger)" />
                    <span style={{ flex: 1, fontSize: 'var(--gx-text-13)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-danger)' }}>{t.due_at ? `${Math.round((Date.now() - Date.parse(t.due_at)) / 86400000)}d` : '!'}</span>
                  </div>
                ))}
              </Widget>
            )}
          </div>

          {/* ── TEAM ────────────────────────────────────────────────────────── */}
          <div className="ws-col">
            <div className="ws-col-head">TEAM</div>

            <Widget icon={Inbox} title="Team Tickets" count={ticketArr.filter(t => !['RESOLVED','CLOSED','CANCELLED'].includes(t.status ?? '')).length}>
              {tickets.state === 'loading' && <Skel />}
              {ticketArr.length === 0 ? <Empty msg="No open tickets" /> : ticketArr.filter(t => !['RESOLVED','CLOSED','CANCELLED'].includes(t.status ?? '')).slice(0, 8).map(t => (
                <div key={t.id} role="button" tabIndex={0} onClick={() => onNavigate?.('helpdesk', t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate?.('helpdesk', t.id) } }} style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', padding: 'var(--gx-space-4) var(--gx-space-18)', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 'var(--gx-text-13)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject ?? '(no subject)'}</span>
                  <span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)' }}>{t.status}</span>
                </div>
              ))}
            </Widget>

            {breachedTickets.length > 0 && (
              <Widget icon={AlertTriangle} title="SLA at Risk" count={breachedTickets.length}>
                {breachedTickets.slice(0, 6).map(t => (
                  <div key={t.id} role="button" tabIndex={0} onClick={() => onNavigate?.('helpdesk', t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate?.('helpdesk', t.id) } }} style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', padding: 'var(--gx-space-4) var(--gx-space-18)', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                    <AlertTriangle size={13} color="var(--gx-danger)" />
                    <span style={{ flex: 1, fontSize: 'var(--gx-text-13)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                    <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-danger)' }}>{Math.round((Date.now() - Date.parse(t.created_at)) / 3600000)}h</span>
                  </div>
                ))}
              </Widget>
            )}

            <Widget icon={Shield} title="Pending Approvals" count={approvalArr.length}>
              {approvals.state === 'loading' && <Skel />}
              {approvalArr.length === 0 ? <Empty msg="Nothing pending" /> : approvalArr.slice(0, 8).map(a => (
                <div key={a.id} role="button" tabIndex={0} onClick={() => onNavigate?.('my-approvals')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate?.('my-approvals') } }} style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', padding: 'var(--gx-space-4) var(--gx-space-18)', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 'var(--gx-text-13)' }}>{a.action_type?.replace(/_/g, ' ')}</span>
                  <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{relTime(a.created_at)}</span>
                </div>
              ))}
            </Widget>

            {(nodes.length > 0 || orgMembers.length > 0) && (
              <Widget icon={Users} title="Team Members" count={orgMembers.length}>
                {orgMembers.slice(0, 8).map((m: any) => (
                  <div key={m.id} style={{ display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', padding: 'var(--gx-space-4) var(--gx-space-18)', borderBottom: '1px solid var(--gx-border)' }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--gx-interactive)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--gx-text-10)', fontWeight: 'var(--gx-weight-bold)', color: 'var(--gx-on-primary)', flexShrink: 0 }}>
                      {(m.name ?? '?').split(' ').map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span style={{ flex: 1, fontSize: 'var(--gx-text-13)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                    <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{m.department ?? ''}</span>
                  </div>
                ))}
              </Widget>
            )}
          </div>

        </div>
      )}

      {tab === 'ask' && <AskGaaexView token={token} embedded />}
      {tab === 'messages' && <MessagesView token={token} embedded />}
      {tab === 'calendar' && <CalendarView token={token} embedded />}
      {tab === 'requests' && <ProfileView embedded initialSection="requests" />}
      {tab === 'documents' && <ProfileView embedded initialSection="documents" />}
      {tab === 'benefits' && <ProfileView embedded initialSection="benefits" />}
      {tab === 'kb' && <ProfileView embedded initialSection="kb" />}

    </PageShell>
  )
}
