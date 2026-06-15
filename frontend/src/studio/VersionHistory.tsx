// GAAhex Studio — Version History pane (Page versions + Audit log).
// Extracted from StudioRichPanes.tsx. Behavior unchanged.
// Tab 1 — Page versions: GET /api/studio/pages + /api/studio/pages/{id}/versions
//          with per-version diff expand and rollback.
// Tab 2 — Audit log: GET /api/audit-log (existing implementation, preserved as-is).
// The component name stays VersionHistory because RICH_PANE_MAP still routes
// "Versioning" / "Workflow Versions" / "Page Versioning" through it.

import { Button, StatusPill } from '../primitives'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { ChevronDown, ChevronUp, GitCommitHorizontal, RotateCcw } from 'lucide-react'
import { bget, bpost } from '../lib/billing'
import { timeAgo } from '../lib/time'
import { PermissionDenied, ErrorBanner, EmptyState, SkeletonRows } from '../components/States'
import { Sec, type StudioPage, type StudioVersion, type StudioDiff } from './_shared'

type AuditEvent = {
  id: string
  type: string
  entity_key: string | null
  record_id: string | null
  actor_user_id: string | null
  actor_name: string | null
  data: any
  created_at: string | null
}

type AuditResp = { items: AuditEvent[]; total: number }

// Fallback event-type catalog used if /api/events/types is unavailable or returns 403.
const FALLBACK_EVENT_TYPES: { type: string; label: string }[] = [
  { type: 'create', label: 'Create' },
  { type: 'update', label: 'Update' },
  { type: 'transition', label: 'Transition' },
  { type: 'delete', label: 'Delete' },
]

// Map an event type → StatusPill variant for consistent colour coding.
function eventVariant(type: string): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  if (type === 'delete' || type === 'action_failed' || type === 'approval_rejected')
    return 'critical'
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
// are JSON-stringified so the row stays scannable.
function DataDetail({ data }: { data: any }) {
  if (data === null || data === undefined) {
    return (
      <div className="hint" style={{ fontSize: 'var(--gx-text-sm)' }}>
        No payload
      </div>
    )
  }
  if (typeof data !== 'object') {
    return (
      <div className="mono" style={{ fontSize: 'var(--gx-text-sm)' }}>
        {String(data)}
      </div>
    )
  }
  const entries = Object.entries(data)
  if (entries.length === 0) {
    return (
      <div className="hint" style={{ fontSize: 'var(--gx-text-sm)' }}>
        Empty payload
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 'var(--gx-space-2) var(--gx-space-6)',
        fontSize: 'var(--gx-text-sm)',
      }}
    >
      {entries.flatMap(([k, v]) => [
        <span key={`${k}-k`} className="mono" style={{ color: 'var(--gx-text-3)' }}>
          {k}
        </span>,
        <span
          key={`${k}-v`}
          className="mono"
          style={{ color: 'var(--gx-text-1)', wordBreak: 'break-word' }}
        >
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

const PAGE_SIZE = 50

// ── Page versions sub-pane (tab 1 of VersionHistory) ─────────────────────────

function PageVersionsTab({ token }: { token?: string }) {
  const [pages, setPages] = useState<StudioPage[]>([])
  const [loadingPages, setLoadingPages] = useState(false)
  const [pagesErr, setPagesErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')

  const [versions, setVersions] = useState<StudioVersion[]>([])
  const [loadingVer, setLoadingVer] = useState(false)
  const [verErr, setVerErr] = useState<string | null>(null)

  // Per-version diff state: versionId → diff data or 'loading'
  const [diffs, setDiffs] = useState<Record<string, StudioDiff | 'loading' | 'error'>>({})
  const [expandedVer, setExpandedVer] = useState<Set<string>>(new Set())

  const [rollbackMsg, setRollbackMsg] = useState<string | null>(null)
  const [rollbackErr, setRollbackErr] = useState<string | null>(null)

  // Load page list
  useEffect(() => {
    if (!token) return
    let alive = true
    setLoadingPages(true)
    setPagesErr(null)
    bget<StudioPage[]>(token, '/api/studio/pages')
      .then((res) => {
        if (!alive) return
        if (!res.ok) {
          setPagesErr(`Failed to load pages (${res.status})`)
          setLoadingPages(false)
          return
        }
        setPages(Array.isArray(res.data) ? res.data : [])
        setLoadingPages(false)
      })
      .catch((e: Error) => {
        if (alive) {
          setPagesErr(e.message)
          setLoadingPages(false)
        }
      })
    return () => {
      alive = false
    }
  }, [token])

  // Load versions when page selected
  useEffect(() => {
    if (!token || !selectedId) {
      setVersions([])
      return
    }
    let alive = true
    setLoadingVer(true)
    setVerErr(null)
    setExpandedVer(new Set())
    setDiffs({})
    bget<StudioVersion[]>(token, `/api/studio/pages/${selectedId}/versions`)
      .then((res) => {
        if (!alive) return
        if (!res.ok) {
          setVerErr(`Failed to load versions (${res.status})`)
          setLoadingVer(false)
          return
        }
        setVersions(Array.isArray(res.data) ? res.data : [])
        setLoadingVer(false)
      })
      .catch((e: Error) => {
        if (alive) {
          setVerErr(e.message)
          setLoadingVer(false)
        }
      })
    return () => {
      alive = false
    }
  }, [token, selectedId])

  const toggleVersion = async (ver: StudioVersion) => {
    const id = ver.id
    const isOpen = expandedVer.has(id)
    setExpandedVer((prev) => {
      const next = new Set(prev)
      if (isOpen) next.delete(id)
      else next.add(id)
      return next
    })
    // Lazy-load diff when opening
    if (!isOpen && !diffs[id] && token && selectedId) {
      setDiffs((prev) => ({ ...prev, [id]: 'loading' }))
      try {
        const res = await bget<StudioDiff>(
          token,
          `/api/studio/pages/${selectedId}/versions/${id}/diff`,
        )
        setDiffs((prev) => ({ ...prev, [id]: res.ok && res.data ? res.data : 'error' }))
      } catch {
        setDiffs((prev) => ({ ...prev, [id]: 'error' }))
      }
    }
  }

  const rollback = async (ver: StudioVersion) => {
    if (!token || !selectedId) return
    if (
      !window.confirm(
        `Roll back to v${ver.version_no}? The current published version will be replaced.`,
      )
    )
      return
    try {
      await bpost(token, `/api/studio/pages/${selectedId}/versions/${ver.id}/rollback`)
      // Refresh versions
      const res = await bget<StudioVersion[]>(token, `/api/studio/pages/${selectedId}/versions`)
      if (res.ok && Array.isArray(res.data)) setVersions(res.data)
      setRollbackMsg(`Rolled back to v${ver.version_no}.`)
      setRollbackErr(null)
      setTimeout(() => setRollbackMsg(null), 4000)
    } catch (e) {
      setRollbackErr((e as Error).message || 'Rollback failed')
      setRollbackMsg(null)
      setTimeout(() => setRollbackErr(null), 4000)
    }
  }

  if (!token) {
    return (
      <div
        style={{
          padding: 'var(--gx-space-9) 0',
          textAlign: 'center',
          color: 'var(--gx-text-3)',
          fontSize: 'var(--gx-text-13)',
        }}
      >
        Sign in to view page versions.
      </div>
    )
  }

  // Find the current published version (first one with status === 'published')
  const publishedVer = versions.find((v) => v.status === 'published')

  return (
    <div>
      {/* Page picker */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--gx-space-5)',
          marginBottom: 'var(--gx-space-7)',
          flexWrap: 'wrap',
        }}
      >
        <label className="lbl" style={{ margin: 0, flexShrink: 0 }}>
          Page
        </label>
        {loadingPages ? (
          <span className="hint" style={{ fontSize: 'var(--gx-text-sm)' }}>
            Loading pages…
          </span>
        ) : pagesErr ? (
          <span style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-danger-fg)' }}>
            {pagesErr}
          </span>
        ) : pages.length === 0 ? (
          <span className="hint" style={{ fontSize: 'var(--gx-text-sm)' }}>
            No pages yet.
          </span>
        ) : (
          <select
            className="inp inp-sm"
            style={{ minWidth: 220 }}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">— select a page —</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.key})
              </option>
            ))}
          </select>
        )}
      </div>

      {rollbackErr && (
        <div
          className="banner"
          style={{
            marginBottom: 'var(--gx-space-5)',
            borderLeftColor: 'var(--gx-danger)',
            background: 'var(--gx-danger-soft)',
          }}
        >
          <div className="bm" style={{ color: 'var(--gx-danger-fg)' }}>
            {rollbackErr}
          </div>
        </div>
      )}
      {rollbackMsg && (
        <div
          className="banner"
          style={{
            marginBottom: 'var(--gx-space-5)',
            borderLeftColor: 'var(--gx-success)',
            background: 'var(--gx-success-soft)',
          }}
        >
          <div className="bm" style={{ color: 'var(--gx-success-fg)' }}>
            {rollbackMsg}
          </div>
        </div>
      )}

      {selectedId &&
        (loadingVer ? (
          <SkeletonRows rows={4} />
        ) : verErr ? (
          <ErrorBanner message={verErr} />
        ) : versions.length === 0 ? (
          <EmptyState title="No versions" message="No versions saved yet for this page." />
        ) : (
          <div className="timeline">
            {versions.map((ver) => {
              const isOpen = expandedVer.has(ver.id)
              const diff = diffs[ver.id]
              const isCurrentPublished = publishedVer?.id === ver.id
              return (
                <div
                  key={ver.id}
                  className="tl-item"
                  style={{
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    padding: 'var(--gx-space-5) 0',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleVersion(ver)}
                    aria-expanded={isOpen}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--gx-space-5)',
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'inherit',
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 'var(--gx-text-13)',
                        fontWeight: 'var(--gx-weight-semibold)',
                        color: 'var(--gx-text-1)',
                        minWidth: 36,
                      }}
                    >
                      v{ver.version_no}
                    </span>
                    <span
                      className={`pill ${ver.status === 'published' ? 'pill-success' : 'pill-neutral'}`}
                    >
                      {ver.status}
                    </span>
                    {ver.author_user_id && (
                      <span className="hint mono" style={{ fontSize: 'var(--gx-text-11)' }}>
                        {ver.author_user_id.slice(0, 8)}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span className="hint" style={{ fontSize: 'var(--gx-text-11)' }}>
                      {timeAgo(ver.created_at)}
                    </span>
                    {!isCurrentPublished && (
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          rollback(ver)
                        }}
                        title={`Rollback to v${ver.version_no}`}
                      >
                        <RotateCcw size={13} />
                        Rollback
                      </Button>
                    )}
                    {isOpen ? (
                      <ChevronUp size={14} style={{ color: 'var(--gx-text-3)' }} />
                    ) : (
                      <ChevronDown size={14} style={{ color: 'var(--gx-text-3)' }} />
                    )}
                  </button>
                  {isOpen && (
                    <div
                      style={{
                        marginTop: 'var(--gx-space-3)',
                        padding: 'var(--gx-space-5)',
                        background: 'var(--gx-surface-2)',
                        border: '1px solid var(--gx-border-subtle)',
                        borderRadius: 'var(--gx-radius-md)',
                        fontSize: 'var(--gx-text-sm)',
                      }}
                    >
                      {diff === 'loading' ? (
                        <span className="hint">Loading diff…</span>
                      ) : diff === 'error' ? (
                        <span style={{ color: 'var(--gx-danger-fg)' }}>Failed to load diff.</span>
                      ) : diff ? (
                        <div
                          style={{ display: 'flex', gap: 'var(--gx-space-6)', flexWrap: 'wrap' }}
                        >
                          {diff.added.length > 0 && (
                            <div>
                              <div
                                className="lbl"
                                style={{
                                  fontSize: 'var(--gx-text-10)',
                                  color: 'var(--gx-success)',
                                  marginBottom: 'var(--gx-space-2)',
                                }}
                              >
                                Added
                              </div>
                              {diff.added.map((k) => (
                                <div
                                  key={k}
                                  className="mono"
                                  style={{ color: 'var(--gx-success-fg)' }}
                                >
                                  + {k}
                                </div>
                              ))}
                            </div>
                          )}
                          {diff.changed.length > 0 && (
                            <div>
                              <div
                                className="lbl"
                                style={{
                                  fontSize: 'var(--gx-text-10)',
                                  color: 'var(--gx-warning)',
                                  marginBottom: 'var(--gx-space-2)',
                                }}
                              >
                                Changed
                              </div>
                              {diff.changed.map((k) => (
                                <div
                                  key={k}
                                  className="mono"
                                  style={{ color: 'var(--gx-warning-fg)' }}
                                >
                                  ~ {k}
                                </div>
                              ))}
                            </div>
                          )}
                          {diff.removed.length > 0 && (
                            <div>
                              <div
                                className="lbl"
                                style={{
                                  fontSize: 'var(--gx-text-10)',
                                  color: 'var(--gx-danger)',
                                  marginBottom: 'var(--gx-space-2)',
                                }}
                              >
                                Removed
                              </div>
                              {diff.removed.map((k) => (
                                <div
                                  key={k}
                                  className="mono"
                                  style={{ color: 'var(--gx-danger-fg)' }}
                                >
                                  - {k}
                                </div>
                              ))}
                            </div>
                          )}
                          {diff.added.length === 0 &&
                            diff.changed.length === 0 &&
                            diff.removed.length === 0 && (
                              <span className="hint">No changes recorded in this version.</span>
                            )}
                        </div>
                      ) : (
                        <span className="hint">No diff available.</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )
}

// ── Audit log sub-pane (tab 2 of VersionHistory) ─────────────────────────────

function AuditLogTab({ token }: { token?: string }) {
  const [items, setItems] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Filter inputs
  const [filterEventType, setFilterEventType] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterSince, setFilterSince] = useState('')
  const [appliedType, setAppliedType] = useState('')
  const [appliedEntity, setAppliedEntity] = useState('')
  const [appliedSince, setAppliedSince] = useState('')

  const [eventTypes, setEventTypes] =
    useState<{ type: string; label: string }[]>(FALLBACK_EVENT_TYPES)

  useEffect(() => {
    if (!token) return
    let alive = true
    bget<{ type: string; label: string }[]>(token, '/api/events/types').then((res) => {
      if (!alive) return
      if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
        setEventTypes(res.data.map((t) => ({ type: t.type, label: t.label })))
      }
    })
    return () => {
      alive = false
    }
  }, [token])

  const buildQuery = useCallback(
    (offset: number): string => {
      const p = new URLSearchParams()
      p.set('limit', String(PAGE_SIZE))
      p.set('offset', String(offset))
      if (appliedType) p.set('event_type', appliedType)
      if (appliedEntity) p.set('entity', appliedEntity)
      if (appliedSince) p.set('since', `${appliedSince}T00:00:00Z`)
      return p.toString()
    },
    [appliedType, appliedEntity, appliedSince],
  )

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    setDenied(false)
    setExpanded(new Set())
    const res = await bget<AuditResp>(token, `/api/audit-log?${buildQuery(0)}`)
    if (res.status === 403) {
      setDenied(true)
      setItems([])
      setTotal(0)
      setLoading(false)
      return
    }
    if (!res.ok || !res.data) {
      setError(`Failed to load audit log (${res.status})`)
      setItems([])
      setTotal(0)
      setLoading(false)
      return
    }
    setItems(Array.isArray(res.data.items) ? res.data.items : [])
    setTotal(typeof res.data.total === 'number' ? res.data.total : 0)
    setLoading(false)
  }, [token, buildQuery])

  useEffect(() => {
    load()
  }, [load])

  const loadMore = async () => {
    if (!token) return
    setLoadingMore(true)
    const res = await bget<AuditResp>(token, `/api/audit-log?${buildQuery(items.length)}`)
    if (res.ok && res.data && Array.isArray(res.data.items)) {
      setItems((prev) => [...prev, ...res.data!.items])
      if (typeof res.data.total === 'number') setTotal(res.data.total)
    }
    setLoadingMore(false)
  }

  const applyFilters = () => {
    setAppliedType(filterEventType)
    setAppliedEntity(filterEntity.trim())
    setAppliedSince(filterSince)
  }

  const clearFilters = () => {
    setFilterEventType('')
    setFilterEntity('')
    setFilterSince('')
    setAppliedType('')
    setAppliedEntity('')
    setAppliedSince('')
  }

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtersActive = appliedType || appliedEntity || appliedSince

  const filterBar = (
    <div
      className="card"
      style={{
        padding: 'var(--gx-space-5)',
        marginBottom: 'var(--gx-space-4)',
        display: 'flex',
        gap: 'var(--gx-space-3)',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
      }}
    >
      <label className="field" style={{ flex: '1 1 160px', minWidth: 140, margin: 0 }}>
        <span style={{ fontSize: 'var(--gx-text-11)' }}>Event type</span>
        <select
          className="inp inp-sm"
          value={filterEventType}
          onChange={(e) => setFilterEventType(e.target.value)}
        >
          <option value="">All types</option>
          {eventTypes.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field" style={{ flex: '1 1 160px', minWidth: 140, margin: 0 }}>
        <span style={{ fontSize: 'var(--gx-text-11)' }}>Entity</span>
        <input
          className="inp inp-sm mono"
          placeholder="e.g. customer"
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
        />
      </label>
      <label className="field" style={{ flex: '1 1 140px', minWidth: 120, margin: 0 }}>
        <span style={{ fontSize: 'var(--gx-text-11)' }}>Since</span>
        <input
          className="inp inp-sm"
          type="date"
          value={filterSince}
          onChange={(e) => setFilterSince(e.target.value)}
        />
      </label>
      <div style={{ display: 'flex', gap: 'var(--gx-space-3)' }}>
        <Button variant="primary" size="sm" type="button" onClick={applyFilters} disabled={loading}>
          Apply
        </Button>
        {filtersActive ? (
          <Button variant="ghost" size="sm" type="button" onClick={clearFilters} disabled={loading}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )

  if (!token) {
    return (
      <div
        style={{
          padding: 'var(--gx-space-9) 0',
          textAlign: 'center',
          color: 'var(--gx-text-3)',
          fontSize: 'var(--gx-text-13)',
        }}
      >
        Sign in to view the audit log.
      </div>
    )
  }

  if (denied)
    return (
      <PermissionDenied message="You do not have audit.view — required to read the governance audit trail." />
    )

  if (loading && items.length === 0)
    return (
      <>
        {filterBar}
        <SkeletonRows rows={6} />
      </>
    )

  if (error)
    return (
      <>
        {filterBar}
        <ErrorBanner message={error} onRetry={load} />
      </>
    )

  return (
    <>
      {filterBar}
      <div
        style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--gx-space-2)' }}
      >
        <span className="hint" style={{ fontSize: 'var(--gx-text-11)' }}>
          {loading ? '' : `${items.length} of ${total}`}
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
          <div className="timeline" style={{ minHeight: 160 }}>
            {items.map((ev) => {
              const isOpen = expanded.has(ev.id)
              const entitySuffix = ev.entity_key
                ? ev.record_id
                  ? `${ev.entity_key} · ${ev.record_id.slice(0, 8)}`
                  : ev.entity_key
                : null
              return (
                <div
                  key={ev.id}
                  className="tl-item"
                  style={{
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    padding: 'var(--gx-space-5) 0',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpanded(ev.id)}
                    aria-expanded={isOpen}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--gx-space-5)',
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'inherit',
                    }}
                  >
                    <StatusPill variant={eventVariant(ev.type)} label={ev.type} size="sm" />
                    <span
                      style={{
                        fontSize: 'var(--gx-text-13)',
                        fontWeight: 'var(--gx-weight-semibold)',
                        color: 'var(--gx-text-1)',
                      }}
                    >
                      {actorLabel(ev)}
                    </span>
                    {entitySuffix && (
                      <span
                        className="mono"
                        style={{ fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}
                      >
                        {entitySuffix}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span className="hint" style={{ fontSize: 'var(--gx-text-11)' }}>
                      {timeAgo(ev.created_at)}
                    </span>
                    {isOpen ? (
                      <ChevronUp size={14} style={{ color: 'var(--gx-text-3)' }} />
                    ) : (
                      <ChevronDown size={14} style={{ color: 'var(--gx-text-3)' }} />
                    )}
                  </button>
                  {isOpen && (
                    <div
                      style={{
                        marginTop: 'var(--gx-space-3)',
                        padding: 'var(--gx-space-5)',
                        background: 'var(--gx-surface-2)',
                        border: '1px solid var(--gx-border-subtle)',
                        borderRadius: 'var(--gx-radius-md)',
                      }}
                    >
                      <DataDetail data={ev.data} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {items.length < total && (
            <div
              style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--gx-space-7)' }}
            >
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : `Load more (${total - items.length} remaining)`}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}

// ── VersionHistory: top-level two-tab shell ────────────────────────────────────

export function VersionHistory() {
  const { token } = useAuth()
  const [tab, setTab] = useState<'versions' | 'audit'>('versions')

  return (
    <div>
      <Sec
        icon={<GitCommitHorizontal size={15} />}
        title="Version History"
        hint="page versions · audit log"
        right={
          <div className="seg">
            <button
              className={tab === 'versions' ? 'on' : ''}
              type="button"
              onClick={() => setTab('versions')}
            >
              Page versions
            </button>
            <button
              className={tab === 'audit' ? 'on' : ''}
              type="button"
              onClick={() => setTab('audit')}
            >
              Audit log
            </button>
          </div>
        }
      />
      {tab === 'versions' ? (
        <PageVersionsTab token={token ?? undefined} />
      ) : (
        <AuditLogTab token={token ?? undefined} />
      )}
    </div>
  )
}
