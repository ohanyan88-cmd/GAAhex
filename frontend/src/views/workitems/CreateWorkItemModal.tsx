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
import { useI18n } from '../../lib/i18n'

export default function CreateWorkItemModal({
  onClose, onDone,
}: {
  onClose: () => void
  onDone: () => void
}) {
  const { token } = useAuth()
  const { t } = useI18n()
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
      toast.success(t('workitems.created', 'Work item created'))
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
      title={t('workitems.newModalTitle', 'New work item')}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="primary" size="md"
            disabled={saving || !title.trim()}
            onClick={submit}>
            {saving ? t('common.creating', 'Creating…') : t('common.create', 'Create')}
          </Button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>{t('workitems.fieldTitle', 'Title')} <span style={{ color: 'var(--gx-danger)' }}>*</span></span>
          <input
            className="inp inp-md"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('workitems.createTitlePlaceholder', 'What needs to be done?')}
            autoFocus
          />
        </label>
        <label className="field">
          <span>{t('workitems.fieldDescription', 'Description')}</span>
          <textarea
            className="inp inp-md"
            rows={3}
            style={{ resize: 'vertical' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('common.optionalDetails', 'Optional details…')}
          />
        </label>

        <div style={{ display: 'flex', gap: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            <span>{t('workitems.fieldKind', 'Kind')}</span>
            <select className="inp inp-md" value={kind} onChange={(e) => setKind(e.target.value as WorkItemKind | '')}>
              <option value="">{t('common.selectPlaceholder', '— select —')}</option>
              {KINDS.map((k) => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            <span>{t('workitems.fieldPriority', 'Priority')}</span>
            <select className="inp inp-md" value={priority} onChange={(e) => setPriority(e.target.value as WorkItemPriority | '')}>
              <option value="">{t('helpdesk.priorityDefault', 'Default')}</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
            </select>
          </label>
        </div>

        <label className="field">
          <span>{t('workitems.fieldAssignee', 'Assignee')}</span>
          <UserPicker
            value={assigneeId}
            onChange={setAssigneeId}
            aria-label={t('workitems.fieldAssignee', 'Assignee')}
          />
        </label>

        <label className="field">
          <span>{t('workitems.fieldCustomerId', 'Customer ID')}</span>
          <input
            className="inp inp-md"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder={t('common.optional', 'optional')}
          />
        </label>

        <div style={{ display: 'flex', gap: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1, minWidth: 160 }}>
            <span>{t('workitems.fieldDue', 'Due')}</span>
            <input
              className="inp inp-md"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 160 }}>
            <span>{t('workitems.fieldScheduled', 'Scheduled')}</span>
            <input
              className="inp inp-md"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span>{t('workitems.fieldLocation', 'Location (field dispatch)')}</span>
          <input
            className="inp inp-md"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t('workitems.locationPlaceholder', 'Address or GPS coords…')}
          />
        </label>
      </div>
    </Modal>
  )
}
