import { useEffect, useState } from 'react'
import { getEntityDef, createRecord, transitionRecord } from './api'
import RefPicker, { refTargetKey, loadRefLabels } from './RefPicker'
import { CheckIcon, ArrowRightIcon, SearchIcon, CloseIcon, WarningIcon } from './icons'

type Field = { key: string; label: string; type: string; required: boolean; order: number; config: any }
type Status = { key: string; label: string; order: number; is_initial: boolean }
type Transition = { from: string; to: string }
type Def = { key: string; label: string; label_plural: string; route_slug: string; fields: Field[]; statuses: Status[]; transitions: Transition[] }
type Row = Record<string, any>
type Mode = 'idle' | 'creating' | 'editing'
type SavedView = { id: string | number; name: string; q?: string; filter?: string; sort?: string }

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// Pull the offending field key out of a backend 422 message (e.g. "Invalid email for 'email'").
function errFieldOf(msg: string): string | null {
  const m = msg.match(/'([^']+)'/)
  return m ? m[1] : null
}

// PATCH lives here (api.ts is out of this lane) — same shape as api.ts's helpers.
async function patchRecord(token: string, slug: string, id: string, data: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/${slug}/${id}`, {
    method: 'PATCH',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    const d = e.detail ?? 'Error'
    throw new Error(typeof d === 'string' ? d : JSON.stringify(d))
  }
  return r.json()
}

// One generic component renders EVERY entity from its config — no per-entity code.
export default function EntityView({ token, slug }: { token: string; slug: string }) {
  const [def, setDef] = useState<Def | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [form, setForm] = useState<Record<string, any>>({})
  const [mode, setMode] = useState<Mode>('idle')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingStatus, setEditingStatus] = useState<string | null>(null)
  const [refLabels, setRefLabels] = useState<Record<string, Record<string, string>>>({})
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // search / saved views (Task A contract: GET /api/{slug}?q=&filter=&sort= + /api/views)
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState('')
  const [views, setViews] = useState<SavedView[]>([])
  const [viewsAvailable, setViewsAvailable] = useState(false)
  const [activeView, setActiveView] = useState('')

  async function load(s: string) {
    setLoading(true)
    try {
      const d: Def = await getEntityDef(token, s)
      setDef(d)
      // build the list request to A's contract; FastAPI ignores params an older build doesn't declare
      const params = new URLSearchParams()
      if (appliedQ) params.set('q', appliedQ)
      if (filter) params.set('filter', filter)
      if (sort) params.set('sort', sort)
      const qs = params.toString()
      const r = await fetch(`${BASE}/api/${s}${qs ? `?${qs}` : ''}`, { headers: authH(token) })
      if (!r.ok) throw new Error('Failed to load records')
      setRows(await r.json())
      // build { fieldKey -> { id -> label } } maps for every ref field, for the list display
      const maps: Record<string, Record<string, string>> = {}
      for (const f of d.fields.filter((x) => x.type === 'ref')) {
        const tk = refTargetKey(f.config)
        if (tk) maps[f.key] = await loadRefLabels(token, tk)
      }
      setRefLabels(maps)
    } finally {
      setLoading(false)
    }
  }

  // Saved views are optional: if /api/views isn't merged yet it 404s → hide the control quietly.
  async function loadViews(s: string) {
    try {
      const r = await fetch(`${BASE}/api/views?entity=${encodeURIComponent(s)}`, { headers: authH(token) })
      if (!r.ok) { setViewsAvailable(false); setViews([]); return }
      const data = await r.json()
      setViews(Array.isArray(data) ? data : [])
      setViewsAvailable(true)
    } catch {
      setViewsAvailable(false); setViews([])
    }
  }

  // slug change → reset view state, then load
  useEffect(() => {
    closeForm(); setError(''); setErrorField(null)
    setQ(''); setAppliedQ(''); setFilter(''); setSort(''); setActiveView('')
    loadViews(slug)
  }, [slug])

  // debounce the search box (~300ms)
  useEffect(() => {
    const id = setTimeout(() => setAppliedQ(q), 300)
    return () => clearTimeout(id)
  }, [q])

  // (re)fetch records on slug / applied search / filter / sort change
  useEffect(() => {
    load(slug).catch((e) => setError((e as Error).message))
  }, [slug, appliedQ, filter, sort])

  function closeForm() {
    setMode('idle'); setForm({}); setEditingId(null); setEditingStatus(null); setErrorField(null)
  }

  function openCreate() {
    setError(''); setErrorField(null); setForm({}); setEditingId(null); setEditingStatus(null); setMode('creating')
  }

  function openEdit(row: Row) {
    if (!def) return
    setError(''); setErrorField(null)
    const f: Record<string, any> = {}
    def.fields.forEach((fld) => { if (fld.type !== 'status') f[fld.key] = row[fld.key] ?? '' })
    setForm(f)
    setEditingId(row.id)
    setEditingStatus(row.status ?? null)
    setMode('editing')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setErrorField(null)
    try {
      const payload: Record<string, unknown> = {}
      def!.fields.forEach((f) => {
        if (f.type === 'status') return            // status is lifecycle-managed, never sent here
        const v = form[f.key]
        if (mode === 'creating') {
          if (v !== undefined && v !== '') payload[f.key] = v
        } else {
          if (v !== undefined) payload[f.key] = v  // editing: send all (allows clearing a field)
        }
      })
      if (mode === 'editing' && editingId) await patchRecord(token, slug, editingId, payload)
      else await createRecord(token, slug, payload)
      closeForm()
      await load(slug)
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      setErrorField(errFieldOf(msg))
    }
  }

  async function doTransition(id: string, to: string) {
    setError(''); setErrorField(null)
    try {
      await transitionRecord(token, slug, id, to)
      await load(slug)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function doDelete(row: Row) {
    if (!window.confirm(`Delete this ${def!.label}? This can't be undone.`)) return
    setError(''); setErrorField(null)
    try {
      const r = await fetch(`${BASE}/api/${slug}/${row.id}`, { method: 'DELETE', headers: authH(token) })
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: r.status === 403 ? 'Not allowed to delete this record' : 'Error' }))
        const d = e.detail ?? 'Error'
        throw new Error(typeof d === 'string' ? d : JSON.stringify(d))
      }
      if (editingId === row.id) closeForm()
      await load(slug)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function saveView() {
    const name = window.prompt('Save current view as:')
    if (!name || !name.trim()) return
    try {
      const r = await fetch(`${BASE}/api/views`, {
        method: 'POST',
        headers: { ...authH(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), entity: slug, q: appliedQ, filter, sort }),
      })
      if (!r.ok) throw new Error('Could not save view')
      await loadViews(slug)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function applyView(id: string) {
    setActiveView(id)
    const v = views.find((x) => String(x.id) === id)
    setQ(v?.q ?? ''); setAppliedQ(v?.q ?? ''); setFilter(v?.filter ?? ''); setSort(v?.sort ?? '')
  }

  if (loading && !def) return <p className="muted">Loading…</p>
  if (!def) return <p className="err">Could not load this entity.</p>

  const cols = def.fields.filter((f) => f.type !== 'status')
  const hasWorkflow = (def.transitions ?? []).length > 0
  const nextFrom = (status: string | null) => (def.transitions ?? []).filter((t) => t.from === status).map((t) => t.to)
  const formOpen = mode !== 'idle'

  const cellValue = (c: Field, r: Row) => (c.type === 'ref' ? (refLabels[c.key]?.[r[c.key]] ?? r[c.key]) : r[c.key])

  // client-side filter as graceful degradation: works even if the backend ignores ?q= (older build)
  const needle = appliedQ.trim().toLowerCase()
  const visibleRows = !needle ? rows : rows.filter((r) =>
    cols.some((c) => String(cellValue(c, r) ?? '').toLowerCase().includes(needle)) ||
    String(r.status ?? '').toLowerCase().includes(needle),
  )

  function renderCell(c: Field, r: Row) {
    const v = cellValue(c, r)
    if (c.type === 'boolean') return r[c.key] ? <CheckIcon size={15} /> : ''
    return String(v ?? '')
  }

  const colSpan = cols.length + 2 + (hasWorkflow ? 1 : 0)

  return (
    <div>
      <div className="view-head">
        <h2>{def.label_plural}</h2>
        <button
          className={formOpen ? 'btn btn-ghost btn-md' : 'btn btn-primary btn-md'}
          onClick={() => (formOpen ? closeForm() : openCreate())}
        >
          {formOpen ? 'Close' : `+ New ${def.label}`}
        </button>
      </div>

      {error && !errorField && <p className="err">{error}</p>}

      {formOpen && (
        <form className="rec-form" onSubmit={submit}>
          {def.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              token={token}
              mode={mode}
              currentStatus={editingStatus}
              errorField={errorField}
              errorMsg={error}
              value={form[f.key]}
              onChange={(v) => setForm({ ...form, [f.key]: v })}
            />
          ))}
          <div className="rec-form-actions">
            <button type="submit" className="btn btn-accent btn-md">{mode === 'editing' ? 'Save changes' : 'Create'}</button>
          </div>
        </form>
      )}

      <div className="list-toolbar">
        <div className="search search-md">
          <SearchIcon className="search-icon" size={16} />
          <input
            className="search-input"
            placeholder={`Search ${def.label_plural.toLowerCase()}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="search-clear" aria-label="Clear search" onClick={() => setQ('')}>
              <CloseIcon size={14} />
            </button>
          )}
        </div>

        {viewsAvailable && (
          <div className="saved-views">
            <select className="inp inp-sm" value={activeView} onChange={(e) => applyView(e.target.value)}>
              <option value="">All records</option>
              {views.map((v) => <option key={String(v.id)} value={String(v.id)}>{v.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={saveView}>Save view</button>
          </div>
        )}
      </div>

      <table className="grid">
        <thead>
          <tr>
            {cols.map((c) => <th key={c.key}>{c.label}</th>)}
            <th>Status</th>
            {hasWorkflow && <th>Move to</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr key={r.id}>
              {cols.map((c) => <td key={c.key}>{renderCell(c, r)}</td>)}
              <td>{r.status ? <span className="pill">{r.status}</span> : ''}</td>
              {hasWorkflow && (
                <td>
                  {nextFrom(r.status).map((to) => (
                    <button key={to} className="btn btn-ghost btn-sm" onClick={() => doTransition(r.id, to)}>
                      <ArrowRightIcon size={13} /> {to}
                    </button>
                  ))}
                </td>
              )}
              <td className="row-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={() => doDelete(r)}>Delete</button>
              </td>
            </tr>
          ))}
          {!loading && visibleRows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="muted">
                {needle ? `No records match “${appliedQ}”.` : 'No records yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function FieldInput({ field, value, onChange, token, mode, currentStatus, errorField, errorMsg }: {
  field: Field
  value: any
  onChange: (v: any) => void
  token: string
  mode: Mode
  currentStatus: string | null
  errorField: string | null
  errorMsg: string
}) {
  const f = field
  const isErr = errorField === f.key
  const cls = 'inp inp-md' + (isErr ? ' is-error' : '')
  let input: React.ReactNode

  if (f.type === 'status') {
    // status is set by the workflow, never edited directly
    return (
      <label className="field">
        <span>{f.label}</span>
        {mode === 'editing'
          ? <span className="pill">{currentStatus ?? '—'}</span>
          : <em className="muted">set by workflow</em>}
      </label>
    )
  } else if (f.type === 'ref') {
    input = <RefPicker token={token} targetKey={refTargetKey(f.config)} value={value} onChange={onChange} />
  } else if (f.type === 'boolean') {
    input = <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
  } else if (f.type === 'number' || f.type === 'money') {
    input = <input type="number" className={cls + ' inp-numeric'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'date') {
    input = <input type="date" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'datetime') {
    input = <input type="datetime-local" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'email') {
    input = <input type="email" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'phone') {
    input = <input type="tel" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'textarea') {
    input = <textarea className={cls + ' inp-area'} rows={4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'select') {
    const opts: string[] = f.config?.options ?? []
    input = (
      <select className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value=""></option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  } else {
    input = <input type="text" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  }

  return (
    <label className="field">
      <span>{f.label}{f.required && ' *'}</span>
      {input}
      {isErr && <span className="inp-err"><WarningIcon size={12} /> {errorMsg}</span>}
    </label>
  )
}
