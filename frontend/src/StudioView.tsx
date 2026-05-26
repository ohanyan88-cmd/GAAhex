import { useState } from 'react'
import { createEntity } from './api'
import { CloseIcon } from './icons'

const FIELD_TYPES = ['text', 'textarea', 'number', 'money', 'boolean', 'date', 'datetime', 'email', 'phone', 'select', 'ref', 'status']

type FieldRow = { key: string; label: string; type: string; required: boolean; extra: string }
type StatusRow = { key: string; label: string; is_initial: boolean }
type TransitionRow = { from: string; to: string; guard: string }

// The SuperAdmin Studio: build a whole entity AS CONFIG from the browser — no SQL, no code.
export default function StudioView({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [labelPlural, setLabelPlural] = useState('')
  const [slug, setSlug] = useState('')
  const [icon, setIcon] = useState('')
  const [fields, setFields] = useState<FieldRow[]>([{ key: 'name', label: 'Name', type: 'text', required: true, extra: '' }])
  const [statuses, setStatuses] = useState<StatusRow[]>([])
  const [transitions, setTransitions] = useState<TransitionRow[]>([])
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const statusKeys = statuses.map((s) => s.key).filter(Boolean)

  function fieldConfig(f: FieldRow): any {
    if (f.type === 'select' && f.extra.trim()) return { options: f.extra.split(',').map((o) => o.trim()).filter(Boolean) }
    if (f.type === 'ref' && f.extra.trim()) return { target: f.extra.trim() }
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setOk('')
    try {
      const def = {
        key: key.trim(), label: label.trim(), label_plural: labelPlural.trim() || undefined,
        route_slug: slug.trim(), icon: icon.trim() || undefined,
        fields: fields.filter((f) => f.key.trim()).map((f) => ({
          key: f.key.trim(), label: f.label.trim() || f.key.trim(), type: f.type, required: f.required, config: fieldConfig(f),
        })),
        statuses: statuses.filter((s) => s.key.trim()).map((s) => ({ key: s.key.trim(), label: s.label.trim() || s.key.trim(), is_initial: s.is_initial })),
        transitions: transitions.filter((t) => t.from && t.to).map((t) => ({ from: t.from, to: t.to, guard: t.guard.trim() || null })),
      }
      const res = await createEntity(token, def)
      setOk(`Created "${res.label_plural}" — it's now in the sidebar and fully working.`)
      // reset
      setKey(''); setLabel(''); setLabelPlural(''); setSlug(''); setIcon('')
      setFields([{ key: 'name', label: 'Name', type: 'text', required: true, extra: '' }]); setStatuses([]); setTransitions([])
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="studio">
      <h2>Studio — new entity</h2>
      <p className="muted">Define an entity as configuration. No code, no SQL — it appears in the sidebar instantly.</p>
      {error && <p className="err">{error}</p>}
      {ok && <p className="ok-msg">{ok}</p>}

      <form onSubmit={submit}>
        <div className="rec-form">
          <label className="field"><span>Key (snake) *</span><input value={key} onChange={(e) => setKey(e.target.value)} placeholder="opportunity" /></label>
          <label className="field"><span>Label *</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Opportunity" /></label>
          <label className="field"><span>Label plural</span><input value={labelPlural} onChange={(e) => setLabelPlural(e.target.value)} placeholder="Opportunities" /></label>
          <label className="field"><span>Route slug (kebab) *</span><input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="opportunities" /></label>
          <label className="field"><span>Icon</span><input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="pipeline" /></label>
        </div>

        <h3>Fields</h3>
        <table className="grid">
          <thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Required</th><th>Options / ref target</th><th></th></tr></thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i}>
                <td><input value={f.key} onChange={(e) => upd(setFields, fields, i, { key: e.target.value })} /></td>
                <td><input value={f.label} onChange={(e) => upd(setFields, fields, i, { label: e.target.value })} /></td>
                <td>
                  <select value={f.type} onChange={(e) => upd(setFields, fields, i, { type: e.target.value })}>
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td><input type="checkbox" checked={f.required} onChange={(e) => upd(setFields, fields, i, { required: e.target.checked })} /></td>
                <td><input value={f.extra} placeholder={f.type === 'select' ? 'a, b, c' : f.type === 'ref' ? 'customer' : ''} onChange={(e) => upd(setFields, fields, i, { extra: e.target.value })} /></td>
                <td><button type="button" className="mini" aria-label="Remove field" onClick={() => setFields(fields.filter((_, j) => j !== i))}><CloseIcon size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="mini" onClick={() => setFields([...fields, { key: '', label: '', type: 'text', required: false, extra: '' }])}>+ field</button>

        <h3>Statuses (optional)</h3>
        <table className="grid">
          <thead><tr><th>Key (UPPER)</th><th>Label</th><th>Initial</th><th></th></tr></thead>
          <tbody>
            {statuses.map((sx, i) => (
              <tr key={i}>
                <td><input value={sx.key} onChange={(e) => upd(setStatuses, statuses, i, { key: e.target.value })} /></td>
                <td><input value={sx.label} onChange={(e) => upd(setStatuses, statuses, i, { label: e.target.value })} /></td>
                <td><input type="checkbox" checked={sx.is_initial} onChange={(e) => upd(setStatuses, statuses, i, { is_initial: e.target.checked })} /></td>
                <td><button type="button" className="mini" aria-label="Remove status" onClick={() => setStatuses(statuses.filter((_, j) => j !== i))}><CloseIcon size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="mini" onClick={() => setStatuses([...statuses, { key: '', label: '', is_initial: statuses.length === 0 }])}>+ status</button>

        <h3>Transitions (optional)</h3>
        <table className="grid">
          <thead><tr><th>From</th><th>To</th><th>Guard (GXL, optional)</th><th></th></tr></thead>
          <tbody>
            {transitions.map((t, i) => (
              <tr key={i}>
                <td><select value={t.from} onChange={(e) => upd(setTransitions, transitions, i, { from: e.target.value })}><option value=""></option>{statusKeys.map((k) => <option key={k} value={k}>{k}</option>)}</select></td>
                <td><select value={t.to} onChange={(e) => upd(setTransitions, transitions, i, { to: e.target.value })}><option value=""></option>{statusKeys.map((k) => <option key={k} value={k}>{k}</option>)}</select></td>
                <td><input value={t.guard} placeholder="phone != None" onChange={(e) => upd(setTransitions, transitions, i, { guard: e.target.value })} /></td>
                <td><button type="button" className="mini" aria-label="Remove transition" onClick={() => setTransitions(transitions.filter((_, j) => j !== i))}><CloseIcon size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="mini" onClick={() => setTransitions([...transitions, { from: '', to: '', guard: '' }])}>+ transition</button>

        <div style={{ marginTop: 18 }}><button type="submit">Create entity</button></div>
      </form>
    </div>
  )
}

function upd<T>(setter: (v: T[]) => void, arr: T[], i: number, patch: Partial<T>) {
  setter(arr.map((row, j) => (j === i ? { ...row, ...patch } : row)))
}
