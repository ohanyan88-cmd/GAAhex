import { useEffect, useState } from 'react'
import { getEntityDef, listRecords, createRecord, transitionRecord } from './api'

type Field = { key: string; label: string; type: string; required: boolean; order: number; config: any }
type Status = { key: string; label: string; order: number; is_initial: boolean }
type Transition = { from: string; to: string }
type Def = { key: string; label: string; label_plural: string; route_slug: string; fields: Field[]; statuses: Status[]; transitions: Transition[] }
type Row = Record<string, any>

// One generic component renders EVERY entity from its config — no per-entity code.
export default function EntityView({ token, slug }: { token: string; slug: string }) {
  const [def, setDef] = useState<Def | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [form, setForm] = useState<Record<string, any>>({})
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  async function load(s: string) {
    const d = await getEntityDef(token, s)
    setDef(d)
    setRows(await listRecords(token, s))
  }

  useEffect(() => {
    setShowForm(false); setForm({}); setError('')
    load(slug)
  }, [slug])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      def!.fields.forEach((f) => {
        const v = form[f.key]
        if (v !== undefined && v !== '') payload[f.key] = v
      })
      await createRecord(token, slug, payload)
      setForm({}); setShowForm(false)
      setRows(await listRecords(token, slug))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function doTransition(id: string, to: string) {
    setError('')
    try {
      await transitionRecord(token, slug, id, to)
      setRows(await listRecords(token, slug))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!def) return <p className="muted">Loading…</p>

  const cols = def.fields.filter((f) => f.type !== 'status')
  const hasWorkflow = (def.transitions ?? []).length > 0
  const nextFrom = (status: string | null) => (def.transitions ?? []).filter((t) => t.from === status).map((t) => t.to)

  return (
    <div>
      <div className="view-head">
        <h2>{def.label_plural}</h2>
        <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Close' : `+ New ${def.label}`}</button>
      </div>

      {error && <p className="err">{error}</p>}

      {showForm && (
        <form className="rec-form" onSubmit={submit}>
          {def.fields.map((f) => (
            <FieldInput key={f.key} field={f} statuses={def.statuses} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} />
          ))}
          <div className="rec-form-actions"><button type="submit">Save</button></div>
        </form>
      )}

      <table className="grid">
        <thead>
          <tr>
            {cols.map((c) => <th key={c.key}>{c.label}</th>)}
            <th>Status</th>
            {hasWorkflow && <th>Move to</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {cols.map((c) => <td key={c.key}>{String(r[c.key] ?? '')}</td>)}
              <td>{r.status ? <span className="pill">{r.status}</span> : ''}</td>
              {hasWorkflow && (
                <td>
                  {nextFrom(r.status).map((to) => (
                    <button key={to} className="mini" onClick={() => doTransition(r.id, to)}>→ {to}</button>
                  ))}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={cols.length + 1 + (hasWorkflow ? 1 : 0)} className="muted">No records yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function FieldInput({ field, statuses, value, onChange }: { field: Field; statuses: Status[]; value: any; onChange: (v: any) => void }) {
  const f = field
  let input: React.ReactNode
  if (f.type === 'boolean') {
    input = <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
  } else if (f.type === 'number' || f.type === 'money') {
    input = <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'date') {
    input = <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'datetime') {
    input = <input type="datetime-local" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'status') {
    // status is set by the workflow, not chosen at create — show a hint instead of an input
    return <label className="field"><span>{f.label}</span><em className="muted">set by workflow</em></label>
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
