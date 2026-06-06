import { Button } from '../primitives'
import { useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  RowsIcon, PlusIcon, EditIcon, TrashIcon, CloseIcon, CheckIcon, InfoIcon,
} from '../components/icons'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

// ---- types ----

type EntityMeta = { key: string; label: string }

type SavedView = {
  id: string
  owner_user_id: string | null
  shared: boolean
  entity_key: string
  name: string
  config: {
    q?: string
    filter?: string
    sort?: string
    columns?: string[]
  }
  created_at: string | null
}

// ---- fetch helper ----

class FetchError extends Error {
  status: number
  constructor(msg: string, status: number) { super(msg); this.status = status }
}

async function jfetch(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Request failed' }))
    throw new FetchError(e.detail || `Error ${r.status}`, r.status)
  }
  if (r.status === 204) return null
  return r.json()
}

// ---- empty config factory ----
function emptyConfig() {
  return { q: '', filter: '', sort: '', columns: '' }
}

// ---- ViewsPane ----

export default function ViewsPane({ token }: { token: string }) {
  const [entities, setEntities] = useState<EntityMeta[]>([])
  const [entLoading, setEntLoading] = useState(true)
  const [entErr, setEntErr] = useState('')
  const [denied, setDenied] = useState(false)

  const [selectedEntity, setSelectedEntity] = useState<string>('')

  const [views, setViews] = useState<SavedView[]>([])
  const [viewsLoading, setViewsLoading] = useState(false)
  const [viewsErr, setViewsErr] = useState('')
  const [viewsDenied, setViewsDenied] = useState(false)

  // form state
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle')
  const [editId, setEditId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formShared, setFormShared] = useState(false)
  // config fields as editable strings
  const [formQ, setFormQ] = useState('')
  const [formFilter, setFormFilter] = useState('')
  const [formSort, setFormSort] = useState('')
  const [formColumns, setFormColumns] = useState('')   // comma-separated
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  // ---- load entities ----
  function loadEntities() {
    let alive = true
    setEntLoading(true); setEntErr(''); setDenied(false)
    jfetch(token, 'GET', '/meta/entities')
      .then((e: EntityMeta[]) => {
        if (!alive) return
        const list = Array.isArray(e) ? e : []
        setEntities(list)
        if (list.length) setSelectedEntity(list[0].key)
      })
      .catch((e: FetchError) => {
        if (!alive) return
        if (e.status === 403) setDenied(true)
        else setEntErr(e.message)
      })
      .finally(() => { if (alive) setEntLoading(false) })
    return () => { alive = false }
  }

  useEffect(loadEntities, [token])

  // ---- load views for selected entity ----
  function loadViews(entityKey: string) {
    if (!entityKey) { setViews([]); return }
    let alive = true
    setViewsLoading(true); setViewsErr(''); setViewsDenied(false); setViews([])
    jfetch(token, 'GET', `/api/views?entity=${encodeURIComponent(entityKey)}`)
      .then((v: SavedView[]) => { if (alive) setViews(Array.isArray(v) ? v : []) })
      .catch((e: FetchError) => {
        if (!alive) return
        if (e.status === 403) setViewsDenied(true)
        else setViewsErr(e.message)
      })
      .finally(() => { if (alive) setViewsLoading(false) })
    return () => { alive = false }
  }

  useEffect(() => { loadViews(selectedEntity) }, [token, selectedEntity])

  // ---- open create ----
  function openCreate() {
    setEditId(null)
    setFormName(''); setFormShared(false)
    const c = emptyConfig()
    setFormQ(c.q); setFormFilter(c.filter); setFormSort(c.sort); setFormColumns(c.columns)
    setSaveErr('')
    setMode('create')
  }

  // ---- open edit ----
  function openEdit(v: SavedView) {
    if (v.shared) return   // shared views not editable in this UI (backend 404s)
    setEditId(v.id)
    setFormName(v.name)
    setFormShared(false)
    setFormQ(v.config.q ?? '')
    setFormFilter(v.config.filter ?? '')
    setFormSort(v.config.sort ?? '')
    setFormColumns(Array.isArray(v.config.columns) ? v.config.columns.join(', ') : '')
    setSaveErr('')
    setMode('edit')
  }

  // ---- save ----
  async function save() {
    setSaving(true); setSaveErr('')
    const config: SavedView['config'] = {}
    if (formQ.trim()) config.q = formQ.trim()
    if (formFilter.trim()) config.filter = formFilter.trim()
    if (formSort.trim()) config.sort = formSort.trim()
    if (formColumns.trim()) config.columns = formColumns.split(',').map((c) => c.trim()).filter(Boolean)

    try {
      if (mode === 'create') {
        await jfetch(token, 'POST', '/api/views', {
          entity_key: selectedEntity,
          name: formName.trim(),
          config,
          shared: formShared,
        })
      } else {
        await jfetch(token, 'PATCH', `/api/views/${editId}`, {
          name: formName.trim(),
          config,
        })
      }
      setMode('idle')
      loadViews(selectedEntity)
    } catch (e) {
      setSaveErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ---- delete ----
  async function deleteView(v: SavedView) {
    if (!window.confirm(`Delete view "${v.name}"?`)) return
    try {
      await jfetch(token, 'DELETE', `/api/views/${v.id}`)
      loadViews(selectedEntity)
    } catch (e) {
      setViewsErr((e as Error).message)
    }
  }

  // ---- render ----

  if (entLoading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to view entities." />
  if (entErr) return <ErrorBanner message={entErr} onRetry={loadEntities} />

  return (
    <div>
      {/* header */}
      <div className="row" style={{ marginBottom: 'var(--gx-space-18)' }}>
        <div>
          <h3 style={{ margin: '0 0 var(--gx-space-2)' }}>Views</h3>
          <p className="hint" style={{ margin: 0 }}>Saved list views per entity — columns, sort, filter presets.</p>
        </div>
        <span className="spacer" />
        {mode === 'idle' && selectedEntity && (
          <Button variant="primary" size="sm"
            onClick={openCreate}>
            <PlusIcon size={13} /> New view
          </Button>
        )}
      </div>

      {/* entity picker */}
      <div style={{ marginBottom: 'var(--gx-space-8)' }}>
        <label className="field" style={{ maxWidth: 260 }}>
          <span>Entity</span>
          <select
            className="inp inp-md"
            value={selectedEntity}
            onChange={(e) => { setSelectedEntity(e.target.value); setMode('idle') }}
          >
            <option value=""></option>
            {entities.map((en) => (
              <option key={en.key} value={en.key}>{en.label}</option>
            ))}
          </select>
        </label>
      </div>

      {!selectedEntity && (
        <EmptyState
          icon={<RowsIcon size={40} />}
          title="Select an entity to manage its views."
        />
      )}

      {selectedEntity && mode === 'idle' && (
        <>
          {viewsLoading && <LoadingState />}
          {viewsDenied && <PermissionDenied message={`You don't have view permission for '${selectedEntity}'.`} />}
          {viewsErr && <ErrorBanner message={viewsErr} />}
          {!viewsLoading && !viewsDenied && !viewsErr && (
            <>
              {views.length === 0 ? (
                <EmptyState
                  icon={<RowsIcon size={40} />}
                  title="No saved views yet."
                  message="Create a view to save column/sort/filter presets for this entity."
                />
              ) : (
                <div className="grid-wrap">
                  <table className="grid studio">
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Scope</th>
                        <th scope="col">Search (q)</th>
                        <th scope="col">Filter</th>
                        <th scope="col">Sort</th>
                        <th scope="col">Columns</th>
                        <th scope="col">Created</th>
                        <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {views.map((v) => (
                        <tr key={v.id}>
                          <td>{v.name}</td>
                          <td>
                            <span style={{ fontSize: 'var(--gx-text-11)', opacity: 0.75 }}>
                              {v.shared ? 'Shared' : 'Personal'}
                            </span>
                          </td>
                          <td>{v.config.q ?? '—'}</td>
                          <td>{v.config.filter ?? '—'}</td>
                          <td>{v.config.sort ?? '—'}</td>
                          <td>
                            {Array.isArray(v.config.columns) && v.config.columns.length > 0
                              ? v.config.columns.join(', ')
                              : '—'}
                          </td>
                          <td style={{ fontSize: 'var(--gx-text-11)', opacity: 0.65 }}>
                            {v.created_at ? new Date(v.created_at).toLocaleDateString() : '—'}
                          </td>
                          <td>
                            <div className="row-actions">
                              {!v.shared && (
                                <>
                                  <Button variant="ghost" size="sm"
            aria-label="Edit view"
                                    onClick={() => openEdit(v)}
                                  >
                                    <EditIcon size={13} />
                                  </Button>
                                  <Button variant="ghost" size="sm"
            aria-label="Delete view"
                                    onClick={() => deleteView(v)}
                                  >
                                    <TrashIcon size={13} />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* create / edit form */}
      {(mode === 'create' || mode === 'edit') && (
        <div>
          <div className="section-head" style={{ marginTop: 0 }}>
            <EditIcon size={15} className="section-icon" />
            {mode === 'create' ? 'New view' : 'Edit view'}
            <span className="spacer" />
            <Button variant="ghost" size="sm"
            onClick={() => setMode('idle')}>
              <CloseIcon size={13} /> Cancel
            </Button>
          </div>

          {saveErr && <ErrorBanner message={saveErr} />}

          <div className="rec-form" style={{ marginBottom: 'var(--gx-space-8)' }}>
            <label className="field">
              <span>Name *</span>
              <input
                className="inp inp-md"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="My view name"
              />
            </label>

            {mode === 'create' && (
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
                <input
                  type="checkbox"
                  checked={formShared}
                  onChange={(e) => setFormShared(e.target.checked)}
                />
                <span>Shared (tenant-wide)</span>
              </label>
            )}
          </div>

          <div className="section-head">
            <RowsIcon size={15} className="section-icon" /> Config
          </div>

          <div className="rec-form" style={{ marginBottom: 'var(--gx-space-8)' }}>
            <label className="field">
              <span>Search (q)</span>
              <input
                className="inp inp-md"
                value={formQ}
                onChange={(e) => setFormQ(e.target.value)}
                placeholder="default search term"
              />
            </label>
            <label className="field">
              <span>Filter (GXL)</span>
              <input
                className="inp inp-md"
                value={formFilter}
                onChange={(e) => setFormFilter(e.target.value)}
                placeholder="status == 'OPEN'"
              />
            </label>
            <label className="field">
              <span>Sort</span>
              <input
                className="inp inp-md"
                value={formSort}
                onChange={(e) => setFormSort(e.target.value)}
                placeholder="-created_at"
              />
            </label>
            <label className="field">
              <span>Columns (comma-separated)</span>
              <input
                className="inp inp-md"
                value={formColumns}
                onChange={(e) => setFormColumns(e.target.value)}
                placeholder="name, status, created_at"
              />
            </label>
          </div>

          <div className="error-banner" style={{ margin: '0 0 var(--gx-space-7)', borderLeftColor: 'var(--gx-info)', background: 'var(--gx-info-soft)' }}>
            <div style={{ color: 'var(--gx-info)', flexShrink: 0, marginTop: 1 }}><InfoIcon size={15} /></div>
            <div className="error-banner-msg">
              All config fields are optional. Leave blank to inherit the list view defaults.
              Shared views have no owner and are visible to the whole tenant — they cannot be edited here after creation.
            </div>
          </div>

          <Button variant="gold" size="md"
            type="button"
            
            onClick={save}
            disabled={saving}>
            <CheckIcon size={14} /> {saving ? 'Saving…' : (mode === 'create' ? 'Create view' : 'Save changes')}
          </Button>
        </div>
      )}
    </div>
  )
}
