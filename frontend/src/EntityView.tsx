import { useEffect, useState } from 'react'
import { getEntityDef, listRecords, createRecord, transitionRecord } from './api'
import RefPicker, { refTargetKey, loadRefLabels } from './RefPicker'

type Field = { key: string; label: string; type: string; required: boolean; order: number; config: any }
type Status = { key: string; label: string; order: number; is_initial: boolean }
type Transition = { from: string; to: string }
type Def = { key: string; label: string; label_plural: string; route_slug: string; fields: Field[]; statuses: Status[]; transitions: Transition[] }
type Row = Record<string, any>
type Mode = 'idle' | 'creating' | 'editing'

const BASE = 'http://127.0.0.1:8099'

// PATCH lives here (api.ts is out of this lane) — same shape as api.ts's helpers.
async function patchRecord(token: string, slug: string, id: string, data: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/${slug}/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
  const [loading, setLoading] = useState(true)

  async function load(s: string) {
    setLoading(true)
    try {
      const d: Def = await getEntityDef(token, s)
      setDef(d)
      setRows(await listRecords(token, s))
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

  useEffect(() => {
    closeForm(); setError('')
    load(slug).catch((e) => setError((e as Error).message))
  }, [slug])

  function closeForm() {
    setMode('idle'); setForm({}); setEditingId(null); setEditingStatus(null)
  }

  function openCreate() {
    setError(''); setForm({}); setEditingId(null); setEditingStatus(null); setMode('creating')
  }

  function openEdit(row: Row) {
    if (!def) return
    setError('')
    const f: Record<string, any> = {}
    def.fields.forEach((fld) => { if (fld.type !== 'status') f[fld.key] = row[fld.key] ?? '' })
    setForm(f)
    setEditingId(row.id)
    setEditingStatus(row.status ?? null)
    setMode('editing')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
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
      setError((err as Error).message)
    }
  }

  async function doTransition(id: string, to: string) {
    setError('')
    try {
      await transitionRecord(token, slug, id, to)
      await load(slug)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function doDelete(row: Row) {
    if (!window.confirm(`Delete this ${def!.label}? This can't be undone.`)) return
    setError('')
    try {
      const r = await fetch(`${BASE}/api/${slug}/${row.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
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

  if (loading && !def) return <p className="muted">Loading…</p>
  if (!def) return <p className="err">Could not load this entity.</p>

  const cols = def.fields.filter((f) => f.type !== 'status')
  const hasWorkflow = (def.transitions ?? []).length > 0
  const nextFrom = (status: string | null) => (def.transitions ?? []).filter((t) => t.from === status).map((t) => t.to)
  const formOpen = mode !== 'idle'

  function renderCell(c: Field, r: Row) {
    const v = r[c.key]
    if (c.type === 'ref') return refLabels[c.key]?.[v] ?? (v ?? '')
    if (c.type === 'boolean') return v ? '✓' : ''
    return String(v ?? '')
  }

  return (
    <div>
      <div className="view-head">
        <h2>{def.label_plural}</h2>
        <button onClick={() => (formOpen ? closeForm() : openCreate())}>
          {formOpen ? 'Close' : `+ New ${def.label}`}
        </button>
      </div>

      {error && <p className="err">{error}</p>}

      {formOpen && (
        <form className="rec-form" onSubmit={submit}>
          {def.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              token={token}
              mode={mode}
              currentStatus={editingStatus}
              value={form[f.key]}
              onChange={(v) => setForm({ ...form, [f.key]: v })}
            />
          ))}
          <div className="rec-form-actions">
            <button type="submit">{mode === 'editing' ? 'Save changes' : 'Create'}</button>
          </div>
        </form>
      )}

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
          {rows.map((r) => (
            <tr key={r.id}>
              {cols.map((c) => <td key={c.key}>{renderCell(c, r)}</td>)}
              <td>{r.status ? <span className="pill">{r.status}</span> : ''}</td>
              {hasWorkflow && (
                <td>
                  {nextFrom(r.status).map((to) => (
                    <button key={to} className="mini" onClick={() => doTransition(r.id, to)}>→ {to}</button>
                  ))}
                </td>
              )}
              <td className="row-actions">
                <button className="mini" onClick={() => openEdit(r)}>Edit</button>
                <button className="mini danger" onClick={() => doDelete(r)}>Delete</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={cols.length + 2 + (hasWorkflow ? 1 : 0)} className="muted">No records yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function FieldInput({ field, value, onChange, token, mode, currentStatus }: {
  field: Field
  value: any
  onChange: (v: any) => void
  token: string
  mode: Mode
  currentStatus: string | null
}) {
  const f = field
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
    input = <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'date') {
    input = <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'datetime') {
    input = <input type="datetime-local" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'email') {
    input = <input type="email" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'phone') {
    input = <input type="tel" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'select') {
    const opts: string[] = f.config?.options ?? []
    input = (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value=""></option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  } else {
    input = <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  }

  return (
    <label className="field">
      <span>{f.label}{f.required && ' *'}</span>
      {input}
    </label>
  )
}
