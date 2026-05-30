// MyTasksView — the Workspace → My Tasks page.
//
// SCOPE: only the CURRENT user's work items. Always calls listWorkItems(token,
// { mine: true }) so the backend's per-user filter (workitems.py:118) is the
// source of truth. The view never falls back to mock/illustrative data — if the
// fetch yields nothing or fails, the page renders the empty / 403 / nothing state.
//
// DOCTRINE: empty source → render nothing. A real fetched 0 → show "0 open".
// Errors hide the table/board entirely and log to console (no banner).

import { useEffect, useMemo, useState } from 'react'
import ViewHead from '../components/ViewHead'
import WorkItemsTable from '../components/WorkItemsTable'
import WorkItemsBoard from '../components/WorkItemsBoard'
import { EmptyState, PermissionDenied, SkeletonRows } from '../components/States'
import { CheckIcon, GearIcon, InboxIcon, SearchIcon } from '../components/icons'
import { Plus, Rows3, Columns3 } from 'lucide-react'
import {
  listWorkItems, type WorkItem, type WorkItemPriority, type WorkItemStatus,
} from '../lib/workitems'
import { listUsers, type User } from '../lib/users'
import { loadCustomers } from '../lib/billing'

// Default column set for My Tasks. SLA is intentionally absent — WorkItem has
// no `sla_due_at`. We surface `due_at` as the closest real proxy.
const MY_TASKS_COLUMNS = [
  { key: 'title',     label: 'Title',    visible: true },
  { key: 'kind',      label: 'Kind',     visible: true },
  { key: 'status',    label: 'Status',   visible: true },
  { key: 'priority',  label: 'Priority', visible: true },
  { key: 'due',       label: 'Due',      visible: true },
  { key: 'scheduled', label: 'Scheduled', visible: true },
]

const OPEN_STATUSES: WorkItemStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED']
const PRIORITIES: WorkItemPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const STATUS_FILTERS: WorkItemStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']

type ViewMode = 'table' | 'board'

// Internal load state. `null` means fetch hasn't completed yet (show skeleton).
type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; items: WorkItem[] }
  | { kind: 'forbidden' }
  | { kind: 'error' }    // hides table + console.error per spec

export default function MyTasksView({
  token,
  canConfigure = false,
  onConfigure,
}: {
  token: string
  canConfigure?: boolean
  onConfigure?: () => void
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [users, setUsers] = useState<User[]>([])
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<ViewMode>('table')
  const [query, setQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<WorkItemPriority | ''>('')
  const [statusFilter, setStatusFilter] = useState<WorkItemStatus | ''>('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)

  async function loadData() {
    setState({ kind: 'loading' })
    const res = await listWorkItems(token, { mine: true })
    if (res.status === 403) { setState({ kind: 'forbidden' }); return }
    if (!res.ok) {
      console.error('[mytasks] listWorkItems failed', res.status)
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'ok', items: Array.isArray(res.data) ? res.data : [] })
  }

  useEffect(() => { loadData() }, [token])

  // Users + customer names are auxiliary; failures are non-blocking (table just
  // falls back to displaying IDs/dashes for unresolved values).
  useEffect(() => {
    (async () => {
      const res = await listUsers(token)
      if (res.ok && Array.isArray(res.data)) setUsers(res.data)
    })()
    ;(async () => {
      try { setCustomerNames(await loadCustomers(token)) } catch { /* hide-if-missing */ }
    })()
  }, [token])

  // ── Derived data ───────────────────────────────────────────────────────────

  const items = state.kind === 'ok' ? state.items : []

  // Real counts: backend gave us this user's items only, so .filter on status
  // is doctrine-compliant (every value is a true fetched field).
  const openCount = items.filter((i) => i.status && OPEN_STATUSES.includes(i.status as WorkItemStatus)).length
  const overdueCount = items.filter((i) => {
    if (!i.due_at) return false
    if (i.status && (i.status === 'DONE' || i.status === 'CANCELLED')) return false
    const due = new Date(i.due_at)
    return !isNaN(due.getTime()) && due.getTime() < Date.now()
  }).length

  // Client-side filters. priority / status dropdowns hide nothing if "All".
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((it) => {
      if (priorityFilter && it.priority !== priorityFilter) return false
      if (statusFilter && it.status !== statusFilter) return false
      if (q) {
        const hay = [it.title ?? '', it.id ?? '', it.kind ?? ''].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, query, priorityFilter, statusFilter])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const get = (it: WorkItem): string => {
      switch (sortKey) {
        case 'title': return it.title ?? ''
        case 'kind': return it.kind ?? ''
        case 'status': return it.status ?? ''
        case 'priority': return it.priority ?? ''
        case 'due': return it.due_at ?? ''
        case 'scheduled': return it.scheduled_at ?? ''
        case 'assignee': return it.assigned_user_id ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => get(a).localeCompare(get(b)) * sortDir)
  }, [filtered, sortKey, sortDir])

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  // ── Subtitle (built from real counts) ──────────────────────────────────────
  // Per doctrine: 0 IS a real fetched value → show it. A failed/forbidden fetch
  // → no subtitle (we can't honestly report counts).
  const subtitle: string | undefined = state.kind === 'ok'
    ? (overdueCount > 0 ? `${openCount} open · ${overdueCount} overdue` : `${openCount} open`)
    : undefined

  // ── Render branches ────────────────────────────────────────────────────────

  if (state.kind === 'forbidden') {
    return (
      <div className="view">
        <div className="view-inner fade">
          <div className="crumbs">
            <span>Workspace</span>
            <span className="sep">/</span>
            <span style={{ color: 'var(--gx-text-1)' }}>My Tasks</span>
          </div>
          <ViewHead icon={<CheckIcon size={18} />} title="My Tasks" />
          <PermissionDenied />
        </div>
      </div>
    )
  }

  // P2 doesn't wire mutations or row-click — those land in P3. Provide no-ops.
  const noopRowClick = () => {}
  const noopStatus = async () => {}

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs">
          <span>Workspace</span>
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>My Tasks</span>
        </div>

        <ViewHead
          icon={<CheckIcon size={18} />}
          title="My Tasks"
          sub={subtitle}
          actions={
            <>
              <div className="seg" role="tablist" aria-label="View mode">
                <button
                  role="tab"
                  aria-selected={mode === 'table'}
                  className={mode === 'table' ? 'on' : ''}
                  onClick={() => setMode('table')}
                >
                  <Rows3 size={13} /> Table
                </button>
                <button
                  role="tab"
                  aria-selected={mode === 'board'}
                  className={mode === 'board' ? 'on' : ''}
                  onClick={() => setMode('board')}
                >
                  <Columns3 size={13} /> Board
                </button>
              </div>
              {canConfigure && onConfigure && (
                <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
                  <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} /> Configure page
                </button>
              )}
              <button className="btn btn-primary btn-sm">
                <Plus size={14} /> New
              </button>
            </>
          }
        />

        {/* Error: hide the table/board entirely. Nothing rendered + console.error in loadData. */}
        {state.kind === 'error' ? null : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 320 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search my tasks"
                  style={{
                    flex: 1, background: 'none', border: 'none', outline: 'none',
                    color: 'var(--gx-text-1)', fontSize: 13,
                  }}
                />
              </div>
              <select
                className="inp inp-sm"
                aria-label="Filter by priority"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as WorkItemPriority | '')}
                style={{ marginLeft: 8 }}
              >
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>
                ))}
              </select>
              <select
                className="inp inp-sm"
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as WorkItemStatus | '')}
                style={{ marginLeft: 8 }}
              >
                <option value="">All statuses</option>
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
              <span className="spacer" />
            </div>

            {state.kind === 'loading' ? (
              <div style={{ padding: 14 }}>
                <SkeletonRows rows={6} />
              </div>
            ) : sorted.length === 0 ? (
              <EmptyState
                icon={<InboxIcon size={40} />}
                title={items.length === 0 ? 'No tasks assigned to you' : 'No tasks match your filters'}
                message={items.length === 0
                  ? 'Tasks assigned to you will appear here.'
                  : 'Try clearing search or filters.'}
              />
            ) : mode === 'table' ? (
              <WorkItemsTable
                items={sorted}
                columns={MY_TASKS_COLUMNS}
                users={users}
                customerNames={customerNames}
                sortKey={sortKey}
                sortDir={sortDir}
                onSortChange={toggleSort}
                onRowClick={noopRowClick}
                onStatusChange={noopStatus}
              />
            ) : (
              <div style={{ padding: 14 }}>
                <WorkItemsBoard
                  items={sorted}
                  users={users}
                  onRowClick={noopRowClick}
                  onStatusChange={noopStatus}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function statusLabel(s: WorkItemStatus): string {
  if (s === 'TODO') return 'To Do'
  if (s === 'IN_PROGRESS') return 'In Progress'
  if (s === 'BLOCKED') return 'Blocked'
  if (s === 'DONE') return 'Done'
  return 'Cancelled'
}
