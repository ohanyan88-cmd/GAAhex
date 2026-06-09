import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  createWorkItem,
  type WorkItemCreate, type WorkItemKind, type WorkItemPriority,
} from '../../lib/workitems'
import UserPicker from '../../components/UserPicker'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/Toast'
import { Button } from '../../primitives'
import { KINDS, PRIORITIES } from './types'

export default function CreateWorkItemModal({
  onClose, onDone,
}: {
  onClose: () => void
  onDone: () => void
}) {
  const { token } = useAuth()
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
      await createWorkItem(token!, payload)
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
