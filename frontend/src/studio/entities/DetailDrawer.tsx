import { useCallback, useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../../components/States'
import { Modal } from '../../components/Modal'
import { Button, StudioDrawer } from '../../primitives'
import {
  EditIcon, PlusIcon, CheckIcon, RowsIcon, TrashIcon,
  ArrowUpIcon, ArrowDownIcon, ArrowRightIcon,
} from '../../components/icons'
import type { EntityDetail, Transition } from './types'
import { FetchError } from './types'
import { apiFetch } from './api'
import { AddFieldInline, EditFieldInline, AddStatusInline, AddTransitionInline } from './InlineEditors'
import { configExtra } from './types'

function DrawerShell({
  onClose, title, children,
}: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <StudioDrawer open onClose={onClose} title={title} bodyPadding={20}>
      {children}
    </StudioDrawer>
  )
}

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
          <Button variant="ghost" size="md" type="button" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" size="md" type="button" onClick={onConfirm} disabled={deleting}>
            <TrashIcon size={13} /> {deleting ? 'Retiring…' : 'Retire entity'}
          </Button>
        </>
      }
    >
      <p className="hint" style={{ margin: '0 0 var(--gx-space-7)' }}>
        This will retire <strong>{entityLabel}</strong> — it disappears from the active
        entity listing and its surface stops rendering for new use. Existing records
        and audit events are preserved in the database (no data loss).
      </p>
      {err && <ErrorBanner message={err} />}
    </Modal>
  )
}

export function DetailDrawer({
  token, slug, onClose, onChanged, onDeleted,
}: {
  token: string; slug: string; onClose: () => void;
  onChanged: () => void; onDeleted: () => void
}) {
  const [detail, setDetail] = useState<EntityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  const [iconEdit, setIconEdit] = useState('')
  const [labelEdit, setLabelEdit] = useState('')
  const [pluralEdit, setPluralEdit] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaErr, setMetaErr] = useState('')
  const [metaMsg, setMetaMsg] = useState('')

  const [editingFieldKey, setEditingFieldKey] = useState<string | null>(null)
  const [showAddField, setShowAddField] = useState(false)
  const [fieldErr, setFieldErr] = useState('')

  const [showAddStatus, setShowAddStatus] = useState(false)
  const [statusErr, setStatusErr] = useState('')

  const [showAddTrans, setShowAddTrans] = useState(false)
  const [transErr, setTransErr] = useState('')

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
      if (Object.keys(body).length === 0) { setMetaMsg('No changes.'); setSavingMeta(false); return }
      await apiFetch(token, `/meta/entities/${slug}`, { method: 'PATCH', body: JSON.stringify(body) })
      setMetaMsg('Saved.')
      onChanged(); load()
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
    const next = detail.transitions.filter((x) => !(x.from === t.from && x.to === t.to))
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
        body: JSON.stringify({ transitions: [...detail.transitions, { from, to }] }),
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

  if (loading) return <DrawerShell onClose={onClose} title={slug}><LoadingState /></DrawerShell>
  if (denied) return <DrawerShell onClose={onClose} title={slug}><PermissionDenied message="You don't have permission to view this entity." /></DrawerShell>
  if (error || !detail) return <DrawerShell onClose={onClose} title={slug}><ErrorBanner message={error || 'No data'} onRetry={load} /></DrawerShell>

  return (
    <DrawerShell onClose={onClose} title={`${detail.label} (${detail.route_slug})`}>
      <div className="section-head" style={{ marginTop: 0 }}>
        <RowsIcon size={15} className="section-icon" /> Entity
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-5)' }}>
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
          <input className="inp inp-sm" value={labelEdit} onChange={(e) => setLabelEdit(e.target.value)} />
        </label>
        <label className="field">
          <span>Label plural</span>
          <input className="inp inp-sm" value={pluralEdit} onChange={(e) => setPluralEdit(e.target.value)} />
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
      {metaMsg && <div className="hint" style={{ marginTop: 'var(--gx-space-4)' }}>{metaMsg}</div>}
      <div className="row" style={{ marginTop: 'var(--gx-space-5)', gap: 'var(--gx-space-4)' }}>
        <Button variant="primary" size="sm" type="button" onClick={saveMeta} disabled={savingMeta}>
          <CheckIcon size={13} /> {savingMeta ? 'Saving…' : 'Save metadata'}
        </Button>
      </div>

      <div className="section-head" style={{ marginTop: 'var(--gx-space-18)' }}>
        <EditIcon size={15} className="section-icon" /> Fields ({detail.fields.length})
        <span className="spacer" />
        <Button variant="primary" size="sm" type="button"
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
                        <Button variant="ghost" size="sm" type="button"
                          aria-label={`Edit field ${f.key}`}
                          onClick={() => setEditingFieldKey(f.key)}
                        >
                          <EditIcon size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" type="button"
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

      <div className="section-head" style={{ marginTop: 'var(--gx-space-18)' }}>
        <ArrowRightIcon size={15} className="section-icon" /> Statuses ({detail.statuses.length})
        <span className="spacer" />
        <Button variant="primary" size="sm" type="button" onClick={() => setShowAddStatus((v) => !v)}>
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
                      <Button variant="ghost" size="sm" type="button"
                        disabled={i === 0} onClick={() => moveStatus(i, -1)} aria-label="Move up"
                      >
                        <ArrowUpIcon size={13} />
                      </Button>
                      <Button variant="ghost" size="sm" type="button"
                        disabled={i === detail.statuses.length - 1} onClick={() => moveStatus(i, 1)} aria-label="Move down"
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
                      <Button variant="ghost" size="sm" type="button" onClick={() => setInitialStatus(s.key)}>
                        Set initial
                      </Button>
                    )}
                  </td>
                  <td className="actions-col">
                    <Button variant="ghost" size="sm" type="button"
                      onClick={() => deleteStatus(s.key)} aria-label={`Delete status ${s.key}`}
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

      <div className="section-head" style={{ marginTop: 'var(--gx-space-18)' }}>
        <ArrowRightIcon size={15} className="section-icon" /> Transitions ({detail.transitions.length})
        <span className="spacer" />
        <Button variant="primary" size="sm" type="button"
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
                    <Button variant="ghost" size="sm" type="button"
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
        <div style={{ marginBottom: 'var(--gx-space-4)' }}>
          <strong>Retire this entity</strong>
        </div>
        <p className="hint" style={{ margin: '0 0 var(--gx-space-5)' }}>
          Removes <code className="mono">{detail.route_slug}</code> from the active entity list.
          Existing records and audit history are preserved (soft-retire).
        </p>
        <Button variant="danger" size="sm" type="button" onClick={() => setConfirmDel(true)}>
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
