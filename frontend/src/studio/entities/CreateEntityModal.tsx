import { useState } from 'react'
import { Modal, ModalFooterActions } from '../../components/Modal'
import { Button } from '../../primitives'
import {
  RowsIcon, EditIcon, PlusIcon, CloseIcon, ArrowRightIcon, InfoIcon,
} from '../../components/icons'
import { ErrorBanner } from '../../components/States'
import type { DraftField, DraftStatus } from './types'
import { FIELD_TYPES, buildConfig } from './types'
import { apiFetch } from './api'
import { useAuth } from '../../context/AuthContext'

export function CreateEntityModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (slug: string) => void }) {
  const { token } = useAuth()
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
      await apiFetch(token!, '/meta/entities', { method: 'POST', body: JSON.stringify(payload) })
      onCreated(slug.trim())
    } catch (ex) {
      setErr((ex as Error).message)
      setSaving(false)
    }
  }

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

        <div className="section-head" style={{ marginTop: 'var(--gx-space-2)' }}>
          <RowsIcon size={15} className="section-icon" /> Identity
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-5)' }}>
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

        <div className="section-head" style={{ marginTop: 'var(--gx-space-8)' }}>
          <EditIcon size={15} className="section-icon" /> Fields
          <span className="spacer" />
          <Button variant="primary" size="sm" type="button" onClick={addField}>
            <PlusIcon size={13} /> Add field
          </Button>
        </div>
        {fields.length === 0 ? (
          <div className="hint" style={{ padding: 'var(--gx-space-6) 0' }}>
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
                      <Button variant="ghost" size="sm" type="button"
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

        <div className="section-head" style={{ marginTop: 'var(--gx-space-8)' }}>
          <ArrowRightIcon size={15} className="section-icon" /> Statuses
          <span className="spacer" />
          <Button variant="ghost" size="sm" type="button" onClick={addStatus}>
            <PlusIcon size={13} /> Status
          </Button>
        </div>
        {statuses.length === 0 ? (
          <div className="hint" style={{ padding: 'var(--gx-space-4) 0' }}>
            No statuses — click <strong>+ Status</strong> (the first added is initial; click any pill to change).
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-4)' }}>
            {statuses.map((s) => (
              <span
                key={s.key}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)',
                  padding: 'var(--gx-space-2) var(--gx-space-4)',
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
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--gx-text-1)' }}
                >
                  {s.is_initial && '* '}{s.key}
                </button>
                <button
                  type="button"
                  onClick={() => rmStatus(s.key)}
                  aria-label={`Remove status ${s.key}`}
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--gx-text-3)', display: 'inline-flex' }}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="error-banner" style={{ margin: 'var(--gx-space-8) 0 var(--gx-space-2)', borderLeftColor: 'var(--gx-info)', background: 'var(--gx-info-soft)' }}>
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
