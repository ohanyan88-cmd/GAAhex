// CreateWebhookModal — create a new webhook endpoint.

import { useState } from 'react'
import { ErrorBanner } from '../../components/States'
import { Modal, ModalFooterActions } from '../../components/Modal'
import {
  RowsIcon, ActivityIcon, LockIcon, CheckIcon,
} from '../../components/icons'
import { EVENT_OPTIONS, Webhook, apiFetch } from './types'

export function CreateWebhookModal({
  token, onClose, onCreated,
}: {
  token: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const [secret, setSecret] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function toggleEvent(ev: string) {
    setEvents(es => es.includes(ev) ? es.filter(x => x !== ev) : [...es, ev])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !url.trim()) {
      setErr('Name and URL are required.')
      return
    }
    setSaving(true); setErr('')
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        url: url.trim(),
        events,
        active,
      }
      if (secret.trim()) body.secret = secret.trim()
      const created = await apiFetch<Webhook>(token, '/api/webhooks', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      onCreated(created.id)
    } catch (ex) {
      setErr((ex as Error).message)
      setSaving(false)
    }
  }

  // MO-1 — migrated from hand-rolled fixed-overlay chrome to `<Modal>`.
  return (
    <Modal
      open
      onClose={() => { if (!saving) onClose() }}
      title="New webhook"
      size="lg"
      footer={
        <ModalFooterActions
          onCancel={onClose}
          onConfirm={() => {
            const f = document.getElementById('webhook-create-form') as HTMLFormElement | null
            if (f) f.requestSubmit()
          }}
          confirmLabel={saving ? 'Creating…' : 'Create webhook'}
          confirmDisabled={saving}
        />
      }
    >
      <form id="webhook-create-form" onSubmit={submit}>
        {err && <ErrorBanner message={err} />}

        <div className="section-head" style={{ marginTop: 'var(--gx-space-2)' }}>
          <RowsIcon size={15} className="section-icon" /> Endpoint
        </div>
        <label className="field">
          <span>Name *</span>
          <input
            className="inp inp-sm" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="Billing events → CRM"
          />
        </label>
        <label className="field" style={{ marginTop: 'var(--gx-space-4)' }}>
          <span>URL *</span>
          <input
            className="inp inp-sm mono" value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hook"
          />
        </label>

        <div className="section-head" style={{ marginTop: 'var(--gx-space-8)' }}>
          <ActivityIcon size={15} className="section-icon" /> Event subscriptions
        </div>
        <p className="hint" style={{ margin: '0 0 var(--gx-space-4)' }}>
          Leave empty to receive <strong>all</strong> events. Otherwise only the selected types are
          delivered.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-3)' }}>
          {EVENT_OPTIONS.map((ev) => {
            const on = events.includes(ev)
            return (
              <button
                key={ev}
                type="button"
                className={'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost')}
                onClick={() => toggleEvent(ev)}
                style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 'var(--gx-text-11)' }}
              >
                {ev}
              </button>
            )
          })}
        </div>

        <div className="section-head" style={{ marginTop: 'var(--gx-space-8)' }}>
          <LockIcon size={15} className="section-icon" /> Signing secret (optional)
        </div>
        <label className="field">
          <span>HMAC secret</span>
          <input
            className="inp inp-sm mono" value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="(leave empty for unsigned deliveries)"
          />
        </label>
        <p className="hint" style={{ margin: 'var(--gx-space-2) 0 0' }}>
          Deliveries are signed with HMAC-SHA256 over the request body when a secret is set.
          The secret is stored server-side and never returned by the API.
        </p>

        <div className="section-head" style={{ marginTop: 'var(--gx-space-8)' }}>
          <CheckIcon size={15} className="section-icon" /> Status
        </div>
        <label className="row" style={{ gap: 'var(--gx-space-3)', alignItems: 'center' }}>
          <input
            type="checkbox" checked={active}
            onChange={(e) => setActive(e.target.checked)}
            id="webhook-active-toggle"
          />
          <span>Active — deliveries fire on subscribed events.</span>
        </label>

      </form>
    </Modal>
  )
}
