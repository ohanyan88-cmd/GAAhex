import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import { MultiSelect } from '../components/Select'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import { confirmDialog } from '../components/Modal'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import {
  InfoIcon, ServerIcon, SearchIcon, GearIcon,
} from '../components/icons'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { t } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'

// Webhooks admin (E12 /api/webhooks) — CRUD + per-webhook deliveries log + test. Degrades on 404.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// Backend never returns the secret value — only `has_secret: bool` — so the column is a presence indicator.
type Webhook = { id: string; name?: string; url?: string; events?: string[]; active?: boolean; has_secret?: boolean; created_at?: string | null }
// Backend delivery shape (J95): event_type + status (QUEUED|SENT|FAILED) + status_code.
type Delivery = { id: string; event_type?: string; status?: string | null; status_code?: number | null; attempts?: number; created_at?: string | null; error?: string | null }
type Draft = { id?: string; name: string; url: string; events: string[]; active: boolean }

const EVENT_OPTIONS = ['create', 'update', 'delete', 'transition', 'comment', 'payment',
  'approval_requested', 'approval_approved', 'approval_rejected']
const EMPTY: Draft = { name: '', url: '', events: [], active: true }

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapWebhookStatus(w: Webhook): { label: string; variant: PillVariant } {
  if (w.active === false) return { label: 'disabled', variant: 'neutral' }
  return { label: 'enabled', variant: 'active' }
}
function mapDeliveryStatus(status: string | null | undefined): { label: string; variant: PillVariant } {
  // Backend status: QUEUED | SENT | FAILED
  const s = (status ?? '').toUpperCase()
  const label = status ?? '—'
  if (s === 'SENT') return { label, variant: 'active' }
  if (s === 'FAILED') return { label, variant: 'critical' }
  if (s === 'QUEUED') return { label, variant: 'info' }
  return { label, variant: 'neutral' }
}

async function jfetch(token: string, path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...authH(token), ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } })
  let data: any = null
  try { data = await r.json() } catch { /* 204 / empty */ }
  return { r, data }
}

export default function WebhooksView({ token, canConfigure = false, configVersion = 0, onConfigure }: { token: string; canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
  const cfg = usePageConfig(token, 'webhooks', configVersion)
  const [list, setList] = useState<Webhook[] | null>(null)
  const cf = useCustomFields(token, 'webhooks', cfg.customFields, (list ?? []).map((w) => w.id))
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null)

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

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
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

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

  const all = list ?? []
  const activeCount = all.filter(w => w.active !== false).length
  const disabledCount = all.filter(w => w.active === false).length

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((w) => {
      const fields = [
        w.name ?? '',
        w.url ?? '',
        (w.events ?? []).join(' '),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  }, [all, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (w: Webhook): string | number => {
      switch (k) {
        case 'name': return w.name ?? ''
        case 'url': return w.url ?? ''
        case 'events': return (w.events ?? []).length
        case 'active': return w.active === false ? 0 : 1
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  if (denied) return <PermissionDenied message={t('webhooks.denied', 'Webhooks are admin-only.')} />

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs"><span>Integrations</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>

        <ViewHead
          icon={<ServerIcon size={18} />}
          title={cfg.title}
          sub={`${all.length} endpoint${all.length !== 1 ? 's' : ''} · event subscriptions · signed deliveries`}
          actions={!unavailable && (
            <>
              {canConfigure && onConfigure && (
                <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
                  <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
                </button>
              )}
              {canConfigure && (
                <button className="btn btn-primary btn-sm" onClick={() => setDraft(draft ? null : { ...EMPTY })}>
                  <Plus size={14} /> {draft ? 'Close' : 'New webhook'}
                </button>
              )}
            </>
          )}
        />

        {all.length > 0 && (
          <div className="kpi-strip">
            <div className="kpi">
              <span className="klbl">Endpoints</span>
              <div className="kval tnum" style={{ fontSize: 24 }}>{all.length}</div>
              <span className="hint" style={{ fontSize: 11 }}>{activeCount} enabled</span>
            </div>
            <div className="kpi kpi--marquee">
              <span className="klbl">Enabled</span>
              <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-gold)' }}>{activeCount}</div>
              <span className="hint" style={{ fontSize: 11 }}>delivering events</span>
            </div>
            {disabledCount > 0 && (
              <div className="kpi">
                <span className="klbl">Disabled</span>
                <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-text-3)' }}>{disabledCount}</div>
                <span className="hint" style={{ fontSize: 11 }}>no deliveries</span>
              </div>
            )}
          </div>
        )}

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
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search webhooks"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <span className="spacer" />
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {cfg.columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        onClick={() => toggleSort(c.key)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {c.label}
                          {sortKey === c.key
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-primary)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-primary)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th style={{ width: 1 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((w) => (
                    <tr key={w.id}>
                      {cfg.columns.map((c) => {
                        let cell: React.ReactNode
                        switch (c.key) {
                          case 'name': cell = <strong>{w.name ?? '—'}</strong>; break
                          case 'url': cell = <span className="mono" title={w.url} style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>{w.url ?? '—'}</span>; break
                          case 'events': cell = <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>{(w.events ?? []).length ? (w.events ?? []).join(', ') : <span style={{ color: 'var(--gx-text-3)' }}>all</span>}</span>; break
                          case 'secret': cell = w.has_secret
                            ? <StatusPill variant="active" label="signed" size="sm" />
                            : <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>none</span>
                            ; break
                          case 'active': {
                            const sp = mapWebhookStatus(w)
                            cell = <StatusPill variant={sp.variant} label={sp.label} size="sm" />
                            break
                          }
                          default: cell = '—'
                        }
                        return <td key={c.key}>{cell}</td>
                      })}
                      {cf.cells(w.id)}
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 1, whiteSpace: 'nowrap' }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setDeliveriesFor(w)} title="View deliveries">Log</button>
                          {canConfigure && <button className="btn btn-ghost btn-sm" onClick={() => test(w)} title="Test webhook">Test</button>}
                          {canConfigure && <button className="btn btn-ghost btn-sm" onClick={() => setDraft({ id: w.id, name: w.name ?? '', url: w.url ?? '', events: w.events ?? [], active: w.active !== false })}>Edit</button>}
                          {canConfigure && <button className="btn btn-ghost btn-sm" onClick={() => remove(w)}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + 1 + cfg.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching webhooks.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span className="hint">
                {sorted.length === 0
                  ? '0 records'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft size={15} />
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map(p => (
                  <button key={p} className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}

        {deliveriesFor && (
          <DeliveriesModal token={token} webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
        )}
      </div>
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
          <thead><tr><th>Event</th><th>Status</th><th>Code</th><th>Attempts</th><th>When</th></tr></thead>
          <tbody>
            {list.map((d) => {
              const sp = mapDeliveryStatus(d.status)
              return (
                <tr key={d.id}>
                  <td>{d.event_type ?? '—'}</td>
                  <td>
                    <StatusPill variant={sp.variant} label={sp.label} size="sm" />
                    {d.error && <div style={{ fontSize: 11, color: 'var(--gx-text-3)', marginTop: 2 }} title={d.error}>{d.error.length > 60 ? d.error.slice(0, 60) + '…' : d.error}</div>}
                  </td>
                  <td className="mono">{d.status_code ?? '—'}</td>
                  <td className="tnum">{d.attempts ?? '—'}</td>
                  <td>{timeAgo(d.created_at ?? null)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
