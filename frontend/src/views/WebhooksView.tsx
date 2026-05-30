import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import { MultiSelect } from '../components/Select'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import { confirmDialog } from '../components/Modal'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import {
  InfoIcon, ServerIcon, SearchIcon, PlusIcon, DownloadIcon,
  ArrowUpIcon, ArrowDownIcon, ChevronLeftIcon, ArrowRightIcon,
} from '../components/icons'
import { t } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'

// Webhooks admin (E12 /api/webhooks) — CRUD + per-webhook deliveries log + test. Degrades on 404.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Webhook = { id: string; name?: string; url?: string; events?: string[]; active?: boolean; secret?: string | null; created_at?: string | null }
type Delivery = { id: string; event?: string; status?: string | null; code?: number | null; created_at?: string | null; error?: string | null }
type Draft = { id?: string; name: string; url: string; events: string[]; active: boolean }

const EVENT_OPTIONS = ['create', 'update', 'delete', 'transition', 'comment', 'payment',
  'approval_requested', 'approval_approved', 'approval_rejected']
const EMPTY: Draft = { name: '', url: '', events: [], active: true }

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapWebhookStatus(w: Webhook): { label: string; variant: PillVariant } {
  if (w.active === false) return { label: 'disabled', variant: 'neutral' }
  return { label: 'enabled', variant: 'active' }
}
function mapDeliveryStatus(status: string | null | undefined, code?: number | null): { label: string; variant: PillVariant } {
  const ok = (typeof code === 'number' && code >= 200 && code < 300) || (status ?? '').toLowerCase() === 'success'
  const failed = (status ?? '').toLowerCase() === 'failed' || (typeof code === 'number' && code >= 400)
  const label = status ?? (code != null ? String(code) : '—')
  if (failed) return { label, variant: 'critical' }
  if (ok) return { label, variant: 'active' }
  return { label, variant: 'neutral' }
}

function MoreVerticalIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </svg>
  )
}

async function jfetch(token: string, path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...authH(token), ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } })
  let data: any = null
  try { data = await r.json() } catch { /* 204 / empty */ }
  return { r, data }
}

function maskSecret(secret: string | null | undefined) {
  if (!secret) return '—'
  return '••••' + secret.slice(-4)
}

export default function WebhooksView({ token, canConfigure = false, configVersion = 0 }: { token: string; canConfigure?: boolean; configVersion?: number }) {
  const cfg = usePageConfig(token, 'webhooks', configVersion)
  const [list, setList] = useState<Webhook[] | null>(null)
  const cf = useCustomFields(token, 'webhooks', cfg.customFields, (list ?? []).map((w) => w.id))
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null)

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
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
  useEffect(() => { setPage(1); setSelected(new Set()) }, [query, sortKey, sortDir])

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
        if (data?.secret) setNewSecret(data.secret)
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
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }
  function toggleRow(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function togglePageAll() {
    setSelected((s) => {
      const n = new Set(s)
      if (allOnPageSelected) pageRows.forEach((r) => n.delete(r.id))
      else pageRows.forEach((r) => n.add(r.id))
      return n
    })
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
              {canConfigure && (
                <button className="btn btn-ghost btn-sm" onClick={() => { console.log('[webhooks] configure'); toast.success('Configure page — wiring TBD') }}>Configure page</button>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => setDraft(draft ? null : { ...EMPTY })}>
                <PlusIcon size={13} /> {draft ? 'Close' : 'New webhook'}
              </button>
            </>
          )}
        />

        {all.length > 0 && (
          <div className="widgets" style={{ marginBottom: 18 }}>
            <div className="widget">
              <div className="widget-label">Endpoints</div>
              <div className="kpi">{all.length}</div>
              <div className="kpi-sub">{activeCount} enabled</div>
            </div>
            <div className="widget">
              <div className="widget-label">Enabled</div>
              <div className="kpi" style={{ color: 'var(--success)' }}>{activeCount}</div>
              <div className="kpi-sub">delivering events</div>
            </div>
            {disabledCount > 0 && (
              <div className="widget">
                <div className="widget-label">Disabled</div>
                <div className="kpi" style={{ color: 'var(--gx-text-3)' }}>{disabledCount}</div>
                <div className="kpi-sub">no deliveries</div>
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
            {selected.size > 0 && (
              <div className="bulkbar">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{selected.size} selected</span>
                <span className="spacer" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { console.log('[webhooks] bulk export', Array.from(selected)); toast.success(`Export queued for ${selected.size} webhook(s)`) }}
                >
                  <DownloadIcon size={13} /> Export
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Cancel</button>
              </div>
            )}

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
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { console.log('[webhooks] export all'); toast.success(`Export queued for ${sorted.length} webhook(s)`) }}
              >
                <DownloadIcon size={13} /> Export
              </button>
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input type="checkbox" checked={allOnPageSelected} onChange={togglePageAll} aria-label="Select all rows on this page" />
                    </th>
                    {cfg.columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        onClick={() => toggleSort(c.key)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {c.label}
                          {sortKey === c.key && (sortDir === 1 ? <ArrowUpIcon size={11} /> : <ArrowDownIcon size={11} />)}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((w) => (
                    <tr key={w.id} className={selected.has(w.id) ? 'sel' : ''}>
                      <td onClick={(e) => { e.stopPropagation(); toggleRow(w.id) }} style={{ cursor: 'default' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(w.id)}
                          onChange={() => toggleRow(w.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select webhook ${w.name ?? w.id.slice(0, 8)}`}
                        />
                      </td>
                      {cfg.columns.map((c) => {
                        let cell: React.ReactNode
                        switch (c.key) {
                          case 'name': cell = <strong>{w.name ?? '—'}</strong>; break
                          case 'url': cell = <span className="mono" title={w.url} style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>{w.url ?? '—'}</span>; break
                          case 'events': cell = <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>{(w.events ?? []).length ? (w.events ?? []).join(', ') : <span style={{ color: 'var(--gx-text-3)' }}>all</span>}</span>; break
                          case 'secret': cell = <span className="mono" style={{ fontSize: 12 }}>{maskSecret(w.secret)}</span>; break
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
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 32 }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => test(w)} title="Test webhook">Test</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setDeliveriesFor(w)} title="View deliveries">Log</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setDraft({ id: w.id, name: w.name ?? '', url: w.url ?? '', events: w.events ?? [], active: w.active !== false })}>Edit</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => remove(w)}>Delete</button>
                          <button
                            className="iconbtn"
                            aria-label="Row menu"
                            title="Row actions"
                            onClick={(e) => { e.stopPropagation(); console.log('[webhooks] row menu', w.id) }}
                          >
                            <MoreVerticalIcon size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + 2 + cfg.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching webhooks.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
                {sorted.length === 0
                  ? '0 webhooks'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeftIcon size={13} /> Prev
              </button>
              <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>Page {page} of {pageCount}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next <ArrowRightIcon size={13} />
              </button>
            </div>
          </div>
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
            {list.map((d) => {
              const sp = mapDeliveryStatus(d.status, d.code)
              return (
                <tr key={d.id}>
                  <td>{d.event ?? '—'}</td>
                  <td><StatusPill variant={sp.variant} label={sp.label} size="sm" /></td>
                  <td className="mono">{d.code ?? '—'}</td>
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
