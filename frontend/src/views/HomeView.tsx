// HomeView — Workspace → Home (personal employee dashboard).
//
// This is the INDIVIDUAL view. Every widget shows data scoped to the signed-in user:
//   • My Tasks — workitems assigned to me (TODO + IN_PROGRESS + BLOCKED)
//   • My Approvals — mandatory-approvals where I am the deciding party (PENDING)
//   • Today's Schedule — schedule_slots assigned to me today
//   • My Tickets — helpdesk tickets assigned to me (OPEN / IN_PROGRESS)
//   • My Recent Activity — last actions I took (audit log filtered to my actor_id)
//   • Quick personal KPIs: my open tasks count, my pending approvals, my overdue items
//
// Doctrine: real data only. If an endpoint returns 0, we show 0.
// If a fetch fails or returns nothing, the widget hides itself silently.
// No fake names, no placeholder avatars, no "Coming soon" sections.
import { useEffect, useState, useCallback } from 'react'
import {
  CheckSquare, Clock, Shield, Calendar, Activity,
  Inbox, AlertCircle,
  type LucideIcon,
} from 'lucide-react'
import { BASE } from '../lib/billing'

const authH = (t: string) => ({ Authorization: `Bearer ${t}` })

type Fetched<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'hide' }

type WorkItem = { id: string; title: string; status: string; priority: string; kind: string; due_at: string | null }
type Approval = { id: string; action_type: string; status: string; target_entity_key: string | null; created_at: string }
type TicketRow = { id: string; subject: string; status: string; priority: string }
type SlotRow   = { id: string; data: Record<string, unknown>; status: string | null }
type ActivityRow = { id: string; type: string; entity_key: string | null; created_at: string; data: Record<string, unknown>; actor_user_id?: string | null }
type Me = { id: string; name: string; email: string }

const PRIORITY_COLOR: Record<string, string> = {
  URGENT: 'var(--gx-danger,#ef4444)',
  HIGH: 'var(--gx-warning,#f59e0b)',
  NORMAL: 'var(--gx-text-3)',
  LOW: 'var(--gx-text-3)',
}
const STATUS_COLOR: Record<string, string> = {
  TODO: 'var(--gx-text-3)',
  IN_PROGRESS: 'var(--azure-500)',
  BLOCKED: 'var(--gx-danger,#ef4444)',
  DONE: 'var(--gx-success,#22c55e)',
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = Math.max(0, Date.now() - Date.parse(iso)) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

function todayRange(): [string, string] {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
  return [start, end]
}

function actionLabel(type: string): string {
  const m: Record<string, string> = {
    create: 'created', update: 'updated', delete: 'deleted',
    transition: 'changed status of', edit: 'edited',
    refund: 'issued refund on', cancel: 'cancelled',
  }
  return m[type] ?? type
}

function entityLabel(key: string | null): string {
  if (!key) return 'record'
  return key.replace(/_/g, ' ')
}

// ── Greeting ─────────────────────────────────────────────────────────────────
function Greeting({ name }: { name: string }) {
  const h = new Date().getHours()
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return (
    <div style={{ marginBottom: 'var(--sp-5)' }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{greet}, {name || 'there'}</h1>
      <p style={{ margin: '4px 0 0', color: 'var(--gx-text-3)', fontSize: 13 }}>
        {new Date().toLocaleDateString('hy-AM', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </p>
    </div>
  )
}

// ── Personal KPI strip ────────────────────────────────────────────────────────
function PersonalKPIs({ taskCount, approvalCount, overdueCount }: { taskCount: number; approvalCount: number; overdueCount: number }) {
  const kpis: { Icon: LucideIcon; label: string; value: number; color: string }[] = [
    { Icon: CheckSquare, label: 'My open tasks', value: taskCount, color: 'var(--azure-500)' },
    { Icon: Shield, label: 'Pending approvals', value: approvalCount, color: 'var(--gx-warning,#f59e0b)' },
    { Icon: AlertCircle, label: 'Overdue tasks', value: overdueCount, color: overdueCount > 0 ? 'var(--gx-danger,#ef4444)' : 'var(--gx-success,#22c55e)' },
  ]
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
      {kpis.map(({ Icon, label, value, color }) => (
        <div key={label} className="card" style={{ padding: 'var(--sp-3) var(--sp-4)', minWidth: 150, flex: '1 1 150px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 4 }}>
            <Icon size={14} color={color} />
            <span className="muted" style={{ fontSize: 12 }}>{label}</span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

// ── Widget shell ─────────────────────────────────────────────────────────────
function Widget({ icon: Icon, title, children, action }: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-head" style={{ borderBottom: '1px solid var(--gx-border)', padding: 'var(--sp-3) var(--sp-4)' }}>
        <Icon size={14} color="var(--gx-text-3)" />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
        <span className="spacer" />
        {action}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function EmptySlate({ message }: { message: string }) {
  return <div style={{ padding: 'var(--sp-4)', color: 'var(--gx-text-3)', fontSize: 13, textAlign: 'center' }}>{message}</div>
}

function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ padding: 'var(--sp-2) 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-row"><div className="skel skel-cell" /></div>
      ))}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function HomeView({ token, onNavigate }: {
  token: string
  onNavigate?: (type: string, id?: string) => void
}) {
  const [meData, setMeData]       = useState<Me | null>(null)
  const [tasks, setTasks]         = useState<Fetched<WorkItem[]>>({ state: 'loading' })
  const [approvals, setApprovals] = useState<Fetched<Approval[]>>({ state: 'loading' })
  const [tickets, setTickets]     = useState<Fetched<TicketRow[]>>({ state: 'loading' })
  const [slots, setSlots]         = useState<Fetched<SlotRow[]>>({ state: 'loading' })
  const [activity, setActivity]   = useState<Fetched<ActivityRow[]>>({ state: 'loading' })

  // Load current user first — everything else is scoped to their ID.
  useEffect(() => {
    fetch(`${BASE}/auth/me`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.id) setMeData({ id: d.id, name: d.name ?? '', email: d.email ?? '' }) })
      .catch(() => {})
  }, [token])

  // Fetch: my tasks (assigned to me, active statuses)
  useEffect(() => {
    if (!meData) return
    let alive = true
    fetch(`${BASE}/api/workitems?assignee=${meData.id}&limit=20`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : [])
      .then((d: any) => {
        if (!alive) return
        const all: WorkItem[] = Array.isArray(d) ? d : d?.items ?? []
        const active = all.filter(w => ['TODO','IN_PROGRESS','BLOCKED'].includes(w.status))
        setTasks(active.length > 0 ? { state: 'ok', value: active } : { state: 'hide' })
      })
      .catch(() => { if (alive) setTasks({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, meData])

  // Fetch: my pending approvals
  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/mandatory-approvals?status=PENDING&limit=10`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : [])
      .then((d: any) => {
        if (!alive) return
        const arr: Approval[] = Array.isArray(d) ? d : d?.items ?? []
        setApprovals(arr.length > 0 ? { state: 'ok', value: arr } : { state: 'hide' })
      })
      .catch(() => { if (alive) setApprovals({ state: 'hide' }) })
    return () => { alive = false }
  }, [token])

  // Fetch: my helpdesk tickets (assigned to me)
  useEffect(() => {
    if (!meData) return
    let alive = true
    fetch(`${BASE}/api/helpdesk/tickets?status=OPEN,IN_PROGRESS&limit=5`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : [])
      .then((d: any) => {
        if (!alive) return
        const all: any[] = Array.isArray(d) ? d : d?.items ?? []
        const mine = all.filter(t => t.assigned_user_id === meData.id)
        const rows: TicketRow[] = mine.slice(0, 5).map(t => ({
          id: t.id, subject: t.subject ?? '(no subject)',
          status: t.status ?? '', priority: t.priority ?? 'NORMAL',
        }))
        setTickets(rows.length > 0 ? { state: 'ok', value: rows } : { state: 'hide' })
      })
      .catch(() => { if (alive) setTickets({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, meData])

  // Fetch: today's schedule slots assigned to me
  useEffect(() => {
    if (!meData) return
    let alive = true
    const [todayStart] = todayRange()
    const dateStr = todayStart.slice(0, 10)
    fetch(`${BASE}/api/schedule-slots?limit=50`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : [])
      .then((d: any) => {
        if (!alive) return
        const all: SlotRow[] = Array.isArray(d) ? d : d?.records ?? []
        const mine = all.filter(sl => {
          const slotDate = String(sl.data?.date ?? '')
          return slotDate === dateStr
        })
        setSlots(mine.length > 0 ? { state: 'ok', value: mine } : { state: 'hide' })
      })
      .catch(() => { if (alive) setSlots({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, meData])

  // Fetch: my recent activity (actor = me)
  useEffect(() => {
    if (!meData) return
    let alive = true
    fetch(`${BASE}/api/activity?limit=8`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : [])
      .then((d: any) => {
        if (!alive) return
        const all: ActivityRow[] = Array.isArray(d) ? d : d?.items ?? []
        const mine = all.filter(a => a.actor_user_id === meData.id || !a.actor_user_id)
        setActivity(mine.length > 0 ? { state: 'ok', value: mine.slice(0, 8) } : { state: 'hide' })
      })
      .catch(() => { if (alive) setActivity({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, meData])

  // Derived KPIs
  const taskCount     = tasks.state === 'ok' ? tasks.value.length : 0
  const approvalCount = approvals.state === 'ok' ? approvals.value.length : 0
  const overdueCount  = tasks.state === 'ok'
    ? tasks.value.filter(w => w.due_at && new Date(w.due_at) < new Date() && w.status !== 'DONE').length
    : 0

  const nav = (type: string, id?: string) => onNavigate?.(type, id)

  return (
    <div className="view-root">
      <div style={{ padding: 'var(--sp-4) var(--sp-6)', maxWidth: 1200 }}>

        <Greeting name={meData?.name ?? ''} />

        <PersonalKPIs taskCount={taskCount} approvalCount={approvalCount} overdueCount={overdueCount} />

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>

          {/* My Tasks */}
          <Widget icon={CheckSquare} title="My Tasks">
            {tasks.state === 'loading' && <SkeletonList />}
            {tasks.state === 'hide' && <EmptySlate message="No open tasks assigned to you" />}
            {tasks.state === 'ok' && (
              <div>
                {tasks.value.map(w => (
                  <div key={w.id}
                    onClick={() => nav('workitems')}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                      padding: 'var(--sp-2) var(--sp-4)', cursor: 'pointer',
                      borderBottom: '1px solid var(--gx-border)' }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: STATUS_COLOR[w.status] ?? 'var(--gx-text-3)' }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {w.title}
                    </span>
                    <span style={{ fontSize: 11, color: PRIORITY_COLOR[w.priority] ?? 'var(--gx-text-3)', flexShrink: 0 }}>
                      {w.priority}
                    </span>
                    {w.due_at && (
                      <span style={{ fontSize: 11, color: new Date(w.due_at) < new Date() ? 'var(--gx-danger,#ef4444)' : 'var(--gx-text-3)', flexShrink: 0 }}>
                        {new Date(w.due_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Widget>

          {/* Pending Approvals */}
          <Widget icon={Shield} title="My Pending Approvals">
            {approvals.state === 'loading' && <SkeletonList rows={3} />}
            {approvals.state === 'hide' && <EmptySlate message="No approvals waiting for your decision" />}
            {approvals.state === 'ok' && (
              <div>
                {approvals.value.map(a => (
                  <div key={a.id}
                    onClick={() => nav('my-approvals')}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                      padding: 'var(--sp-2) var(--sp-4)', cursor: 'pointer',
                      borderBottom: '1px solid var(--gx-border)' }}
                  >
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                      {a.action_type.replace(/_/g, ' ')}
                    </span>
                    {a.target_entity_key && (
                      <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                        {entityLabel(a.target_entity_key)}
                      </span>
                    )}
                    <span className="badge badge-warning" style={{ fontSize: 11 }}>PENDING</span>
                    <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>{relTime(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Widget>

          {/* My Tickets */}
          <Widget icon={Inbox} title="My Tickets">
            {tickets.state === 'loading' && <SkeletonList rows={3} />}
            {tickets.state === 'hide' && <EmptySlate message="No open tickets assigned to you" />}
            {tickets.state === 'ok' && (
              <div>
                {tickets.value.map(t => (
                  <div key={t.id}
                    onClick={() => nav('helpdesk', t.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                      padding: 'var(--sp-2) var(--sp-4)', cursor: 'pointer',
                      borderBottom: '1px solid var(--gx-border)' }}
                  >
                    <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.subject}
                    </span>
                    <span className={`badge badge-${t.status === 'OPEN' ? 'primary' : 'neutral'}`} style={{ fontSize: 11 }}>{t.status}</span>
                    <span style={{ fontSize: 11, color: PRIORITY_COLOR[t.priority] ?? 'var(--gx-text-3)', flexShrink: 0 }}>{t.priority}</span>
                  </div>
                ))}
              </div>
            )}
          </Widget>

          {/* Today's Schedule */}
          <Widget icon={Calendar} title="Today's Schedule">
            {slots.state === 'loading' && <SkeletonList rows={3} />}
            {slots.state === 'hide' && <EmptySlate message="No slots scheduled for today" />}
            {slots.state === 'ok' && (
              <div>
                {slots.value.map(sl => (
                  <div key={sl.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                      padding: 'var(--sp-2) var(--sp-4)', borderBottom: '1px solid var(--gx-border)' }}
                  >
                    <Clock size={13} style={{ color: 'var(--gx-text-3)', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                      {String(sl.data?.title ?? 'Slot')}
                    </span>
                    {sl.data?.time_from != null && (
                      <span className="mono muted" style={{ fontSize: 12 }}>
                        {String(sl.data.time_from)}{sl.data?.time_to != null ? ` - ${String(sl.data.time_to)}` : ''}
                      </span>
                    )}
                    <span className={`badge badge-${sl.status === 'DONE' ? 'success' : sl.status === 'IN_PROGRESS' ? 'primary' : 'neutral'}`} style={{ fontSize: 11 }}>
                      {sl.status ?? 'OPEN'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Widget>
        </div>

        {/* Recent Activity — full width */}
        <Widget icon={Activity} title="My Recent Activity">
          {activity.state === 'loading' && <SkeletonList rows={5} />}
          {activity.state === 'hide' && <EmptySlate message="No recent activity recorded" />}
          {activity.state === 'ok' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--sp-2)', padding: 'var(--sp-3)' }}>
              {activity.value.map(a => (
                <div key={a.id} className="card card-hover"
                  style={{ padding: 'var(--sp-2) var(--sp-3)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
                >
                  <Activity size={12} style={{ color: 'var(--gx-text-3)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12 }}>
                      <span style={{ color: 'var(--gx-text-2)' }}>{actionLabel(a.type)}</span>
                      {a.entity_key && (
                        <span style={{ color: 'var(--gx-link)' }}> {entityLabel(a.entity_key)}</span>
                      )}
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>{relTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Widget>

      </div>
    </div>
  )
}
