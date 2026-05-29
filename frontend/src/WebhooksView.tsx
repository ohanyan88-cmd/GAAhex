import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { MultiSelect } from './Select'
import { toast } from './Toast'
import { timeAgo } from './time'
import { confirmDialog } from './Modal'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from './States'
import { InfoIcon, ServerIcon } from './icons'
import { t } from './i18n'
import ViewHead from './ViewHead'
import { usePageConfig } from './pageConfig'
import { useCustomFields } from './CustomCells'

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

export default function WebhooksView({ token, configVersion = 0 }: { token: string; configVersion?: number }) {
  const cfg = usePageConfig(token, 'webhooks', configVersion)
  const [list, setList] = useState<Webhook[] | null>(null)
  const cf = useCustomFields(token, 'webhooks', cfg.customFields, (list ?? []).map((w) => w.id))
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
      if (!r.ok) { setError(t('webhooks.loadError', 'Failed to load webhooks')); setList([]); return }
      setList(Array.isArray(data) ? data : [])
    } catch {
      setError(t('webhooks.loadError', 'Failed to load webhooks')); setList([])
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
        toast.success(t('webhooks.updated', 'Webhook updated'))
      } else {
        const { r, data } = await jfetch(token, '/api/webhooks', { method: 'POST', body: JSON.stringify(body) })
        if (!r.ok) throw new Error(data?.detail || `Create failed (${r.status})`)
        toast.success(t('webhooks.created', 'Webhook created'))
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
      toast.success(t('webhooks.deleted', 'Webhook deleted'))
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function test(w: Webhook) {
    try {
      const { r, data } = await jfetch(token, `/api/webhooks/${w.id}/test`, { method: 'POST' })
      if (!r.ok) throw new Error(data?.detail || `Test failed (${r.status})`)
      toast.success(t('webhooks.testSent', 'Test event sent'))
    } catch (e) { toast.error((e as Error).message) }
  }

  if (denied) return <PermissionDenied message={t('webhooks.denied', 'Webhooks are admin-only.')} />

  return (
    <div>
      <ViewHead icon={<ServerIcon size={20} />} title={cfg.title}
        sub="Event subscriptions · signing secrets · delivery log per endpoint"
        actions={!unavailable && <button className="btn btn-primary btn-sm" onClick={() => setDraft(draft ? null : { ...EMPTY })}>{draft ? 'Close' : <><span>+</span> New webhook</>}</button>} />

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
      {list === null && !error && <SkeletonRows />}
      {unavailable && <EmptyState icon={<InfoIcon size={40} />} title={t('webhooks.unavailable', "Webhooks aren't available yet")} message={t('webhooks.unavailableMsg', 'Webhook delivery will appear here once the integration service is enabled.')} />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<InfoIcon size={40} />} title="No webhooks" message="Create one to forward events to an external URL." />
      )}

      {list && list.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              {cfg.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
              {cf.headers()}
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.id} className={w.active === false ? 'row-muted' : ''}>
                {cfg.columns.map((c) => {
                  let cell: React.ReactNode
                  switch (c.key) {
                    case 'name': cell = <strong>{w.name ?? '—'}</strong>; break
                    case 'url': cell = <span className="ob-preview mono" title={w.url} style={{ color: 'var(--text-3)', fontSize: 12 }}>{w.url ?? '—'}</span>; break
                    case 'events': cell = <span style={{ fontSize: 12 }}>{(w.events ?? []).length ? (w.events ?? []).join(', ') : <span className="muted">all</span>}</span>; break
                    case 'secret': cell = <span className="mono" style={{ fontSize: 12 }}>{maskSecret(w.secret)}</span>; break
                    case 'active': cell = w.active === false ? <span className="pill pill-muted">off</span> : <span className="pill pill-success">on</span>; break
                    default: cell = '—'
                  }
                  return <td key={c.key}>{cell}</td>
                })}
                {cf.cells(w.id)}
                <td><div className="row-actions">
                  <button className="iconbtn" onClick={() => test(w)} title="Test webhook"><span style={{ fontSize: 13 }}>Test</span></button>
                  <button className="iconbtn" onClick={() => setDeliveriesFor(w)} title="View deliveries"><span style={{ fontSize: 13 }}>Log</span></button>
                  <button className="iconbtn" onClick={() => setDraft({ id: w.id, name: w.name ?? '', url: w.url ?? '', events: w.events ?? [], active: w.active !== false })} title="Edit"><span style={{ fontSize: 13 }}>Edit</span></button>
                  <button className="iconbtn" onClick={() => remove(w)} title="Delete"><span style={{ fontSize: 13 }}>Delete</span></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
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
      if (!r.ok) { setError(r.status === 404 ? t('webhooks.deliveriesLoadError', 'Deliveries log not available') : t('webhooks.deliveriesLoadError', 'Failed to load deliveries')); setList([]); return }
      setList(Array.isArray(data) ? data : [])
    } catch { setError(t('webhooks.deliveriesLoadError', 'Failed to load deliveries')); setList([]) }
  }

  useEffect(() => { load() }, [token, webhook.id])

  return (
    <Modal open onClose={onClose} title={`Deliveries · ${webhook.name ?? ''}`} size="lg">
      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <SkeletonRows rows={3} />}
      {list && list.length === 0 && !error && <p className="muted">{t('common.noneYet', 'No deliveries yet.')}</p>}
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
