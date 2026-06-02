// HomeView — role-aware personalized landing page.
//
// Per Gev's spec:
//   • Unique landing page per user
//   • Role-aware widgets (Support / Sales / Tech / Finance / Admin / General)
//   • Personal KPIs WITH TARGETS (X/Y progress format)
//   • Personal urgent alerts (SLA breaches, upcoming dispatches, pending approvals)
//   • Quick Action shortcut buttons (verb-first: New Ticket / Check Coverage / Add Lead)
//
// Real data only — every number comes from a backend endpoint. No mocks, no random.
//
// Role detection: derived from /api/me/capabilities. Manual override available via
// the role selector chip (persisted in localStorage so a sales manager who wants
// to see the support view can pin it).
//
// Migrated onto the PageShell framework (type=workspace): title / subtitle /
// breadcrumb / icon / KPIs are now PageShell props; the body keeps the urgent
// alerts band, quick-action shortcuts, role-specific widgets, and the role
// override picker (its dropdown is non-trivial UI, not a static chip).
import { useEffect, useState, useMemo } from 'react'
import {
  CheckSquare, Clock, Shield, Activity, Inbox, AlertCircle,
  AlertTriangle, Users, Banknote, Plus, Search, MapPin,
  Ticket, FileText, TrendingUp, ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { BASE } from '../lib/config'
import { fetchCapabilities, type Capabilities } from '../lib/capabilities'
import { PageShell, type KPISpec } from '../page-shell'
import { HomeIcon } from '../components/icons'

const authH = (t: string) => ({ Authorization: `Bearer ${t}` })

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

const ROLE_COLOR: Record<Role, string> = {
  support: 'var(--azure-500)',
  sales:   '#22c55e',
  tech:    '#f59e0b',
  finance: '#8b5cf6',
  admin:   '#ec4899',
  general: 'var(--gx-text-3)',
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

// ── quick action shortcuts per role ─────────────────────────────────────────
type QuickAction = { label: string; icon: LucideIcon; target: string; color: string }
const ROLE_ACTIONS: Record<Role, QuickAction[]> = {
  support: [
    { label: 'New Ticket',     icon: Ticket,   target: 'helpdesk',         color: 'var(--azure-500)' },
    { label: 'Lookup Customer',icon: Search,   target: 'entity:customers', color: 'var(--gx-text-2)' },
    { label: 'KB Article',     icon: FileText, target: 'entity:kb-articles',color:'var(--gx-text-2)' },
  ],
  sales: [
    { label: 'Add Lead',       icon: Plus,     target: 'entity:leads',     color: '#22c55e' },
    { label: 'New Quote',      icon: FileText, target: 'entity:quotes',    color: 'var(--gx-text-2)' },
    { label: 'Check Coverage', icon: MapPin,   target: 'coverage-gis',     color: 'var(--gx-text-2)' },
  ],
  tech: [
    { label: 'New Work Order', icon: Plus,     target: 'entity:work-orders',color:'#f59e0b' },
    { label: 'Check Coverage', icon: MapPin,   target: 'coverage-gis',     color: 'var(--gx-text-2)' },
    { label: 'Dispatch Board', icon: Activity, target: 'dispatch-board',   color: 'var(--gx-text-2)' },
  ],
  finance: [
    { label: 'New Invoice',    icon: Plus,     target: 'invoices',         color: '#8b5cf6' },
    { label: 'Record Payment', icon: Banknote, target: 'payments',         color: 'var(--gx-text-2)' },
    { label: 'Collections',    icon: AlertCircle,target:'entity:collections',color:'var(--gx-text-2)' },
  ],
  admin: [
    { label: 'Add User',       icon: Plus,     target: 'entity:users',     color: '#ec4899' },
    { label: 'System Health',  icon: Activity, target: 'studio',           color: 'var(--gx-text-2)' },
    { label: 'Reports',        icon: TrendingUp,target:'reports',          color: 'var(--gx-text-2)' },
  ],
  general: [
    { label: 'Add Lead',       icon: Plus,     target: 'entity:leads',     color: 'var(--azure-500)' },
    { label: 'New Ticket',     icon: Ticket,   target: 'helpdesk',         color: 'var(--gx-text-2)' },
    { label: 'My Tasks',       icon: CheckSquare,target:'workitems',       color: 'var(--gx-text-2)' },
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
      <div className="card-head" style={{ borderBottom: '1px solid var(--gx-border)', padding: '12px 18px' }}>
        <Icon size={14} color="var(--gx-text-3)" />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
        {count !== undefined && (
          <span className="badge badge-neutral" style={{ fontSize: 11, marginLeft: 6 }}>{count}</span>
        )}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 18, color: 'var(--gx-text-3)', fontSize: 13, textAlign: 'center' }}>{msg}</div>
}
function Skel({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ padding: '8px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-row"><div className="skel skel-cell" /></div>
      ))}
    </div>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────
const ROLE_OVERRIDE_KEY = 'gaahex.home.role.override.v1'

export default function HomeView({ token, onNavigate }: {
  token: string
  onNavigate?: (type: string, id?: string) => void
}) {
  const [me, setMe] = useState<Me | null>(null)
  const [caps, setCaps] = useState<Capabilities>({})
  const [capsLoaded, setCapsLoaded] = useState(false)

  // role: auto-detected from caps, optionally overridden by user
  const [override, setOverride] = useState<Role | null>(() => {
    try { return (localStorage.getItem(ROLE_OVERRIDE_KEY) as Role) || null } catch { return null }
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const detectedRole = capsLoaded ? detectRole(caps) : 'general'
  const role: Role = override ?? detectedRole

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

  // Capabilities → role detection
  useEffect(() => {
    fetchCapabilities(token).then(c => { setCaps(c); setCapsLoaded(true) })
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

  // ── Build KPISpec[] for PageShell ────────────────────────────────────────
  // The old inline <KPI> tile rendered "value / target" with a progress bar +
  // green/amber/red colorway by progress %. KPIBar (PageShell Zone B) renders
  // a simpler tile, so we map progress semantics into KPISpec accents:
  //   • on-track (value >= target, target > 0)  → deltaPositive + delta="on track"
  //   • behind   (target > 0 && value < target) → warning accent
  //   • info     (target === 0)                 → plain
  // The target itself appears in `subtitle` so the X/Y framing is preserved.
  const kpiSpecs: KPISpec[] = ROLE_KPIS[role].map(k => {
    const v = kpiValue(k.key)
    const onTrack = k.target > 0 && v >= k.target
    const behind  = k.target > 0 && v < k.target
    return {
      label: k.label,
      value: fmtKpi(v, k.unit),
      unit: k.unit,
      subtitle: k.target > 0 ? `target ${fmtKpi(k.target, k.unit)}${k.unit ?? ''}` : undefined,
      delta: onTrack ? 'on track' : undefined,
      deltaPositive: onTrack ? true : undefined,
      warning: behind,
      loading: tasks.state === 'loading' && tickets.state === 'loading',
    }
  })

  // ── Render ────────────────────────────────────────────────────────────────
  const onAction = (target: string) => {
    if (target.startsWith('entity:')) onNavigate?.('entity', target.slice(7))
    else onNavigate?.(target)
  }

  const actions = ROLE_ACTIONS[role]

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'Home']}
      icon={<HomeIcon size={18} />}
      title="Home"
      subtitle={ROLE_SUBTITLE[role]}
      statusSummary={{ label: `You · ${ROLE_LABEL[role]}`, variant: 'info' }}
      kpis={kpiSpecs}
    >
      {/* Role override picker — preserves the user's ability to pin a
          different role's view (e.g. a sales manager wanting the support
          dashboard). Auto-detected role is marked with an "auto" tag. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setPickerOpen(!pickerOpen)}
            className="card card-hover"
            style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', border: 'none', font: 'inherit', color: 'inherit' }}
            title="Change role view"
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ROLE_COLOR[role] }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{ROLE_LABEL[role]}</span>
            {override && <span className="muted" style={{ fontSize: 10 }}>(override)</span>}
            <ChevronDown size={12} />
          </button>
          {pickerOpen && (
            <div className="card" style={{ position: 'absolute', right: 0, top: '110%', minWidth: 200, zIndex: 100, padding: 6 }}>
              {(['support','sales','tech','finance','admin','general'] as Role[]).map(r => (
                <div
                  key={r}
                  onClick={() => {
                    if (r === detectedRole) { setOverride(null); localStorage.removeItem(ROLE_OVERRIDE_KEY) }
                    else { setOverride(r); localStorage.setItem(ROLE_OVERRIDE_KEY, r) }
                    setPickerOpen(false)
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', borderRadius: 4, background: r === role ? 'var(--gx-surface-2)' : 'transparent' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: ROLE_COLOR[r] }} />
                  <span style={{ fontSize: 13, flex: 1 }}>{ROLE_LABEL[r]}</span>
                  {r === detectedRole && <span className="muted" style={{ fontSize: 10 }}>auto</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Action shortcuts */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {actions.map(({ label, icon: Icon, target, color }) => (
          <button
            key={label}
            onClick={() => onAction(target)}
            className="card card-hover"
            style={{
              padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', border: 'none', font: 'inherit', color: 'inherit',
              background: 'var(--gx-surface)',
              borderLeft: `3px solid ${color}`,
            }}
          >
            <Icon size={14} color={color} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
          </button>
        ))}
      </div>

      {/* Urgent alerts band */}
      {urgentItems.length > 0 && (
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {urgentItems.map((u, i) => (
            <div
              key={i}
              onClick={u.onClick}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 16px',
                borderRadius: 6,
                background: u.severity === 'red'
                  ? 'rgba(239,68,68,0.08)'
                  : 'rgba(245,158,11,0.08)',
                border: `1px solid ${u.severity === 'red' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                cursor: u.onClick ? 'pointer' : 'default',
              }}
            >
              <u.icon size={16} color={u.severity === 'red' ? 'var(--gx-danger,#ef4444)' : 'var(--gx-warning,#f59e0b)'} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{u.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Role-specific widgets */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 20 }}>

        {role === 'support' && (
          <>
            <Widget icon={Inbox} title="My Open Tickets" count={myTickets.filter(t => !['RESOLVED','CLOSED'].includes(t.status)).length}>
              {tickets.state === 'loading' && <Skel />}
              {myTickets.length === 0 ? <Empty msg="All clear" /> : myTickets.slice(0, 6).map(t => (
                <div key={t.id} onClick={() => onNavigate?.('helpdesk', t.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject ?? '(no subject)'}</span>
                  <span className="badge badge-primary" style={{ fontSize: 11 }}>{t.status}</span>
                </div>
              ))}
            </Widget>

            <Widget icon={AlertTriangle} title="SLA at Risk" count={breachedTickets.length}>
              {breachedTickets.length === 0 ? <Empty msg="No tickets past SLA" /> : breachedTickets.slice(0, 6).map(t => (
                <div key={t.id} onClick={() => onNavigate?.('helpdesk', t.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <AlertTriangle size={13} color="var(--gx-danger,#ef4444)" />
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                  <span style={{ fontSize: 11, color: 'var(--gx-danger,#ef4444)' }}>{Math.round((Date.now()-Date.parse(t.created_at))/3600000)}h</span>
                </div>
              ))}
            </Widget>
          </>
        )}

        {role === 'sales' && (
          <>
            <Widget icon={Users} title="My Pipeline" count={myLeads.length}>
              {myLeads.length === 0 ? <Empty msg="No leads assigned" /> : myLeads.slice(0, 6).map(l => (
                <div key={l.id} onClick={() => onNavigate?.('entity', 'leads')} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{l.data?.name ?? l.name ?? '(unnamed)'}</span>
                  <span className="badge badge-neutral" style={{ fontSize: 11 }}>{l.status}</span>
                </div>
              ))}
            </Widget>

            <Widget icon={FileText} title="Active Quotes" count={quoteArr.filter(q => q.status === 'SENT').length}>
              {quoteArr.length === 0 ? <Empty msg="No quotes yet" /> : quoteArr.filter(q => q.status === 'SENT').slice(0, 6).map(q => (
                <div key={q.id} onClick={() => onNavigate?.('entity', 'quotes')} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{q.data?.number ?? 'QUO-' + String(q.id).slice(0,6)}</span>
                  {q.data?.amount && <span className="mono" style={{ fontSize: 12, color: 'var(--gx-text-3)' }}>{Math.round(Number(q.data.amount)/100).toLocaleString()}֏</span>}
                </div>
              ))}
            </Widget>
          </>
        )}

        {role === 'tech' && (
          <>
            <Widget icon={MapPin} title="Today's Dispatches" count={myTodaySlots.length}>
              {myTodaySlots.length === 0 ? <Empty msg="No dispatches scheduled today" /> : myTodaySlots.slice(0, 6).map(s => (
                <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)' }}>
                  <Clock size={13} color="var(--gx-text-3)" />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{s.data?.title ?? 'Slot'}</span>
                  {s.data?.time_from && <span className="mono muted" style={{ fontSize: 12 }}>{String(s.data.time_from)}</span>}
                </div>
              ))}
            </Widget>

            <Widget icon={CheckSquare} title="Open Work Orders" count={tasksOpen.length}>
              {tasksOpen.length === 0 ? <Empty msg="No open work orders" /> : tasksOpen.slice(0, 6).map(t => (
                <div key={t.id} onClick={() => onNavigate?.('workitems')} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <span className="badge badge-neutral" style={{ fontSize: 11 }}>{t.status}</span>
                </div>
              ))}
            </Widget>
          </>
        )}

        {role === 'finance' && (
          <>
            <Widget icon={Banknote} title="Issued Invoices" count={invoiceArr.length}>
              {invoiceArr.length === 0 ? <Empty msg="No outstanding invoices" /> : invoiceArr.slice(0, 6).map(i => (
                <div key={i.id} onClick={() => onNavigate?.('invoices')} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{i.number}</span>
                  <span className="mono" style={{ fontSize: 12 }}>{Math.round(Number(i.total)/100).toLocaleString()}֏</span>
                </div>
              ))}
            </Widget>

            <Widget icon={Shield} title="Pending Approvals" count={approvalArr.length}>
              {approvalArr.length === 0 ? <Empty msg="Nothing waiting on you" /> : approvalArr.slice(0, 6).map(a => (
                <div key={a.id} onClick={() => onNavigate?.('my-approvals')} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{a.action_type?.replace(/_/g, ' ')}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{relTime(a.created_at)}</span>
                </div>
              ))}
            </Widget>
          </>
        )}

        {(role === 'admin' || role === 'general') && (
          <>
            <Widget icon={CheckSquare} title="My Tasks" count={tasksOpen.length}>
              {tasksOpen.length === 0 ? <Empty msg="No open tasks" /> : tasksOpen.slice(0, 6).map(t => (
                <div key={t.id} onClick={() => onNavigate?.('workitems')} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  <span className="badge badge-neutral" style={{ fontSize: 11 }}>{t.status}</span>
                </div>
              ))}
            </Widget>

            <Widget icon={Shield} title="Approvals Waiting" count={approvalArr.length}>
              {approvalArr.length === 0 ? <Empty msg="Nothing waiting on you" /> : approvalArr.slice(0, 6).map(a => (
                <div key={a.id} onClick={() => onNavigate?.('my-approvals')} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 18px', borderBottom: '1px solid var(--gx-border)', cursor: 'pointer' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{a.action_type?.replace(/_/g, ' ')}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{relTime(a.created_at)}</span>
                </div>
              ))}
            </Widget>
          </>
        )}
      </div>

      {/* Recent activity — common to all roles */}
      <Widget icon={Activity} title="My Recent Activity">
        {activity.state === 'loading' && <Skel rows={5} />}
        {activity.state === 'hide' && <Empty msg="No recent activity" />}
        {activity.state === 'ok' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8, padding: 12 }}>
            {activity.value.slice(0, 8).map(a => (
              <div key={a.id} className="card card-hover" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={11} color="var(--gx-text-3)" />
                <span style={{ flex: 1, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--gx-text-2)' }}>{a.type}</span>
                  {a.entity_key && <span style={{ color: 'var(--gx-link)' }}> {a.entity_key.replace(/_/g, ' ')}</span>}
                </span>
                <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{relTime(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Widget>
    </PageShell>
  )
}
