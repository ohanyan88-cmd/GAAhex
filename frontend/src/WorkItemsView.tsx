import { useEffect, useState, type ReactNode } from 'react'
import {
  listWorkItems, getWorkItem, createWorkItem, patchWorkItem,
  startWorkItem, completeWorkItem, blockWorkItem,
  cancelWorkItem, reopenWorkItem, deleteWorkItem,
  type WorkItem, type WorkItemCreate, type WorkItemFilters,
  type WorkItemKind, type WorkItemPriority, type WorkItemStatus,
} from './workitems'
import { listUsers, type User } from './users'
import { loadCustomers } from './billing'
import UserPicker, { resolveUserDisplay } from './UserPicker'
import { Modal } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import {
  PlusIcon, EditIcon, CheckIcon, CloseIcon,
  PlayIcon, PauseIcon, ArrowRightIcon, InboxIcon, TrashIcon, GearIcon, RowsIcon,
} from './icons'
import ViewHead from './ViewHead'
import { usePageConfig } from './pageConfig'
import { useCustomFields } from './CustomCells'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function priorityPill(priority: string | null | undefined) {
  const p = (priority ?? '').toUpperCase()
  const cls =
    p === 'URGENT' ? 'pill pill-danger'
    : p === 'HIGH' ? 'pill pill-warning'
    : p === 'LOW' ? 'pill pill-muted'
    : 'pill'
  const label =
    p === 'URGENT' ? 'Urgent'
    : p === 'HIGH' ? 'High'
    : p === 'LOW' ? 'Low'
    : p === 'NORMAL' ? 'Normal'
    : null
  return label
    ? <span className={cls}><span className="pill-dot" />{label}</span>
    : <span className="muted">—</span>
}

function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase()
  const cls =
    s === 'DONE' ? 'pill pill-success'
    : s === 'CANCELLED' ? 'pill pill-muted'
    : s === 'IN_PROGRESS' ? 'pill'
    : s === 'BLOCKED' ? 'pill pill-danger'
    : s === 'TODO' ? 'pill pill-muted'
    : 'pill'
  const label =
    s === 'TODO' ? 'To Do'
    : s === 'IN_PROGRESS' ? 'In Progress'
    : s === 'BLOCKED' ? 'Blocked'
    : s === 'DONE' ? 'Done'
    : s === 'CANCELLED' ? 'Cancelled'
    : (status ?? '—')
  return status
    ? <span className={cls}><span className="pill-dot" />{label}</span>
    : <span className="muted">—</span>
}

const KINDS: WorkItemKind[] = ['task', 'install', 'repair', 'survey']
const PRIORITIES: WorkItemPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'TODO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

type Tab = 'active' | 'all' | 'mine'

// ── Main view ─────────────────────────────────────────────────────────────────

export default function WorkItemsView({
  token,
  canConfigure = false,
  configVersion = 0,
}: {
  token: string
  canConfigure?: boolean
  configVersion?: number
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
  const [statusFilter, setStatusFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')

  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

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
    if (statusFilter) filters.status = statusFilter
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
  useEffect(() => { loadData() }, [token, tab, statusFilter, kindFilter])

  // Tab counts derived from allItems
  const activeCount = allItems.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELLED').length
  const allCount = allItems.length
  // For "Mine" we can't easily count without a separate request — show the current list length when on that tab
  const mineCount = tab === 'mine' ? (items?.length ?? 0) : null

  if (unavailable) {
    return (
      <div>
        <ViewHead
          icon={<RowsIcon size={20} />}
          title={cfg.title}
          sub="Driven by the WorkItem movement engine · stages configured in Studio"
        />
        <EmptyState
          icon={<InboxIcon size={40} />}
          title="Work Items aren't available yet"
          message="This service will appear here once the work items module is enabled."
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* ViewHead — matches DESIGN: RowsIcon, title, sub, actions */}
      <ViewHead
        icon={<RowsIcon size={20} />}
        title={cfg.title}
        sub="Driven by the WorkItem movement engine · stages configured in Studio"
        actions={
          <>
            {canConfigure && (
              <button className="btn btn-ghost btn-sm">
                <GearIcon size={13} /> Workflow
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon size={13} /> New work item
            </button>
          </>
        }
      />

      {/* Tabs — DESIGN .tabs / .tab / .tab-count pattern */}
      <div className="tabs">
        {([
          ['active', 'Active', activeCount],
          ['all', 'All', allCount],
          ['mine', 'Mine', mineCount],
        ] as [Tab, string, number | null][]).map(([t, label, count]) => (
          <button
            key={t}
            className={'tab' + (tab === t ? ' on' : '')}
            onClick={() => setTab(t)}
          >
            {label}
            {count !== null && (
              <span className="tab-count">{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Secondary filters — only visible on All/Mine tabs */}
      {tab !== 'active' && (
        <div className="list-toolbar" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>Status</span>
            <select
              className="inp inp-sm"
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>Kind</span>
            <select
              className="inp inp-sm"
              aria-label="Filter by kind"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            >
              <option value="">All</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ padding: '0 0 24px' }}>
        {error && <ErrorBanner message={error} onRetry={loadData} />}
        {items === null && !error && <p className="muted" style={{ padding: '12px 0' }}>Loading…</p>}

        {items && items.length === 0 && !error && (
          <EmptyState
            icon={<InboxIcon size={40} />}
            title="No work items"
            message="Create a work item or adjust your filters."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                New item
              </button>
            }
          />
        )}

        {items && items.length > 0 && (
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {cfg.columns.map((col) => (
                    <th key={col.key} scope="col">{col.label}</th>
                  ))}
                  {cf.headers()}
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <WorkItemRow
                    key={item.id}
                    item={item}
                    users={users}
                    customerNames={customerNames}
                    token={token}
                    columns={cfg.columns}
                    cfCells={cf.cells(item.id)}
                    onRefresh={loadData}
                    onEdit={() => setDetailId(item.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function WorkItemRow({
  item, users, customerNames, token, columns, cfCells, onRefresh, onEdit,
}: {
  item: WorkItem
  users: User[]
  customerNames: Record<string, string>
  token: string
  columns: { key: string; label: string; visible: boolean }[]
  cfCells: ReactNode
  onRefresh: () => void
  onEdit: () => void
}) {
  const [busy, setBusy] = useState(false)
  const s = (item.status ?? 'TODO') as WorkItemStatus

  async function act(action: () => Promise<WorkItem>) {
    if (busy) return
    setBusy(true)
    try { await action(); onRefresh() }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  const custName = item.customer_id
    ? (customerNames[item.customer_id] ?? item.customer_id.slice(0, 8))
    : '—'

  return (
    <tr>
      {columns.map((col) => {
        if (col.key === 'title') return (
          <td key={col.key} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </td>
        )
        if (col.key === 'kind') return <td key={col.key} className="muted">{item.kind ? item.kind.charAt(0).toUpperCase() + item.kind.slice(1) : '—'}</td>
        if (col.key === 'customer') return <td key={col.key} className="muted">{custName}</td>
        if (col.key === 'status') return <td key={col.key}>{statusPill(item.status)}</td>
        if (col.key === 'priority') return <td key={col.key}>{priorityPill(item.priority)}</td>
        if (col.key === 'assignee') return <td key={col.key} className="muted">{resolveUserDisplay(item.assigned_user_id, users)}</td>
        if (col.key === 'due') return <td key={col.key} className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateShort(item.due_at)}</td>
        if (col.key === 'scheduled') return (
          <td key={col.key} className="muted" style={{ whiteSpace: 'nowrap' }}>
            {item.scheduled_at ? fmtDateShort(item.scheduled_at) : '—'}
            {item.location ? <span title={item.location}> {item.location.length > 16 ? item.location.slice(0, 14) + '…' : item.location}</span> : null}
          </td>
        )
        return null
      })}
      {cfCells}
      <td className="row-actions" style={{ whiteSpace: 'nowrap' }}>
        {/* Stage actions per current status */}
        {s === 'TODO' && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => startWorkItem(token, item.id))} title="Start">
            <PlayIcon size={12} /> Start
          </button>
        )}
        {s === 'IN_PROGRESS' && (
          <>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => completeWorkItem(token, item.id))} title="Complete">
              <CheckIcon size={12} /> Done
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => blockWorkItem(token, item.id))} title="Block">
              <PauseIcon size={12} />
            </button>
          </>
        )}
        {s === 'BLOCKED' && (
          <>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => startWorkItem(token, item.id))} title="Resume">
              <PlayIcon size={12} /> Resume
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => cancelWorkItem(token, item.id))} title="Cancel">
              <CloseIcon size={12} />
            </button>
          </>
        )}
        {(s === 'TODO' || s === 'IN_PROGRESS') && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => cancelWorkItem(token, item.id))} title="Cancel">
            <CloseIcon size={12} />
          </button>
        )}
        {(s === 'DONE' || s === 'CANCELLED') && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => reopenWorkItem(token, item.id))} title="Reopen">
            Reopen
          </button>
        )}
        {/* Edit */}
        <button className="btn btn-ghost btn-sm" onClick={onEdit} title="Edit">
          <EditIcon size={12} /> <ArrowRightIcon size={12} />
        </button>
      </td>
    </tr>
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
  const custName = item?.customer_id
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
            {statusPill(item.status)}
            {priorityPill(item.priority)}
            {custName && <span className="muted" style={{ fontSize: 12 }}>{custName}</span>}
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
