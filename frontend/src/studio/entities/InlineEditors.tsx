import { useState } from 'react'
import { Button } from '../../primitives'
import { CheckIcon, CloseIcon } from '../../components/icons'
import { ErrorBanner } from '../../components/States'
import type { FieldDef, StatusDefT } from './types'
import { FIELD_TYPES, configExtra, buildConfig } from './types'
import { apiFetch } from './api'
import { useAuth } from '../../context/AuthContext'

export function AddFieldInline({
  slug, onAdded, onCancel,
}: { slug: string; onAdded: () => void; onCancel: () => void }) {
  const { token } = useAuth()
  const [k, setK] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState('text')
  const [required, setRequired] = useState(false)
  const [extra, setExtra] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!k.trim()) { setErr('Field key is required'); return }
    setSaving(true); setErr('')
    try {
      await apiFetch(token!, `/meta/entities/${slug}/fields`, {
        method: 'POST',
        body: JSON.stringify({
          key: k.trim(),
          label: label.trim() || k.trim(),
          type, required,
          config: buildConfig(type, extra),
        }),
      })
      onAdded()
    } catch (ex) {
      setErr((ex as Error).message)
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={save}
      style={{
        marginTop: 'var(--gx-space-5)', padding: 'var(--gx-space-4)',
        border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)',
        background: 'var(--gx-surface-2)',
      }}
    >
      {err && <ErrorBanner message={err} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr) auto', gap: 'var(--gx-space-3)', alignItems: 'flex-end' }}>
        <label className="field"><span>Key *</span>
          <input className="inp inp-sm mono" value={k} onChange={(e) => setK(e.target.value)} autoFocus />
        </label>
        <label className="field"><span>Label</span>
          <input className="inp inp-sm" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field"><span>Type</span>
          <select className="inp inp-sm" value={type} onChange={(e) => { setType(e.target.value); setExtra('') }}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field"><span>Required</span>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} style={{ marginTop: 'var(--gx-space-4)' }} />
        </label>
        <label className="field"><span>{type === 'select' ? 'Options' : type === 'ref' ? 'Target' : '—'}</span>
          <input
            className="inp inp-sm" value={extra}
            onChange={(e) => setExtra(e.target.value)}
            disabled={type !== 'select' && type !== 'ref'}
            placeholder={type === 'select' ? 'a, b, c' : 'customer'}
          />
        </label>
        <div className="row-actions" style={{ paddingBottom: 'var(--gx-space-1)' }}>
          <Button variant="primary" size="sm" type="submit" disabled={saving}>
            <CheckIcon size={13} />
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onCancel} disabled={saving}>
            <CloseIcon size={13} />
          </Button>
        </div>
      </div>
    </form>
  )
}

export function EditFieldInline({
  field, slug, onDone,
}: { field: FieldDef; slug: string; onDone: () => void }) {
  const { token } = useAuth()
  const [label, setLabel] = useState(field.label)
  const [required, setRequired] = useState(field.required)
  const [extra, setExtra] = useState(configExtra(field))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setErr('')
    try {
      const body: any = { label: label.trim() || field.key, required }
      const cfg = buildConfig(field.type, extra)
      if (field.type === 'select') body.config = cfg ?? { options: [] }
      if (field.type === 'ref') body.config = cfg
      await apiFetch(token!, `/meta/entities/${slug}/fields/${field.key}`, {
        method: 'PATCH', body: JSON.stringify(body),
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
          <td colSpan={6}><ErrorBanner message={err} /></td>
        </tr>
      )}
      <tr style={{ background: 'var(--gx-surface-2)' }}>
        <td><span className="hint mono">{field.key}</span></td>
        <td>
          <input className="inp inp-sm" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </td>
        <td><span className="hint">{field.type}</span></td>
        <td>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        </td>
        <td>
          {(field.type === 'select' || field.type === 'ref') ? (
            <input
              className="inp inp-sm" value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={field.type === 'select' ? 'a, b, c' : 'customer'}
            />
          ) : <span className="hint">—</span>}
        </td>
        <td className="actions-col">
          <div className="row-actions">
            <Button variant="primary" size="sm" type="button" onClick={save} disabled={saving}>
              <CheckIcon size={13} />
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={onDone} disabled={saving}>
              <CloseIcon size={13} />
            </Button>
          </div>
        </td>
      </tr>
    </>
  )
}

export function AddStatusInline({
  slug, onAdded, onCancel,
}: { slug: string; onAdded: () => void; onCancel: () => void }) {
  const { token } = useAuth()
  const [k, setK] = useState('')
  const [label, setLabel] = useState('')
  const [isInitial, setIsInitial] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!k.trim()) { setErr('Status key is required'); return }
    setSaving(true); setErr('')
    try {
      const upperKey = k.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      await apiFetch(token!, `/meta/entities/${slug}/statuses`, {
        method: 'POST',
        body: JSON.stringify({ key: upperKey, label: label.trim() || upperKey, is_initial: isInitial }),
      })
      onAdded()
    } catch (ex) {
      setErr((ex as Error).message)
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={save}
      style={{
        marginTop: 'var(--gx-space-5)', padding: 'var(--gx-space-4)',
        border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)',
        background: 'var(--gx-surface-2)',
      }}
    >
      {err && <ErrorBanner message={err} />}
      <div style={{ display: 'flex', gap: 'var(--gx-space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span>Key (UPPER_SNAKE) *</span>
          <input className="inp inp-sm mono" value={k} onChange={(e) => setK(e.target.value)} autoFocus />
        </label>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span>Label</span>
          <input className="inp inp-sm" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field" style={{ flex: '0 0 90px' }}>
          <span>Initial</span>
          <input type="checkbox" checked={isInitial} onChange={(e) => setIsInitial(e.target.checked)} style={{ marginTop: 'var(--gx-space-4)' }} />
        </label>
        <div className="row-actions" style={{ paddingBottom: 'var(--gx-space-1)' }}>
          <Button variant="primary" size="sm" type="submit" disabled={saving}>
            <CheckIcon size={13} />
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onCancel} disabled={saving}>
            <CloseIcon size={13} />
          </Button>
        </div>
      </div>
    </form>
  )
}

export function AddTransitionInline({
  statuses, onAdded, onCancel,
}: {
  statuses: StatusDefT[]
  onAdded: (from: string | null, to: string) => void
  onCancel: () => void
}) {
  const [from, setFrom] = useState<string>('__initial__')
  const [to, setTo] = useState<string>(statuses[0]?.key ?? '')

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!to) return
    onAdded(from === '__initial__' ? null : from, to)
  }

  return (
    <form
      onSubmit={save}
      style={{
        marginTop: 'var(--gx-space-5)', padding: 'var(--gx-space-4)',
        border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)',
        background: 'var(--gx-surface-2)',
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--gx-space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 160px' }}>
          <span>From</span>
          <select className="inp inp-sm" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="__initial__">(initial)</option>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 160px' }}>
          <span>To *</span>
          <select className="inp inp-sm" value={to} onChange={(e) => setTo(e.target.value)}>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
          </select>
        </label>
        <div className="row-actions" style={{ paddingBottom: 'var(--gx-space-1)' }}>
          <Button variant="primary" size="sm" type="submit">
            <CheckIcon size={13} />
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
            <CloseIcon size={13} />
          </Button>
        </div>
      </div>
    </form>
  )
}
