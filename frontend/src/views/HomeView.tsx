// HomeView — role/department-personalized landing (the "LayoutRegistry" the backend's
// /api/me/workspace-role was built to drive).
//
// Personalization key = the backend-resolved WORKSPACE ROLE (one of 10: ceo · d2d_agent ·
// retail_agent · b2b_am · support_t1 · support_t2 · field_tech · noc_engineer · billing_spec ·
// general). It already encodes position nuance. From it we resolve:
//   • EXACTLY 4 role KPIs (with X/Y targets where a real ratio exists)
//   • a "Needs You Now" urgent band (SLA breaches · overdue · approvals waiting on you)
//   • a role-default widget layout (lib/workspace/registry). The layout is FIXED per role — end
//     users do NOT customize it; only an admin sets layouts (via Studio). Widgets are equal-height
//     (≈6 rows, scroll for more); a full-width Recent Activity card fills the bottom.
//
// Real data only — every number comes from a backend endpoint. No mocks, no random.
import { useState, useMemo } from 'react'
import { AlertTriangle, Shield, Clock, Check } from 'lucide-react'
import { type Capabilities } from '../lib/capabilities'
import { PageShell, type KPISpec } from '../page-shell'
import { useAuth } from '../context/AuthContext'
import { initialsOf } from '../lib/utils'
import { TICKET_CLOSED } from '../lib/status-constants'
import { DetailTab, DetailTabList } from '../primitives'
import { useFetch, useFetched } from '../hooks/useFetch'
import { useI18n } from '../lib/i18n'
import { type WorkspaceRole, resolveWidgets } from '../lib/workspace/registry'
import AskGaaexView from './AskGaaexView'
import MessagesView from './MessagesView'
import MailView from './mail/MailView'
import CalendarView from './CalendarView'
import ProfileView from './ProfileView'

const toArr = (d: any): any[] => (Array.isArray(d) ? d : (d?.items ?? d?.records ?? []))
const relTime = (iso?: string | null) => { if (!iso) return ''; const d = Math.max(0, Date.now() - Date.parse(iso)) / 1000; return d < 3600 ? `${Math.floor(d / 60)}m` : d < 86400 ? `${Math.floor(d / 3600)}h` : `${Math.floor(d / 86400)}d` }
const NONE: { hidden: string[]; order: string[] } = { hidden: [], order: [] }

type Me = { id: string; name: string; email: string }
type WorkspaceRoleResp = { resolved_role: WorkspaceRole; label: string; source: string }

const ROLE_LABEL_DEFAULT: Record<WorkspaceRole, string> = {
  ceo: 'Executive overview', b2b_am: 'B2B account desk', d2d_agent: 'Door-to-door sales',
  retail_agent: 'Retail sales', support_t1: 'Support — Tier 1', support_t2: 'Support — Tier 2',
  field_tech: 'Field technician', noc_engineer: 'NOC engineer', billing_spec: 'Billing & collections',
  general: 'Your workspace',
}

// Full-width card that fills the bottom of the grid — a tenant-wide recent-activity feed.
function RecentActivity({ onNavigate }: { onNavigate?: (t: string, id?: string) => void }) {
  const { t } = useI18n()
  const { data } = useFetch<any[]>('/api/activity?limit=24')
  const items = toArr(data)
  return (
    <div className="card wx-full">
      <div className="wx-head">
        <h3 className="wx-title">{t('home.widget.recentActivity', 'Recent Activity')}</h3>
        {items.length > 0 && <span className="wx-count">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <div style={{ padding: 'var(--gx-space-18)', color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-13)', textAlign: 'center' }}>{t('home.empty.noActivity', 'No recent activity')}</div>
      ) : (
        <div className="wx-activity">
          {items.slice(0, 18).map((a: any, i: number) => (
            <div key={a.id ?? i} className="wx-act-row" role="button" tabIndex={0}
              onClick={() => a.entity_key && a.record_id && onNavigate?.(a.entity_key, a.record_id)}
              onKeyDown={(e) => { if (e.key === 'Enter' && a.entity_key && a.record_id) onNavigate?.(a.entity_key, a.record_id) }}>
              <span className="wx-act-dot" />
              <span className="wx-act-text">
                <strong style={{ color: 'var(--gx-text-1)', fontWeight: 'var(--gx-weight-semibold)' }}>{a.actor_name || 'System'}</strong>{' '}
                {a.summary ?? (a.type ?? a.event_type ?? 'activity').replace(/_/g, ' ')}
              </span>
              <span className="wx-act-time">{relTime(a.created_at ?? a.at ?? a.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function HomeView({ onNavigate, capabilities }: {
  onNavigate?: (type: string, id?: string) => void
  capabilities?: Capabilities
}) {
  const { user: authUser } = useAuth()
  const { t } = useI18n()
  const [tab, setTab] = useState<'workspace' | 'ask' | 'messages' | 'mail' | 'calendar' | 'requests' | 'documents' | 'benefits' | 'kb'>('workspace')

  const caps: Capabilities = capabilities ?? {}

  // Identity + the backend-resolved workspace role (the personalization key).
  const { data: me } = useFetch<Me>('/auth/me')
  const { data: roleResp } = useFetch<WorkspaceRoleResp>('/api/me/workspace-role')
  const role: WorkspaceRole = roleResp?.resolved_role ?? 'general'

  // ── KPI data sources (fetched per-role; null = not fetched) ───────────────────
  const needsBilling = role === 'ceo' || role === 'billing_spec'
  const needsTeamTickets = role === 'support_t2'
  const needsLeads = role === 'd2d_agent' || role === 'retail_agent' || role === 'b2b_am'

  const myTasks   = useFetched<any[]>(me?.id ? `/api/workitems?assignee=${me.id}&limit=50` : null, d => toArr(d).length > 0)
  const myTickets = useFetched<any[]>(me?.id ? '/api/helpdesk/tickets?mine=true&limit=50' : null, d => toArr(d).length > 0)
  const teamTix   = useFetched<any[]>(needsTeamTickets ? '/api/helpdesk/tickets?limit=80' : null, d => toArr(d).length > 0)
  const approvals = useFetched<any[]>('/api/mandatory-approvals?status=PENDING&limit=50', d => toArr(d).length > 0)
  const overdue   = useFetched<any[]>(needsBilling ? '/api/invoices?status=overdue&limit=80' : null, d => toArr(d).length > 0)
  const leads     = useFetched<any[]>(needsLeads ? `/api/leads?filter=${encodeURIComponent("status != 'LOST' and status != 'ORDER_CREATED'")}&limit=80` : null, d => toArr(d).length > 0)
  const { data: dashStats, loading: dashLoading } = useFetch<any>(needsBilling ? '/api/analytics/dashboard/stats' : null)

  const val = (q: { state: string; value?: any }) => (q.state === 'ok' ? toArr(q.value) : [])
  const taskArr = val(myTasks), myTixArr = val(myTickets), teamTixArr = val(teamTix), apprArr = val(approvals)
  const overdueArr = val(overdue), leadArr = val(leads)

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const tasksOpen = taskArr.filter(t => ['TODO', 'IN_PROGRESS', 'BLOCKED'].includes(t.status))
  const overdueTasks = tasksOpen.filter(t => t.due_at && Date.parse(t.due_at) < Date.now())
  const myTixOpen = myTixArr.filter(t => !TICKET_CLOSED.includes(t.status ?? ''))
  const slaBreached = myTixOpen.filter(t => (Date.now() - Date.parse(t.created_at)) / 3600000 > 24)
  const todayJobs = taskArr.filter(t => (t.scheduled_at ?? '').slice(0, 10) === today)
  const todayJobsDone = todayJobs.filter(t => ['DONE', 'CLOSED', 'COMPLETED'].includes(t.status))

  // ── EXACTLY 4 role KPIs (real values; X/Y progress where a real ratio exists) ─────
  const kpiYou = (label: string, value: number | string, sub: string, extra?: Partial<KPISpec>): KPISpec =>
    ({ label, value, subtitle: sub, cornerNote: <span className="kpi-scope kpi-scope-you">YOU</span>, ...extra })
  const kpiTeam = (label: string, value: number | string, sub: string, extra?: Partial<KPISpec>): KPISpec =>
    ({ label, value, subtitle: sub, cornerNote: <span className="kpi-scope kpi-scope-team">TEAM</span>, ...extra })
  const kpiOrg = (label: string, value: number | string, sub: string, extra?: Partial<KPISpec>): KPISpec =>
    ({ label, value, subtitle: sub, cornerNote: <span className="kpi-scope kpi-scope-org">ORG</span>, ...extra })

  const kTasks = kpiYou(t('home.kpi.myOpenTasks', 'My Open Tasks'), tasksOpen.length,
    overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : t('home.kpi.upToDate', 'up to date'),
    { warning: overdueTasks.length > 0, loading: myTasks.state === 'loading', onClick: () => onNavigate?.('workitems') })
  const kMyTix = kpiYou(t('home.kpi.myTickets', 'My Tickets'), myTixOpen.length,
    slaBreached.length > 0 ? `${slaBreached.length} past SLA` : t('home.kpi.allWithinSla', 'all within SLA'),
    { danger: slaBreached.length > 0, loading: myTickets.state === 'loading', onClick: () => onNavigate?.('helpdesk') })
  const kSla = kpiTeam(t('home.kpi.slaAtRisk', 'SLA at Risk'), slaBreached.length,
    slaBreached.length > 0 ? t('home.kpi.actNow', 'act now') : t('home.kpi.clear', 'clear'),
    { danger: slaBreached.length > 0, loading: myTickets.state === 'loading' })
  const kAppr = kpiOrg(t('home.kpi.pendingApprovals', 'Pending Approvals'), apprArr.length,
    apprArr.length > 0 ? t('home.kpi.requireDecision', 'require your decision') : t('home.kpi.nothingPending', 'nothing pending'),
    { warning: apprArr.length > 0, loading: approvals.state === 'loading', onClick: () => onNavigate?.('my-approvals') })
  const kPipe = kpiYou(t('home.kpi.myPipeline', 'My Pipeline'), leadArr.length, t('home.kpi.activeLeads', 'active leads'),
    { loading: leads.state === 'loading', onClick: () => onNavigate?.('leads') })
  const kDispatch = kpiYou(t('home.kpi.dispatchesToday', "Today's Dispatches"), todayJobs.length,
    todayJobs.length > 0 ? `${todayJobsDone.length}/${todayJobs.length} ${t('home.kpi.done', 'done')}` : t('home.kpi.noneToday', 'none today'),
    { loading: myTasks.state === 'loading', progress: todayJobs.length ? Math.round((todayJobsDone.length / todayJobs.length) * 100) : 0, progressVariant: 'gold', progressLabel: `${todayJobsDone.length}/${todayJobs.length}`, onClick: () => onNavigate?.('workitems') })
  const kDoneToday = kpiYou(t('home.kpi.doneToday', 'Done Today'), todayJobsDone.length, t('home.kpi.jobsCompleted', 'jobs completed'), { onClick: () => onNavigate?.('workitems') })
  const kTeamTix = kpiTeam(t('home.kpi.teamTicketsOpen', 'Team Tickets Open'), teamTixArr.filter(x => !TICKET_CLOSED.includes(x.status ?? '')).length,
    t('home.kpi.acrossQueue', 'across the queue'), { loading: teamTix.state === 'loading', onClick: () => onNavigate?.('helpdesk') })
  const kOverdue = kpiOrg(t('home.kpi.overdueInvoices', 'Overdue Invoices'), overdueArr.length, t('home.kpi.inCollections', 'in collections'),
    { danger: overdueArr.length > 0, loading: overdue.state === 'loading', onClick: () => onNavigate?.('invoices') })
  const kPayments = kpiOrg(t('home.kpi.paymentsToday', 'Payments Today'), dashStats?.payments_today ?? 0, t('home.kpi.collectedSinceMidnight', 'collected since midnight'), { loading: dashLoading })
  const kResolved = kpiOrg(t('home.kpi.resolvedToday', 'Resolved Today'), dashStats?.collections_resolved ?? 0, t('home.kpi.ticketsClosedToday', 'tickets closed today'), { loading: dashLoading })
  const kActive = kpiOrg(t('home.kpi.activeUsers', 'Active Users'), dashStats?.active_users ?? 0, t('home.kpi.staffAccountsActive', 'staff active'), { loading: dashLoading })
  const kHealth = kpiOrg(t('home.kpi.systemHealth', 'System Health'), `${dashStats?.system_health_pct ?? 0}%`,
    (dashStats?.system_health_pct ?? 100) === 100 ? t('home.kpi.allSystemsGo', 'all systems go') : t('home.kpi.degraded', 'degraded'),
    { loading: dashLoading, progress: dashStats?.system_health_pct ?? 0, progressVariant: (dashStats?.system_health_pct ?? 100) < 100 ? 'danger' : 'success', warning: (dashStats?.system_health_pct ?? 100) < 100 })

  const ROLE_KPIS: Record<WorkspaceRole, KPISpec[]> = {
    ceo:          [kPayments, kResolved, kActive, kHealth],
    billing_spec: [kOverdue, kPayments, kTasks, kAppr],
    field_tech:   [kDispatch, kDoneToday, kTasks, kMyTix],
    noc_engineer: [kMyTix, kDispatch, kTasks, kAppr],
    support_t1:   [kMyTix, kSla, kTasks, kAppr],
    support_t2:   [kTeamTix, kMyTix, kSla, kAppr],
    b2b_am:       [kPipe, kMyTix, kTasks, kAppr],
    d2d_agent:    [kPipe, kTasks, kMyTix, kAppr],
    retail_agent: [kPipe, kTasks, kMyTix, kAppr],
    general:      [kTasks, kMyTix, kSla, kAppr],
  }
  const kpiSpecs = (ROLE_KPIS[role] ?? ROLE_KPIS.general).slice(0, 4)

  // ── "Needs You Now" — ALWAYS-ON status band (Gev 2026-06-14): every category is shown even when
  //     clear (green + "0 …"), and turns red/amber the moment it needs you. ─────────────────────────
  const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  // Glass tint: a status colour over a 50%-translucent surface — matches the KPI/card glass level.
  const glassTint = (c: string) => `color-mix(in srgb, ${c} 16%, color-mix(in srgb, var(--gx-surface) 50%, transparent))`
  const bands = [
    { count: slaBreached.length, icon: AlertTriangle, warn: 'var(--gx-danger)',  soft: 'var(--gx-danger-soft)',  label: pl(slaBreached.length, t('home.urgent.sla.one', 'ticket past SLA'), t('home.urgent.sla.many', 'tickets past SLA')), onClick: () => onNavigate?.('helpdesk') },
    { count: overdueTasks.length, icon: Clock,        warn: 'var(--gx-warning)', soft: 'var(--gx-warning-soft)', label: pl(overdueTasks.length, t('home.urgent.overdue.one', 'task overdue'), t('home.urgent.overdue.many', 'tasks overdue')), onClick: () => onNavigate?.('workitems') },
    { count: apprArr.length,      icon: Shield,       warn: 'var(--gx-warning)', soft: 'var(--gx-warning-soft)', label: pl(apprArr.length, t('home.urgent.approvals.one', 'approval awaiting you'), t('home.urgent.approvals.many', 'approvals awaiting you')), onClick: () => onNavigate?.('my-approvals') },
  ]

  // Role-default widget layout (FIXED per role — no end-user customization).
  const widgets = useMemo(() => resolveWidgets(role, caps, NONE), [role, caps])

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={[t('nav.workspace', 'Workspace')]}
      icon={authUser?.avatar_url ? <img src={authUser.avatar_url} alt="" /> : <span className="ps-header-icon-initials">{initialsOf(authUser?.name ?? me?.name)}</span>}
      title={me?.name ?? 'Workspace'}
      subtitle={roleResp?.label ?? ROLE_LABEL_DEFAULT[role]}
      kpis={kpiSpecs}
      pageTabs={
        <DetailTabList ariaLabel="Workspace sections">
          <DetailTab active={tab === 'workspace'} onSelect={() => setTab('workspace')}>{t('home.tab.workspace', 'Workspace')}</DetailTab>
          <DetailTab active={tab === 'ask'} onSelect={() => setTab('ask')}>{t('home.tab.ask', 'Ask Me')}</DetailTab>
          <DetailTab active={tab === 'messages'} onSelect={() => setTab('messages')}>{t('home.tab.messenger', 'Messenger')}</DetailTab>
          <DetailTab active={tab === 'mail'} onSelect={() => setTab('mail')}>{t('home.tab.mail', 'Mail')}</DetailTab>
          <DetailTab active={tab === 'calendar'} onSelect={() => setTab('calendar')}>{t('home.tab.calendar', 'Calendar')}</DetailTab>
          <DetailTab active={tab === 'requests'} onSelect={() => setTab('requests')}>{t('home.tab.requests', 'My Requests')}</DetailTab>
          <DetailTab active={tab === 'documents'} onSelect={() => setTab('documents')}>{t('home.tab.documents', 'My Documents')}</DetailTab>
          <DetailTab active={tab === 'benefits'} onSelect={() => setTab('benefits')}>{t('home.tab.benefits', 'My Benefits')}</DetailTab>
          <DetailTab active={tab === 'kb'} onSelect={() => setTab('kb')}>{t('home.tab.kb', 'Knowledge Base')}</DetailTab>
        </DetailTabList>
      }
    >
      {tab === 'workspace' && (
        <div className="ws-home">
          <div className="ws-urgent">
            {bands.map((bnd, i) => {
              const ok = bnd.count === 0
              const Icon = ok ? Check : bnd.icon
              return (
                <button key={i} type="button" className="ws-urgent-chip"
                  style={{ background: glassTint(ok ? 'var(--gx-success)' : bnd.warn) }} onClick={bnd.onClick}>
                  <Icon size={14} color={ok ? 'var(--gx-success)' : bnd.warn} />
                  <span>{bnd.label}</span>
                </button>
              )
            })}
          </div>

          <div className="ws-grid">
            {widgets.map(w => <w.Component key={w.id} meId={me?.id} onNavigate={onNavigate} />)}
            <RecentActivity onNavigate={onNavigate} />
          </div>
        </div>
      )}

      {tab === 'ask' && <AskGaaexView embedded />}
      {tab === 'messages' && <MessagesView embedded />}
      {tab === 'mail' && <MailView />}
      {tab === 'calendar' && <CalendarView embedded />}
      {tab === 'requests' && <ProfileView embedded initialSection="requests" />}
      {tab === 'documents' && <ProfileView embedded initialSection="documents" />}
      {tab === 'benefits' && <ProfileView embedded initialSection="benefits" />}
      {tab === 'kb' && <ProfileView embedded initialSection="kb" />}
    </PageShell>
  )
}
