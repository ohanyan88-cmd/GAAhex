import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { MultiSelect } from './Select'
import { toast } from './Toast'
import { timeAgo } from './time'
import { confirmDialog } from './Modal'
import { EmptyState, ErrorBanner, PermissionDenied } from './States'
import { InfoIcon } from './icons'

// Webhooks admin (E12 /api/webhooks) — CRUD + per-webhook deliveries log + test. Degrades on 404.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Webhook = { id: string; name?: string; url?: string; events?: string[]; active?: boolean; secret?: string | null; created_at?: string | null }
type Delivery = { id: string; event?: string; status?: string | null; code?: number | null; created_at?: string | null; error?: string | null }
type Draft = { id?: string; name: string; url: string; events: string[]; active: boolean }

// Common GAAex event types a webhook can subscribe to (kernel audit/notification events).
const EVENT_OPTIONS = ['create', 'update', 'delete', 'transition', 'comment', 'payment',
  'approval_requested', 'approval_approved', 'approval_rejected']
const EMPTY: Draft = { name: '', url: '', events: [], active: true }

async function jfetch(token: string, path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...authH(token), ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } })
  let data: any = null
  try { data = await r.json() } catch { /* 204 / empty */ }
  return { r, data }
}

function statusPill(status: string | null | undefined, code?: number | null) {
  const ok = (typeof code === 'number' && code >= 200 && code < 300) || (status ?? '').toLowerCase() === 'success'
  const failed = (status ?? '').toLowerCase() === 'failed' || (typeof code === 'number' && code >= 400)
  const cls = failed ? 'pill pill-danger' : ok ? 'pill pill-success' : 'pill pill-muted'
  return <span className={cls}>{status ?? (code ?? '—')}</span>
}

function maskSecret(secret: string | null | undefined) {
  if (!secret) return '—'
  return '••••' + secret.slice(-4)
}

export default function WebhooksView({ token }: { token: string }) {
  const [list, setList] = useState<Webhook[] | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null)

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    try {
      const { r, data } = await jfetch(token, '/api/webhooks')
      if (r.status === 404) { setUnavailable(true); setList([]); return }
      if (r.status === 403) { setDenied(true); setList([]); return }
      if (!r.ok) { setError('Failed to load webhooks'); setList([]); return }
      setList(Array.isArray(data) ? data : [])
    } catch (e) {
      setError((e as Error).message); setList([])
    }
  }

  useEffect(() => { load() }, [token])

  async function save() {
    if (!draft || !draft.name.trim() || !draft.url.trim()) return
    const body = { name: draft.name.trim(), url: draft.url.trim(), events: draft.events, active: draft.active }
    try {
      if (draft.id) {
        const { r, data } = await jfetch(token, `/api/webhooks/${draft.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        if (!r.ok) throw new Error(data?.detail || `Save failed (${r.status})`)
        toast.success('Webhook updated')
      } else {
        const { r, data } = await jfetch(token, '/api/webhooks', { method: 'POST', body: JSON.stringify(body) })
        if (!r.ok) throw new Error(data?.detail || `Create failed (${r.status})`)
        toast.success('Webhook created')
        if (data?.secret) setNewSecret(data.secret)     // signing secret shown once
      }
      setDraft(null)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function remove(w: Webhook) {
    const ok = await confirmDialog({ title: `Delete ${w.name}`, message: 'Delete this webhook? Deliveries to it will stop.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      const { r, data } = await jfetch(token, `/api/webhooks/${w.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(data?.detail || `Delete failed (${r.status})`)
      toast.success('Webhook deleted')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function test(w: Webhook) {
    try {
      const { r, data } = await jfetch(token, `/api/webhooks/${w.id}/test`, { method: 'POST' })
      if (!r.ok) throw new Error(data?.detail || `Test failed (${r.status})`)
      toast.success('Test event sent')
    } catch (e) { toast.error((e as Error).message) }
  }

  if (denied) return <PermissionDenied message="Webhooks are admin-only." />

  return (
    <div>
      <div className="view-head">
        <h2>Webhooks</h2>
        {!unavailable && <button className="btn btn-primary btn-md" onClick={() => setDraft(draft ? null : { ...EMPTY })}>{draft ? 'Close' : '+ New webhook'}</button>}
      </div>

      {draft && (
        <div className="rec-form">
          <label className="field"><span>Name *</span><input className="inp inp-md" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Billing events → CRM" /></label>
          <label className="field"><span>URL *</span><input className="inp inp-md" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://example.com/hook" /></label>
          <label className="field"><span>Events</span><MultiSelect value={draft.events} options={EVENT_OPTIONS} onChange={(v) => setDraft({ ...draft, events: v })} /></label>
          <label className="field"><span>Active</span><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /></label>
          <div className="rec-form-actions"><button className="btn btn-accent btn-md" onClick={save} disabled={!draft.name.trim() || !draft.url.trim()}>{draft.id ? 'Save' : 'Create'}</button></div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState icon={<InfoIcon size={40} />} title="Webhooks aren't available yet" message="Webhook delivery will appear here once the integration service is enabled." />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<InfoIcon size={40} />} title="No webhooks" message="Create one to forward events to an external URL." />
      )}

      {list && list.length > 0 && (
        <div className="grid-wrap"><table className="grid">
          <thead><tr><th scope="col">Name</th><th scope="col">URL</th><th scope="col">Events</th><th scope="col">Secret</th><th scope="col">Active</th><th scope="col"></th></tr></thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.id} className={w.active === false ? 'row-muted' : ''}>
                <td>{w.name ?? '—'}</td>
                <td className="ob-preview" title={w.url}>{w.url ?? '—'}</td>
                <td>{(w.events ?? []).length ? (w.events ?? []).join(', ') : <span className="muted">all</span>}</td>
                <td className="mono">{maskSecret(w.secret)}</td>
                <td>{w.active === false ? <span className="pill pill-muted">off</span> : <span className="pill pill-success">on</span>}</td>
                <td className="row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => test(w)}>Test</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDeliveriesFor(w)}>Deliveries</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDraft({ id: w.id, name: w.name ?? '', url: w.url ?? '', events: w.events ?? [], active: w.active !== false })}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(w)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {newSecret && (
        <Modal open onClose={() => setNewSecret(null)} title="Signing secret" size="sm"
          footer={<button className="btn btn-primary btn-md" onClick={() => setNewSecret(null)}>Done</button>}>
          <p>Copy this signing secret now — it won't be shown again.</p>
          <div className="secret-box mono">{newSecret}</div>
        </Modal>
      )}

      {deliveriesFor && (
        <DeliveriesModal token={token} webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
      )}
    </div>
  )
}

function DeliveriesModal({ token, webhook, onClose }: { token: string; webhook: Webhook; onClose: () => void }) {
  const [list, setList] = useState<Delivery[] | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setError(''); setList(null)
    try {
      const { r, data } = await jfetch(token, `/api/webhooks/${webhook.id}/deliveries`)
      if (!r.ok) { setError(r.status === 404 ? 'Deliveries log not available' : 'Failed to load deliveries'); setList([]); return }
      setList(Array.isArray(data) ? data : [])
    } catch (e) { setError((e as Error).message); setList([]) }
  }

  useEffect(() => { load() }, [token, webhook.id])

  return (
    <Modal open onClose={onClose} title={`Deliveries · ${webhook.name ?? ''}`} size="lg">
      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {list && list.length === 0 && !error && <p className="muted">No deliveries yet.</p>}
      {list && list.length > 0 && (
        <table className="grid">
          <thead><tr><th>Event</th><th>Status</th><th>Code</th><th>When</th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>{d.event ?? '—'}</td>
                <td>{statusPill(d.status, d.code)}</td>
                <td className="mono">{d.code ?? '—'}</td>
                <td>{timeAgo(d.created_at ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
