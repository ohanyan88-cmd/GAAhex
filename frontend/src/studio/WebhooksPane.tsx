// WebhooksPane — Studio-shaped pane for the Developer → Webhooks leaf.
//
// Wraps the same CRUD that powers the System nav's WebhooksView, but uses the
// Studio shell's own ViewHead/crumbs and the pane-internal heading pattern
// (matching NotificationsPane / RolesPane), so it sits cleanly inside Studio.
//
// Wiring (real, no mocks):
//   GET    /api/webhooks                       → list
//   POST   /api/webhooks                       → create  (config.manage server-side gate)
//   GET    /api/webhooks/{id}                  → detail / drawer reload
//   PATCH  /api/webhooks/{id}                  → update + secret rotation ({secret} key)
//   DELETE /api/webhooks/{id}                  → hard delete
//   POST   /api/webhooks/{id}/test             → fire a sample event
//   GET    /api/webhooks/{id}/deliveries       → delivery log (newest first)
//
// Every write is gated server-side by `_require_config_manage` (see
// backend/app/routers/webhooks.py). 403 → <PermissionDenied/>. Other errors →
// <ErrorBanner/>. The backend never returns the secret value — we render
// has_secret as a "signed" pill and let the operator rotate by PATCHing a new
// value. Light + dark via --gx-* tokens; zero raw hex. No emoji.

import { useCallback, useEffect, useState } from 'react'
import { StatusPill, KPITile } from '../primitives'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { timeAgo } from '../lib/time'
import {
  PlusIcon, CloseIcon, CheckIcon, EditIcon, TrashIcon, ServerIcon,
  PlayIcon, RowsIcon, LockIcon, ActivityIcon,
} from '../components/icons'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: 'Bearer ' + token })

const EVENT_OPTIONS = [
  'create', 'update', 'delete', 'transition', 'comment', 'payment',
  'approval_requested', 'approval_approved', 'approval_rejected',
]

class FetchError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function apiFetch<T = unknown>(token: string, path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...authH(token),
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts?.headers ?? {}),
    },
  })
  if (!r.ok) {
    let detail = `HTTP ${r.status}`
    try {
      const j = await r.json()
      detail = j?.detail || detail
    } catch { /* empty body */ }
    throw new FetchError(detail, r.status)
  }
  if (r.status === 204) return null as T
  return (await r.json()) as T
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Webhook = {
  id: string
  name: string
  url: string
  events: string[]
  active: boolean
  has_secret: boolean
  created_at: string | null
}

type Delivery = {
  id: string
  event_type?: string
  status?: string | null
  status_code?: number | null
  attempts?: number
  created_at?: string | null
  error?: string | null
}

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

function mapDeliveryStatus(status: string | null | undefined): { label: string; variant: PillVariant } {
  const s = (status ?? '').toUpperCase()
  const label = status ?? '—'
  if (s === 'SENT') return { label, variant: 'active' }
  if (s === 'FAILED') return { label, variant: 'critical' }
  if (s === 'QUEUED') return { label, variant: 'info' }
  return { label, variant: 'neutral' }
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------
function CreateWebhookModal({
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

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 100, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: 'var(--gx-surface-1)',
          border: '1px solid var(--gx-border)',
          borderRadius: 'var(--gx-radius-lg)',
          width: 'min(680px, 100%)',
          padding: 20,
          boxShadow: 'var(--gx-shadow-lg, 0 16px 48px rgba(0,0,0,0.3))',
        }}
      >
        <div className="row" style={{ alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>New webhook</h3>
          <span className="spacer" />
          <button
            type="button" className="btn btn-ghost btn-sm"
            onClick={onClose} disabled={saving} aria-label="Close"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        {err && <ErrorBanner message={err} />}

        <div className="section-head" style={{ marginTop: 4 }}>
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
        <label className="field" style={{ marginTop: 8 }}>
          <span>URL *</span>
          <input
            className="inp inp-sm mono" value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hook"
          />
        </label>

        <div className="section-head" style={{ marginTop: 16 }}>
          <ActivityIcon size={15} className="section-icon" /> Event subscriptions
        </div>
        <p className="hint" style={{ margin: '0 0 8px' }}>
          Leave empty to receive <strong>all</strong> events. Otherwise only the selected types are
          delivered.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EVENT_OPTIONS.map((ev) => {
            const on = events.includes(ev)
            return (
              <button
                key={ev}
                type="button"
                className={'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost')}
                onClick={() => toggleEvent(ev)}
                style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 11.5 }}
              >
                {ev}
              </button>
            )
          })}
        </div>

        <div className="section-head" style={{ marginTop: 16 }}>
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
        <p className="hint" style={{ margin: '4px 0 0' }}>
          Deliveries are signed with HMAC-SHA256 over the request body when a secret is set.
          The secret is stored server-side and never returned by the API.
        </p>

        <div className="section-head" style={{ marginTop: 16 }}>
          <CheckIcon size={15} className="section-icon" /> Status
        </div>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox" checked={active}
            onChange={(e) => setActive(e.target.checked)}
            id="webhook-active-toggle"
          />
          <span>Active — deliveries fire on subscribed events.</span>
        </label>

        <div className="row" style={{ marginTop: 16, gap: 8 }}>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-md" disabled={saving}>
            <CheckIcon size={14} /> {saving ? 'Creating…' : 'Create webhook'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirm delete
// ---------------------------------------------------------------------------
function ConfirmDeleteDialog({
  hookName, onCancel, onConfirm, deleting, err,
}: {
  hookName: string
  onCancel: () => void
  onConfirm: () => void
  deleting: boolean
  err: string
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--gx-surface-1)',
          border: '1px solid var(--gx-border)',
          borderRadius: 'var(--gx-radius-lg)',
          width: 'min(460px, 100%)', padding: 20,
          boxShadow: 'var(--gx-shadow-lg, 0 16px 48px rgba(0,0,0,0.3))',
        }}
      >
        <h3 style={{ margin: '0 0 8px' }}>Delete webhook?</h3>
        <p className="hint" style={{ margin: '0 0 14px' }}>
          This will hard-delete <strong>{hookName}</strong>. Future events will no longer be
          delivered to this endpoint. Past delivery records are preserved.
        </p>
        {err && <ErrorBanner message={err} />}
        <div className="row" style={{ gap: 8 }}>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost btn-md" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-md" onClick={onConfirm} disabled={deleting}>
            <TrashIcon size={13} /> {deleting ? 'Deleting…' : 'Delete webhook'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail drawer — edit + secret rotation + deliveries log + test
// ---------------------------------------------------------------------------
function DetailDrawer({
  token, hookId, onClose, onChanged, onDeleted,
}: {
  token: string
  hookId: string
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [hook, setHook] = useState<Webhook | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [denied, setDenied] = useState(false)

  // Editable buffers
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([])
  const [active, setActive] = useState(true)
  const [newSecret, setNewSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Test send
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<Delivery | null>(null)
  const [testErr, setTestErr] = useState('')

  // Deliveries
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null)
  const [delErr, setDelErr] = useState('')

  // Delete
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoadErr(''); setDenied(false)
    apiFetch<Webhook>(token, `/api/webhooks/${hookId}`)
      .then((w) => {
        if (!alive) return
        setHook(w)
        setName(w.name ?? '')
        setUrl(w.url ?? '')
        setEvents(w.events ?? [])
        setActive(w.active !== false)
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setDenied(true)
        else setLoadErr((ex as Error).message)
      })
    return () => { alive = false }
  }, [token, hookId])

  useEffect(() => { load() }, [load])

  const loadDeliveries = useCallback(() => {
    let alive = true
    setDelErr('')
    apiFetch<Delivery[]>(token, `/api/webhooks/${hookId}/deliveries`)
      .then((rows) => { if (alive) setDeliveries(Array.isArray(rows) ? rows : []) })
      .catch((ex) => { if (alive) setDelErr((ex as Error).message); setDeliveries([]) })
    return () => { alive = false }
  }, [token, hookId])

  useEffect(() => { loadDeliveries() }, [loadDeliveries])

  function toggleEvent(ev: string) {
    setEvents(es => es.includes(ev) ? es.filter(x => x !== ev) : [...es, ev])
  }

  async function saveAll(opts: { rotate: boolean }) {
    if (!hook) return
    if (!name.trim() || !url.trim()) {
      setSaveErr('Name and URL cannot be empty.')
      return
    }
    setSaving(true); setSaveErr(''); setSavedAt(null)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        url: url.trim(),
        events,
        active,
      }
      if (opts.rotate) {
        // Empty string clears the secret (unsigned); otherwise rotate to the new value.
        body.secret = newSecret.trim() || null
      }
      const updated = await apiFetch<Webhook>(token, `/api/webhooks/${hookId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setHook(updated)
      setName(updated.name)
      setUrl(updated.url)
      setEvents(updated.events ?? [])
      setActive(updated.active !== false)
      if (opts.rotate) setNewSecret('')
      setSavedAt(Date.now())
      onChanged()
    } catch (ex) {
      setSaveErr((ex as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function runTest() {
    setTesting(true); setTestErr(''); setTestResult(null)
    try {
      const d = await apiFetch<Delivery>(token, `/api/webhooks/${hookId}/test`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setTestResult(d)
      // Refresh the delivery log so the new attempt shows up at the top.
      loadDeliveries()
    } catch (ex) {
      setTestErr((ex as Error).message)
    } finally {
      setTesting(false)
    }
  }

  async function doDelete() {
    setDeleting(true); setDeleteErr('')
    try {
      await apiFetch(token, `/api/webhooks/${hookId}`, { method: 'DELETE' })
      onDeleted()
    } catch (ex) {
      setDeleteErr((ex as Error).message)
      setDeleting(false)
    }
  }

  return (
    <DrawerShell onClose={onClose} title={hook ? hook.name : 'Loading…'}>
      {denied && <PermissionDenied message="You don't have permission to view this webhook." />}
      {loadErr && <ErrorBanner message={loadErr} onRetry={load} />}
      {!hook && !loadErr && !denied && <LoadingState />}

      {hook && (
        <>
          <div className="section-head" style={{ marginTop: 4 }}>
            <RowsIcon size={15} className="section-icon" /> Endpoint
          </div>
          <label className="field">
            <span>Name *</span>
            <input
              className="inp inp-sm" value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field" style={{ marginTop: 8 }}>
            <span>URL *</span>
            <input
              className="inp inp-sm mono" value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>

          <div className="section-head" style={{ marginTop: 16 }}>
            <ActivityIcon size={15} className="section-icon" /> Event subscriptions
          </div>
          <p className="hint" style={{ margin: '0 0 8px' }}>
            Empty = receive all events.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EVENT_OPTIONS.map((ev) => {
              const on = events.includes(ev)
              return (
                <button
                  key={ev}
                  type="button"
                  className={'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost')}
                  onClick={() => toggleEvent(ev)}
                  style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 11.5 }}
                >
                  {ev}
                </button>
              )
            })}
          </div>

          <div className="section-head" style={{ marginTop: 16 }}>
            <CheckIcon size={15} className="section-icon" /> Status
          </div>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox" checked={active}
              onChange={(e) => setActive(e.target.checked)}
              id={`webhook-active-${hookId}`}
            />
            <span>Active — fires deliveries on subscribed events.</span>
          </label>

          {saveErr && <div style={{ marginTop: 10 }}><ErrorBanner message={saveErr} /></div>}
          {savedAt && (
            <div
              style={{
                marginTop: 10, padding: 8,
                border: '1px solid var(--gx-border)',
                borderRadius: 'var(--gx-radius-md)',
                background: 'var(--gx-success-soft, var(--gx-surface-2))',
                color: 'var(--gx-text-1)', fontSize: 12,
              }}
            >
              Saved {timeAgo(new Date(savedAt).toISOString())}.
            </div>
          )}

          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <span className="spacer" />
            <button
              type="button" className="btn btn-primary btn-md"
              onClick={() => saveAll({ rotate: false })}
              disabled={saving}
            >
              <CheckIcon size={13} /> {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>

          <div className="section-head" style={{ marginTop: 22 }}>
            <LockIcon size={15} className="section-icon" /> Signing secret
          </div>
          <div
            style={{
              padding: 12,
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-md)',
              background: 'var(--gx-surface-2)',
            }}
          >
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong>Current state</strong>
              {hook.has_secret
                ? <StatusPill variant="active" label="signed" size="sm" />
                : <span className="hint">unsigned</span>}
            </div>
            <p className="hint" style={{ margin: '0 0 10px' }}>
              The secret is never returned by the API. Set a new value to rotate it; clear and rotate
              to disable signing.
            </p>
            <label className="field">
              <span>New secret</span>
              <input
                className="inp inp-sm mono" value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                placeholder="(blank to clear)"
              />
            </label>
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <span className="spacer" />
              <button
                type="button" className="btn btn-secondary btn-md"
                onClick={() => saveAll({ rotate: true })}
                disabled={saving}
              >
                <LockIcon size={13} /> {saving ? 'Rotating…' : (newSecret.trim() ? 'Rotate secret' : 'Clear secret')}
              </button>
            </div>
          </div>

          <div className="section-head" style={{ marginTop: 22 }}>
            <PlayIcon size={15} className="section-icon" /> Test delivery
          </div>
          <p className="hint" style={{ margin: '0 0 8px' }}>
            Sends a sample <code className="mono">test</code> event to this endpoint and records the
            attempt in the delivery log.
          </p>
          {testErr && <ErrorBanner message={testErr} />}
          {testResult && (
            <div
              style={{
                marginBottom: 10, padding: 10,
                border: '1px solid var(--gx-border)',
                borderRadius: 'var(--gx-radius-md)',
                background: 'var(--gx-surface-2)',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <strong>Test result</strong>
                <StatusPill {...mapDeliveryStatus(testResult.status)} size="sm" />
                {testResult.status_code != null && (
                  <span className="hint mono">HTTP {testResult.status_code}</span>
                )}
              </div>
              {testResult.error && (
                <div className="hint" style={{ wordBreak: 'break-word' }}>{testResult.error}</div>
              )}
            </div>
          )}
          <button
            type="button" className="btn btn-secondary btn-sm"
            onClick={runTest} disabled={testing}
          >
            <PlayIcon size={13} /> {testing ? 'Sending…' : 'Send test event'}
          </button>

          <div className="section-head" style={{ marginTop: 22 }}>
            <ActivityIcon size={15} className="section-icon" /> Delivery log
          </div>
          {delErr && <ErrorBanner message={delErr} onRetry={loadDeliveries} />}
          {!deliveries && !delErr && <LoadingState />}
          {deliveries && deliveries.length === 0 && (
            <p className="hint" style={{ margin: 0 }}>No deliveries yet.</p>
          )}
          {deliveries && deliveries.length > 0 && (
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Status</th>
                    <th scope="col">Code</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => {
                    const sp = mapDeliveryStatus(d.status)
                    return (
                      <tr key={d.id}>
                        <td><code className="mono">{d.event_type ?? '—'}</code></td>
                        <td>
                          <StatusPill variant={sp.variant} label={sp.label} size="sm" />
                          {d.error && (
                            <div
                              style={{ fontSize: 11, color: 'var(--gx-text-3)', marginTop: 2 }}
                              title={d.error}
                            >
                              {d.error.length > 60 ? d.error.slice(0, 60) + '…' : d.error}
                            </div>
                          )}
                        </td>
                        <td className="mono">{d.status_code ?? '—'}</td>
                        <td className="tnum">{d.attempts ?? '—'}</td>
                        <td>{timeAgo(d.created_at ?? null)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="section-head" style={{ marginTop: 22 }}>
            <TrashIcon size={15} className="section-icon" /> Danger zone
          </div>
          <div
            style={{
              padding: 14,
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-md)',
              background: 'var(--gx-surface-2)',
            }}
          >
            <div style={{ marginBottom: 8 }}>
              <strong>Delete this webhook</strong>
            </div>
            <p className="hint" style={{ margin: '0 0 10px' }}>
              Hard-delete <strong>{hook.name}</strong>. Future events will no longer be delivered.
              To temporarily stop deliveries instead, uncheck <strong>Active</strong> above and Save.
            </p>
            <button
              type="button" className="btn btn-danger btn-sm"
              onClick={() => setConfirmDel(true)}
            >
              <TrashIcon size={13} /> Delete webhook
            </button>
          </div>
        </>
      )}

      {confirmDel && hook && (
        <ConfirmDeleteDialog
          hookName={hook.name}
          onCancel={() => setConfirmDel(false)}
          onConfirm={doDelete}
          deleting={deleting}
          err={deleteErr}
        />
      )}
    </DrawerShell>
  )
}

function DrawerShell({
  onClose, title, children,
}: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 100, display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        style={{
          background: 'var(--gx-surface-1)',
          borderLeft: '1px solid var(--gx-border)',
          width: 'min(720px, 100%)',
          height: '100vh', overflowY: 'auto', padding: 20,
          boxShadow: 'var(--gx-shadow-lg, -16px 0 48px rgba(0,0,0,0.3))',
        }}
      >
        <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <span className="spacer" />
          <button
            type="button" className="btn btn-ghost btn-sm"
            onClick={onClose} aria-label="Close drawer"
          >
            <CloseIcon size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main pane — list + filters + create + drill-in
// ---------------------------------------------------------------------------
export default function WebhooksPane({ token }: { token: string }) {
  const [hooks, setHooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    apiFetch<Webhook[]>(token, '/api/webhooks')
      .then((d) => { if (alive) setHooks(Array.isArray(d) ? d : []) })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setDenied(true)
        else setError((ex as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  useEffect(() => load(), [load])

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to manage webhooks." />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  const total = hooks.length
  const activeCount = hooks.filter(w => w.active !== false).length
  const signedCount = hooks.filter(w => w.has_secret).length

  const q = search.trim().toLowerCase()
  const filtered = q
    ? hooks.filter((w) =>
        (w.name || '').toLowerCase().includes(q) ||
        (w.url || '').toLowerCase().includes(q) ||
        (w.events || []).some(e => e.toLowerCase().includes(q)),
      )
    : hooks

  return (
    <div>
      <div className="row" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Webhooks</h3>
          <p className="hint" style={{ margin: 0 }}>
            Forward platform events to external HTTPS endpoints. Deliveries are
            HMAC-SHA256 signed when a secret is set; retries are recorded in the
            delivery log per endpoint.
          </p>
        </div>
        <span className="spacer" />
        <button
          type="button" className="btn btn-primary btn-md"
          onClick={() => setShowCreate(true)}
        >
          <PlusIcon size={13} /> New webhook
        </button>
      </div>

      {total > 0 && (
        <div className="kpi-strip" style={{ marginBottom: 12 }}>
          <KPITile
            label="Endpoints"
            value={total}
            subtitle={`${activeCount} enabled`}
            size="sm"
          />
          <KPITile
            label="Signed"
            value={signedCount}
            subtitle="HMAC-secured"
            size="sm"
            premium
          />
          <KPITile
            label="Disabled"
            value={total - activeCount}
            subtitle="no deliveries"
            size="sm"
            muted
          />
        </div>
      )}

      <div style={{ marginBottom: 12, maxWidth: 320 }}>
        <input
          className="inp inp-md"
          placeholder="Filter by name, URL, or event…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ServerIcon size={40} />}
          title={q ? 'No webhooks match the filter.' : 'No webhooks yet.'}
          message={
            q
              ? 'Try a different query.'
              : 'Create the first endpoint with "New webhook" above. Once active, it will receive subscribed events.'
          }
        />
      ) : (
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">URL</th>
                <th scope="col">Events</th>
                <th scope="col">Secret</th>
                <th scope="col">Status</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr
                  key={w.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOpenId(w.id)}
                >
                  <td><strong>{w.name}</strong></td>
                  <td>
                    <span
                      className="mono"
                      title={w.url}
                      style={{ color: 'var(--gx-text-3)', fontSize: 12 }}
                    >
                      {w.url}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>
                      {w.events && w.events.length
                        ? w.events.join(', ')
                        : <span style={{ color: 'var(--gx-text-3)' }}>all</span>}
                    </span>
                  </td>
                  <td>
                    {w.has_secret
                      ? <StatusPill variant="active" label="signed" size="sm" />
                      : <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>none</span>}
                  </td>
                  <td>
                    {w.active !== false
                      ? <StatusPill variant="active" label="enabled" size="sm" />
                      : <StatusPill variant="neutral" label="disabled" size="sm" />}
                  </td>
                  <td className="actions-col">
                    <button
                      type="button" className="btn btn-ghost btn-sm"
                      onClick={(ev) => { ev.stopPropagation(); setOpenId(w.id) }}
                      aria-label={`Open ${w.name}`}
                    >
                      <EditIcon size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateWebhookModal
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false)
            load()
            setOpenId(id)
          }}
        />
      )}

      {openId && (
        <DetailDrawer
          token={token}
          hookId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => load()}
          onDeleted={() => { setOpenId(null); load() }}
        />
      )}
    </div>
  )
}
