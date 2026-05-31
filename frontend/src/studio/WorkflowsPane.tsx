import { useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  ArrowRightIcon, PlusIcon, CloseIcon, CheckIcon, InfoIcon, RowsIcon, TrashIcon, ChartIcon, EditIcon,
} from '../components/icons'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: 'Bearer ' + token })

class FetchError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function apiFetch(token: string, path: string, opts?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...authH(token), 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Request failed' }))
    throw new FetchError(e.detail || `HTTP ${r.status}`, r.status)
  }
  if (r.status === 204) return null
  return r.json()
}

type EntitySummary = { key: string; label: string; label_plural: string; route_slug: string }
type StatusDef = { key: string; label: string; is_initial: boolean; order: number }
type TransitionDef = { from: string | null; to: string; guard?: string | null }

function upd<T>(setter: (v: T[]) => void, arr: T[], i: number, patch: Partial<T>) {
  setter(arr.map((row, j) => (j === i ? { ...row, ...patch } : row)))
}

// ---------------------------------------------------------------------------
// Add-status form
// ---------------------------------------------------------------------------
function AddStatusForm({
  slug, token, onAdded,
}: { slug: string; token: string; onAdded: () => void }) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [isInitial, setIsInitial] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!key.trim()) { setErr('Status key is required'); return }
    setSaving(true); setErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/statuses`, {
        method: 'POST',
        body: JSON.stringify({ key: key.trim(), label: label.trim() || key.trim(), is_initial: isInitial }),
      })
      setKey(''); setLabel(''); setIsInitial(false)
      onAdded()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12 }}>
      {err && <ErrorBanner message={err} />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 130px' }}>
          <span>Key (UPPER_SNAKE) *</span>
          <input className="inp inp-sm" value={key} onChange={(e) => setKey(e.target.value)} placeholder="OPEN" autoFocus />
        </label>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span>Label</span>
          <input className="inp inp-sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Open" />
        </label>
        <label className="field" style={{ flex: '0 0 72px' }}>
          <span>Initial</span>
          <input type="checkbox" checked={isInitial} onChange={(e) => setIsInitial(e.target.checked)} style={{ marginTop: 8 }} />
        </label>
        <div style={{ paddingBottom: 2 }}>
          <button type="submit" className="btn btn-accent btn-sm" disabled={saving}>
            <CheckIcon size={13} /> {saving ? 'Saving…' : 'Add status'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Inline edit row for a status (rename label + toggle initial)
// Saved via PATCH /meta/entities/{slug}/statuses/{statusKey}
// ---------------------------------------------------------------------------
function EditStatusRow({
  slug, token, status, onDone,
}: { slug: string; token: string; status: StatusDef; onDone: () => void }) {
  const [label, setLabel] = useState(status.label)
  const [isInitial, setIsInitial] = useState(status.is_initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/statuses/${status.key}`, {
        method: 'PATCH',
        body: JSON.stringify({ label: label.trim() || status.key, is_initial: isInitial }),
      })
      onDone()
    } catch (ex) {
      setErr((ex as Error).message)
      setSaving(false)
    }
  }

  return (
    <>
      {err && (
        <tr>
          <td colSpan={5}><ErrorBanner message={err} /></td>
        </tr>
      )}
      <tr style={{ background: 'var(--gx-surface-2)' }}>
        {/* Order column — empty while editing */}
        <td></td>
        <td><code className="mono">{status.key}</code></td>
        <td>
          <input
            className="inp inp-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </td>
        <td>
          <input
            type="checkbox"
            checked={isInitial}
            onChange={(e) => setIsInitial(e.target.checked)}
          />
        </td>
        <td>
          <div className="row-actions">
            <button type="button" className="btn btn-accent btn-sm" onClick={save} disabled={saving}>
              <CheckIcon size={13} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDone} disabled={saving}>
              <CloseIcon size={13} />
            </button>
          </div>
        </td>
      </tr>
    </>
  )
}

// ---------------------------------------------------------------------------
// Transitions editor — full replace (PUT)
// ---------------------------------------------------------------------------
function TransitionsEditor({
  slug, token, statuses, initialTransitions, onSaved,
}: {
  slug: string
  token: string
  statuses: StatusDef[]
  initialTransitions: TransitionDef[]
  onSaved: () => void
}) {
  const [rows, setRows] = useState<TransitionDef[]>(
    initialTransitions.map((t) => ({ from: t.from ?? null, to: t.to, guard: t.guard ?? '' }))
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)

  const statusKeys = statuses.map((s) => s.key)

  async function save() {
    setSaving(true); setErr(''); setOk(false)
    try {
      await apiFetch(token, `/meta/entities/${slug}/transitions`, {
        method: 'PUT',
        body: JSON.stringify({
          transitions: rows
            .filter((r) => r.to)
            .map((r) => ({ from: r.from || null, to: r.to, guard: (r.guard as string)?.trim() || null })),
        }),
      })
      setOk(true)
      onSaved()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {err && <ErrorBanner message={err} />}
      {ok && (
        <div className="error-banner" style={{ marginBottom: 12, borderLeftColor: 'var(--gx-success)', background: 'var(--gx-success-soft)' }}>
          <div style={{ color: 'var(--gx-success)', flexShrink: 0, marginTop: 1 }}><CheckIcon size={16} /></div>
          <div>
            <div className="error-banner-title" style={{ color: 'var(--gx-text-1)' }}>Transitions saved</div>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="hint" style={{ marginBottom: 8 }}>No transitions defined. Add one below.</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Guard (GXL, optional)</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={i}>
                  <td>
                    <select
                      className="inp inp-sm"
                      value={t.from ?? ''}
                      onChange={(e) => upd(setRows, rows, i, { from: e.target.value || null })}
                    >
                      <option value="">(entry / initial)</option>
                      {statusKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      className="inp inp-sm"
                      value={t.to}
                      onChange={(e) => upd(setRows, rows, i, { to: e.target.value })}
                    >
                      <option value=""></option>
                      {statusKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      className="inp inp-sm"
                      value={(t.guard as string) ?? ''}
                      placeholder="phone != None"
                      onChange={(e) => upd(setRows, rows, i, { guard: e.target.value })}
                    />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label="Delete transition"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRows([...rows, { from: null, to: '', guard: '' }])}
        >
          <PlusIcon size={13} /> Add transition
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-accent btn-sm" onClick={save} disabled={saving}>
          <CheckIcon size={13} /> {saving ? 'Saving…' : 'Save transitions'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------
export default function WorkflowsPane({ token, initialSlug, lockEntity }: { token: string; initialSlug?: string; lockEntity?: boolean }) {
  const [entities, setEntities] = useState<EntitySummary[]>([])
  const [entLoading, setEntLoading] = useState(true)
  const [entError, setEntError] = useState('')
  const [entDenied, setEntDenied] = useState(false)

  const [slug, setSlug] = useState<string | null>(initialSlug ?? null)

  const [statuses, setStatuses] = useState<StatusDef[]>([])
  const [transitions, setTransitions] = useState<TransitionDef[]>([])
  const [wfLoading, setWfLoading] = useState(false)
  const [wfError, setWfError] = useState('')
  const [wfDenied, setWfDenied] = useState(false)

  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [editingStatusKey, setEditingStatusKey] = useState<string | null>(null)
  const [deleteErr, setDeleteErr] = useState('')
  const [showAddStatus, setShowAddStatus] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [reorderErr, setReorderErr] = useState('')

  // Load entity list
  function loadEntities() {
    let alive = true
    setEntLoading(true); setEntError(''); setEntDenied(false)
    apiFetch(token, '/meta/entities')
      .then((d: EntitySummary[]) => {
        if (!alive) return
        const list = Array.isArray(d) ? d : []
        setEntities(list)
        if (list.length && !slug) setSlug(list[0].route_slug)
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setEntDenied(true)
        else setEntError((ex as Error).message)
      })
      .finally(() => { if (alive) setEntLoading(false) })
    return () => { alive = false }
  }

  // Load statuses + transitions for selected entity
  function loadWorkflow(s: string) {
    let alive = true
    setWfLoading(true); setWfError(''); setWfDenied(false)
    setStatuses([]); setTransitions([]); setShowAddStatus(false); setDeleteErr(''); setEditingStatusKey(null)
    apiFetch(token, `/meta/entities/${s}`)
      .then((d: { statuses: StatusDef[]; transitions: TransitionDef[] }) => {
        if (!alive) return
        setStatuses(d.statuses ?? [])
        setTransitions(d.transitions ?? [])
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setWfDenied(true)
        else setWfError((ex as Error).message)
      })
      .finally(() => { if (alive) setWfLoading(false) })
    return () => { alive = false }
  }

  useEffect(() => { loadEntities() }, [token])
  useEffect(() => { if (slug) loadWorkflow(slug) }, [token, slug])

  async function deleteStatus(key: string) {
    if (!slug) return
    setDeletingKey(key); setDeleteErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/statuses/${key}`, { method: 'DELETE' })
      loadWorkflow(slug)
    } catch (ex) {
      setDeleteErr((ex as Error).message)
    } finally {
      setDeletingKey(null)
    }
  }

  async function moveStatus(fromIdx: number, toIdx: number) {
    if (!slug || reordering) return
    const reordered = [...statuses]
    const [item] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, item)
    setStatuses(reordered)
    setReordering(true); setReorderErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/statuses/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ order: reordered.map((s) => s.key) }),
      })
    } catch (ex) {
      setReorderErr((ex as Error).message)
      loadWorkflow(slug) // restore server order on failure
    } finally {
      setReordering(false)
    }
  }

  // --- render ---
  if (entLoading) return <LoadingState />
  if (entDenied) return <PermissionDenied message="You don't have permission to manage workflows." />
  if (entError) return <ErrorBanner message={entError} onRetry={loadEntities} />

  return (
    <div>
      {/* header */}
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Statuses / Workflows</h3>
          <p className="hint" style={{ margin: 0 }}>
            Define lifecycle stages and allowed transitions. The WorkItem engine enforces them at runtime.
          </p>
        </div>
      </div>

      {/* entity picker */}
      {entities.length === 0 ? (
        <EmptyState title="No entities found." message="Create an entity first via the Entities pane." />
      ) : (
        <>
          {!lockEntity && (
            <>
              <div className="section-head" style={{ marginTop: 0 }}>
                <RowsIcon size={15} className="section-icon" /> Entity
              </div>
              <div style={{ marginBottom: 16 }}>
                <select
                  className="inp inp-md"
                  style={{ maxWidth: 280 }}
                  value={slug ?? ''}
                  onChange={(e) => setSlug(e.target.value)}
                >
                  {entities.map((e) => (
                    <option key={e.route_slug} value={e.route_slug}>
                      {e.label_plural || e.label} ({e.route_slug})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {slug && (
            <>
              {wfLoading && <LoadingState />}
              {wfDenied && <PermissionDenied />}
              {wfError && <ErrorBanner message={wfError} onRetry={() => loadWorkflow(slug)} />}

              {!wfLoading && !wfDenied && !wfError && (
                <>
                  {/* Statuses */}
                  <div className="section-head">
                    <ArrowRightIcon size={15} className="section-icon" /> Statuses
                    <span className="spacer" />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setShowAddStatus((v) => !v)}
                    >
                      <PlusIcon size={13} /> Add status
                    </button>
                  </div>

                  {deleteErr && <ErrorBanner message={deleteErr} />}
                  {reorderErr && <ErrorBanner message={reorderErr} />}

                  {statuses.length === 0 ? (
                    <EmptyState
                      title="No statuses yet."
                      message="Add statuses to enable a workflow for this entity."
                    />
                  ) : (
                    <div className="grid-wrap">
                      <table className="grid studio">
                        <thead>
                          <tr>
                            <th scope="col">Order</th>
                            <th scope="col">Key</th>
                            <th scope="col">Label</th>
                            <th scope="col">Initial</th>
                            <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {statuses.map((st, i) =>
                            editingStatusKey === st.key ? (
                              <EditStatusRow
                                key={st.key}
                                slug={slug}
                                token={token}
                                status={st}
                                onDone={() => { setEditingStatusKey(null); loadWorkflow(slug) }}
                              />
                            ) : (
                              <tr key={st.key}>
                                <td>
                                  <div className="row-actions">
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      aria-label="Move up"
                                      disabled={i === 0 || reordering}
                                      onClick={() => moveStatus(i, i - 1)}
                                      title="Move up"
                                    >
                                      &#8593;
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      aria-label="Move down"
                                      disabled={i === statuses.length - 1 || reordering}
                                      onClick={() => moveStatus(i, i + 1)}
                                      title="Move down"
                                    >
                                      &#8595;
                                    </button>
                                  </div>
                                </td>
                                <td><code className="mono">{st.key}</code></td>
                                <td>{st.label}</td>
                                <td>{st.is_initial ? <CheckIcon size={14} /> : <span className="hint">—</span>}</td>
                                <td>
                                  <div className="row-actions">
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      aria-label={`Edit status ${st.key}`}
                                      disabled={!!editingStatusKey}
                                      onClick={() => { setEditingStatusKey(st.key); setShowAddStatus(false) }}
                                    >
                                      <EditIcon size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      aria-label={`Delete status ${st.key}`}
                                      disabled={deletingKey === st.key || !!editingStatusKey}
                                      onClick={() => deleteStatus(st.key)}
                                    >
                                      <TrashIcon size={13} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {showAddStatus && (
                    <AddStatusForm
                      slug={slug}
                      token={token}
                      onAdded={() => { setShowAddStatus(false); loadWorkflow(slug) }}
                    />
                  )}

                  {/* Transitions */}
                  <div className="section-head" style={{ marginTop: 24 }}>
                    <ChartIcon size={15} className="section-icon" /> Transitions
                  </div>

                  {statuses.length === 0 ? (
                    <p className="hint">Add statuses before defining transitions.</p>
                  ) : (
                    <TransitionsEditor
                      slug={slug}
                      token={token}
                      statuses={statuses}
                      initialTransitions={transitions}
                      onSaved={() => loadWorkflow(slug)}
                    />
                  )}

                  <div className="error-banner" style={{ margin: '20px 0 4px', borderLeftColor: 'var(--gx-info)', background: 'var(--gx-info-soft)' }}>
                    <div style={{ color: 'var(--gx-info)', flexShrink: 0, marginTop: 1 }}><InfoIcon size={16} /></div>
                    <div>
                      <div className="error-banner-title" style={{ color: 'var(--gx-text-1)' }}>Transitions are replaced atomically</div>
                      <div className="error-banner-msg">
                        Saving the transition list replaces all edges in one call. Remove all dangling references before deleting a status.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
