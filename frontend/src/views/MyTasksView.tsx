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
import WorkItemsTable, { makeStatusChangeHandler } from '../components/WorkItemsTable'
import WorkItemsBoard from '../components/WorkItemsBoard'
import { EmptyState, PermissionDenied, SkeletonRows, ErrorBanner } from '../components/States'
import { CheckIcon, GearIcon, InboxIcon, SearchIcon, PlayIcon, PauseIcon, TrashIcon, CloseIcon } from '../components/icons'
import { Plus, Rows3, Columns3 } from 'lucide-react'
import {
  listWorkItems, getWorkItem, createWorkItem, patchWorkItem,
  startWorkItem, completeWorkItem, blockWorkItem, cancelWorkItem, reopenWorkItem, deleteWorkItem,
  type WorkItem, type WorkItemCreate, type WorkItemKind, type WorkItemPriority, type WorkItemStatus,
} from '../lib/workitems'
import { listUsers, type User } from '../lib/users'
import { loadCustomers } from '../lib/billing'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import UserPicker from '../components/UserPicker'
import { StatusPill } from '../primitives'

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
const KINDS: WorkItemKind[] = ['task', 'install', 'repair', 'survey']

type ViewMode = 'table' | 'board'

// Internal load state. `null` means fetch hasn't completed yet (show skeleton).
type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; items: WorkItem[] }
  | { kind: 'forbidden' }
  | { kind: 'error' }    // hides table/board entirely and console.error per spec

// ── Pill helpers (local — same mapping as WorkItemsView) ──────────────────────

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapWorkItemStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'DONE' || v === 'CLOSED') return 'active'
  if (v === 'IN_PROGRESS') return 'degraded'
  if (v === 'BLOCKED') return 'critical'
  if (v === 'CANCELLED') return 'neutral'
  return 'info'
}
function statusLabelFull(s: string | null | undefined): string {
  const v = (s ?? '').toUpperCase()
  if (v === 'TODO') return 'To Do'
  if (v === 'IN_PROGRESS') return 'In Progress'
  if (v === 'BLOCKED') return 'Blocked'
  if (v === 'DONE') return 'Done'
  if (v === 'CANCELLED') return 'Cancelled'
  return s ?? '—'
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}
function priorityPill(priority: string | null | undefined) {
  const p = (priority ?? '').toUpperCase()
  if (!priority) return <span className="muted">—</span>
  const variant: PillVariant = p === 'URGENT' ? 'critical'
    : p === 'HIGH' ? 'degraded'
    : p === 'LOW' ? 'neutral'
    : 'info'
  const label = p === 'URGENT' ? 'Urgent' : p === 'HIGH' ? 'High' : p === 'LOW' ? 'Low' : 'Normal'
  return <StatusPill variant={variant} label={label} size="sm" />
}

// ── Main view ─────────────────────────────────────────────────────────────────

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

  // P3 mutation state
  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

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

  // ── P3: mutation handlers ──────────────────────────────────────────────────

  function handleRowClick(item: WorkItem) {
    setDetailId(item.id)
  }

  const handleStatusChange = makeStatusChangeHandler(token, loadData)

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
                  <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
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
                onRowClick={handleRowClick}
                onStatusChange={handleStatusChange}
              />
            ) : (
              <div style={{ padding: 14 }}>
                <WorkItemsBoard
                  items={sorted}
                  users={users}
                  onRowClick={handleRowClick}
                  onStatusChange={handleStatusChange}
                />
              </div>
            )}
          </div>
        )}

        {/* Detail/edit modal */}
        {detailId && (
          <MyTaskDetailModal
            token={token}
            id={detailId}
            users={users}
            customerNames={customerNames}
            onClose={() => { setDetailId(null); loadData() }}
          />
        )}

        {/* Create modal */}
        {createOpen && (
          <MyTaskCreateModal
            token={token}
            onClose={() => setCreateOpen(false)}
            onDone={() => { setCreateOpen(false); loadData() }}
          />
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

// ── Detail / Edit Modal ───────────────────────────────────────────────────────
// Same pattern as WorkItemDetailModal in WorkItemsView — reused here because
// those components are not exported from WorkItemsView.

function MyTaskDetailModal({
  token, id, users, customerNames, onClose,
}: {
  token: string
  id: string
  users: User[]
  customerNames: Record<string, string>
  onClose: () => void
}) {
  const [item, setItem] = useState<WorkItem | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Edit fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<WorkItemKind | ''>('')
  const [priority, setPriority] = useState<WorkItemPriority | ''>('')
  const [assigneeId, setAssigneeId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [location, setLocation] = useState('')

  // users is threaded through for parity; suppress lint warning
  void users

  async function load() {
    setError('')
    const res = await getWorkItem(token, id)
    if (!res.ok) { setError(res.status === 404 ? 'Work item not found' : 'Failed to load'); return }
    const wi = res.data!
    setItem(wi)
    setTitle(wi.title ?? '')
    setDescription(wi.description ?? '')
    setKind((wi.kind ?? '') as WorkItemKind | '')
    setPriority((wi.priority ?? '') as WorkItemPriority | '')
    setAssigneeId(wi.assigned_user_id ?? '')
    setCustomerId(wi.customer_id ?? '')
    setDueAt(wi.due_at ? wi.due_at.slice(0, 16) : '')
    setScheduledAt(wi.scheduled_at ? wi.scheduled_at.slice(0, 16) : '')
    setLocation(wi.location ?? '')
  }

  useEffect(() => { load() }, [token, id])

  async function handleSave() {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await patchWorkItem(token, id, {
        title: title.trim(),
        description: description.trim() || undefined,
        kind: (kind as WorkItemKind) || undefined,
        priority: (priority as WorkItemPriority) || undefined,
        assigned_user_id: assigneeId || undefined,
        customer_id: customerId.trim() || undefined,
        due_at: dueAt || undefined,
        scheduled_at: scheduledAt || undefined,
        location: location.trim() || undefined,
      })
      toast.success('Work item saved')
      await load()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  async function handleAction(action: 'start' | 'complete' | 'block' | 'cancel' | 'reopen') {
    if (busy) return
    setBusy(true)
    try {
      if (action === 'start') await startWorkItem(token, id)
      else if (action === 'complete') await completeWorkItem(token, id)
      else if (action === 'block') await blockWorkItem(token, id)
      else if (action === 'cancel') await cancelWorkItem(token, id)
      else await reopenWorkItem(token, id)
      toast.success(`Work item ${action === 'complete' ? 'completed' : action + 'ed'}`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  async function handleDelete() {
    if (busy) return
    if (!window.confirm('Delete this work item? This cannot be undone.')) return
    setBusy(true)
    try {
      await deleteWorkItem(token, id)
      toast.success('Deleted')
      onClose()
    } catch (e) { toast.error((e as Error).message); setBusy(false) }
  }

  const s = (item?.status ?? 'TODO') as WorkItemStatus
  const cust = item?.customer_id
    ? (customerNames[item.customer_id] ?? item.customer_id.slice(0, 8))
    : null

  return (
    <Modal
      open
      onClose={onClose}
      title={item ? item.title : 'Work Item'}
      size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={handleDelete}
            style={{ color: 'var(--danger)', marginRight: 'auto' }}
            title="Delete"
          >
            <TrashIcon size={13} />
          </button>
          <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-md"
            disabled={busy || !title.trim()}
            onClick={handleSave}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!item && !error && <p className="muted">Loading…</p>}

      {item && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Status + action bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {item.status
              ? <StatusPill variant={mapWorkItemStatus(item.status)} label={statusLabelFull(item.status)} size="sm" />
              : <span className="muted">—</span>}
            {priorityPill(item.priority)}
            {cust && <span className="muted" style={{ fontSize: 12 }}>{cust}</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {s === 'TODO' && (
                <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => handleAction('start')}>
                  <PlayIcon size={12} /> Start
                </button>
              )}
              {s === 'IN_PROGRESS' && (
                <>
                  <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => handleAction('complete')}>
                    <CheckIcon size={12} /> Complete
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => handleAction('block')}>
                    <PauseIcon size={12} /> Block
                  </button>
                </>
              )}
              {s === 'BLOCKED' && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => handleAction('start')}>
                  <PlayIcon size={12} /> Resume
                </button>
              )}
              {(s === 'TODO' || s === 'IN_PROGRESS' || s === 'BLOCKED') && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => handleAction('cancel')}>
                  <CloseIcon size={12} /> Cancel
                </button>
              )}
              {(s === 'DONE' || s === 'CANCELLED') && (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => handleAction('reopen')}>
                  Reopen
                </button>
              )}
            </div>
          </div>

          {/* Fields */}
          <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
            <label className="field">
              <span>Title <span style={{ color: 'var(--danger)' }}>*</span></span>
              <input
                className="inp inp-md"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Work item title"
              />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea
                className="inp inp-md"
                rows={3}
                style={{ resize: 'vertical' }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional details…"
              />
            </label>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: 1, minWidth: 140 }}>
                <span>Kind</span>
                <select className="inp inp-md" value={kind} onChange={(e) => setKind(e.target.value as WorkItemKind | '')}>
                  <option value="">—</option>
                  {KINDS.map((k) => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
                </select>
              </label>
              <label className="field" style={{ flex: 1, minWidth: 140 }}>
                <span>Priority</span>
                <select className="inp inp-md" value={priority} onChange={(e) => setPriority(e.target.value as WorkItemPriority | '')}>
                  <option value="">—</option>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Assignee</span>
              <UserPicker
                token={token}
                value={assigneeId}
                onChange={setAssigneeId}
                aria-label="Assignee"
              />
            </label>

            <label className="field">
              <span>Customer ID</span>
              <input
                className="inp inp-md"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="optional"
              />
            </label>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: 1, minWidth: 160 }}>
                <span>Due</span>
                <input
                  className="inp inp-md"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 160 }}>
                <span>Scheduled</span>
                <input
                  className="inp inp-md"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </label>
            </div>

            <label className="field">
              <span>Location (field dispatch)</span>
              <input
                className="inp inp-md"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Address or GPS coords…"
              />
            </label>
          </div>

          {/* Timestamps */}
          <div className="bill-meta">
            <div>
              <span className="muted">Created</span>
              <div>{fmtDate(item.created_at)}</div>
            </div>
            {item.completed_at && (
              <div>
                <span className="muted">Completed</span>
                <div>{fmtDate(item.completed_at)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Create Modal ──────────────────────────────────────────────────────────────

function MyTaskCreateModal({
  token, onClose, onDone,
}: {
  token: string
  onClose: () => void
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<WorkItemKind | ''>('')
  const [priority, setPriority] = useState<WorkItemPriority | ''>('')
  const [assigneeId, setAssigneeId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const payload: WorkItemCreate = {
        title: title.trim(),
        description: description.trim() || undefined,
        kind: (kind as WorkItemKind) || undefined,
        priority: (priority as WorkItemPriority) || undefined,
        assigned_user_id: assigneeId || undefined,
        customer_id: customerId.trim() || undefined,
        due_at: dueAt || undefined,
        scheduled_at: scheduledAt || undefined,
        location: location.trim() || undefined,
      }
      await createWorkItem(token, payload)
      toast.success('Work item created')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New task"
      size="md"
      footer={
        <>
          <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-md"
            disabled={saving || !title.trim()}
            onClick={submit}
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Title <span style={{ color: 'var(--danger)' }}>*</span></span>
          <input
            className="inp inp-md"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            className="inp inp-md"
            rows={3}
            style={{ resize: 'vertical' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional details…"
          />
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            <span>Kind</span>
            <select className="inp inp-md" value={kind} onChange={(e) => setKind(e.target.value as WorkItemKind | '')}>
              <option value="">— select —</option>
              {KINDS.map((k) => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            <span>Priority</span>
            <select className="inp inp-md" value={priority} onChange={(e) => setPriority(e.target.value as WorkItemPriority | '')}>
              <option value="">Default</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Assignee</span>
          <UserPicker
            token={token}
            value={assigneeId}
            onChange={setAssigneeId}
            aria-label="Assignee"
          />
        </label>

        <label className="field">
          <span>Customer ID</span>
          <input
            className="inp inp-md"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="optional"
          />
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1, minWidth: 160 }}>
            <span>Due</span>
            <input
              className="inp inp-md"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 160 }}>
            <span>Scheduled</span>
            <input
              className="inp inp-md"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span>Location (field dispatch)</span>
          <input
            className="inp inp-md"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Address or GPS coords…"
          />
        </label>
      </div>
    </Modal>
  )
}
