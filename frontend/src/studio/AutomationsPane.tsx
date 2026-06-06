import { Button } from '../primitives'
import { useEffect, useState, useCallback } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  SparkleIcon, PlusIcon, CloseIcon, CheckIcon, EditIcon, TrashIcon, InfoIcon,
} from '../components/icons'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ActionType = 'notify' | 'set_field' | 'webhook' | 'emit_event'
type EventType = 'create' | 'update' | 'transition' | 'delete'

type AutomationAction = { type: ActionType; config: Record<string, unknown> }

type Automation = {
  id: number
  key: string
  name: string
  event_type: EventType
  entity_key: string
  condition: string | null
  action: AutomationAction
  is_active: boolean
  order: number
}

type EntityMeta = { key: string; label: string; route_slug: string }

class FetchError extends Error {
  status: number
  constructor(msg: string, status: number) { super(msg); this.status = status }
}

async function jreq(token: string, path: string, opts: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authH(token), ...(opts.headers ?? {}) },
  })
  if (r.status === 204) return null
  const body = await r.json().catch(() => ({ detail: 'Error' }))
  if (!r.ok) throw new FetchError(body.detail || `HTTP ${r.status}`, r.status)
  return body
}

const EVENT_TYPES: EventType[] = ['create', 'update', 'transition', 'delete']
const ACTION_TYPES: ActionType[] = ['notify', 'set_field', 'webhook', 'emit_event']

// Human-readable labels
const eventLabel: Record<EventType, string> = {
  create: 'Record created',
  update: 'Record updated',
  transition: 'Status transition',
  delete: 'Record deleted',
}
const actionLabel: Record<ActionType, string> = {
  notify: 'Send notification',
  set_field: 'Set field value',
  webhook: 'Call webhook',
  emit_event: 'Emit event',
}

// ---------------------------------------------------------------------------
// Empty form state
// ---------------------------------------------------------------------------
function emptyForm() {
  return {
    key: '',
    name: '',
    event_type: 'create' as EventType,
    entity_key: '',
    condition: '',
    action_type: 'notify' as ActionType,
    action_config: '{}',
    is_active: true,
    order: 0,
  }
}
type FormState = ReturnType<typeof emptyForm>

function formToPayload(f: FormState) {
  let config: Record<string, unknown> = {}
  try { config = JSON.parse(f.action_config || '{}') } catch { /* keep empty */ }
  return {
    key: f.key.trim(),
    name: f.name.trim(),
    event_type: f.event_type,
    entity_key: f.entity_key,
    condition: f.condition.trim() || null,
    action: { type: f.action_type, config },
    is_active: f.is_active,
    order: Number(f.order) || 0,
  }
}

function automationToForm(a: Automation): FormState {
  return {
    key: a.key,
    name: a.name,
    event_type: a.event_type,
    entity_key: a.entity_key,
    condition: a.condition ?? '',
    action_type: a.action.type,
    action_config: JSON.stringify(a.action.config ?? {}, null, 2),
    is_active: a.is_active,
    order: a.order,
  }
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------
export default function AutomationsPane({ token }: { token: string }) {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [entities, setEntities] = useState<EntityMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  // Edit/create form
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Automation | null>(null) // null = create
  const [form, setForm] = useState<FormState>(emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [formErr, setFormErr] = useState('')
  const [formOk, setFormOk] = useState('')

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    Promise.all([
      jreq(token, '/api/automations'),
      jreq(token, '/meta/entities'),
    ])
      .then(([a, e]) => {
        if (!alive) return
        setAutomations(Array.isArray(a) ? a : [])
        setEntities(Array.isArray(e) ? e : [])
      })
      .catch((e) => {
        if (!alive) return
        if (e instanceof FetchError && e.status === 403) setDenied(true)
        else setError((e as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  useEffect(() => { return load() }, [load])

  function openCreate() {
    setEditTarget(null)
    setForm({ ...emptyForm(), entity_key: entities[0]?.key ?? '' })
    setFormErr(''); setFormOk('')
    setFormOpen(true)
  }

  function openEdit(a: Automation) {
    setEditTarget(a)
    setForm(automationToForm(a))
    setFormErr(''); setFormOk('')
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false); setEditTarget(null)
    setFormErr(''); setFormOk('')
  }

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setFormErr(''); setFormOk('')
    try {
      const payload = formToPayload(form)
      if (editTarget) {
        const updated = await jreq(token, `/api/automations/${editTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
        setAutomations((prev) => prev.map((a) => a.id === editTarget.id ? updated : a))
        setFormOk('Automation updated.')
        setEditTarget(updated)
      } else {
        const created = await jreq(token, '/api/automations', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setAutomations((prev) => [...prev, created])
        setFormOk('Automation created.')
        setEditTarget(created)
        setForm(automationToForm(created))
      }
    } catch (err) {
      setFormErr((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(a: Automation) {
    try {
      const updated = await jreq(token, `/api/automations/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !a.is_active }),
      })
      setAutomations((prev) => prev.map((x) => x.id === a.id ? updated : x))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function deleteAutomation(id: number) {
    setDeleting(true); setDeleteErr('')
    try {
      await jreq(token, `/api/automations/${id}`, { method: 'DELETE' })
      setAutomations((prev) => prev.filter((a) => a.id !== id))
      setDeleteId(null)
      if (editTarget?.id === id) closeForm()
    } catch (err) {
      setDeleteErr((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to manage automations." />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  const sorted = [...automations].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))

  return (
    <div>
      {/* Header */}
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Automations</h3>
          <p className="hint" style={{ margin: 0 }}>
            Trigger-condition-action rules. Fire on entity lifecycle events.
          </p>
        </div>
        <span className="spacer" />
        <Button variant="primary" size="sm"
            onClick={openCreate}>
          <PlusIcon size={13} /> New automation
        </Button>
      </div>

      {deleteErr && <ErrorBanner message={deleteErr} />}

      {/* List */}
      {sorted.length === 0 && !formOpen ? (
        <EmptyState
          icon={<SparkleIcon size={40} />}
          title="No automations yet."
          message="Create a rule to trigger actions on entity events."
          action={
            <Button variant="primary" size="sm"
            onClick={openCreate}>
              <PlusIcon size={13} /> New automation
            </Button>
          }
        />
      ) : (
        <div className="grid-wrap" style={{ marginBottom: 'var(--gx-space-12)' }}>
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Event</th>
                <th scope="col">Entity</th>
                <th scope="col">Action</th>
                <th scope="col">Active</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr
                  key={a.id}
                  style={{
                    cursor: 'pointer',
                    // D18: selected automation row = azure-soft (interactive family, active selected state)
                    background: editTarget?.id === a.id ? 'var(--gx-interactive-soft)' : undefined,
                    opacity: a.is_active ? 1 : 0.55,
                  }}
                  onClick={() => openEdit(a)}
                >
                  <td>
                    <span style={{ fontWeight: 500 }}>{a.name}</span>
                    {a.condition && (
                      <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', marginTop: 'var(--gx-space-1)' }}>
                        if {a.condition}
                      </div>
                    )}
                  </td>
                  <td>
                    <span style={{ fontSize: 'var(--gx-text-sm)' }}>{eventLabel[a.event_type] ?? a.event_type}</span>
                  </td>
                  <td>
                    <code className="mono" style={{ fontSize: 'var(--gx-text-11)' }}>{a.entity_key}</code>
                  </td>
                  <td>
                    <span style={{ fontSize: 'var(--gx-text-sm)' }}>{actionLabel[a.action?.type] ?? a.action?.type}</span>
                  </td>
                  <td onClick={(e) => { e.stopPropagation(); toggleActive(a) }}>
                    <button
                      className={'btn btn-sm ' + (a.is_active ? 'btn-accent' : 'btn-ghost')}
                      title={a.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                      style={{ minWidth: 64 }}
                    >
                      {a.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm"
            title="Edit"
                        onClick={() => openEdit(a)}
                      >
                        <EditIcon size={13} />
                      </Button>
                      {deleteId === a.id ? (
                        <>
                          <button
                            className="btn btn-sm"
                            style={{ color: 'var(--gx-danger)' }}
                            onClick={() => deleteAutomation(a.id)}
                            disabled={deleting}
                          >
                            {deleting ? 'Deleting…' : 'Confirm'}
                          </button>
                          <Button variant="ghost" size="sm"
            onClick={() => setDeleteId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm"
            title="Delete automation"
                          onClick={() => setDeleteId(a.id)}
                        >
                          <TrashIcon size={13} />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit form */}
      {formOpen && (
        <form
          onSubmit={submitForm}
          style={{ background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border)', borderRadius: 6, padding: '16px 18px', marginTop: 'var(--gx-space-4)' }}
        >
          <div className="section-head" style={{ marginTop: 0 }}>
            <SparkleIcon size={14} className="section-icon" />
            {editTarget ? `Edit: ${editTarget.name}` : 'New automation'}
            <span className="spacer" />
            <Button variant="ghost" size="sm"
            type="button"  onClick={closeForm}>
              <CloseIcon size={13} />
            </Button>
          </div>

          {formErr && <ErrorBanner message={formErr} />}
          {formOk && (
            <div className="error-banner" style={{ marginBottom: 'var(--gx-space-4)', borderLeftColor: 'var(--gx-success)', background: 'var(--gx-success-soft)' }}>
              <CheckIcon size={14} />
              <span className="error-banner-msg">{formOk}</span>
            </div>
          )}

          <div className="rec-form">
            {/* Identity */}
            <label className="field">
              <span>Name *</span>
              <input
                className="inp inp-md"
                value={form.name}
                onChange={(e) => patch('name', e.target.value)}
                placeholder="Notify on new ticket"
                required
              />
            </label>
            <label className="field">
              <span>Key (snake_case) *</span>
              <input
                className="inp inp-md"
                value={form.key}
                onChange={(e) => patch('key', e.target.value)}
                placeholder="notify_on_new_ticket"
                required
              />
            </label>

            {/* Trigger */}
            <label className="field">
              <span>Event type</span>
              <select
                className="inp inp-md"
                value={form.event_type}
                onChange={(e) => patch('event_type', e.target.value as EventType)}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>{eventLabel[t]}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Entity</span>
              <select
                className="inp inp-md"
                value={form.entity_key}
                onChange={(e) => patch('entity_key', e.target.value)}
              >
                <option value="">— select entity —</option>
                {entities.map((ent) => (
                  <option key={ent.key} value={ent.key}>{ent.label}</option>
                ))}
              </select>
            </label>

            {/* Condition */}
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>
                Condition
                <span className="hint" style={{ marginLeft: 'var(--gx-space-4)' }}>(GXL expression — leave blank to always fire)</span>
              </span>
              <input
                className="inp inp-md"
                value={form.condition}
                onChange={(e) => patch('condition', e.target.value)}
                placeholder="status == 'OPEN' and priority > 2"
              />
            </label>

            {/* Action */}
            <label className="field">
              <span>Action type</span>
              <select
                className="inp inp-md"
                value={form.action_type}
                onChange={(e) => patch('action_type', e.target.value as ActionType)}
              >
                {ACTION_TYPES.map((t) => (
                  <option key={t} value={t}>{actionLabel[t]}</option>
                ))}
              </select>
            </label>

            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>
                Action config
                <span className="hint" style={{ marginLeft: 'var(--gx-space-4)' }}>(JSON)</span>
              </span>
              <textarea
                className="inp inp-md"
                style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--gx-text-sm)', minHeight: 80, resize: 'vertical' }}
                value={form.action_config}
                onChange={(e) => patch('action_config', e.target.value)}
                placeholder={getConfigPlaceholder(form.action_type)}
                spellCheck={false}
              />
            </label>

            {/* Misc */}
            <label className="field">
              <span>Order</span>
              <input
                type="number"
                className="inp inp-md"
                value={form.order}
                onChange={(e) => patch('order', Number(e.target.value))}
                min={0}
              />
            </label>

            <label className="field" style={{ justifyContent: 'center' }}>
              <span>Active</span>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => patch('is_active', e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
            </label>
          </div>

          {/* Help banner per action type */}
          <div className="error-banner" style={{ margin: '12px 0 8px', borderLeftColor: 'var(--gx-info)', background: 'var(--gx-info-soft)' }}>
            <InfoIcon size={14} style={{ color: 'var(--gx-info)', flexShrink: 0 }} />
            <span className="error-banner-msg">{getActionHint(form.action_type)}</span>
          </div>

          <div className="row" style={{ marginTop: 'var(--gx-space-2)' }}>
            <Button variant="gold" size="sm"
            type="submit"  disabled={submitting}>
              <CheckIcon size={13} />
              {submitting ? 'Saving…' : editTarget ? 'Save changes' : 'Create automation'}
            </Button>
            <Button variant="ghost" size="sm"
            type="button"  onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getConfigPlaceholder(type: ActionType): string {
  switch (type) {
    case 'notify':      return '{"template": "ticket_created", "channels": ["email"]}'
    case 'set_field':   return '{"field": "status", "value": "IN_PROGRESS"}'
    case 'webhook':     return '{"url": "https://example.com/hook", "method": "POST"}'
    case 'emit_event':  return '{"event": "ticket.escalated", "payload": {}}'
  }
}

function getActionHint(type: ActionType): string {
  switch (type) {
    case 'notify':
      return 'Sends a notification using the specified template and channels (email, in-app, sms).'
    case 'set_field':
      return 'Sets a field on the record to a literal value or GXL expression after the event fires.'
    case 'webhook':
      return 'POSTs (or GETs) to the given URL with the event payload. Add `headers` for auth tokens.'
    case 'emit_event':
      return 'Emits a synthetic platform event that can trigger further automations or integrations.'
  }
}
