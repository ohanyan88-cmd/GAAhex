// EntitiesPane — real backend-wired pane for the Data → Models → Entities leaf.
//
// Replaces the prior local-state EntityBuilder (which had an inert "Create entity"
// button) per Gev's "DELETE old code, don't layer" doctrine.
//
// Wiring:
//   GET    /meta/entities                              → list view
//   POST   /meta/entities                              → create
//   GET    /meta/entities/{slug}                       → load detail (fields/statuses/transitions)
//   PATCH  /meta/entities/{slug}                       → entity metadata (icon, label, label_plural)
//   DELETE /meta/entities/{slug}                       → soft-retire
//   POST   /meta/entities/{slug}/fields                → add field
//   PATCH  /meta/entities/{slug}/fields/{key}          → edit field (label/required/options)
//   DELETE /meta/entities/{slug}/fields/{key}          → delete field
//   POST   /meta/entities/{slug}/statuses              → add status
//   PATCH  /meta/entities/{slug}/statuses/reorder      → up/down reorder
//   PATCH  /meta/entities/{slug}/statuses/{key}        → edit status (label/is_initial)
//   DELETE /meta/entities/{slug}/statuses/{key}        → delete status
//   PUT    /meta/entities/{slug}/transitions           → replace transition list
//
// Every write is gated server-side by `config.manage` (see backend/app/routers/meta.py).
// 403 → <PermissionDenied/>. Other errors → <ErrorBanner/>.
//
// Tokens: --gx-* only, no raw hex. Icons: lucide via ../components/icons.
import { useCallback, useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { Modal, ModalFooterActions } from '../components/Modal'  // MO-1/2 — canonical modal chrome
import { Button, StudioDrawer} from '../primitives'  // DR-1 — canonical drawer chrome
import {
  EditIcon, PlusIcon, CloseIcon, CheckIcon, InfoIcon, RowsIcon, TrashIcon,
  ArrowUpIcon, ArrowDownIcon, ArrowRightIcon,
} from '../components/icons'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type EntitySummary = {
  key: string; label: string; label_plural: string; route_slug: string;
  icon: string | null; status: string; order: number
}

type FieldDef = {
  key: string; label: string; type: string; required: boolean;
  order: number; config: Record<string, any> | null
}

type StatusDefT = { key: string; label: string; order: number; is_initial: boolean }

type Transition = { from: string | null; to: string }

type EntityDetail = {
  key: string; label: string; label_plural: string; route_slug: string; icon: string | null;
  fields: FieldDef[]; statuses: StatusDefT[]; transitions: Transition[]
}

type DraftField = { key: string; label: string; type: string; required: boolean; extra: string }
type DraftStatus = { key: string; label: string; is_initial: boolean }

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
// Create-entity modal
// ---------------------------------------------------------------------------
function CreateEntityModal({
  token, onClose, onCreated,
}: { token: string; onClose: () => void; onCreated: (slug: string) => void }) {
  const [label, setLabel] = useState('')
  const [labelPlural, setLabelPlural] = useState('')
  const [key, setKey] = useState('')
  const [slug, setSlug] = useState('')
  const [icon, setIcon] = useState('')
  const [fields, setFields] = useState<DraftField[]>([])
  const [statuses, setStatuses] = useState<DraftStatus[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function handleLabelChange(v: string) {
    setLabel(v)
    if (!key) setKey(v.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
    if (!slug) setSlug(v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + 's')
    if (!labelPlural) setLabelPlural(v + 's')
  }

  function updField(i: number, patch: Partial<DraftField>) {
    setFields((arr) => arr.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  function addField() {
    setFields((arr) => [...arr, { key: '', label: '', type: 'text', required: false, extra: '' }])
  }
  function rmField(i: number) {
    setFields((arr) => arr.filter((_, j) => j !== i))
  }

  function addStatus() {
    const k = window.prompt('Status key (UPPER_SNAKE)')
    if (!k) return
    const upper = k.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    const l = window.prompt('Status label', upper) ?? upper
    setStatuses((arr) => [...arr, { key: upper, label: l, is_initial: arr.length === 0 }])
  }
  function rmStatus(k: string) {
    setStatuses((arr) => arr.filter((s) => s.key !== k))
  }
  function setInitial(k: string) {
    setStatuses((arr) => arr.map((s) => ({ ...s, is_initial: s.key === k })))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim() || !key.trim() || !slug.trim()) {
      setErr('Label, key, and route slug are required.')
      return
    }
    setSaving(true); setErr('')
    try {
      const payload: any = {
        label: label.trim(),
        label_plural: labelPlural.trim() || `${label.trim()}s`,
        key: key.trim(),
        route_slug: slug.trim(),
        icon: icon.trim() || null,
        fields: fields
          .filter((f) => f.key.trim())
          .map((f) => ({
            key: f.key.trim(),
            label: f.label.trim() || f.key.trim(),
            type: f.type,
            required: f.required,
            config: buildConfig(f.type, f.extra),
          })),
        statuses: statuses.map((s) => ({ key: s.key, label: s.label, is_initial: s.is_initial })),
      }
      await apiFetch(token, '/meta/entities', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      onCreated(slug.trim())
    } catch (ex) {
      setErr((ex as Error).message)
      setSaving(false)
    }
  }

  // MO-1 — migrated from hand-rolled `position:fixed,inset:0` chrome to the
  // canonical `<Modal>`. The form lives inside the modal body; the footer
  // Cancel/Submit pair lives in `<ModalFooterActions>` and triggers submit
  // via the `form="entity-create-form"` HTML attribute (the standard way to
  // submit a form from a button rendered outside it).
  return (
    <Modal
      open
      onClose={() => { if (!saving) onClose() }}
      title="New entity"
      size="lg"
      footer={
        <ModalFooterActions
          onCancel={onClose}
          onConfirm={() => {
            const form = document.getElementById('entity-create-form') as HTMLFormElement | null
            if (form) form.requestSubmit()
          }}
          confirmLabel={saving ? 'Creating…' : 'Create entity'}
          confirmDisabled={saving}
        />
      }
    >
      <form id="entity-create-form" onSubmit={submit}>
        {err && <ErrorBanner message={err} />}

        <div className="section-head" style={{ marginTop: 4 }}>
          <RowsIcon size={15} className="section-icon" /> Identity
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">
            <span>Label *</span>
            <input
              className="inp inp-sm" value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="Service Level Agreement"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Label plural</span>
            <input
              className="inp inp-sm" value={labelPlural}
              onChange={(e) => setLabelPlural(e.target.value)}
              placeholder="Service Level Agreements"
            />
          </label>
          <label className="field">
            <span>Key (snake_case) *</span>
            <input
              className="inp inp-sm mono" value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sla"
            />
          </label>
          <label className="field">
            <span>Route slug (kebab) *</span>
            <input
              className="inp inp-sm mono" value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="slas"
            />
          </label>
          <label className="field" style={{ gridColumn: '1 / span 2' }}>
            <span>Icon (optional lucide name)</span>
            <input
              className="inp inp-sm" value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="clock"
            />
          </label>
        </div>

        <div className="section-head" style={{ marginTop: 16 }}>
          <EditIcon size={15} className="section-icon" /> Fields
          <span className="spacer" />
          <Button variant="primary" size="sm"
            type="button"  onClick={addField}>
            <PlusIcon size={13} /> Add field
          </Button>
        </div>
        {fields.length === 0 ? (
          <div className="hint" style={{ padding: '12px 0' }}>
            No fields yet — click <strong>Add field</strong>.
          </div>
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
                {fields.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="inp inp-sm mono" value={f.key}
                        onChange={(e) => updField(i, { key: e.target.value })}
                        placeholder="field_key"
                      />
                    </td>
                    <td>
                      <input
                        className="inp inp-sm" value={f.label}
                        onChange={(e) => updField(i, { label: e.target.value })}
                        placeholder="Label"
                      />
                    </td>
                    <td>
                      <select
                        className="inp inp-sm" value={f.type}
                        onChange={(e) => updField(i, { type: e.target.value, extra: '' })}
                      >
                        {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox" checked={f.required}
                        onChange={(e) => updField(i, { required: e.target.checked })}
                      />
                    </td>
                    <td>
                      {(f.type === 'select' || f.type === 'ref') ? (
                        <input
                          className="inp inp-sm" value={f.extra}
                          placeholder={f.type === 'select' ? 'a, b, c' : 'customer'}
                          onChange={(e) => updField(i, { extra: e.target.value })}
                        />
                      ) : <span className="hint">—</span>}
                    </td>
                    <td className="actions-col">
                      <Button variant="ghost" size="sm"
            type="button" 
                        onClick={() => rmField(i)} aria-label="Remove field"
                      >
                        <CloseIcon size={13} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="section-head" style={{ marginTop: 16 }}>
          <ArrowRightIcon size={15} className="section-icon" /> Statuses
          <span className="spacer" />
          <Button variant="ghost" size="sm"
            type="button"  onClick={addStatus}>
            <PlusIcon size={13} /> Status
          </Button>
        </div>
        {statuses.length === 0 ? (
          <div className="hint" style={{ padding: '8px 0' }}>
            No statuses — click <strong>+ Status</strong> (the first added is initial; click any pill to change).
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {statuses.map((s) => (
              <span
                key={s.key}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)',
                  padding: 'var(--gx-space-2) var(--gx-space-4)',
                  // D18: active "initial status" pill = azure-soft (interactive family)
                  background: s.is_initial ? 'var(--gx-interactive-soft)' : 'var(--gx-surface-2)',
                  border: '1px solid var(--gx-border)',
                  borderRadius: 'var(--gx-radius-md)',
                  fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 'var(--gx-text-sm)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setInitial(s.key)}
                  title={s.is_initial ? 'Initial status' : 'Mark as initial'}
                  style={{
                    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--gx-text-1)',
                  }}
                >
                  {s.is_initial && '* '}{s.key}
                </button>
                <button
                  type="button"
                  onClick={() => rmStatus(s.key)}
                  aria-label={`Remove status ${s.key}`}
                  style={{
                    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'var(--gx-text-3)', display: 'inline-flex',
                  }}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="error-banner" style={{ margin: '16px 0 4px', borderLeftColor: 'var(--gx-info)', background: 'var(--gx-info-soft)' }}>
          <div style={{ color: 'var(--gx-info)', flexShrink: 0, marginTop: 1 }}><InfoIcon size={16} /></div>
          <div>
            <div className="error-banner-title" style={{ color: 'var(--gx-text-1)' }}>
              No transitions configured at create time
            </div>
            <div className="error-banner-msg">
              Add lifecycle transitions in the detail drawer after the entity is created.
            </div>
          </div>
        </div>

      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------
// MO-2 — migrated from hand-rolled `position:fixed,inset:0` chrome to the
// canonical `<Modal>`. Modal provides focus trap + Esc + body scroll lock +
// kit chrome consistently. The async error / loading states stay inline in
// the body since the legacy `confirmDialog()` promise API doesn't expose
// them; a per-confirm Modal is the right primitive here.
function ConfirmDeleteDialog({
  entityLabel, onCancel, onConfirm, deleting, err,
}: {
  entityLabel: string; onCancel: () => void; onConfirm: () => void;
  deleting: boolean; err: string
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Retire entity?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md"
            type="button"  onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" size="md"
            type="button"  onClick={onConfirm} disabled={deleting}>
            <TrashIcon size={13} /> {deleting ? 'Retiring…' : 'Retire entity'}
          </Button>
        </>
      }
    >
      <p className="hint" style={{ margin: '0 0 14px' }}>
        This will retire <strong>{entityLabel}</strong> — it disappears from the active
        entity listing and its surface stops rendering for new use. Existing records
        and audit events are preserved in the database (no data loss).
      </p>
      {err && <ErrorBanner message={err} />}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Detail drawer — Fields + Statuses + Transitions
// ---------------------------------------------------------------------------
function DetailDrawer({
  token, slug, onClose, onChanged, onDeleted,
}: {
  token: string; slug: string; onClose: () => void;
  onChanged: () => void; onDeleted: () => void
}) {
  const [detail, setDetail] = useState<EntityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  // entity-level edit (icon)
  const [iconEdit, setIconEdit] = useState('')
  const [labelEdit, setLabelEdit] = useState('')
  const [pluralEdit, setPluralEdit] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaErr, setMetaErr] = useState('')
  const [metaMsg, setMetaMsg] = useState('')

  // field editor
  const [editingFieldKey, setEditingFieldKey] = useState<string | null>(null)
  const [showAddField, setShowAddField] = useState(false)
  const [fieldErr, setFieldErr] = useState('')

  // status editor
  const [showAddStatus, setShowAddStatus] = useState(false)
  const [statusErr, setStatusErr] = useState('')

  // transitions
  const [showAddTrans, setShowAddTrans] = useState(false)
  const [transErr, setTransErr] = useState('')

  // delete confirm
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [delErr, setDelErr] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    apiFetch(token, `/meta/entities/${slug}`)
      .then((d: EntityDetail) => {
        if (!alive) return
        setDetail(d)
        setIconEdit(d.icon ?? '')
        setLabelEdit(d.label)
        setPluralEdit(d.label_plural)
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setDenied(true)
        else setError((ex as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token, slug])

  useEffect(() => load(), [load])

  async function saveMeta() {
    if (!detail) return
    setSavingMeta(true); setMetaErr(''); setMetaMsg('')
    try {
      const body: any = {}
      if (labelEdit.trim() !== detail.label) body.label = labelEdit.trim()
      if (pluralEdit.trim() !== detail.label_plural) body.label_plural = pluralEdit.trim()
      if ((iconEdit || null) !== (detail.icon || null)) body.icon = iconEdit.trim() || null
      if (Object.keys(body).length === 0) {
        setMetaMsg('No changes.')
        setSavingMeta(false)
        return
      }
      await apiFetch(token, `/meta/entities/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setMetaMsg('Saved.')
      onChanged()
      load()
    } catch (ex) {
      setMetaErr((ex as Error).message)
    } finally {
      setSavingMeta(false)
    }
  }

  async function deleteField(k: string) {
    setFieldErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/fields/${k}`, { method: 'DELETE' })
      onChanged(); load()
    } catch (ex) { setFieldErr((ex as Error).message) }
  }

  async function moveStatus(idx: number, dir: -1 | 1) {
    if (!detail) return
    const arr = [...detail.statuses]
    const ni = idx + dir
    if (ni < 0 || ni >= arr.length) return
    const tmp = arr[idx]; arr[idx] = arr[ni]; arr[ni] = tmp
    setStatusErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/statuses/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ order: arr.map((s) => s.key) }),
      })
      onChanged(); load()
    } catch (ex) { setStatusErr((ex as Error).message) }
  }

  async function deleteStatus(k: string) {
    setStatusErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/statuses/${k}`, { method: 'DELETE' })
      onChanged(); load()
    } catch (ex) { setStatusErr((ex as Error).message) }
  }

  async function setInitialStatus(k: string) {
    setStatusErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/statuses/${k}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_initial: true }),
      })
      onChanged(); load()
    } catch (ex) { setStatusErr((ex as Error).message) }
  }

  async function deleteTransition(t: Transition) {
    if (!detail) return
    const next = detail.transitions.filter(
      (x) => !(x.from === t.from && x.to === t.to),
    )
    setTransErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/transitions`, {
        method: 'PUT',
        body: JSON.stringify({ transitions: next }),
      })
      onChanged(); load()
    } catch (ex) { setTransErr((ex as Error).message) }
  }

  async function addTransition(from: string | null, to: string) {
    if (!detail) return
    setTransErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}/transitions`, {
        method: 'PUT',
        body: JSON.stringify({
          transitions: [...detail.transitions, { from, to }],
        }),
      })
      setShowAddTrans(false); onChanged(); load()
    } catch (ex) { setTransErr((ex as Error).message) }
  }

  async function deleteEntity() {
    setDeleting(true); setDelErr('')
    try {
      await apiFetch(token, `/meta/entities/${slug}`, { method: 'DELETE' })
      onDeleted()
    } catch (ex) {
      setDelErr((ex as Error).message)
      setDeleting(false)
    }
  }

  // ---- render ----
  if (loading) {
    return (
      <DrawerShell onClose={onClose} title={slug}>
        <LoadingState />
      </DrawerShell>
    )
  }
  if (denied) {
    return (
      <DrawerShell onClose={onClose} title={slug}>
        <PermissionDenied message="You don't have permission to view this entity." />
      </DrawerShell>
    )
  }
  if (error || !detail) {
    return (
      <DrawerShell onClose={onClose} title={slug}>
        <ErrorBanner message={error || 'No data'} onRetry={load} />
      </DrawerShell>
    )
  }

  return (
    <DrawerShell onClose={onClose} title={`${detail.label} (${detail.route_slug})`}>
      {/* Entity-level meta */}
      <div className="section-head" style={{ marginTop: 0 }}>
        <RowsIcon size={15} className="section-icon" /> Entity
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field">
          <span>Key (immutable)</span>
          <input className="inp inp-sm mono" value={detail.key} disabled />
        </label>
        <label className="field">
          <span>Route slug (immutable)</span>
          <input className="inp inp-sm mono" value={detail.route_slug} disabled />
        </label>
        <label className="field">
          <span>Label</span>
          <input
            className="inp inp-sm" value={labelEdit}
            onChange={(e) => setLabelEdit(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Label plural</span>
          <input
            className="inp inp-sm" value={pluralEdit}
            onChange={(e) => setPluralEdit(e.target.value)}
          />
        </label>
        <label className="field" style={{ gridColumn: '1 / span 2' }}>
          <span>Icon</span>
          <input
            className="inp inp-sm" value={iconEdit}
            onChange={(e) => setIconEdit(e.target.value)}
            placeholder="lucide icon name (e.g. clock)"
          />
        </label>
      </div>
      {metaErr && <ErrorBanner message={metaErr} />}
      {metaMsg && <div className="hint" style={{ marginTop: 8 }}>{metaMsg}</div>}
      <div className="row" style={{ marginTop: 'var(--gx-space-5)', gap: 8 }}>
        <Button variant="primary" size="sm"
            type="button" 
          onClick={saveMeta} disabled={savingMeta}>
          <CheckIcon size={13} /> {savingMeta ? 'Saving…' : 'Save metadata'}
        </Button>
      </div>

      {/* Fields */}
      <div className="section-head" style={{ marginTop: 18 }}>
        <EditIcon size={15} className="section-icon" /> Fields ({detail.fields.length})
        <span className="spacer" />
        <Button variant="primary" size="sm"
            type="button" 
          onClick={() => { setShowAddField((v) => !v); setEditingFieldKey(null) }}
        >
          <PlusIcon size={13} /> Add field
        </Button>
      </div>
      {fieldErr && <ErrorBanner message={fieldErr} />}
      {detail.fields.length === 0 ? (
        <EmptyState title="No fields yet." message="Add the first field using the button above." />
      ) : (
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Label</th>
                <th scope="col">Type</th>
                <th scope="col">Req</th>
                <th scope="col">Options / ref</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {detail.fields.map((f) =>
                editingFieldKey === f.key ? (
                  <EditFieldInline
                    key={f.key} field={f} token={token} slug={slug}
                    onDone={() => { setEditingFieldKey(null); onChanged(); load() }}
                  />
                ) : (
                  <tr key={f.key}>
                    <td><code className="mono">{f.key}</code></td>
                    <td>{f.label}</td>
                    <td><span className="hint">{f.type}</span></td>
                    <td>{f.required ? <CheckIcon size={13} /> : <span className="hint">—</span>}</td>
                    <td><span className="hint">{configExtra(f) || '—'}</span></td>
                    <td className="actions-col">
                      <div className="row-actions">
                        <Button variant="ghost" size="sm"
            type="button" 
                          aria-label={`Edit field ${f.key}`}
                          onClick={() => setEditingFieldKey(f.key)}
                        >
                          <EditIcon size={13} />
                        </Button>
                        <Button variant="ghost" size="sm"
            type="button" 
                          aria-label={`Delete field ${f.key}`}
                          onClick={() => deleteField(f.key)}
                        >
                          <TrashIcon size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {showAddField && (
        <AddFieldInline
          token={token} slug={slug}
          onAdded={() => { setShowAddField(false); onChanged(); load() }}
          onCancel={() => setShowAddField(false)}
        />
      )}

      {/* Statuses */}
      <div className="section-head" style={{ marginTop: 18 }}>
        <ArrowRightIcon size={15} className="section-icon" /> Statuses ({detail.statuses.length})
        <span className="spacer" />
        <Button variant="primary" size="sm"
            type="button" 
          onClick={() => setShowAddStatus((v) => !v)}
        >
          <PlusIcon size={13} /> Add status
        </Button>
      </div>
      {statusErr && <ErrorBanner message={statusErr} />}
      {detail.statuses.length === 0 ? (
        <EmptyState title="No statuses yet." message="Add lifecycle statuses using the button above." />
      ) : (
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Key</th>
                <th scope="col">Label</th>
                <th scope="col">Initial</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {detail.statuses.map((s, i) => (
                <tr key={s.key}>
                  <td>
                    <div className="row-actions">
                      <Button variant="ghost" size="sm"
            type="button" 
                        disabled={i === 0}
                        onClick={() => moveStatus(i, -1)}
                        aria-label="Move up"
                      >
                        <ArrowUpIcon size={13} />
                      </Button>
                      <Button variant="ghost" size="sm"
            type="button" 
                        disabled={i === detail.statuses.length - 1}
                        onClick={() => moveStatus(i, 1)}
                        aria-label="Move down"
                      >
                        <ArrowDownIcon size={13} />
                      </Button>
                    </div>
                  </td>
                  <td><code className="mono">{s.key}</code></td>
                  <td>{s.label}</td>
                  <td>
                    {s.is_initial ? (
                      <CheckIcon size={13} />
                    ) : (
                      <Button variant="ghost" size="sm"
            type="button" 
                        onClick={() => setInitialStatus(s.key)}
                      >
                        Set initial
                      </Button>
                    )}
                  </td>
                  <td className="actions-col">
                    <Button variant="ghost" size="sm"
            type="button" 
                      onClick={() => deleteStatus(s.key)}
                      aria-label={`Delete status ${s.key}`}
                    >
                      <TrashIcon size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showAddStatus && (
        <AddStatusInline
          token={token} slug={slug}
          onAdded={() => { setShowAddStatus(false); onChanged(); load() }}
          onCancel={() => setShowAddStatus(false)}
        />
      )}

      {/* Transitions */}
      <div className="section-head" style={{ marginTop: 18 }}>
        <ArrowRightIcon size={15} className="section-icon" /> Transitions ({detail.transitions.length})
        <span className="spacer" />
        <Button variant="primary" size="sm"
            type="button" 
          onClick={() => setShowAddTrans((v) => !v)}
          disabled={detail.statuses.length === 0}
          title={detail.statuses.length === 0 ? 'Add statuses first' : 'Add transition'}
        >
          <PlusIcon size={13} /> Add transition
        </Button>
      </div>
      {transErr && <ErrorBanner message={transErr} />}
      {detail.transitions.length === 0 ? (
        <EmptyState
          title="No transitions configured."
          message="Define from → to edges so records can flow through the lifecycle."
        />
      ) : (
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {detail.transitions.map((t, i) => (
                <tr key={`${t.from ?? ''}->${t.to}-${i}`}>
                  <td><span className="hint mono">{t.from ?? '(initial)'}</span></td>
                  <td><span className="mono">{t.to}</span></td>
                  <td className="actions-col">
                    <Button variant="ghost" size="sm"
            type="button" 
                      onClick={() => deleteTransition(t)}
                      aria-label={`Delete transition ${t.from ?? '(initial)'} → ${t.to}`}
                    >
                      <TrashIcon size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showAddTrans && detail.statuses.length > 0 && (
        <AddTransitionInline
          statuses={detail.statuses}
          onAdded={(from, to) => addTransition(from, to)}
          onCancel={() => setShowAddTrans(false)}
        />
      )}

      {/* Danger zone */}
      <div className="section-head" style={{ marginTop: 22 }}>
        <TrashIcon size={15} className="section-icon" /> Danger zone
      </div>
      <div
        style={{
          padding: 'var(--gx-space-7)',
          border: '1px solid var(--gx-border)',
          borderRadius: 'var(--gx-radius-md)',
          background: 'var(--gx-surface-2)',
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <strong>Retire this entity</strong>
        </div>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          Removes <code className="mono">{detail.route_slug}</code> from the active entity list.
          Existing records and audit history are preserved (soft-retire).
        </p>
        <Button variant="danger" size="sm"
            type="button" 
          onClick={() => setConfirmDel(true)}
        >
          <TrashIcon size={13} /> Retire entity
        </Button>
      </div>

      {confirmDel && (
        <ConfirmDeleteDialog
          entityLabel={detail.label}
          onCancel={() => setConfirmDel(false)}
          onConfirm={deleteEntity}
          deleting={deleting}
          err={delErr}
        />
      )}
    </DrawerShell>
  )
}

// DR-4 — `DrawerShell` now wraps the canonical `<StudioDrawer>` primitive.
// The local component remains as a 1-line shim so existing call sites don't
// have to update their JSX in this PR; future PRs may remove it.
function DrawerShell({
  onClose, title, children,
}: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <StudioDrawer open onClose={onClose} title={title} bodyPadding={20}>
      {children}
    </StudioDrawer>
  )
}

// inline add-field form
function AddFieldInline({
  token, slug, onAdded, onCancel,
}: { token: string; slug: string; onAdded: () => void; onCancel: () => void }) {
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
      await apiFetch(token, `/meta/entities/${slug}/fields`, {
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
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} style={{ marginTop: 8 }} />
        </label>
        <label className="field"><span>{type === 'select' ? 'Options' : type === 'ref' ? 'Target' : '—'}</span>
          <input
            className="inp inp-sm" value={extra}
            onChange={(e) => setExtra(e.target.value)}
            disabled={type !== 'select' && type !== 'ref'}
            placeholder={type === 'select' ? 'a, b, c' : 'customer'}
          />
        </label>
        <div className="row-actions" style={{ paddingBottom: 2 }}>
          <Button variant="gold" size="sm"
            type="submit"  disabled={saving}>
            <CheckIcon size={13} />
          </Button>
          <Button variant="ghost" size="sm"
            type="button"  onClick={onCancel} disabled={saving}>
            <CloseIcon size={13} />
          </Button>
        </div>
      </div>
    </form>
  )
}

// inline edit-field row
function EditFieldInline({
  field, token, slug, onDone,
}: { field: FieldDef; token: string; slug: string; onDone: () => void }) {
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
      await apiFetch(token, `/meta/entities/${slug}/fields/${field.key}`, {
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
            <Button variant="gold" size="sm"
            type="button"  onClick={save} disabled={saving}>
              <CheckIcon size={13} />
            </Button>
            <Button variant="ghost" size="sm"
            type="button"  onClick={onDone} disabled={saving}>
              <CloseIcon size={13} />
            </Button>
          </div>
        </td>
      </tr>
    </>
  )
}

// inline add-status form
function AddStatusInline({
  token, slug, onAdded, onCancel,
}: { token: string; slug: string; onAdded: () => void; onCancel: () => void }) {
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
      await apiFetch(token, `/meta/entities/${slug}/statuses`, {
        method: 'POST',
        body: JSON.stringify({
          key: upperKey,
          label: label.trim() || upperKey,
          is_initial: isInitial,
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
          <input type="checkbox" checked={isInitial} onChange={(e) => setIsInitial(e.target.checked)} style={{ marginTop: 8 }} />
        </label>
        <div className="row-actions" style={{ paddingBottom: 2 }}>
          <Button variant="gold" size="sm"
            type="submit"  disabled={saving}>
            <CheckIcon size={13} />
          </Button>
          <Button variant="ghost" size="sm"
            type="button"  onClick={onCancel} disabled={saving}>
            <CloseIcon size={13} />
          </Button>
        </div>
      </div>
    </form>
  )
}

// inline add-transition form
function AddTransitionInline({
  statuses, onAdded, onCancel,
}: {
  statuses: StatusDefT[]; onAdded: (from: string | null, to: string) => void; onCancel: () => void
}) {
  const [from, setFrom] = useState<string>('__initial__')
  const [to, setTo] = useState<string>(statuses[0]?.key ?? '')

  async function save(e: React.FormEvent) {
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
        <div className="row-actions" style={{ paddingBottom: 2 }}>
          <Button variant="gold" size="sm"
            type="submit">
            <CheckIcon size={13} />
          </Button>
          <Button variant="ghost" size="sm"
            type="button"  onClick={onCancel}>
            <CloseIcon size={13} />
          </Button>
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------
export default function EntitiesPane({ token }: { token: string }) {
  const [entities, setEntities] = useState<EntitySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    apiFetch(token, '/meta/entities')
      .then((d: EntitySummary[]) => {
        if (!alive) return
        setEntities(Array.isArray(d) ? d : [])
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setDenied(true)
        else setError((ex as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  useEffect(() => load(), [load])

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to manage entities." />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  const filtered = search.trim()
    ? entities.filter((e) =>
        e.label.toLowerCase().includes(search.toLowerCase()) ||
        e.route_slug.toLowerCase().includes(search.toLowerCase()) ||
        e.key.toLowerCase().includes(search.toLowerCase()),
      )
    : entities

  return (
    <div>
      <div className="row" style={{ marginBottom: 'var(--gx-space-5)', alignItems: 'flex-end' }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Entities</h3>
          <p className="hint" style={{ margin: 0 }}>
            Entities are the system's living configuration — fields and statuses applied to every record.
            Stand up a new entity here and it appears in the sidebar instantly.
          </p>
        </div>
        <span className="spacer" />
        <Button variant="primary" size="md"
            type="button" 
          onClick={() => setShowCreate(true)}
        >
          <PlusIcon size={13} /> New entity
        </Button>
      </div>

      <div style={{ marginBottom: 'var(--gx-space-4)', maxWidth: 320 }}>
        <input
          className="inp inp-md"
          placeholder="Filter by label, key, or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={search ? 'No entities match the filter.' : 'No entities yet.'}
          message={search ? 'Try a different query.' : 'Create the first entity using "New entity" above.'}
        />
      ) : (
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Key</th>
                <th scope="col">Route</th>
                <th scope="col">Icon</th>
                <th scope="col">Status</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr
                  key={e.route_slug}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOpenSlug(e.route_slug)}
                >
                  <td>{e.label}</td>
                  <td><code className="mono">{e.key}</code></td>
                  <td><code className="mono">{e.route_slug}</code></td>
                  <td><span className="hint">{e.icon ?? '—'}</span></td>
                  <td>
                    <span className="hint">{e.status}</span>
                  </td>
                  <td className="actions-col">
                    <Button variant="ghost" size="sm"
            type="button" 
                      onClick={(ev) => { ev.stopPropagation(); setOpenSlug(e.route_slug) }}
                      aria-label={`Open ${e.label}`}
                    >
                      <EditIcon size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateEntityModal
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={(slug) => {
            setShowCreate(false)
            load()
            setOpenSlug(slug)
          }}
        />
      )}

      {openSlug && (
        <DetailDrawer
          token={token}
          slug={openSlug}
          onClose={() => setOpenSlug(null)}
          onChanged={() => load()}
          onDeleted={() => { setOpenSlug(null); load() }}
        />
      )}
    </div>
  )
}
