// Create-notification-def modal — Identity, Templates, and GXL condition sections.

import { useState } from 'react'
import { ErrorBanner } from '../../components/States'
import { Modal, ModalFooterActions } from '../../components/Modal'
import { EditIcon, RowsIcon, ZapIcon } from '../../components/icons'
import { CATEGORIES, PRIORITIES, NotifChannel, apiFetch } from './types'

export function CreateDefModal({
  token, channel, rulesView, onClose, onCreated,
}: {
  token: string
  channel?: NotifChannel
  rulesView?: boolean
  onClose: () => void
  onCreated: (key: string) => void
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [chosenChannel, setChosenChannel] = useState<string>(channel ?? 'inapp')
  const [category, setCategory] = useState('system')
  const [priority, setPriority] = useState('info')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [cond, setCond] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim() || !key.trim() || !title.trim() || !body.trim()) {
      setErr('Key, label, title template and body template are required.')
      return
    }
    if (rulesView && !cond.trim()) {
      setErr('A rule requires a GXL condition.')
      return
    }
    setSaving(true); setErr('')
    try {
      const payload: any = {
        key: key.trim(),
        label: label.trim(),
        channel: chosenChannel,
        category, priority,
        title_template: title,
        body_template: body,
        enabled: true,
      }
      if (cond.trim()) payload.gxl_condition = cond.trim()
      await apiFetch(token, '/meta/notification-defs', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      onCreated(key.trim())
    } catch (ex) {
      setErr((ex as Error).message)
      setSaving(false)
    }
  }

  const heading = rulesView ? 'New notification rule' : 'New template'
  const submitLabel = rulesView ? 'Create rule' : 'Create template'

  // MO-1 — migrated from hand-rolled fixed-overlay chrome to `<Modal>`. The
  // form submits through the footer's "Confirm" button via the standard
  // `form="notif-def-create-form"` HTML attribute.
  return (
    <Modal
      open
      onClose={() => { if (!saving) onClose() }}
      title={heading}
      size="lg"
      footer={
        <ModalFooterActions
          onCancel={onClose}
          onConfirm={() => {
            const f = document.getElementById('notif-def-create-form') as HTMLFormElement | null
            if (f) f.requestSubmit()
          }}
          confirmLabel={saving ? 'Creating…' : submitLabel}
          confirmDisabled={saving}
        />
      }
    >
      <form id="notif-def-create-form" onSubmit={submit}>
        {err && <ErrorBanner message={err} />}

        <div className="section-head" style={{ marginTop: 'var(--gx-space-2)' }}>
          <RowsIcon size={15} className="section-icon" /> Identity
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-5)' }}>
          <label className="field">
            <span>Key (unique) *</span>
            <input
              className="inp inp-sm mono" value={key} autoFocus
              onChange={(e) => setKey(e.target.value)}
              placeholder="ticket.opened"
            />
          </label>
          <label className="field">
            <span>Label *</span>
            <input
              className="inp inp-sm" value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ticket opened"
            />
          </label>

          {channel ? (
            <label className="field">
              <span>Channel</span>
              <input className="inp inp-sm mono" value={channel} disabled />
            </label>
          ) : (
            <label className="field">
              <span>Channel</span>
              <select
                className="inp inp-sm" value={chosenChannel}
                onChange={(e) => setChosenChannel(e.target.value)}
              >
                <option value="inapp">inapp</option>
                <option value="email">email</option>
                <option value="sms">sms</option>
                <option value="push">push</option>
                <option value="webhook">webhook</option>
                <option value="console">console</option>
              </select>
            </label>
          )}

          <label className="field">
            <span>Category</span>
            <select
              className="inp inp-sm" value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Priority</span>
            <select
              className="inp inp-sm" value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <div className="section-head" style={{ marginTop: 'var(--gx-space-8)' }}>
          <EditIcon size={15} className="section-icon" /> Templates
        </div>
        <label className="field">
          <span>Title template *</span>
          <input
            className="inp inp-sm" value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New ticket: {subject}"
          />
        </label>
        <label className="field" style={{ marginTop: 'var(--gx-space-4)' }}>
          <span>Body template *</span>
          <textarea
            className="inp inp-sm" rows={3} value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="A ticket '{subject}' was opened (priority: {priority})."
            style={{ fontFamily: 'inherit', resize: 'vertical' }}
          />
        </label>
        <p className="hint" style={{ margin: 'var(--gx-space-2) 0 0' }}>
          Placeholders in <code className="mono">{'{curly_braces}'}</code> resolve at emit time.
        </p>

        <div className="section-head" style={{ marginTop: 'var(--gx-space-8)' }}>
          <ZapIcon size={15} className="section-icon" />
          {rulesView ? ' GXL condition (required)' : ' GXL condition (optional)'}
        </div>
        <label className="field">
          <span>Condition</span>
          <input
            className="inp inp-sm mono" value={cond}
            onChange={(e) => setCond(e.target.value)}
            placeholder={rulesView ? "priority == 'high' and status == 'OPEN'" : '(leave empty for unconditional emit)'}
          />
        </label>
        <p className="hint" style={{ margin: 'var(--gx-space-2) 0 0' }}>
          GXL expression — evaluated against the emit context. See backend/app/gxl.py.
        </p>

      </form>
    </Modal>
  )
}
