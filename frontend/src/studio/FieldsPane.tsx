import { useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  EditIcon, PlusIcon, CloseIcon, CheckIcon, InfoIcon, RowsIcon, TrashIcon,
} from '../components/icons'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: 'Bearer ' + token })

const FIELD_TYPES = [
  'text', 'textarea', 'number', 'money', 'boolean', 'date', 'datetime',
  'email', 'phone', 'select', 'ref', 'status',
]

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

type FieldDef = {
  key: string; label: string; type: string; required: boolean;
  order: number; config: Record<string, any> | null
}

function upd<T>(setter: (v: T[]) => void, arr: T[], i: number, patch: Partial<T>) {
  setter(arr.map((row, j) => (j === i ? { ...row, ...patch } : row)))
}

function configExtra(f: { type: string; config: Record<string, any> | null }): string {
  if (!f.config) return ''
  if (f.type === 'select' && Array.isArray(f.config.options)) return f.config.options.join(', ')
  if (f.type === 'ref' && f.config.target) return f.config.target
  return ''
}

function buildConfig(type: string, extra: string): Record<string, any> | null {
  if (type === 'select' && extra.trim()) {
    return { options: extra.split(',').map((o) => o.trim()).filter(Boolean) }
  }
  if (type === 'ref' && extra.trim()) return { target: extra.trim() }
  return null
}

// ---------------------------------------------------------------------------
// Add-field form (inline, shown below table)
// ---------------------------------------------------------------------------
function AddFieldForm({
  slug, token, onAdded,
}: { slug: string; token: string; onAdded: () => void }) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState('text')
  const [required, setRequired] = useState(false)
  const [extra, setExtra] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!key.trim()) { setErr('Field key is required'); return }
    setSaving(true); setErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/fields`, {
        method: 'POST',
        body: JSON.stringify({
          key: key.trim(),
          label: label.trim() || key.trim(),
          type,
          required,
          config: buildConfig(type, extra),
        }),
      })
      setKey(''); setLabel(''); setType('text'); setRequired(false); setExtra('')
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
        <label className="field" style={{ flex: '1 1 120px' }}>
          <span>Key *</span>
          <input className="inp inp-sm" value={key} onChange={(e) => setKey(e.target.value)} placeholder="phone" />
        </label>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span>Label</span>
          <input className="inp inp-sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Phone" />
        </label>
        <label className="field" style={{ flex: '0 0 120px' }}>
          <span>Type</span>
          <select className="inp inp-sm" value={type} onChange={(e) => { setType(e.target.value); setExtra('') }}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: '0 0 76px' }}>
          <span>Required</span>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} style={{ marginTop: 8 }} />
        </label>
        {(type === 'select' || type === 'ref') && (
          <label className="field" style={{ flex: '1 1 160px' }}>
            <span>{type === 'select' ? 'Options (comma-sep)' : 'Ref target'}</span>
            <input
              className="inp inp-sm"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={type === 'select' ? 'a, b, c' : 'customer'}
            />
          </label>
        )}
        <div style={{ paddingBottom: 2 }}>
          <button type="submit" className="btn btn-accent btn-sm" disabled={saving}>
            <CheckIcon size={13} /> {saving ? 'Saving…' : 'Add field'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Inline edit row (replaces a table row on click)
// ---------------------------------------------------------------------------
function EditFieldRow({
  slug, token, field, onDone,
}: { slug: string; token: string; field: FieldDef; onDone: () => void }) {
  const [label, setLabel] = useState(field.label)
  const [required, setRequired] = useState(field.required)
  const [extra, setExtra] = useState(configExtra(field))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setErr('')
    try {
      const body: Record<string, any> = { label: label.trim() || field.key, required }
      const cfg = buildConfig(field.type, extra)
      if (field.type === 'select') body.config = cfg ?? { options: [] }
      if (field.type === 'ref') body.config = cfg
      await apiFetch(token, `/meta/entities/${slug}/fields/${field.key}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
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
        <td><span className="hint">{field.key}</span></td>
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
              className="inp inp-sm"
              value={extra}
              placeholder={field.type === 'select' ? 'a, b, c' : 'customer'}
              onChange={(e) => setExtra(e.target.value)}
            />
          ) : <span className="hint">—</span>}
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
// Main pane
// ---------------------------------------------------------------------------
export default function FieldsPane({ token, initialSlug, lockEntity }: { token: string; initialSlug?: string; lockEntity?: boolean }) {
  const [entities, setEntities] = useState<EntitySummary[]>([])
  const [entLoading, setEntLoading] = useState(true)
  const [entError, setEntError] = useState('')
  const [entDenied, setEntDenied] = useState(false)

  const [slug, setSlug] = useState<string | null>(initialSlug ?? null)

  const [fields, setFields] = useState<FieldDef[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [fieldsError, setFieldsError] = useState('')
  const [fieldsDenied, setFieldsDenied] = useState(false)

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [deleteErr, setDeleteErr] = useState('')
  const [showAdd, setShowAdd] = useState(false)

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

  // Load fields for selected entity
  function loadFields(s: string) {
    let alive = true
    setFieldsLoading(true); setFieldsError(''); setFieldsDenied(false)
    setFields([]); setEditingKey(null); setShowAdd(false); setDeleteErr('')
    apiFetch(token, `/meta/entities/${s}`)
      .then((d: { fields: FieldDef[] }) => {
        if (!alive) return
        setFields(d.fields ?? [])
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setFieldsDenied(true)
        else setFieldsError((ex as Error).message)
      })
      .finally(() => { if (alive) setFieldsLoading(false) })
    return () => { alive = false }
  }

  useEffect(() => { loadEntities() }, [token])
  useEffect(() => { if (slug) loadFields(slug) }, [token, slug])

  async function deleteField(fieldKey: string) {
    if (!slug) return
    setDeletingKey(fieldKey); setDeleteErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/fields/${fieldKey}`, { method: 'DELETE' })
      loadFields(slug)
    } catch (ex) {
      setDeleteErr((ex as Error).message)
    } finally {
      setDeletingKey(null)
    }
  }

  // --- render ---
  if (entLoading) return <LoadingState />
  if (entDenied) return <PermissionDenied message="You don't have permission to manage fields." />
  if (entError) return <ErrorBanner message={entError} onRetry={loadEntities} />

  return (
    <div>
      {/* header */}
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Fields</h3>
          <p className="hint" style={{ margin: 0 }}>
            Add, edit, and remove fields for any entity. Key and type are immutable after creation.
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

          {/* fields section */}
          {slug && (
            <>
              <div className="section-head">
                <EditIcon size={15} className="section-icon" /> Fields
                <span className="spacer" />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => { setShowAdd((v) => !v); setEditingKey(null) }}
                >
                  <PlusIcon size={13} /> Add field
                </button>
              </div>

              {deleteErr && <ErrorBanner message={deleteErr} />}

              {fieldsLoading && <LoadingState />}
              {fieldsDenied && <PermissionDenied />}
              {fieldsError && <ErrorBanner message={fieldsError} onRetry={() => loadFields(slug)} />}

              {!fieldsLoading && !fieldsDenied && !fieldsError && (
                <>
                  {fields.length === 0 ? (
                    <EmptyState
                      title="No fields yet."
                      message="Add the first field for this entity using the button above."
                    />
                  ) : (
                    <div className="grid-wrap">
                      <table className="grid studio">
                        <thead>
                          <tr>
                            <th scope="col">Key</th>
                            <th scope="col">Label</th>
                            <th scope="col">Type</th>
                            <th scope="col">Required</th>
                            <th scope="col">Options / ref</th>
                            <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map((f) =>
                            editingKey === f.key ? (
                              <EditFieldRow
                                key={f.key}
                                slug={slug}
                                token={token}
                                field={f}
                                onDone={() => { setEditingKey(null); loadFields(slug) }}
                              />
                            ) : (
                              <tr key={f.key}>
                                <td><code className="mono">{f.key}</code></td>
                                <td>{f.label}</td>
                                <td><span className="hint">{f.type}</span></td>
                                <td>{f.required ? <CheckIcon size={14} /> : <span className="hint">—</span>}</td>
                                <td>
                                  <span className="hint">
                                    {configExtra(f) || '—'}
                                  </span>
                                </td>
                                <td>
                                  <div className="row-actions">
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      aria-label={`Edit field ${f.key}`}
                                      onClick={() => { setEditingKey(f.key); setShowAdd(false) }}
                                    >
                                      <EditIcon size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      aria-label={`Delete field ${f.key}`}
                                      disabled={deletingKey === f.key}
                                      onClick={() => deleteField(f.key)}
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

                  {showAdd && (
                    <AddFieldForm
                      slug={slug}
                      token={token}
                      onAdded={() => { setShowAdd(false); loadFields(slug) }}
                    />
                  )}

                  <div className="error-banner" style={{ margin: '20px 0 4px', borderLeftColor: 'var(--gx-info)', background: 'var(--gx-info-soft)' }}>
                    <div style={{ color: 'var(--gx-info)', flexShrink: 0, marginTop: 1 }}><InfoIcon size={16} /></div>
                    <div>
                      <div className="error-banner-title" style={{ color: 'var(--gx-text-1)' }}>Key and type are immutable</div>
                      <div className="error-banner-msg">
                        Renaming a key or changing a type would orphan existing record data. Add a new field instead.
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
