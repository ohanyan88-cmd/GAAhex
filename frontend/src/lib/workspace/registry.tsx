// Workspace Widget Registry — the role/department-personalized landing system.
//
// Design (Gev 2026-06-14): the backend already resolves each user to ONE of 10 canonical
// WORKSPACE ROLES via GET /api/me/workspace-role (ceo · d2d_agent · retail_agent · b2b_am ·
// support_t1 · support_t2 · field_tech · noc_engineer · billing_spec · general). Its own comment
// says "the frontend LayoutRegistry matches on these to render role-personalized dashboards" — this
// IS that LayoutRegistry. The workspace-role already encodes position nuance (d2d vs retail vs b2b,
// t1 vs t2), so it's the primary personalization key; `department` refines it where useful.
//
// Each widget is SELF-CONTAINED (fetches its own data via the real endpoints, using ?mine=true for
// true per-user scoping where the backend supports it — no broad-fetch + client-filter). Widgets use
// DELIBERATELY VARIED visual treatments (list · table · stat-tiles · avatar-grid · stage-bars ·
// timeline) so the landing reads rich, not monotone — same card chrome, different insides.
// A widget is shown when (a) it's relevant to the user's role AND (b) capabilities permit it. The
// resolved default layout is overlaid with the user's customization (hide / reorder / add-from-catalog).
import React from 'react'
import {
  Inbox, CheckSquare, MapPin, Shield, AlertTriangle, Users, Activity,
  GitBranch, Receipt, Wrench, PhoneCall, type LucideIcon,
} from 'lucide-react'
import { useFetched, useFetch } from '../../hooks/useFetch'
import { type Capabilities, can } from '../capabilities'
import { TICKET_CLOSED } from '../status-constants'

// ── the 10 canonical workspace roles (mirror backend workspace.py) ───────────────
export type WorkspaceRole =
  | 'ceo' | 'd2d_agent' | 'retail_agent' | 'b2b_am'
  | 'support_t1' | 'support_t2' | 'field_tech'
  | 'noc_engineer' | 'billing_spec' | 'general'

export const ALL_WORKSPACE_ROLES: WorkspaceRole[] = [
  'ceo', 'b2b_am', 'd2d_agent', 'retail_agent', 'support_t1', 'support_t2',
  'field_tech', 'noc_engineer', 'billing_spec', 'general',
]

type Scope = 'you' | 'team' | 'org'
type Perm = { obj: string; verb: 'view' | 'create' | 'edit' | 'delete' }

export type WidgetDef = {
  id: string
  title: string                 // i18n default; HomeView wraps with t()
  i18nKey: string
  icon: LucideIcon
  scope: Scope
  /** which workspace roles get this widget in their DEFAULT layout. '*' = everyone. */
  defaultFor: WorkspaceRole[] | '*'
  /** min capability to even be allowed to see/add it (undefined = always allowed). */
  perm?: Perm
  /** a one-line description shown in the "Add widget" catalog. */
  blurb: string
  Component: React.FC<{ meId?: string; onNavigate?: (t: string, id?: string) => void }>
}

// ── shared widget shells ─────────────────────────────────────────────────────────
const toArr = (d: any): any[] => (Array.isArray(d) ? d : (d?.items ?? d?.records ?? []))

export function Widget({ title, count, children }: {
  icon?: LucideIcon; title: string; count?: number; children: React.ReactNode
}) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="wx-head">
        <h3 className="wx-title">{title}</h3>
        {count !== undefined && <span className="wx-count">{count}</span>}
      </div>
      <div className="wx-body">{children}</div>
    </div>
  )
}
function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 'var(--gx-space-18)', color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-13)', textAlign: 'center' }}>{msg}</div>
}
function Skel({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ padding: 'var(--gx-space-4) 0' }}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skel-row"><div className="skel skel-cell" /></div>)}
    </div>
  )
}
const ROW: React.CSSProperties = { display: 'flex', gap: 'var(--gx-space-5)', alignItems: 'center', padding: 'var(--gx-space-4) var(--gx-space-18)', borderBottom: '1px solid var(--gx-border)' }
const NAME: React.CSSProperties = { flex: 1, fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
function clickRow(onNavigate: (() => void) | undefined): React.HTMLAttributes<HTMLDivElement> {
  if (!onNavigate) return {}
  return {
    role: 'button', tabIndex: 0, style: { ...ROW, cursor: 'pointer' }, onClick: onNavigate,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate() } },
  }
}
function relTime(iso?: string | null): string {
  if (!iso) return ''
  const d = Math.max(0, Date.now() - Date.parse(iso)) / 1000
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  return `${Math.floor(d / 86400)}d`
}
const todayISO = () => new Date().toISOString().slice(0, 10)
const fmtTime = (iso?: string | null) => { if (!iso) return ''; try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
const fmtDue = (iso?: string | null) => { if (!iso) return '—'; const ms = Date.parse(iso) - Date.now(); if (ms < 0) return 'overdue'; const d = Math.round(ms / 86400000); return d === 0 ? 'today' : d === 1 ? 'tomorrow' : `${d}d` }
const initials = (n?: string) => (n ?? '?').split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()
const fmtNum = (v: any) => { const n = Number(v); return isFinite(n) ? n.toLocaleString() : '—' }

// ── widget components (VARIED treatments) ─────────────────────────────────────────

// LIST — My Tickets
const WMyTickets: WidgetDef['Component'] = ({ meId, onNavigate }) => {
  const q = useFetched<any[]>(meId ? '/api/helpdesk/tickets?mine=true&limit=20' : null, d => toArr(d).length > 0)
  const open = (q.state === 'ok' ? toArr(q.value) : []).filter(t => !TICKET_CLOSED.includes(t.status ?? ''))
  return (
    <Widget icon={Inbox} title="My Tickets" count={open.length}>
      {q.state === 'loading' && <Skel />}
      {open.length === 0 ? <Empty msg="No tickets assigned to you" /> : open.slice(0, 40).map(t => (
        <div key={t.id} {...clickRow(() => onNavigate?.('helpdesk', t.id))}>
          <span style={NAME}>{t.subject ?? '(no subject)'}</span>
          <span className="badge badge-primary" style={{ fontSize: 'var(--gx-text-11)' }}>{t.status}</span>
        </div>
      ))}
    </Widget>
  )
}

// LIST (alert) — SLA at Risk
const WSlaAtRisk: WidgetDef['Component'] = ({ onNavigate }) => {
  const q = useFetched<any[]>('/api/helpdesk/tickets?limit=60', d => toArr(d).length > 0)
  const breached = (q.state === 'ok' ? toArr(q.value) : []).filter(t => {
    if (TICKET_CLOSED.includes(t.status ?? '')) return false
    return (Date.now() - Date.parse(t.created_at)) / 3600000 > 24
  })
  return (
    <Widget icon={AlertTriangle} title="SLA at Risk" count={breached.length}>
      {q.state === 'loading' && <Skel />}
      {breached.length === 0 ? <Empty msg="All within SLA" /> : breached.slice(0, 40).map(t => (
        <div key={t.id} {...clickRow(() => onNavigate?.('helpdesk', t.id))}>
          <AlertTriangle size={13} color="var(--gx-danger)" />
          <span style={NAME}>{t.subject}</span>
          <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-danger)' }}>{Math.round((Date.now() - Date.parse(t.created_at)) / 3600000)}h</span>
        </div>
      ))}
    </Widget>
  )
}

// LIST — Team Tickets
const WTeamTickets: WidgetDef['Component'] = ({ onNavigate }) => {
  const q = useFetched<any[]>('/api/helpdesk/tickets?limit=20', d => toArr(d).length > 0)
  const open = (q.state === 'ok' ? toArr(q.value) : []).filter(t => !TICKET_CLOSED.includes(t.status ?? ''))
  return (
    <Widget icon={Inbox} title="Team Tickets" count={open.length}>
      {q.state === 'loading' && <Skel />}
      {open.length === 0 ? <Empty msg="No open tickets" /> : open.slice(0, 40).map(t => (
        <div key={t.id} {...clickRow(() => onNavigate?.('helpdesk', t.id))}>
          <span style={NAME}>{t.subject ?? '(no subject)'}</span>
          <span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)' }}>{t.status}</span>
        </div>
      ))}
    </Widget>
  )
}

// TABLE — My Open Tasks
const WMyTasks: WidgetDef['Component'] = ({ meId, onNavigate }) => {
  const q = useFetched<any[]>(meId ? `/api/workitems?assignee=${meId}&limit=20` : null, d => toArr(d).length > 0)
  const open = (q.state === 'ok' ? toArr(q.value) : []).filter(t => ['TODO', 'IN_PROGRESS', 'BLOCKED'].includes(t.status))
  return (
    <Widget icon={CheckSquare} title="My Open Tasks" count={open.length}>
      {q.state === 'loading' ? <Skel /> : (
        <table className="wx-table">
          <thead><tr><th>Task</th><th>Status</th><th>Due</th></tr></thead>
          <tbody>
            {open.length === 0 && <tr><td colSpan={3} className="wx-empty-cell">No open tasks</td></tr>}
            {open.slice(0, 40).map(t => {
              const od = t.due_at && Date.parse(t.due_at) < Date.now()
              return (
                <tr key={t.id} className={od ? 'wx-tr-danger' : ''} onClick={() => onNavigate?.('workitems')}>
                  <td className="wx-td-name">{t.title}</td>
                  <td><span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)' }}>{t.status?.replace(/_/g, ' ')}</span></td>
                  <td className="wx-td-due">{fmtDue(t.due_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Widget>
  )
}

// TIMELINE — My Route Today
const WMyRouteToday: WidgetDef['Component'] = ({ meId, onNavigate }) => {
  const today = todayISO()
  const q = useFetched<any[]>(meId ? `/api/workitems?assignee=${meId}&scheduled_from=${today}T00:00:00&scheduled_to=${today}T23:59:59&limit=20` : null, d => toArr(d).length > 0)
  const items = (q.state === 'ok' ? toArr(q.value) : []).slice().sort((a, b) => String(a.scheduled_at ?? '').localeCompare(String(b.scheduled_at ?? '')))
  return (
    <Widget icon={MapPin} title="My Route Today" count={items.length}>
      {q.state === 'loading' && <Skel />}
      {items.length === 0 ? <Empty msg="No dispatches for you today" /> : (
        <div className="wx-timeline">
          {items.slice(0, 40).map(s => (
            <div key={s.id} className="wx-tl-row" role="button" tabIndex={0} onClick={() => onNavigate?.('workitems')} onKeyDown={(e) => { if (e.key === 'Enter') onNavigate?.('workitems') }}>
              <span className="wx-tl-time mono">{fmtTime(s.scheduled_at) || '—'}</span>
              <span className="wx-tl-dot" />
              <span className="wx-tl-name">{s.title ?? 'Job'}</span>
              <Wrench size={12} color="var(--gx-text-3)" />
            </div>
          ))}
        </div>
      )}
    </Widget>
  )
}

// STAGE BARS — My Pipeline
const PIPE_STAGES: [string, string][] = [['LEAD', 'Lead'], ['VALIDATED_LEAD', 'Validated'], ['ASSIGNED', 'Assigned'], ['DEAL', 'Deal'], ['CONTRACT_SIGNED', 'Signed']]
const WMyPipeline: WidgetDef['Component'] = ({ onNavigate }) => {
  const q = useFetched<any[]>("/api/leads?filter=" + encodeURIComponent("status != 'LOST' and status != 'ORDER_CREATED'") + "&sort=-created_at&limit=80", d => toArr(d).length > 0)
  const leads = q.state === 'ok' ? toArr(q.value) : []
  const counts = PIPE_STAGES.map(([k, label]) => ({ k, label, n: leads.filter(l => (l.status ?? '') === k).length }))
  const max = Math.max(1, ...counts.map(c => c.n))
  return (
    <Widget icon={GitBranch} title="My Pipeline" count={leads.length}>
      {q.state === 'loading' && <Skel />}
      {leads.length === 0 ? <Empty msg="No active leads" /> : (
        <div className="wx-bars" role="button" tabIndex={0} onClick={() => onNavigate?.('leads')} onKeyDown={(e) => { if (e.key === 'Enter') onNavigate?.('leads') }}>
          {counts.map(c => (
            <div key={c.k} className="wx-bar-row">
              <span className="wx-bar-lbl">{c.label}</span>
              <span className="wx-bar-track"><span className="wx-bar-fill" style={{ width: `${(c.n / max) * 100}%` }} /></span>
              <span className="wx-bar-n mono">{c.n}</span>
            </div>
          ))}
        </div>
      )}
    </Widget>
  )
}

// TABLE — Overdue Invoices
const WCollections: WidgetDef['Component'] = ({ onNavigate }) => {
  const q = useFetched<any[]>('/api/invoices?status=overdue&limit=20', d => toArr(d).length > 0)
  const inv = q.state === 'ok' ? toArr(q.value) : []
  return (
    <Widget icon={Receipt} title="Overdue Invoices" count={inv.length}>
      {q.state === 'loading' ? <Skel /> : (
        <table className="wx-table">
          <thead><tr><th>Invoice</th><th>Amount</th><th>Age</th></tr></thead>
          <tbody>
            {inv.length === 0 && <tr><td colSpan={3} className="wx-empty-cell">Nothing overdue</td></tr>}
            {inv.slice(0, 40).map(i => (
              <tr key={i.id} onClick={() => onNavigate?.('invoices', i.id)}>
                <td className="wx-td-name">{i.number ?? 'Invoice'}</td>
                <td className="mono">{fmtNum(i.total ?? i.amount ?? i.amount_due)}</td>
                <td className="wx-td-due" style={{ color: 'var(--gx-danger)' }}>{relTime(i.due_date ?? i.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Widget>
  )
}

// LIST — Pending Approvals
const WApprovals: WidgetDef['Component'] = ({ onNavigate }) => {
  const q = useFetched<any[]>('/api/mandatory-approvals?status=PENDING&limit=20', d => toArr(d).length > 0)
  const ap = q.state === 'ok' ? toArr(q.value) : []
  return (
    <Widget icon={Shield} title="Pending Approvals" count={ap.length}>
      {q.state === 'loading' && <Skel />}
      {ap.length === 0 ? <Empty msg="Nothing pending" /> : ap.slice(0, 40).map(a => (
        <div key={a.id} {...clickRow(() => onNavigate?.('my-approvals'))}>
          <span style={{ flex: 1, fontSize: 'var(--gx-text-13)' }}>{a.action_type?.replace(/_/g, ' ')}</span>
          <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{relTime(a.created_at)}</span>
        </div>
      ))}
    </Widget>
  )
}

// AVATAR GRID — Team Members
const WTeamMembers: WidgetDef['Component'] = () => {
  const { data } = useFetch<any>('/api/users')
  const members = toArr(data)
  return (
    <Widget icon={Users} title="Team Members" count={members.length}>
      {members.length === 0 ? <Empty msg="No members" /> : (
        <div className="wx-avatars">
          {members.slice(0, 40).map((m: any) => (
            <div key={m.id} className="wx-avatar-chip" title={m.name + (m.department ? ` · ${m.department}` : '')}>
              <div className="wx-avatar">{initials(m.name)}</div>
              <span className="wx-avatar-name">{m.name}</span>
            </div>
          ))}
        </div>
      )}
    </Widget>
  )
}

// STAT TILES — Org Health
const WOrgHealth: WidgetDef['Component'] = () => {
  const { data } = useFetch<any>('/api/analytics/dashboard/stats')
  const tiles = [
    { label: 'Payments today', value: fmtNum(data?.payments_today), tone: '' },
    { label: 'Resolved today', value: fmtNum(data?.collections_resolved), tone: '' },
    { label: 'Active users', value: fmtNum(data?.active_users), tone: '' },
    { label: 'System health', value: data?.system_health_pct != null ? `${data.system_health_pct}%` : '—', tone: (data?.system_health_pct ?? 100) === 100 ? 'good' : 'bad' },
  ]
  return (
    <Widget icon={Activity} title="Org Health">
      <div className="wx-stats">
        {tiles.map(tl => (
          <div key={tl.label} className="wx-stat">
            <div className={'wx-stat-val' + (tl.tone === 'good' ? ' wx-good' : tl.tone === 'bad' ? ' wx-bad' : '')}>{tl.value}</div>
            <div className="wx-stat-lbl">{tl.label}</div>
          </div>
        ))}
      </div>
    </Widget>
  )
}

// LIST — My Accounts (B2B)
const WCustomerCalls: WidgetDef['Component'] = ({ onNavigate }) => {
  const q = useFetched<any[]>('/api/customers?sort=-created_at&limit=20', d => toArr(d).length > 0)
  const cust = q.state === 'ok' ? toArr(q.value) : []
  return (
    <Widget icon={PhoneCall} title="My Accounts" count={cust.length}>
      {q.state === 'loading' && <Skel />}
      {cust.length === 0 ? <Empty msg="No accounts" /> : cust.slice(0, 40).map(c => (
        <div key={c.id} {...clickRow(() => onNavigate?.('customers', c.id))}>
          <span style={NAME}>{c.data?.name ?? c.name ?? 'Customer'}</span>
          <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{c.data?.plan ?? ''}</span>
        </div>
      ))}
    </Widget>
  )
}

// ── the catalog ────────────────────────────────────────────────────────────────
const P = (obj: string, verb: Perm['verb']): Perm => ({ obj, verb })

export const WIDGETS: WidgetDef[] = [
  { id: 'my-tickets',   i18nKey: 'home.widget.myTickets',     title: 'My Tickets',        icon: Inbox,         scope: 'you',  defaultFor: ['support_t1', 'support_t2', 'noc_engineer'], perm: P('helpdesk_ticket', 'view'), blurb: 'Tickets assigned to you (list)', Component: WMyTickets },
  { id: 'sla-risk',     i18nKey: 'home.widget.slaAtRisk',     title: 'SLA at Risk',       icon: AlertTriangle, scope: 'team', defaultFor: ['support_t1', 'support_t2', 'ceo'],         perm: P('helpdesk_ticket', 'view'), blurb: 'Open tickets past their SLA window', Component: WSlaAtRisk },
  { id: 'team-tickets', i18nKey: 'home.widget.teamTickets',   title: 'Team Tickets',      icon: Inbox,         scope: 'team', defaultFor: ['support_t2', 'ceo'],                       perm: P('helpdesk_ticket', 'view'), blurb: "Your team's open queue", Component: WTeamTickets },
  { id: 'my-tasks',     i18nKey: 'home.widget.myOpenTasks',   title: 'My Open Tasks',     icon: CheckSquare,   scope: 'you',  defaultFor: '*',                                          perm: P('workitem', 'view'),       blurb: 'Work items assigned to you (table)', Component: WMyTasks },
  { id: 'my-route',     i18nKey: 'home.widget.myRouteToday',  title: 'My Route Today',    icon: MapPin,        scope: 'you',  defaultFor: ['field_tech', 'noc_engineer'],              perm: P('workitem', 'view'),       blurb: "Today's dispatches (timeline)", Component: WMyRouteToday },
  { id: 'my-pipeline',  i18nKey: 'home.widget.myPipeline',    title: 'My Pipeline',       icon: GitBranch,     scope: 'you',  defaultFor: ['d2d_agent', 'retail_agent', 'b2b_am'],      perm: P('lead', 'view'),           blurb: 'Active leads by stage (bars)', Component: WMyPipeline },
  { id: 'my-accounts',  i18nKey: 'home.widget.myAccounts',    title: 'My Accounts',       icon: PhoneCall,     scope: 'you',  defaultFor: ['b2b_am'],                                   perm: P('customer', 'view'),       blurb: 'Customer accounts you manage', Component: WCustomerCalls },
  { id: 'collections',  i18nKey: 'home.widget.overdueInv',    title: 'Overdue Invoices',  icon: Receipt,       scope: 'team', defaultFor: ['billing_spec', 'ceo'],                     perm: P('invoice', 'view'),        blurb: 'Invoices past due — collections (table)', Component: WCollections },
  { id: 'approvals',    i18nKey: 'home.widget.pendingApprovals', title: 'Pending Approvals', icon: Shield,     scope: 'org',  defaultFor: ['ceo', 'b2b_am', 'billing_spec', 'support_t2'], blurb: 'Decisions waiting on you', Component: WApprovals },
  { id: 'team-members', i18nKey: 'home.widget.teamMembers',   title: 'Team Members',      icon: Users,         scope: 'team', defaultFor: ['ceo', 'support_t2'],                       blurb: 'People in your organisation (avatars)', Component: WTeamMembers },
  { id: 'org-health',   i18nKey: 'home.widget.orgHealth',     title: 'Org Health',        icon: Activity,      scope: 'org',  defaultFor: ['ceo'],                                      perm: P('kpi', 'view'),            blurb: 'Company-wide snapshot (stat tiles)', Component: WOrgHealth },
]

const WIDGET_BY_ID = new Map(WIDGETS.map(w => [w.id, w]))

// ── permission gate ──────────────────────────────────────────────────────────────
function permitted(w: WidgetDef, caps: Capabilities): boolean {
  if (!w.perm) return true
  return can(caps, w.perm.obj, w.perm.verb)
}

/** The default ordered widget ids for a role, gated by capabilities. */
export function defaultLayoutFor(role: WorkspaceRole, caps: Capabilities): string[] {
  return WIDGETS
    .filter(w => (w.defaultFor === '*' || w.defaultFor.includes(role)) && permitted(w, caps))
    .map(w => w.id)
}

/** Every widget the user is ALLOWED to add (for the "Add widget" catalog). */
export function catalogFor(caps: Capabilities): WidgetDef[] {
  return WIDGETS.filter(w => permitted(w, caps))
}

// ── per-user customization (localStorage now; backend /api/me/workspace-layout is the next step) ──
export type Customization = { hidden: string[]; order: string[] }
const LS_KEY = 'gaahex.workspace.layout.v1'

export function loadCustomization(): Customization {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { hidden: [], order: [] }
    const o = JSON.parse(raw)
    return { hidden: Array.isArray(o?.hidden) ? o.hidden : [], order: Array.isArray(o?.order) ? o.order : [] }
  } catch { return { hidden: [], order: [] } }
}
export function saveCustomization(c: Customization): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)) } catch { /* swallow */ }
}

/** Resolve the final visible, ordered widget defs: role default → user order → minus hidden. */
export function resolveWidgets(role: WorkspaceRole, caps: Capabilities, c: Customization): WidgetDef[] {
  const base = defaultLayoutFor(role, caps)
  const extra = c.order.filter(id => !base.includes(id) && WIDGET_BY_ID.has(id) && permitted(WIDGET_BY_ID.get(id)!, caps))
  const all = [...base, ...extra]
  const ordered = [
    ...c.order.filter(id => all.includes(id)),
    ...all.filter(id => !c.order.includes(id)),
  ]
  const seen = new Set<string>()
  return ordered
    .filter(id => !c.hidden.includes(id) && !seen.has(id) && seen.add(id))
    .map(id => WIDGET_BY_ID.get(id)!)
    .filter(Boolean)
}

export { WIDGET_BY_ID }
