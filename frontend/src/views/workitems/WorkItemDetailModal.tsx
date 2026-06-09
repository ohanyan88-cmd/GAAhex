import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  getWorkItem, patchWorkItem,
  startWorkItem, completeWorkItem, blockWorkItem,
  cancelWorkItem, reopenWorkItem, deleteWorkItem,
  type WorkItem, type WorkItemKind, type WorkItemPriority, type WorkItemStatus,
} from '../../lib/workitems'
import type { User } from '../../lib/users'
import UserPicker from '../../components/UserPicker'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/Toast'
import { ErrorBanner } from '../../components/States'
import {
  CheckIcon, CloseIcon,
  PlayIcon, PauseIcon, TrashIcon,
} from '../../components/icons'
import { Button, StatusPill } from '../../primitives'
import { fmtDateTime as fmtDate } from '../../lib/time'
import { mapWorkItemStatus, statusLabel, priorityPill } from './helpers'
import { KINDS, PRIORITIES } from './types'

export default function WorkItemDetailModal({
  id, users, customerNames, onClose,
}: {
  id: string
  users: User[]
  customerNames: Record<string, string>
  onClose: () => void
}) {
  const { token } = useAuth()
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
    const res = await getWorkItem(token!, id)
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
      await patchWorkItem(token!, id, {
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
      if (action === 'start') await startWorkItem(token!, id)
      else if (action === 'complete') await completeWorkItem(token!, id)
      else if (action === 'block') await blockWorkItem(token!, id)
      else if (action === 'cancel') await cancelWorkItem(token!, id)
      else await reopenWorkItem(token!, id)
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
      await deleteWorkItem(token!, id)
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
