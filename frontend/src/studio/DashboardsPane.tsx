import { Button } from '../primitives'
import { useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  ChartIcon, PlusIcon, EditIcon, TrashIcon, CloseIcon, CheckIcon, InfoIcon,
} from '../components/icons'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

// ---- types ----

type EntityMeta = { key: string; label: string }

type BoardSummary = { key: string; label: string; description?: string | null; order: number }

type WidgetQuery = {
  entity: string
  metric: 'count' | 'sum' | 'avg'
  field?: string
  group_by?: string
  filter?: string
}

type Widget = { key: string; label: string; type: string; order: number; query: WidgetQuery }

type BoardDetail = BoardSummary & { widgets: Widget[] }

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

// ---- row updater helper ----
function upd<T>(setter: (v: T[]) => void, arr: T[], i: number, patch: Partial<T>) {
  setter(arr.map((row, j) => (j === i ? { ...row, ...patch } : row)))
}

// ---- empty widget factory ----
function emptyWidget(): Widget {
  return { key: '', label: '', type: 'kpi', order: 0, query: { entity: '', metric: 'count', field: '', group_by: '', filter: '' } }
}

// ---- DashboardsPane ----

export default function DashboardsPane({ token }: { token: string }) {
  const [entities, setEntities] = useState<EntityMeta[]>([])
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [loadErr, setLoadErr] = useState('')

  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<BoardDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErr, setDetailErr] = useState('')

  // edit / create form
  const [mode, setMode] = useState<'idle' | 'edit' | 'create'>('idle')
  const [formKey, setFormKey] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formOrder, setFormOrder] = useState(0)
  const [formWidgets, setFormWidgets] = useState<Widget[]>([])
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  // ---- load boards + entities ----
  function loadAll() {
    let alive = true
    setLoading(true); setLoadErr(''); setDenied(false)
    Promise.all([
      jfetch(token, 'GET', '/dashboards'),
      jfetch(token, 'GET', '/meta/entities'),
    ])
      .then(([b, e]) => {
        if (!alive) return
        setBoards(Array.isArray(b) ? b : [])
        setEntities(Array.isArray(e) ? e : [])
        if (Array.isArray(b) && b.length) setSelected(b[0].key)
      })
      .catch((e: FetchError) => {
        if (!alive) return
        if (e.status === 403) setDenied(true)
        else setLoadErr(e.message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }

  useEffect(loadAll, [token])

  // ---- load board detail on selection ----
  useEffect(() => {
    if (!selected) { setDetail(null); return }
    let alive = true
    setDetailLoading(true); setDetailErr(''); setDetail(null)
    jfetch(token, 'GET', `/dashboards/${selected}`)
      .then((d: BoardDetail) => { if (alive) setDetail(d) })
      .catch((e: FetchError) => { if (alive) setDetailErr(e.message) })
      .finally(() => { if (alive) setDetailLoading(false) })
    return () => { alive = false }
  }, [token, selected])

  // ---- open edit form ----
  function openEdit() {
    if (!detail) return
    setFormKey(detail.key)
    setFormLabel(detail.label)
    setFormDesc(detail.description ?? '')
    setFormOrder(detail.order)
    setFormWidgets(detail.widgets.map((w) => ({
      ...w,
      query: {
        entity: w.query?.entity ?? '',
        metric: (w.query?.metric ?? 'count') as Widget['query']['metric'],
        field: w.query?.field ?? '',
        group_by: w.query?.group_by ?? '',
        filter: w.query?.filter ?? '',
      },
    })))
    setSaveErr('')
    setMode('edit')
  }

  // ---- open create form ----
  function openCreate() {
    setFormKey(''); setFormLabel(''); setFormDesc(''); setFormOrder(0)
    setFormWidgets([])
    setSaveErr('')
    setMode('create')
  }

  // ---- save (create or patch) ----
  async function save() {
    setSaving(true); setSaveErr('')
    const widgets = formWidgets.map((w, i) => ({
      key: w.key.trim(),
      label: w.label.trim() || w.key.trim(),
      type: w.type,
      order: i + 1,
      query: {
        entity: w.query.entity.trim(),
        metric: w.query.metric,
        ...(w.query.field?.trim() ? { field: w.query.field.trim() } : {}),
        ...(w.query.group_by?.trim() ? { group_by: w.query.group_by.trim() } : {}),
        ...(w.query.filter?.trim() ? { filter: w.query.filter.trim() } : {}),
      },
    }))
    try {
      if (mode === 'create') {
        await jfetch(token, 'POST', '/dashboards', {
          key: formKey.trim(), label: formLabel.trim(),
          description: formDesc.trim() || null, order: formOrder, widgets,
        })
      } else {
        await jfetch(token, 'PATCH', `/dashboards/${selected}`, {
          label: formLabel.trim(),
          description: formDesc.trim() || null,
          order: formOrder, widgets,
        })
      }
      setMode('idle')
      const newKey = mode === 'create' ? formKey.trim() : selected!
      // reload list then set selection
      const b: BoardSummary[] = await jfetch(token, 'GET', '/dashboards')
      setBoards(b)
      setSelected(newKey)
    } catch (e) {
      setSaveErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ---- delete ----
  async function deleteBoard() {
    if (!selected || !window.confirm('Delete this dashboard?')) return
    try {
      await jfetch(token, 'DELETE', `/dashboards/${selected}`)
      const b: BoardSummary[] = await jfetch(token, 'GET', '/dashboards')
      setBoards(b)
      setSelected(b.length ? b[0].key : null)
      setMode('idle')
    } catch (e) {
      setDetailErr((e as Error).message)
    }
  }

  // ---- render ----

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to manage dashboards." />
  if (loadErr) return <ErrorBanner message={loadErr} onRetry={loadAll} />

  return (
    <div>
      {/* header */}
      <div className="row" style={{ marginBottom: 'var(--gx-space-18)' }}>
        <div>
          <h3 style={{ margin: '0 0 var(--gx-space-2)' }}>Dashboards</h3>
          <p className="hint" style={{ margin: 0 }}>Define boards and their config-driven widgets.</p>
        </div>
        <span className="spacer" />
        {mode === 'idle' && (
          <Button variant="primary" size="sm"
            onClick={openCreate}>
            <PlusIcon size={13} /> New dashboard
          </Button>
        )}
      </div>

      {/* board tabs */}
      {boards.length > 0 && mode === 'idle' && (
        <div className="tabs" style={{ marginBottom: 'var(--gx-space-8)' }}>
          {boards.map((b) => (
            <button
              key={b.key}
              className={'tab' + (selected === b.key ? ' on' : '')}
              onClick={() => { setSelected(b.key); setMode('idle') }}
              title={b.description ?? ''}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {boards.length === 0 && mode === 'idle' && (
        <EmptyState
          icon={<ChartIcon size={40} />}
          title="No dashboards yet."
          message="Create a dashboard to define boards and widgets."
        />
      )}

      {/* detail view */}
      {mode === 'idle' && selected && (
        <>
          {detailLoading && <LoadingState />}
          {detailErr && <ErrorBanner message={detailErr} />}
          {!detailLoading && !detailErr && detail && (
            <div>
              <div className="section-head" style={{ marginTop: 0 }}>
                <ChartIcon size={15} className="section-icon" />
                {detail.label}
                <span className="spacer" />
                <Button variant="ghost" size="sm"
            onClick={openEdit}>
                  <EditIcon size={13} /> Edit
                </Button>
                <Button variant="ghost" size="sm"
            onClick={deleteBoard} style={{ marginLeft: 'var(--gx-space-2)' }}>
                  <TrashIcon size={13} /> Delete
                </Button>
              </div>
              {detail.description && <p className="hint" style={{ marginBottom: 'var(--gx-space-6)' }}>{detail.description}</p>}
              <div className="grid-wrap">
                <table className="grid studio">
                  <thead>
                    <tr>
                      <th scope="col">Widget key</th>
                      <th scope="col">Label</th>
                      <th scope="col">Type</th>
                      <th scope="col">Entity</th>
                      <th scope="col">Metric</th>
                      <th scope="col">Field</th>
                      <th scope="col">Group by</th>
                      <th scope="col">Filter (GXL)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.widgets.length === 0 ? (
                      <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--gx-text-3)' }}>No widgets</td></tr>
                    ) : detail.widgets.map((w) => (
                      <tr key={w.key}>
                        <td><code className="mono">{w.key}</code></td>
                        <td>{w.label}</td>
                        <td>{w.type}</td>
                        <td>{w.query?.entity ?? '—'}</td>
                        <td>{w.query?.metric ?? '—'}</td>
                        <td>{w.query?.field ?? '—'}</td>
                        <td>{w.query?.group_by ?? '—'}</td>
                        <td>{w.query?.filter ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* create / edit form */}
      {(mode === 'create' || mode === 'edit') && (
        <div>
          <div className="section-head" style={{ marginTop: 0 }}>
            <EditIcon size={15} className="section-icon" />
            {mode === 'create' ? 'New dashboard' : `Edit: ${detail?.label}`}
            <span className="spacer" />
            <Button variant="ghost" size="sm"
            onClick={() => setMode('idle')}>
              <CloseIcon size={13} /> Cancel
            </Button>
          </div>

          {saveErr && <ErrorBanner message={saveErr} />}

          {/* board meta */}
          <div className="rec-form" style={{ marginBottom: 'var(--gx-space-8)' }}>
            {mode === 'create' && (
              <label className="field">
                <span>Key (snake_case) *</span>
                <input className="inp inp-md" value={formKey} onChange={(e) => setFormKey(e.target.value)} placeholder="sales_overview" />
              </label>
            )}
            <label className="field">
              <span>Label *</span>
              <input className="inp inp-md" value={formLabel} onChange={(e) => setFormLabel(e.target.value)} placeholder="Sales Overview" />
            </label>
            <label className="field">
              <span>Description</span>
              <input className="inp inp-md" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Order</span>
              <input className="inp inp-md" type="number" value={formOrder} onChange={(e) => setFormOrder(Number(e.target.value))} />
            </label>
          </div>

          {/* widgets table */}
          <div className="section-head">
            <ChartIcon size={15} className="section-icon" /> Widgets
            <span className="spacer" />
            <Button variant="ghost" size="sm"
            type="button"
              
              onClick={() => setFormWidgets([...formWidgets, emptyWidget()])}
            >
              <PlusIcon size={13} /> Add widget
            </Button>
          </div>

          <div className="grid-wrap">
            <table className="grid studio">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Label</th>
                  <th scope="col">Type</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Metric</th>
                  <th scope="col">Field (sum/avg)</th>
                  <th scope="col">Group by</th>
                  <th scope="col">Filter (GXL)</th>
                  <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {formWidgets.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--gx-text-3)' }}>No widgets — add one above</td></tr>
                ) : formWidgets.map((w, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="inp inp-sm"
                        value={w.key}
                        placeholder="widget_key"
                        onChange={(e) => upd(setFormWidgets, formWidgets, i, { key: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="inp inp-sm"
                        value={w.label}
                        placeholder="Widget label"
                        onChange={(e) => upd(setFormWidgets, formWidgets, i, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="inp inp-sm"
                        value={w.type}
                        onChange={(e) => upd(setFormWidgets, formWidgets, i, { type: e.target.value })}
                      >
                        {['kpi', 'bar', 'line', 'donut', 'table'].map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {entities.length > 0 ? (
                        <select
                          className="inp inp-sm"
                          value={w.query.entity}
                          onChange={(e) => upd(setFormWidgets, formWidgets, i, { query: { ...w.query, entity: e.target.value } })}
                        >
                          <option value=""></option>
                          {entities.map((en) => (
                            <option key={en.key} value={en.key}>{en.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="inp inp-sm"
                          value={w.query.entity}
                          placeholder="entity_key"
                          onChange={(e) => upd(setFormWidgets, formWidgets, i, { query: { ...w.query, entity: e.target.value } })}
                        />
                      )}
                    </td>
                    <td>
                      <select
                        className="inp inp-sm"
                        value={w.query.metric}
                        onChange={(e) => upd(setFormWidgets, formWidgets, i, { query: { ...w.query, metric: e.target.value as Widget['query']['metric'] } })}
                      >
                        {['count', 'sum', 'avg'].map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="inp inp-sm"
                        value={w.query.field ?? ''}
                        placeholder={w.query.metric !== 'count' ? 'required' : 'optional'}
                        onChange={(e) => upd(setFormWidgets, formWidgets, i, { query: { ...w.query, field: e.target.value } })}
                      />
                    </td>
                    <td>
                      <input
                        className="inp inp-sm"
                        value={w.query.group_by ?? ''}
                        placeholder="field"
                        onChange={(e) => upd(setFormWidgets, formWidgets, i, { query: { ...w.query, group_by: e.target.value } })}
                      />
                    </td>
                    <td>
                      <input
                        className="inp inp-sm"
                        value={w.query.filter ?? ''}
                        placeholder="status == 'OPEN'"
                        onChange={(e) => upd(setFormWidgets, formWidgets, i, { query: { ...w.query, filter: e.target.value } })}
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                        <Button variant="ghost" size="sm"
            type="button"
                          
                          aria-label="Remove widget"
                          onClick={() => setFormWidgets(formWidgets.filter((_, j) => j !== i))}
                        >
                          <CloseIcon size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="error-banner" style={{ margin: 'var(--gx-space-8) 0 var(--gx-space-7)', borderLeftColor: 'var(--gx-info)', background: 'var(--gx-info-soft)' }}>
            <div style={{ color: 'var(--gx-info)', flexShrink: 0, marginTop: 1 }}><InfoIcon size={15} /></div>
            <div className="error-banner-msg">
              Widget queries run at view time. <code className="mono">filter</code> is a GXL expression evaluated per record (e.g. <code className="mono">status == &apos;OPEN&apos;</code>).
            </div>
          </div>

          <Button variant="primary" size="md"
            type="button"
            
            onClick={save}
            disabled={saving}>
            <CheckIcon size={14} /> {saving ? 'Saving…' : (mode === 'create' ? 'Create dashboard' : 'Save changes')}
          </Button>
        </div>
      )}
    </div>
  )
}
