import { useEffect, useMemo, useState } from 'react'
import {
  listWorkItems, getWorkItem, createWorkItem, patchWorkItem,
  startWorkItem, completeWorkItem, blockWorkItem,
  cancelWorkItem, reopenWorkItem, deleteWorkItem,
  type WorkItem, type WorkItemCreate, type WorkItemFilters,
  type WorkItemKind, type WorkItemPriority, type WorkItemStatus,
} from '../lib/workitems'
import { listUsers, type User } from '../lib/users'
import { loadCustomers } from '../lib/billing'
import UserPicker, { resolveUserDisplay } from '../components/UserPicker'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner } from '../components/States'
import {
  CheckIcon, CloseIcon,
  PlayIcon, PauseIcon, InboxIcon, TrashIcon, GearIcon, RowsIcon,
  SearchIcon,
} from '../components/icons'
import {
  Plus,
} from 'lucide-react'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { Button, Pagination, StatusPill } from '../primitives'
import WorkItemsTable, { makeStatusChangeHandler } from '../components/WorkItemsTable'
import ErrorBoundary from '../components/ErrorBoundary'
import LoadingState from '../components/LoadingState'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'

// ── Helpers ───────────────────────────────────────────────────────────────────

// DF-4/5 — local `fmtDate` was actually a datetime formatter (used
// `toLocaleString`). Delegated to canonical `fmtDateTime`.
import { fmtDateTime as fmtDate } from '../lib/time'

// WorkItem status → StatusPill primitive variant — kept here for the detail
// modal (table/board use their own copy of this mapping).
type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapWorkItemStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'DONE' || v === 'CLOSED') return 'active'
  if (v === 'IN_PROGRESS') return 'degraded'
  if (v === 'BLOCKED') return 'critical'
  if (v === 'CANCELLED') return 'neutral'
  return 'info'
}
function statusLabel(s: string | null | undefined): string {
  const v = (s ?? '').toUpperCase()
  if (v === 'TODO') return 'To Do'
  if (v === 'IN_PROGRESS') return 'In Progress'
  if (v === 'BLOCKED') return 'Blocked'
  if (v === 'DONE') return 'Done'
  if (v === 'CANCELLED') return 'Cancelled'
  return s ?? '—'
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

const KINDS: WorkItemKind[] = ['task', 'install', 'repair', 'survey']
const PRIORITIES: WorkItemPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

type Tab = 'active' | 'all' | 'mine'

// ── Main view ─────────────────────────────────────────────────────────────────

export default function WorkItemsView({
  token,
  canConfigure = false,
  configVersion = 0,
  onConfigure,
}: {
  token: string
  canConfigure?: boolean
  configVersion?: number
  onConfigure?: () => void
}) {
  const cfg = usePageConfig(token, 'workitems', configVersion)
  const [items, setItems] = useState<WorkItem[] | null>(null)
  const cf = useCustomFields(token, 'workitems', cfg.customFields, (items ?? []).map((item) => item.id))
  const [allItems, setAllItems] = useState<WorkItem[]>([])   // unfiltered, used for counts
  const [users, setUsers] = useState<User[]>([])
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  const [tab, setTab] = useState<Tab>('active')
  const [kindFilter, setKindFilter] = useState('')

  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // Reskin: client-only search/sort/page state (no new fetches).
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  async function loadUsers() {
    const res = await listUsers(token)
    if (res.ok && Array.isArray(res.data)) setUsers(res.data)
  }

  async function loadData() {
    setError('')
    setUnavailable(false)
    setItems(null)

    const filters: WorkItemFilters = {}
    if (tab === 'mine') filters.mine = true
    if (kindFilter) filters.kind = kindFilter

    // Load all items once for tab counts, then filter per tab
    const res = await listWorkItems(token, filters)
    if (res.status === 404) { setUnavailable(true); setItems([]); setAllItems([]); return }
    if (!res.ok) { setError('Failed to load work items'); setItems([]); setAllItems([]); return }
    let list = Array.isArray(res.data) ? res.data : []

    setAllItems(list)

    if (tab === 'active') {
      list = list.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELLED')
    }

    setItems(list)
    setCustomerNames(await loadCustomers(token))
  }

  useEffect(() => { loadUsers() }, [token])
  useEffect(() => { loadData() }, [token, tab, kindFilter])
  // Reset paging whenever filter/search/sort changes.
  useEffect(() => { setPage(1) }, [tab, kindFilter, query, sortKey, sortDir])

  const custName = (item: WorkItem) =>
    item.customer_id ? (customerNames[item.customer_id] ?? item.customer_id.slice(0, 8)) : '—'

  // Tab counts derived from allItems
  const activeCount = allItems.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELLED').length
  const allCount = allItems.length

  // KPI aggregates (from loaded list — no extra API).
  const doneCount = allItems.filter((i) => i.status === 'DONE').length
  const blockedCount = allItems.filter((i) => i.status === 'BLOCKED').length
  const inProgressCount = allItems.filter((i) => i.status === 'IN_PROGRESS').length

  // Client-side search applied on top of tab/kind filter.
  const list = items ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((item) => {
      const fields = [
        item.title ?? '',
        item.id ?? '',
        item.kind ?? '',
        item.status ?? '',
        item.priority ?? '',
        custName(item),
        resolveUserDisplay(item.assigned_user_id, users) ?? '',
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, query, customerNames, users])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (item: WorkItem): string | number => {
      switch (k) {
        case 'title': return item.title ?? ''
        case 'kind': return item.kind ?? ''
        case 'customer': return custName(item)
        case 'status': return item.status ?? ''
        case 'priority': return item.priority ?? ''
        case 'assignee': return resolveUserDisplay(item.assigned_user_id, users) ?? ''
        case 'due': return item.due_at ?? ''
        case 'scheduled': return item.scheduled_at ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, customerNames, users])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  // KPI specs derived from allItems counts
  const kpis: KPISpec[] = allItems.length > 0 ? [
    { label: 'TODO',        value: allItems.filter(i => i.status === 'TODO').length },
    { label: 'In Progress', value: inProgressCount, warning: inProgressCount > 0 },
    { label: 'Blocked',     value: blockedCount,     danger: blockedCount > 0 },
    { label: 'Done',        value: doneCount },
  ] : []

  if (unavailable) {
    return (
      <PageShell
        type="OPERATIONS"
        breadcrumb={['Tech & NOC', 'Work Items']}
        icon={<RowsIcon size={18} />}
        title="Work Items"
        subtitle="Field operations work queue"
      >
        <EmptyState
          icon={<InboxIcon size={40} />}
          title="Work Items aren't available yet"
          message="This service will appear here once the work items module is enabled."
        />
      </PageShell>
    )
  }

  return (
    <PageShell
      type="OPERATIONS"
      breadcrumb={['Tech & NOC', 'Work Items']}
      icon={<RowsIcon size={18} />}
      title="Work Items"
      subtitle="Field operations work queue"
      kpis={kpis.length > 0 ? kpis : undefined}
      primaryAction={{ label: 'New work item', onClick: () => setCreateOpen(true) }}
    >

        {/* Tabs — kit .tabs/.tab/.tab-count */}
        <div className="tabs">
          {([
            ['active', 'Active', activeCount],
            ['all', 'All', allCount],
            ['mine', 'Mine', null],
          ] as [Tab, string, number | null][]).map(([t, label, count]) => (
            <button
              key={t}
              className={'tab' + (tab === t ? ' on' : '')}
              onClick={() => setTab(t)}
            >
              {label}
              {count !== null && <span className="tab-count">{count}</span>}
            </button>
          ))}
        </div>

        {error && <ErrorBanner message={error} onRetry={loadData} />}
        <ErrorBoundary onReset={loadData}>
        {items === null && !error && <LoadingState kind="rows" label="Loading work items…" />}
        {items && items.length === 0 && !error && (
          <EmptyState
            icon={<InboxIcon size={40} />}
            title="No work items"
            message="Create a work item or adjust your filters."
            action={
              <Button variant="primary" size="sm"
            onClick={() => setCreateOpen(true)}>
                New item
              </Button>
            }
          />
        )}

        {items && items.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="toolbar" style={{ padding: 'var(--gx-space-6) var(--gx-space-7)', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search work items"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 'var(--gx-text-13)' }}
                />
              </div>
              <select
                className="inp inp-sm"
                aria-label="Filter by kind"
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
                style={{ marginLeft: 'var(--gx-space-4)' }}
              >
                <option value="">All kinds</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
                ))}
              </select>
              <span className="spacer" />
            </div>

            <WorkItemsTable
              items={pageRows}
              columns={cfg.columns}
              users={users}
              customerNames={customerNames}
              sortKey={sortKey}
              sortDir={sortDir}
              onSortChange={toggleSort}
              onRowClick={(item) => setDetailId(item.id)}
              onStatusChange={makeStatusChangeHandler(token, loadData)}
              cfHeaders={cf.headers()}
              cfCellsFor={(id) => cf.cells(id)}
              customFieldCount={cfg.customFields.length}
            />

            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={sorted.length}
              onChange={setPage}
            />
          </div>
        )}
        </ErrorBoundary>

        {/* Detail/edit modal */}
        {detailId && (
          <WorkItemDetailModal
            token={token}
            id={detailId}
            users={users}
            customerNames={customerNames}
            onClose={() => { setDetailId(null); loadData() }}
          />
        )}

        {/* Create modal */}
        {createOpen && (
          <CreateWorkItemModal
            token={token}
            onClose={() => setCreateOpen(false)}
            onDone={() => { setCreateOpen(false); loadData() }}
          />
        )}
    </PageShell>
  )
}

// ── Detail / Edit Modal ───────────────────────────────────────────────────────

function WorkItemDetailModal({
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

  // Silence the unused-var warning on `users` — it's threaded through for parity with the parent.
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
        <div style={{ display: 'flex', gap: 'var(--gx-space-3)', width: '100%', alignItems: 'center' }}>
          <Button variant="ghost" size="sm"
            disabled={busy}
            onClick={handleDelete}
            style={{ color: 'var(--gx-danger)', marginRight: 'auto' }}
            title="Delete">
            <TrashIcon size={13} />
          </Button>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md"
            disabled={busy || !title.trim()}
            onClick={handleSave}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!item && !error && <p className="muted">Loading…</p>}

      {item && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-8)' }}>
          {/* Status + action bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', flexWrap: 'wrap' }}>
            {item.status
              ? <StatusPill variant={mapWorkItemStatus(item.status)} label={statusLabel(item.status)} size="sm" />
              : <span className="muted">—</span>}
            {priorityPill(item.priority)}
            {cust && <span className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>{cust}</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--gx-space-3)' }}>
              {s === 'TODO' && (
                <Button variant="primary" size="sm"
            disabled={busy} onClick={() => handleAction('start')}>
                  <PlayIcon size={12} /> Start
                </Button>
              )}
              {s === 'IN_PROGRESS' && (
                <>
                  <Button variant="primary" size="sm"
            disabled={busy} onClick={() => handleAction('complete')}>
                    <CheckIcon size={12} /> Complete
                  </Button>
                  <Button variant="ghost" size="sm"
            disabled={busy} onClick={() => handleAction('block')}>
                    <PauseIcon size={12} /> Block
                  </Button>
                </>
              )}
              {s === 'BLOCKED' && (
                <Button variant="ghost" size="sm"
            disabled={busy} onClick={() => handleAction('start')}>
                  <PlayIcon size={12} /> Resume
                </Button>
              )}
              {(s === 'TODO' || s === 'IN_PROGRESS' || s === 'BLOCKED') && (
                <Button variant="ghost" size="sm"
            disabled={busy} onClick={() => handleAction('cancel')}>
                  <CloseIcon size={12} /> Cancel
                </Button>
              )}
              {(s === 'DONE' || s === 'CANCELLED') && (
                <Button variant="primary" size="sm"
            disabled={busy} onClick={() => handleAction('reopen')}>
                  Reopen
                </Button>
              )}
            </div>
          </div>

          {/* Fields */}
          <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
            <label className="field">
              <span>Title <span style={{ color: 'var(--gx-danger)' }}>*</span></span>
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

            <div style={{ display: 'flex', gap: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
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

            <div style={{ display: 'flex', gap: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
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

function CreateWorkItemModal({
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
      title="New work item"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md"
            disabled={saving || !title.trim()}
            onClick={submit}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Title <span style={{ color: 'var(--gx-danger)' }}>*</span></span>
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

        <div style={{ display: 'flex', gap: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
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

        <div style={{ display: 'flex', gap: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
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
