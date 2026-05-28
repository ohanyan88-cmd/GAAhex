import type { ReactNode } from 'react'
import RefPicker, { refTargetKey } from './RefPicker'
import { Select, MultiSelect } from './Select'
import { WarningIcon } from './icons'

// Config-driven field input — renders the right control for a field's type. Shared by EntityView
// (the generic entity pages) and any custom view (e.g. the lead pipeline) so every create/edit form
// is generated from the entity's Studio config, never hand-coded.
export type Field = { key: string; label: string; type: string; required: boolean; order: number; config: any; editable?: boolean }
export type Mode = 'idle' | 'creating' | 'editing'

export default function FieldInput({ field, value, onChange, token, mode, currentStatus, errorField, errorMsg }: {
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
  let input: ReactNode

  // read-only field (per-field `editable` flag from /meta; absent ⇒ editable)
  if (f.editable === false) {
    const display = Array.isArray(value) ? value.join(', ') : (value === true ? 'Yes' : value === false ? 'No' : (value ?? '—'))
    return (
      <label className="field">
        <span>{f.label}</span>
        <span className="field-readonly">{String(display) || '—'}</span>
      </label>
    )
  }

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
    input = <Select value={value ?? ''} options={f.config?.options ?? []} onChange={onChange} />
  } else if (f.type === 'multiselect') {
    input = <MultiSelect value={value} options={f.config?.options ?? []} onChange={onChange} />
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
