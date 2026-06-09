import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Modal } from '../components/Modal'
import { MultiSelect } from '../components/Select'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import { confirmDialog } from '../components/Modal'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import {
  InfoIcon, ServerIcon, GearIcon, EditIcon, TrashIcon, PlayIcon, ActivityIcon,
} from '../components/icons'
import RowActionsMenu, { type RowAction } from '../components/RowActionsMenu'  // TL-4
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { t } from '../lib/i18n'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { Button, KPITile, Pagination, StatusPill} from '../primitives'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'

// Webhooks admin (E12 /api/webhooks) — CRUD + per-webhook deliveries log + test. Degrades on 404.
import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

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

export default function WebhooksView({ canConfigure = false, configVersion = 0, onConfigure }: { canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
  const { token } = useAuth()
  const cfg = usePageConfig(token!, 'webhooks', configVersion)
  const [list, setList] = useState<Webhook[] | null>(null)
  const cf = useCustomFields('webhooks', cfg.customFields, (list ?? []).map((w) => w.id))
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
      const { r, data } = await jfetch(token!, '/api/webhooks')
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
        const { r, data } = await jfetch(token!, `/api/webhooks/${draft.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        if (!r.ok) throw new Error(data?.detail || `Save failed (${r.status})`)
        toast.success(t('webhooks.updated', 'Webhook updated'))
      } else {
        const { r, data } = await jfetch(token!, '/api/webhooks', { method: 'POST', body: JSON.stringify(body) })
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
      const { r, data } = await jfetch(token!, `/api/webhooks/${w.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(data?.detail || `Delete failed (${r.status})`)
      toast.success(t('webhooks.deleted', 'Webhook deleted'))
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function test(w: Webhook) {
    try {
      const { r, data } = await jfetch(token!, `/api/webhooks/${w.id}/test`, { method: 'POST' })
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

  const kpis: KPISpec[] = all.length > 0
    ? [
        { label: 'Endpoints', value: all.length, subtitle: `${activeCount} enabled`, onClick: () => setQuery('') },
        { label: 'Enabled', value: activeCount, subtitle: 'delivering events', onClick: () => setQuery('enabled') },
        ...(disabledCount > 0 ? [{ label: 'Disabled', value: disabledCount, subtitle: 'no deliveries', muted: true, onClick: () => setQuery('disabled') }] : []),
      ]
    : []

  return (
    <PageShell
      type="CONFIGURATION"
      breadcrumb={['Admin Panel', 'Integrations']}
      icon={<ServerIcon size={18} />}
      title="Integrations"
      subtitle="Webhook endpoints & external API connections"
      kpis={kpis}
      primaryAction={!unavailable && canConfigure ? {
        label: draft ? 'Close' : 'New webhook',
        onClick: () => setDraft(draft ? null : { ...EMPTY }),
        icon: draft ? undefined : <Plus size={14} />,
      } : undefined}
      secondaryActions={!unavailable && canConfigure && onConfigure ? [
        { label: 'Configure', onClick: onConfigure, icon: <GearIcon size={13} /> },
      ] : undefined}
      // TL-5 — search lifts into PageShell zone D.
      filters={{ search: { value: query, onChange: setQuery, placeholder: 'Search webhooks' } }}
    >

        {draft && (
          <div className="rec-form">
            <label className="field"><span>Name *</span><input className="inp inp-md" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Billing events → CRM" /></label>
            <label className="field"><span>URL *</span><input className="inp inp-md" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://example.com/hook" /></label>
            <label className="field"><span>Events</span><MultiSelect value={draft.events} options={EVENT_OPTIONS} onChange={(v) => setDraft({ ...draft, events: v })} /></label>
            <label className="field"><span>Active</span><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /></label>
            <div className="rec-form-actions"><Button variant="primary" size="md" onClick={save} disabled={!draft.name.trim() || !draft.url.trim()}>{draft.id ? 'Save' : 'Create'}</Button></div>
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
            {/* TL-5 — search lifted to PageShell zone D. */}
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-2)' }}>
                          {c.label}
                          {sortKey === c.key
                            // D18: active sort indicator = azure (interactive cue)
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-interactive)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-interactive)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((w) => (
                    <tr key={w.id}>
                      {cfg.columns.map((c) => {
                        let cell: React.ReactNode
                        switch (c.key) {
                          case 'name': cell = <strong>{w.name ?? '—'}</strong>; break
                          case 'url': cell = <span className="mono" title={w.url} style={{ color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-sm)' }}>{w.url ?? '—'}</span>; break
                          case 'events': cell = <span style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)' }}>{(w.events ?? []).length ? (w.events ?? []).join(', ') : <span style={{ color: 'var(--gx-text-3)' }}>all</span>}</span>; break
                          case 'secret': cell = w.has_secret
                            ? <StatusPill variant="active" label="signed" size="sm" />
                            : <span style={{ color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-sm)' }}>none</span>
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
                      <td className="actions-col" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        {/* TL-4 — 4 inline ghost buttons (Log/Test/Edit/Delete) → canonical RowActionsMenu.
                            Log stays inline as the primary shortcut; the rest collapse into the kebab. */}
                        {(() => {
                          const actions: RowAction[] = []
                          if (canConfigure) {
                            actions.push({ key: 'test',   label: 'Test webhook', icon: <PlayIcon size={14} />, onClick: () => test(w) })
                            actions.push({ key: 'edit',   label: 'Edit',         icon: <EditIcon size={14} />, onClick: () => setDraft({ id: w.id, name: w.name ?? '', url: w.url ?? '', events: w.events ?? [], active: w.active !== false }) })
                            actions.push({ key: 'delete', label: 'Delete',       icon: <TrashIcon size={14} />, danger: true, onClick: () => remove(w) })
                          }
                          return (
                            <RowActionsMenu
                              primary={{ key: 'log', label: 'View deliveries', icon: <ActivityIcon size={14} />, onClick: () => setDeliveriesFor(w) }}
                              actions={actions}
                              ariaLabel="Webhook actions"
                            />
                          )
                        })()}
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + 1 + cfg.customFields.length} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                        No matching webhooks.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={sorted.length}
              onChange={setPage}
            />
          </div>
        )}

        {deliveriesFor && (
          <DeliveriesModal webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
        )}
    </PageShell>
  )
}

function DeliveriesModal({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const { token } = useAuth()
  const [list, setList] = useState<Delivery[] | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setError(''); setList(null)
    try {
      const { r, data } = await jfetch(token!, `/api/webhooks/${webhook.id}/deliveries`)
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
                    {d.error && <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', marginTop: 'var(--gx-space-1)' }} title={d.error}>{d.error.length > 60 ? d.error.slice(0, 60) + '…' : d.error}</div>}
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
