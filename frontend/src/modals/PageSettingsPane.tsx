import { Button } from '../primitives'
import { useEffect, useState } from 'react'
import { toast } from '../components/Toast'
import { LoadingState, ErrorBanner } from '../components/States'
import { CheckIcon, ArrowUpIcon, ArrowDownIcon, PlusIcon, EditIcon, TrashIcon, CloseIcon } from '../components/icons'
import { bget } from '../lib/billing'
import {
  PAGE_SPECS, defaultDescriptor, resolveDescriptor, savePageConfig, deriveFieldKey,
  type PageDescriptor, type ColumnDef, type CustomFieldDef, type CustomFieldType,
} from '../lib/pageConfig'

const CUSTOM_FIELD_TYPES: CustomFieldType[] = ['text', 'number', 'date', 'select', 'boolean']

// -----------------------------------------------------------------------------
// PageSettingsPane — the page-config editor for a BESPOKE page (Services).
// Edits a PAGE descriptor (title override + per-column visible/label/order), NOT entity fields.
// Lives inside ConfigureDrawer; persists via PUT /api/page-config/{pageKey}.
// -----------------------------------------------------------------------------
export default function PageSettingsPane({
  token, pageKey, onSaved,
}: { token: string; pageKey: string; onSaved?: () => void }) {
  const spec = PAGE_SPECS[pageKey]
  const [descriptor, setDescriptor] = useState<PageDescriptor | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!spec) { setError(`Unknown page "${pageKey}"`); return }
    let alive = true
    setError(''); setDescriptor(null); setDirty(false)
    bget<{ config?: Partial<PageDescriptor> }>(token, `/api/page-config/${pageKey}`)
      .then((res) => {
        if (!alive) return
        if (!res.ok && res.status !== 404) { setError('Failed to load page settings'); setDescriptor(defaultDescriptor(spec)); return }
        setDescriptor(resolveDescriptor(spec, res.ok ? res.data?.config : null))
      })
      .catch(() => { if (alive) setDescriptor(defaultDescriptor(spec)) })
    return () => { alive = false }
  }, [token, pageKey])

  function patchColumn(i: number, patch: Partial<ColumnDef>) {
    if (!descriptor) return
    setDescriptor({ ...descriptor, columns: descriptor.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
    setDirty(true)
  }

  function move(i: number, dir: -1 | 1) {
    if (!descriptor) return
    const j = i + dir
    if (j < 0 || j >= descriptor.columns.length) return
    const cols = descriptor.columns.slice()
    ;[cols[i], cols[j]] = [cols[j], cols[i]]
    setDescriptor({ ...descriptor, columns: cols })
    setDirty(true)
  }

  // --- Custom fields (real data fields the superadmin adds; values edited per-row in the view) ---
  function addCustomField(field: CustomFieldDef) {
    if (!descriptor) return
    setDescriptor({ ...descriptor, customFields: [...descriptor.customFields, field] })
    setDirty(true)
  }
  function patchCustomField(i: number, patch: Partial<CustomFieldDef>) {
    if (!descriptor) return
    setDescriptor({ ...descriptor, customFields: descriptor.customFields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
    setDirty(true)
  }
  function removeCustomField(i: number) {
    if (!descriptor) return
    setDescriptor({ ...descriptor, customFields: descriptor.customFields.filter((_, j) => j !== i) })
    setDirty(true)
  }

  async function save() {
    if (!descriptor || saving) return
    setSaving(true)
    try {
      // Persist labels trimmed; an empty label falls back to the column's default on resolve.
      const clean: PageDescriptor = {
        title: descriptor.title && descriptor.title.trim() !== '' ? descriptor.title.trim() : null,
        columns: descriptor.columns.map((c) => ({ key: c.key, label: (c.label ?? '').trim(), visible: c.visible })),
        customFields: descriptor.customFields.map((f) => ({
          key: f.key,
          label: (f.label ?? '').trim() || f.key,
          type: f.type,
          ...(f.type === 'select' ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
        })),
      }
      await savePageConfig(token, pageKey, clean)
      toast.success('Page settings saved')
      setDirty(false)
      onSaved?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    if (!spec) return
    setDescriptor(defaultDescriptor(spec))
    setDirty(true)
  }

  if (error) return <ErrorBanner message={error} />
  if (!descriptor || !spec) return <LoadingState />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Title override */}
      <section>
        <h4 style={{ margin: '0 0 var(--gx-space-2)', fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-semibold)' }}>Page heading</h4>
        <p style={{ margin: '0 0 var(--gx-space-5)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
          Override the title shown at the top of the page. Leave blank for the default
          (<span style={{ fontStyle: 'italic' }}>{spec.defaultTitle}</span>).
        </p>
        <input
          className="inp inp-md"
          style={{ width: '100%' }}
          value={descriptor.title ?? ''}
          placeholder={spec.defaultTitle}
          onChange={(e) => { setDescriptor({ ...descriptor, title: e.target.value }); setDirty(true) }}
          aria-label="Page title override"
        />
      </section>

      {/* Column controls — only shown when the page has configurable columns */}
      {spec.defaultColumns.length > 0 && (
      <section>
        <h4 style={{ margin: '0 0 var(--gx-space-2)', fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-semibold)' }}>Table columns</h4>
        <p style={{ margin: '0 0 var(--gx-space-6)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
          Show or hide columns, rename their headers, and reorder them. The page's data and tools are unchanged.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
          {descriptor.columns.map((col, i) => {
            const def = spec.defaultColumns.find((d) => d.key === col.key)
            return (
              <div
                key={col.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)',
                  padding: 'var(--gx-space-4) var(--gx-space-5)', border: '1px solid var(--gx-border)',
                  borderRadius: 'var(--gx-radius-md)', background: 'var(--gx-surface-2)',
                  opacity: col.visible ? 1 : 0.6,
                }}
              >
                {/* visible toggle */}
                <button
                  type="button"
                  className={'check' + (col.visible ? ' on' : '')}
                  role="checkbox"
                  aria-checked={col.visible}
                  aria-label={`Show column ${col.label}`}
                  onClick={() => patchColumn(i, { visible: !col.visible })}
                  style={{
                    width: 'var(--gx-space-18)', height: 'var(--gx-space-18)', flexShrink: 0, borderRadius: 'var(--gx-radius-xs)',
                    border: '1px solid var(--gx-border)', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: col.visible ? 'var(--gx-gold)' : 'transparent',
                    color: col.visible ? 'var(--gx-text-on-primary)' : 'transparent',
                  }}
                >
                  {col.visible && <CheckIcon size={12} />}
                </button>

                {/* label */}
                <input
                  className="inp inp-sm"
                  style={{ flex: 1, minWidth: 0 }}
                  value={col.label}
                  placeholder={def?.label ?? col.key}
                  onChange={(e) => patchColumn(i, { label: e.target.value })}
                  aria-label={`Label for column ${col.key}`}
                />
                <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', fontFamily: 'var(--gx-font-mono)', flexShrink: 0 }}>{col.key}</span>

                {/* reorder */}
                <div style={{ display: 'flex', gap: 'var(--gx-space-1)', flexShrink: 0 }}>
                  <button type="button" className="iconbtn" aria-label={`Move ${col.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUpIcon size={14} />
                  </button>
                  <button type="button" className="iconbtn" aria-label={`Move ${col.label} down`} disabled={i === descriptor.columns.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDownIcon size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
      )}

      {/* Custom fields — real data fields added to the page; each row's VALUE is edited inline in
          the view and persisted separately. The page's hand-coded engine is never touched. */}
      <CustomFieldsSection
        fields={descriptor.customFields}
        onAdd={addCustomField}
        onPatch={patchCustomField}
        onRemove={removeCustomField}
      />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--gx-space-3)', alignItems: 'center', paddingTop: 'var(--gx-space-2)' }}>
        <Button variant="primary" size="md"
            type="button"  disabled={saving || !dirty} onClick={save}>
          {saving ? 'Saving…' : 'Save page settings'}
        </Button>
        <Button variant="ghost" size="md"
            type="button"  disabled={saving} onClick={reset}>
          Reset to default
        </Button>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// CustomFieldsSection — list + add/edit/remove for the page's superadmin-defined data fields.
// Edits the DEFINITIONS only (label/type/options); per-row VALUES are set inline in the view.
// -----------------------------------------------------------------------------
function CustomFieldsSection({
  fields, onAdd, onPatch, onRemove,
}: {
  fields: CustomFieldDef[]
  onAdd: (f: CustomFieldDef) => void
  onPatch: (i: number, patch: Partial<CustomFieldDef>) => void
  onRemove: (i: number) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  // draft for add/edit form
  const [label, setLabel] = useState('')
  const [type, setType] = useState<CustomFieldType>('text')
  const [options, setOptions] = useState('')

  function startAdd() {
    setEditing(null); setAdding(true)
    setLabel(''); setType('text'); setOptions('')
  }
  function startEdit(i: number) {
    const f = fields[i]
    setAdding(false); setEditing(i)
    setLabel(f.label); setType(f.type); setOptions((f.options ?? []).join(', '))
  }
  function cancel() { setAdding(false); setEditing(null) }

  function commit() {
    const lbl = label.trim()
    if (!lbl) { toast.error('Field label is required'); return }
    const opts = type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : undefined
    if (type === 'select' && (!opts || opts.length === 0)) { toast.error('Select fields need at least one option'); return }

    if (editing != null) {
      // key + type are immutable after creation (renaming/retyping would orphan stored values).
      onPatch(editing, { label: lbl, ...(type === 'select' ? { options: opts } : {}) })
    } else {
      const existing = new Set(fields.map((f) => f.key))
      let key = deriveFieldKey(lbl)
      if (!key) { toast.error('Could not derive a field key from that label'); return }
      if (existing.has(key)) { let n = 2; while (existing.has(`${key}_${n}`)) n++; key = `${key}_${n}` }
      onAdd({ key, label: lbl, type, ...(type === 'select' ? { options: opts } : {}) })
    }
    cancel()
  }

  const formOpen = adding || editing != null

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 var(--gx-space-2)' }}>
        <h4 style={{ margin: 0, fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-semibold)' }}>Custom fields</h4>
        {!formOpen && (
          <Button variant="primary" size="sm"
            type="button"  onClick={startAdd}>
            <PlusIcon size={13} /> Add field
          </Button>
        )}
      </div>
      <p style={{ margin: '0 0 var(--gx-space-6)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)' }}>
        Add real data fields (text, number, date, select, boolean) shown as extra columns. Each row's
        value is edited directly in the table. The page's data and tools are unchanged.
      </p>

      {fields.length === 0 && !formOpen && (
        <p style={{ margin: '0 0 var(--gx-space-4)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-3)', fontStyle: 'italic' }}>No custom fields yet.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
        {fields.map((f, i) => (
          <div
            key={f.key}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)',
              padding: 'var(--gx-space-4) var(--gx-space-5)', border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-md)', background: 'var(--gx-surface-2)',
            }}
          >
            <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--gx-text-13)' }}>{f.label}</span>
            <span className="pill pill-muted" style={{ flexShrink: 0 }}>{f.type}</span>
            {f.type === 'select' && (
              <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', flexShrink: 0 }}>{(f.options ?? []).join(', ') || '—'}</span>
            )}
            <span style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', fontFamily: 'var(--gx-font-mono)', flexShrink: 0 }}>{f.key}</span>
            <div style={{ display: 'flex', gap: 'var(--gx-space-1)', flexShrink: 0 }}>
              <button type="button" className="iconbtn" aria-label={`Edit field ${f.label}`} onClick={() => startEdit(i)}>
                <EditIcon size={14} />
              </button>
              <button type="button" className="iconbtn" aria-label={`Remove field ${f.label}`} onClick={() => onRemove(i)}>
                <TrashIcon size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {formOpen && (
        <div style={{ marginTop: 'var(--gx-space-5)', padding: 'var(--gx-space-6) var(--gx-space-6)', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)', background: 'var(--gx-surface-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--gx-space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '1 1 160px' }}>
              <span>Label *</span>
              <input className="inp inp-sm" value={label} autoFocus onChange={(e) => setLabel(e.target.value)} placeholder="Notes" />
            </label>
            <label className="field" style={{ flex: '0 0 130px' }}>
              <span>Type</span>
              <select className="inp inp-sm" value={type} disabled={editing != null}
                onChange={(e) => { setType(e.target.value as CustomFieldType); setOptions('') }}>
                {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            {type === 'select' && (
              <label className="field" style={{ flex: '1 1 180px' }}>
                <span>Options (comma-sep)</span>
                <input className="inp inp-sm" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Low, High" />
              </label>
            )}
            <div style={{ display: 'flex', gap: 'var(--gx-space-2)', paddingBottom: 'var(--gx-space-1)' }}>
              <Button variant="gold" size="sm"
            type="button"  onClick={commit}>
                <CheckIcon size={13} /> {editing != null ? 'Save' : 'Add'}
              </Button>
              <Button variant="ghost" size="sm"
            type="button"  onClick={cancel}>
                <CloseIcon size={13} />
              </Button>
            </div>
          </div>
          {editing != null && (
            <p style={{ margin: 'var(--gx-space-4) 0 0', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
              Key and type are immutable — changing them would orphan stored values.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
