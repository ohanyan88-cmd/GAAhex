// AuditLogPane — Studio-shaped pane for the Governance → Audit Logs leaf.
//
// Read-only viewer over the immutable Event log. Backend gates on `audit.view`
// (SuperAdmin-tier); a 403 surfaces as <PermissionDenied/>. Other errors →
// <ErrorBanner/>. Filters are server-side; pagination is offset/limit and we
// show "Load more" once the current page < total.
//
// Wiring (real, no mocks):
//   GET /api/audit-log?entity=&actor=&event_type=&since=&until=&limit=&offset=
//
// Each row is a single audit event:
//   - timestamp (relative + absolute via title)
//   - actor name (left-joined server-side; falls back to short UUID, then "system")
//   - StatusPill colour-coded by event type (create/update/transition/delete/...)
//   - entity_key + record_id suffix (short)
//   - expandable payload as a key:value diff list
//
// Light + dark via --gx-* tokens; zero raw hex. No emoji; inline lucide icons via
// the SVG wrapper set in components/icons.tsx.

import { Fragment, useCallback, useEffect, useState } from 'react'
import { Button, StatusPill } from '../primitives'
import {
  EmptyState, ErrorBanner, PermissionDenied, SkeletonRows,
} from '../components/States'
import {
  ChevronDownIcon, FilterIcon, RefreshIcon, ActivityIcon,
} from '../components/icons'
import { ChevronUp } from 'lucide-react'
import { bget } from '../lib/billing'
import { timeAgo } from '../lib/time'

// ---------------------------------------------------------------------------
// Types — mirror backend/app/routers/audit_log.py
// ---------------------------------------------------------------------------
type AuditEvent = {
  id: string
  type: string
  entity_key: string | null
  record_id: string | null
  actor_user_id: string | null
  actor_name: string | null
  data: unknown
  created_at: string | null
}

type AuditResp = { items: AuditEvent[]; total: number }

type EventTypeDef = { type: string; label: string }

// Fallback event-type catalog if /api/events/types is unavailable or returns 403.
// The audit log can have more event types than the executor catalogues (e.g.
// `feature_flag.update`, `webhook.delivery_failed`), so this is purely a
// dropdown-population fallback — it does NOT restrict what /audit-log returns.
const FALLBACK_EVENT_TYPES: EventTypeDef[] = [
  { type: 'create',     label: 'Create' },
  { type: 'update',     label: 'Update' },
  { type: 'transition', label: 'Transition' },
  { type: 'delete',     label: 'Delete' },
]

const PAGE_SIZE = 50

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

// Map an event type → StatusPill variant for consistent colour coding. Matches
// the convention used in StudioRichPanes.eventVariant — keep them in sync.
function eventVariant(type: string): PillVariant {
  if (type === 'delete' || type === 'action_failed' || type === 'approval_rejected') return 'critical'
  if (type === 'create' || type === 'approval_approved') return 'active'
  if (type === 'transition' || type === 'approval_requested') return 'degraded'
  if (type === 'update') return 'info'
  return 'neutral'
}

function actorLabel(ev: AuditEvent): string {
  if (ev.actor_name) return ev.actor_name
  if (ev.actor_user_id) return ev.actor_user_id.slice(0, 8)
  return 'system'
}

// Render an event's `data` payload as a compact key:value list. Nested objects
// are JSON-stringified so the row stays scannable. Honest "no payload" when
// data is null/undefined; honest "empty payload" when an empty object.
function PayloadDetail({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <div className="hint" style={{ fontSize: 'var(--gx-text-sm)' }}>No payload</div>
  }
  if (typeof data !== 'object') {
    return <div className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{String(data)}</div>
  }
  const entries = Object.entries(data as Record<string, unknown>)
  if (entries.length === 0) {
    return <div className="hint" style={{ fontSize: 'var(--gx-text-sm)' }}>Empty payload</div>
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--gx-space-2) var(--gx-space-6)', fontSize: 'var(--gx-text-sm)' }}>
      {entries.flatMap(([k, v]) => [
        <span key={`${k}-k`} className="mono" style={{ color: 'var(--gx-text-3)' }}>{k}</span>,
        <span key={`${k}-v`} className="mono" style={{ color: 'var(--gx-text-1)', wordBreak: 'break-word' }}>
          {v === null || v === undefined
            ? 'null'
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v)}
        </span>,
      ])}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------
export default function AuditLogPane({ token }: { token: string }) {
  const [items, setItems] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Filter inputs (user-edited) vs applied (what's actually in the query).
  const [filterEventType, setFilterEventType] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterActor, setFilterActor] = useState('')
  const [filterSince, setFilterSince] = useState('')
  const [filterUntil, setFilterUntil] = useState('')
  const [appliedType, setAppliedType] = useState('')
  const [appliedEntity, setAppliedEntity] = useState('')
  const [appliedActor, setAppliedActor] = useState('')
  const [appliedSince, setAppliedSince] = useState('')
  const [appliedUntil, setAppliedUntil] = useState('')

  // Event-type catalog for the dropdown (best-effort; falls back to fixed list).
  const [eventTypes, setEventTypes] = useState<EventTypeDef[]>(FALLBACK_EVENT_TYPES)

  useEffect(() => {
    if (!token) return
    let alive = true
    bget<EventTypeDef[]>(token, '/api/events/types').then(res => {
      if (!alive) return
      if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
        setEventTypes(res.data.map(t => ({ type: t.type, label: t.label })))
      }
    })
    return () => { alive = false }
  }, [token])

  const buildQuery = useCallback((offset: number): string => {
    const p = new URLSearchParams()
    p.set('limit', String(PAGE_SIZE))
    p.set('offset', String(offset))
    if (appliedType)   p.set('event_type', appliedType)
    if (appliedEntity) p.set('entity', appliedEntity)
    if (appliedActor)  p.set('actor', appliedActor)
    if (appliedSince)  p.set('since', `${appliedSince}T00:00:00Z`)
    if (appliedUntil)  p.set('until', `${appliedUntil}T23:59:59Z`)
    return p.toString()
  }, [appliedType, appliedEntity, appliedActor, appliedSince, appliedUntil])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError(''); setDenied(false); setExpanded(new Set())
    const res = await bget<AuditResp>(token, `/api/audit-log?${buildQuery(0)}`)
    if (res.status === 403) {
      setDenied(true); setItems([]); setTotal(0); setLoading(false); return
    }
    if (!res.ok || !res.data) {
      setError(`Failed to load audit log (HTTP ${res.status})`)
      setItems([]); setTotal(0); setLoading(false); return
    }
    setItems(Array.isArray(res.data.items) ? res.data.items : [])
    setTotal(typeof res.data.total === 'number' ? res.data.total : 0)
    setLoading(false)
  }, [token, buildQuery])

  useEffect(() => { load() }, [load])

  const loadMore = async () => {
    if (!token) return
    setLoadingMore(true)
    const res = await bget<AuditResp>(token, `/api/audit-log?${buildQuery(items.length)}`)
    if (res.ok && res.data && Array.isArray(res.data.items)) {
      setItems(prev => [...prev, ...res.data!.items])
      if (typeof res.data.total === 'number') setTotal(res.data.total)
    }
    setLoadingMore(false)
  }

  const applyFilters = () => {
    setAppliedType(filterEventType)
    setAppliedEntity(filterEntity.trim())
    setAppliedActor(filterActor.trim())
    setAppliedSince(filterSince)
    setAppliedUntil(filterUntil)
  }

  const clearFilters = () => {
    setFilterEventType(''); setFilterEntity(''); setFilterActor(''); setFilterSince(''); setFilterUntil('')
    setAppliedType('');    setAppliedEntity('');   setAppliedActor('');   setAppliedSince('');    setAppliedUntil('')
  }

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const filtersActive = !!(appliedType || appliedEntity || appliedActor || appliedSince || appliedUntil)

  // ---- header ----
  const header = (
    <div className="row" style={{ marginBottom: 'var(--gx-space-5)', alignItems: 'flex-end' }}>
      <div>
        <h3 style={{ margin: '0 0 var(--gx-space-2)' }}>Audit Logs</h3>
        <p className="hint" style={{ margin: 0 }}>
          Immutable record of every create / update / transition / delete across the tenant.
          Read-only; gated on <code className="mono">audit.view</code>.
        </p>
      </div>
      <span className="spacer" />
      <Button variant="ghost" size="md"
            type="button" 
        onClick={load} disabled={loading} aria-label="Refresh audit log"
        title="Refresh">
        <RefreshIcon size={13} /> Refresh
      </Button>
    </div>
  )

  // ---- filter bar ----
  const filterBar = (
    <div
      className="card"
      style={{
        padding: 'var(--gx-space-5)', marginBottom: 'var(--gx-space-4)',
        display: 'flex', gap: 'var(--gx-space-3)', flexWrap: 'wrap', alignItems: 'flex-end',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', marginRight: 'var(--gx-space-2)', color: 'var(--gx-text-3)' }}>
        <FilterIcon size={13} />
        <span className="hint" style={{ fontSize: 'var(--gx-text-11)' }}>Filters</span>
      </div>
      <label className="field" style={{ flex: '1 1 160px', minWidth: 140, margin: 0 }}>
        <span style={{ fontSize: 'var(--gx-text-11)' }}>Event type</span>
        <select
          className="inp inp-sm"
          value={filterEventType}
          onChange={e => setFilterEventType(e.target.value)}
        >
          <option value="">All types</option>
          {eventTypes.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
      </label>
      <label className="field" style={{ flex: '1 1 140px', minWidth: 120, margin: 0 }}>
        <span style={{ fontSize: 'var(--gx-text-11)' }}>Entity key</span>
        <input
          className="inp inp-sm mono"
          placeholder="e.g. customer"
          value={filterEntity}
          onChange={e => setFilterEntity(e.target.value)}
        />
      </label>
      <label className="field" style={{ flex: '1 1 160px', minWidth: 140, margin: 0 }}>
        <span style={{ fontSize: 'var(--gx-text-11)' }}>Actor (UUID)</span>
        <input
          className="inp inp-sm mono"
          placeholder="00000000-…"
          value={filterActor}
          onChange={e => setFilterActor(e.target.value)}
        />
      </label>
      <label className="field" style={{ flex: '1 1 130px', minWidth: 110, margin: 0 }}>
        <span style={{ fontSize: 'var(--gx-text-11)' }}>Since</span>
        <input
          className="inp inp-sm"
          type="date"
          value={filterSince}
          onChange={e => setFilterSince(e.target.value)}
        />
      </label>
      <label className="field" style={{ flex: '1 1 130px', minWidth: 110, margin: 0 }}>
        <span style={{ fontSize: 'var(--gx-text-11)' }}>Until</span>
        <input
          className="inp inp-sm"
          type="date"
          value={filterUntil}
          onChange={e => setFilterUntil(e.target.value)}
        />
      </label>
      <div style={{ display: 'flex', gap: 'var(--gx-space-3)' }}>
        <Button variant="primary" size="sm"
            type="button" onClick={applyFilters} disabled={loading}>
          Apply
        </Button>
        {filtersActive ? (
          <Button variant="ghost" size="sm"
            type="button" onClick={clearFilters} disabled={loading}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )

  // ---- states ----
  if (denied) {
    return (
      <div>
        {header}
        <PermissionDenied message="You need audit.view to read the governance audit trail." />
      </div>
    )
  }

  if (loading && items.length === 0) {
    return (
      <div>
        {header}
        {filterBar}
        <SkeletonRows rows={6} />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {header}
        {filterBar}
        <ErrorBanner message={error} onRetry={load} />
      </div>
    )
  }

  return (
    <div>
      {header}
      {filterBar}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--gx-space-3)' }}>
        <span className="hint" style={{ fontSize: 'var(--gx-text-11)', display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)' }}>
          <ActivityIcon size={12} />
          {filtersActive ? 'Filtered · ' : ''}{items.length} of {total} events
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No audit events"
          message={
            filtersActive
              ? 'No audit events match these filters.'
              : 'Audit events will appear here as users create, update, or transition records.'
          }
        />
      ) : (
        <>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Type</th>
                  <th>Entity</th>
                  <th>Record</th>
                  <th scope="col" className="actions-col"><span className="sr-only">Expand</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map(ev => {
                  const isOpen = expanded.has(ev.id)
                  return (
                    <Fragment key={ev.id}>
                      <tr
                        style={{ cursor: 'pointer' }}
                        onClick={() => toggleExpanded(ev.id)}
                        aria-expanded={isOpen}
                      >
                        <td>
                          <span
                            className="hint"
                            style={{ fontSize: 'var(--gx-text-11)' }}
                            title={ev.created_at ?? ''}
                          >
                            {timeAgo(ev.created_at)}
                          </span>
                        </td>
                        <td style={{ fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-semibold)', color: 'var(--gx-text-1)' }}>
                          {actorLabel(ev)}
                        </td>
                        <td>
                          <StatusPill variant={eventVariant(ev.type)} label={ev.type} size="sm" />
                        </td>
                        <td>
                          {ev.entity_key
                            ? <span className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>{ev.entity_key}</span>
                            : <span className="hint" style={{ fontSize: 'var(--gx-text-sm)' }}>—</span>}
                        </td>
                        <td>
                          {ev.record_id
                            ? (
                              <span
                                className="mono"
                                title={ev.record_id}
                                style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}
                              >
                                {ev.record_id.slice(0, 8)}
                              </span>
                            )
                            : <span className="hint" style={{ fontSize: 'var(--gx-text-sm)' }}>—</span>}
                        </td>
                        <td className="actions-col">
                          <Button variant="ghost" size="sm" iconOnly
            type="button"
                            
                            onClick={(e) => { e.stopPropagation(); toggleExpanded(ev.id) }}
                            aria-label={isOpen ? 'Collapse payload' : 'Expand payload'}
                          >
                            {isOpen ? <ChevronUp size={14} /> : <ChevronDownIcon size={14} />}
                          </Button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={6} style={{
                            background: 'var(--gx-surface-2)',
                            borderTop: '1px solid var(--gx-border-subtle)',
                            padding: 'var(--gx-space-4)',
                          }}>
                            <PayloadDetail data={ev.data} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {items.length < total && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--gx-space-7)' }}>
              <Button variant="secondary" size="sm"
            type="button"
                onClick={loadMore}
                disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load more (${total - items.length} remaining)`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
