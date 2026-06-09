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
import { useState, useMemo } from 'react'
import {
  CheckSquare, Clock, Shield, Inbox,
  AlertTriangle, Users, MapPin,
  type LucideIcon,
} from 'lucide-react'
import { type Capabilities } from '../lib/capabilities'
import { PageShell, type KPISpec } from '../page-shell'
import { useAuth } from '../context/AuthContext'
import { initialsOf } from '../lib/utils'
import { TICKET_CLOSED } from '../lib/status-constants'
import { WIDGET_ITEMS, WIDGET_APPROVALS } from '../lib/pagination'
import { OBJ } from '../lib/permissions-constants'
import { DetailTab, DetailTabList } from '../primitives'
import { useFetch, useFetched } from '../hooks/useFetch'
import AskGaaexView from './AskGaaexView'
import MessagesView from './MessagesView'
import CalendarView from './CalendarView'
import ProfileView from './ProfileView'

// ── helpers shared in component scope ────────────────────────────────────────
const toArr = (d: any): any[] => Array.isArray(d) ? d : (d?.items ?? d?.records ?? [])

type Me = { id: string; name: string; email: string }
// Covers all 11 system roles seeded by the backend (seed.py) plus workspace-module roles.
// Mapped to 8 distinct UI personalities:
//   admin        ← super_admin
//   manager      ← manager
//   support      ← customer_care, sales_agent (helpdesk-heavy)
//   sales        ← sales_agent, sales_d2d, sales_retail, sales_b2b
//   tech         ← field_technician, network_noc, noc_engineer
//   finance      ← billing, billing_specialist, revenue_control, finance
//   hr           ← hr
//   executive    ← executive
//   general      ← fallback
type Role = 'admin' | 'manager' | 'support' | 'sales' | 'tech' | 'finance' | 'hr' | 'executive' | 'general'

// ── role detection from capabilities ──────────────────────────────────────────
function detectRole(caps: Capabilities): Role {
  // Priority: most specific role first. Empty caps = FULL_ACCESS = super_admin.
  if (Object.keys(caps).length === 0) return 'admin'
  const has = (k: string, v: 'view' | 'create' | 'edit' | 'delete') =>
    caps[k] === undefined ? true : caps[k]?.[v] === true
  const hasAny = (k: string, v: string) => (caps as any)[k]?.[v] === true

  // configuration.manage = super_admin / admin
  if (hasAny(OBJ.CONFIGURATION, 'manage')) return 'admin'
  // role.manage = manager (has broad permissions but not full config)
  if (hasAny(OBJ.ROLE, 'manage')) return 'manager'
  // HR: employee management
  if (caps['employee']?.['edit']) return 'hr'
  // Executive: KPI/dashboard read-only, no write on operational objects
  if (caps['kpi']?.['view'] && !has(OBJ.HELPDESK_TICKET, 'create') && !has(OBJ.WORKITEM, 'create')) return 'executive'
  // Finance: billing, invoices, payments, collections
  if (has(OBJ.INVOICE, 'create') || has(OBJ.PAYMENT, 'create') || caps['billing_account']?.['view']) return 'finance'
  // Revenue Control / Billing: payment_order + billing_account but no invoice creation
  if (hasAny(OBJ.PAYMENT_ORDER, 'collect') || caps['credit_note']?.['view']) return 'finance'
  // Helpdesk / Customer Care: can edit helpdesk tickets
  if (has(OBJ.HELPDESK_TICKET, 'edit')) return 'support'
  // Sales (all variants: agent, D2D, retail, B2B): lead create/edit
  if (has(OBJ.LEAD, 'create') || has(OBJ.DEAL, 'edit')) return 'sales'
  // Field Technician / NOC / Network: work orders or workitem + schedule/service
  if (has(OBJ.WORKITEM, 'edit') || has(OBJ.SCHEDULE_SLOT, 'edit') || caps['alarm']?.['view']) return 'tech'
  return 'general'
}

const ROLE_SUBTITLE: Record<Role, string> = {
  admin:     'Administrator overview',
  manager:   'Manager dashboard',
  support:   'Support center',
  sales:     'Sales overview',
  tech:      'Tech bench',
  finance:   'Finance desk',
  hr:        'HR overview',
  executive: 'Executive overview',
  general:   'Your workspace',
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
function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
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
export default function HomeView({ onNavigate, capabilities }: {
  onNavigate?: (type: string, id?: string) => void
  capabilities?: Capabilities  // SM-2 — App's capabilities snapshot
}) {
  const { user: authUser } = useAuth()
  const [tab, setTab] = useState<'workspace' | 'ask' | 'messages' | 'calendar' | 'requests' | 'documents' | 'benefits' | 'kb'>('workspace')

  // SM-2 — receive caps via prop instead of refetching.
  const caps: Capabilities = capabilities ?? {}
  const capsLoaded = capabilities !== undefined

  // role: auto-detected from caps
  const role: Role = capsLoaded ? detectRole(caps) : 'general'

  // Identity
  const { data: me } = useFetch<Me>('/auth/me')

  // Org nodes + members for Team tab
  const { data: rawNodes }      = useFetch<any>('/api/org/nodes')
  const { data: rawOrgMembers } = useFetch<any>('/api/users')
  const nodes      = useMemo(() => toArr(rawNodes),      [rawNodes])
  const orgMembers = useMemo(() => toArr(rawOrgMembers), [rawOrgMembers])

  // Workspace data — 4 endpoints the ME|TEAM layout renders
  // SM-2 — capabilities now flow as a prop from App.tsx; no per-view refetch.
  const tasks     = useFetched<any[]>(me?.id ? `/api/workitems?assignee=${me.id}&limit=${WIDGET_ITEMS}` : null, d => toArr(d).length > 0)
  const tickets   = useFetched<any[]>(`/api/helpdesk/tickets?limit=${WIDGET_ITEMS}`,                           d => toArr(d).length > 0)
  const approvals = useFetched<any[]>(`/api/mandatory-approvals?status=PENDING&limit=${WIDGET_APPROVALS}`,     d => toArr(d).length > 0)
  const slots     = useFetched<any[]>(`/api/schedule-slots?limit=${WIDGET_ITEMS}`,                             d => toArr(d).length > 0)

  // ── Derived state ────────────────────────────────────────────────────────────
  const today = useMemo(() => todayKey(), [])

  const taskArr     = tasks.state     === 'ok' ? toArr(tasks.value)     : []
  const ticketArr   = tickets.state   === 'ok' ? toArr(tickets.value)   : []
  const approvalArr = approvals.state === 'ok' ? toArr(approvals.value) : []
  const slotArr     = slots.state     === 'ok' ? toArr(slots.value)     : []

  const myTickets   = me ? ticketArr.filter(t => t.assigned_user_id === me.id) : []
  const breachedTickets = myTickets.filter(t => {
    if (TICKET_CLOSED.includes(t.status)) return false
    const age = (Date.now() - Date.parse(t.created_at)) / (1000 * 3600)
    return age > 24
  })

  const tasksOpen    = taskArr.filter(t => ['TODO','IN_PROGRESS','BLOCKED'].includes(t.status))
  const overdueTasks = tasksOpen.filter(t => t.due_at && Date.parse(t.due_at) < Date.now())

  const todaySlots   = slotArr.filter(sl => (sl.data?.date ?? '') === today)
  const myTodaySlots = me ? todaySlots.filter(sl => sl.data?.tech === me.name || sl.data?.tech === me.id) : todaySlots

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
      value: ticketArr.filter(t => !TICKET_CLOSED.includes(t.status ?? '')).length,
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
      icon={
        authUser?.avatar_url
          ? <img src={authUser.avatar_url} alt="" />
          : <span className="ps-header-icon-initials">{initialsOf(authUser?.name ?? me?.name)}</span>
      }
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

            <Widget icon={Inbox} title="My Tickets" count={myTickets.filter(t => !TICKET_CLOSED.includes(t.status ?? '')).length}>
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

            <Widget icon={Inbox} title="Team Tickets" count={ticketArr.filter(t => !TICKET_CLOSED.includes(t.status ?? '')).length}>
              {tickets.state === 'loading' && <Skel />}
              {ticketArr.length === 0 ? <Empty msg="No open tickets" /> : ticketArr.filter(t => !TICKET_CLOSED.includes(t.status ?? '')).slice(0, 8).map(t => (
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

      {tab === 'ask' && <AskGaaexView embedded />}
      {tab === 'messages' && <MessagesView embedded />}
      {tab === 'calendar' && <CalendarView embedded />}
      {tab === 'requests' && <ProfileView embedded initialSection="requests" />}
      {tab === 'documents' && <ProfileView embedded initialSection="documents" />}
      {tab === 'benefits' && <ProfileView embedded initialSection="benefits" />}
      {tab === 'kb' && <ProfileView embedded initialSection="kb" />}

    </PageShell>
  )
}
