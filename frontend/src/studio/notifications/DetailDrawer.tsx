// DetailDrawer — edit + preview + test-send + delete for a notification def.

import { useCallback, useEffect, useState } from 'react'
import { LoadingState, ErrorBanner, PermissionDenied } from '../../components/States'
import { Button, StudioDrawer } from '../../primitives'
import {
  EditIcon, CheckIcon, RowsIcon, TrashIcon,
  PlayIcon, SendHorizontalIcon, ZapIcon,
} from '../../components/icons'
import { CATEGORIES, PRIORITIES, NotifDef, FetchError, apiFetch } from './types'
import { ConfirmDeleteDialog, ConfirmTestSendDialog } from './ConfirmDialogs'

// DR-4 — `DrawerShell` wraps the canonical `<StudioDrawer>` primitive.
function DrawerShell({
  onClose, title, children,
}: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <StudioDrawer open onClose={onClose} title={title} bodyPadding={20}>
      {children}
    </StudioDrawer>
  )
}

export function DetailDrawer({
  token, defKey, onClose, onChanged, onDeleted,
}: {
  token: string; defKey: string
  onClose: () => void; onChanged: () => void; onDeleted: () => void
}) {
  const [detail, setDetail] = useState<NotifDef | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  // editable mirror
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState('system')
  const [priority, setPriority] = useState('info')
  const [titleT, setTitleT] = useState('')
  const [bodyT, setBodyT] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [cond, setCond] = useState('')

  const [savingMeta, setSavingMeta] = useState(false)
  const [metaErr, setMetaErr] = useState('')
  const [metaMsg, setMetaMsg] = useState('')

  // preview
  const [previewCtx, setPreviewCtx] = useState('{}')
  const [previewing, setPreviewing] = useState(false)
  const [previewErr, setPreviewErr] = useState('')
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null)

  // test-send
  const [confirmSend, setConfirmSend] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // delete
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [delErr, setDelErr] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    apiFetch(token, `/meta/notification-defs/${encodeURIComponent(defKey)}`)
      .then((d: NotifDef) => {
        if (!alive) return
        setDetail(d)
        setLabel(d.label)
        setCategory(d.category)
        setPriority(d.priority)
        setTitleT(d.title_template)
        setBodyT(d.body_template)
        setEnabled(d.enabled)
        setCond(d.gxl_condition ?? '')
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setDenied(true)
        else setError((ex as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token, defKey])

  useEffect(() => load(), [load])

  async function saveMeta() {
    if (!detail) return
    setSavingMeta(true); setMetaErr(''); setMetaMsg('')
    try {
      const body: any = {}
      if (label.trim() !== detail.label) body.label = label.trim()
      if (category !== detail.category) body.category = category
      if (priority !== detail.priority) body.priority = priority
      if (titleT !== detail.title_template) body.title_template = titleT
      if (bodyT !== detail.body_template) body.body_template = bodyT
      if (enabled !== detail.enabled) body.enabled = enabled
      if ((cond.trim() || null) !== (detail.gxl_condition || null)) {
        body.gxl_condition = cond.trim() || null
      }
      if (Object.keys(body).length === 0) {
        setMetaMsg('No changes.')
        setSavingMeta(false)
        return
      }
      await apiFetch(token, `/meta/notification-defs/${encodeURIComponent(defKey)}`, {
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

  async function runPreview() {
    setPreviewing(true); setPreviewErr(''); setPreview(null)
    try {
      let ctx: any = {}
      const raw = previewCtx.trim()
      if (raw) {
        try { ctx = JSON.parse(raw) } catch {
          throw new Error('Sample context is not valid JSON.')
        }
        if (typeof ctx !== 'object' || Array.isArray(ctx)) {
          throw new Error('Sample context must be a JSON object.')
        }
      }
      const r = await apiFetch(token, `/meta/notification-defs/${encodeURIComponent(defKey)}/preview`, {
        method: 'POST',
        body: JSON.stringify({ context: ctx }),
      })
      setPreview({ title: r.title, body: r.body })
    } catch (ex) {
      setPreviewErr((ex as Error).message)
    } finally {
      setPreviewing(false)
    }
  }

  async function runTestSend() {
    setSending(true); setSendResult(null)
    try {
      let ctx: any = {}
      const raw = previewCtx.trim()
      if (raw) {
        try { ctx = JSON.parse(raw) } catch { ctx = {} }
      }
      const r = await apiFetch(token, `/meta/notification-defs/${encodeURIComponent(defKey)}/test-send`, {
        method: 'POST',
        body: JSON.stringify({ context: ctx }),
      })
      if (r.delivered) {
        setSendResult({ ok: true, msg: `Delivered (inbox row id ${r.notification_id ?? '?'}).` })
      } else {
        setSendResult({ ok: false, msg: `Not delivered — ${r.reason ?? 'adapter unavailable'}.` })
      }
    } catch (ex) {
      setSendResult({ ok: false, msg: (ex as Error).message })
    } finally {
      setSending(false)
      setConfirmSend(false)
    }
  }

  async function deleteDef() {
    setDeleting(true); setDelErr('')
    try {
      await apiFetch(token, `/meta/notification-defs/${encodeURIComponent(defKey)}`, { method: 'DELETE' })
      onDeleted()
    } catch (ex) {
      setDelErr((ex as Error).message)
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <DrawerShell onClose={onClose} title={defKey}>
        <LoadingState />
      </DrawerShell>
    )
  }
  if (denied) {
    return (
      <DrawerShell onClose={onClose} title={defKey}>
        <PermissionDenied message="You don't have permission to view this notification def." />
      </DrawerShell>
    )
  }
  if (error || !detail) {
    return (
      <DrawerShell onClose={onClose} title={defKey}>
        <ErrorBanner message={error || 'No data'} onRetry={load} />
      </DrawerShell>
    )
  }

  return (
    <DrawerShell onClose={onClose} title={`${detail.label} (${detail.key})`}>
      {/* identity */}
      <div className="section-head" style={{ marginTop: 0 }}>
        <RowsIcon size={15} className="section-icon" /> Identity
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gx-space-5)' }}>
        <label className="field">
          <span>Key (immutable)</span>
          <input className="inp inp-sm mono" value={detail.key} disabled />
        </label>
        <label className="field">
          <span>Channel (immutable on this surface)</span>
          <input className="inp inp-sm mono" value={detail.channel} disabled />
        </label>
        <label className="field">
          <span>Label</span>
          <input
            className="inp inp-sm" value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Category</span>
          <select
            className="inp inp-sm" value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select
            className="inp inp-sm" value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="field" style={{ alignSelf: 'end' }}>
          <span>Enabled</span>
          <div style={{ marginTop: 'var(--gx-space-4)' }}>
            <input
              type="checkbox" checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </div>
        </label>
      </div>

      <div className="section-head" style={{ marginTop: 'var(--gx-space-18)' }}>
        <EditIcon size={15} className="section-icon" /> Templates
      </div>
      <label className="field">
        <span>Title template</span>
        <input
          className="inp inp-sm" value={titleT}
          onChange={(e) => setTitleT(e.target.value)}
        />
      </label>
      <label className="field" style={{ marginTop: 'var(--gx-space-4)' }}>
        <span>Body template</span>
        <textarea
          className="inp inp-sm" rows={3} value={bodyT}
          onChange={(e) => setBodyT(e.target.value)}
          style={{ fontFamily: 'inherit', resize: 'vertical' }}
        />
      </label>

      <div className="section-head" style={{ marginTop: 'var(--gx-space-18)' }}>
        <ZapIcon size={15} className="section-icon" /> GXL condition
      </div>
      <label className="field">
        <span>Condition (leave empty for unconditional emit)</span>
        <input
          className="inp inp-sm mono" value={cond}
          onChange={(e) => setCond(e.target.value)}
          placeholder="priority == 'high'"
        />
      </label>

      {metaErr && <ErrorBanner message={metaErr} />}
      {metaMsg && <div className="hint" style={{ marginTop: 'var(--gx-space-4)' }}>{metaMsg}</div>}
      <div className="row" style={{ marginTop: 'var(--gx-space-5)', gap: 'var(--gx-space-4)' }}>
        <Button variant="primary" size="sm"
            type="button"
          onClick={saveMeta} disabled={savingMeta}>
          <CheckIcon size={13} /> {savingMeta ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      {/* preview + test-send */}
      <div className="section-head" style={{ marginTop: 22 }}>
        <PlayIcon size={15} className="section-icon" /> Preview &amp; test
      </div>
      <label className="field">
        <span>Sample context (JSON)</span>
        <textarea
          className="inp inp-sm mono" rows={3} value={previewCtx}
          onChange={(e) => setPreviewCtx(e.target.value)}
          placeholder='{"customer_name":"Acme Corp","amount":"10000"}'
          style={{ resize: 'vertical' }}
        />
      </label>
      <div className="row" style={{ marginTop: 'var(--gx-space-5)', gap: 'var(--gx-space-4)' }}>
        <Button variant="ghost" size="sm"
            type="button"
          onClick={runPreview} disabled={previewing}>
          <PlayIcon size={13} /> {previewing ? 'Rendering…' : 'Preview'}
        </Button>
        <Button variant="primary" size="sm"
            type="button"
          onClick={() => setConfirmSend(true)} disabled={sending}
        >
          <SendHorizontalIcon size={13} /> {sending ? 'Sending…' : 'Test send'}
        </Button>
      </div>
      {previewErr && <div style={{ marginTop: 'var(--gx-space-4)' }}><ErrorBanner message={previewErr} /></div>}
      {preview && (
        <div
          style={{
            marginTop: 'var(--gx-space-5)', padding: 'var(--gx-space-4)',
            border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)',
            background: 'var(--gx-surface-2)',
          }}
        >
          <div className="hint" style={{ marginBottom: 'var(--gx-space-2)', fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Rendered title
          </div>
          <div style={{ fontWeight: 'var(--gx-weight-semibold)', marginBottom: 'var(--gx-space-4)' }}>{preview.title}</div>
          <div className="hint" style={{ marginBottom: 'var(--gx-space-2)', fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Rendered body
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{preview.body}</div>
        </div>
      )}
      {sendResult && (
        <div
          style={{
            marginTop: 'var(--gx-space-5)', padding: 'var(--gx-space-5)',
            border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)',
            background: sendResult.ok ? 'var(--gx-success-soft, var(--gx-surface-2))' : 'var(--gx-warning-soft, var(--gx-surface-2))',
            color: 'var(--gx-text-1)',
          }}
        >
          <strong>{sendResult.ok ? 'Test send delivered' : 'Test send not delivered'}</strong>
          <div className="hint" style={{ marginTop: 'var(--gx-space-1)' }}>{sendResult.msg}</div>
        </div>
      )}

      {/* danger zone */}
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
          <strong>Delete this notification def</strong>
        </div>
        <p className="hint" style={{ margin: '0 0 var(--gx-space-5)' }}>
          Hard-delete <code className="mono">{detail.key}</code>. To soft-retire instead, toggle
          <strong> Enabled</strong> off in Identity above and Save — future emits become no-ops
          while history is preserved.
        </p>
        <Button variant="danger" size="sm"
            type="button"
          onClick={() => setConfirmDel(true)}
        >
          <TrashIcon size={13} /> Delete def
        </Button>
      </div>

      {confirmSend && (
        <ConfirmTestSendDialog
          defKey={detail.key} channel={detail.channel}
          onCancel={() => setConfirmSend(false)}
          onConfirm={runTestSend}
          sending={sending}
        />
      )}
      {confirmDel && (
        <ConfirmDeleteDialog
          defLabel={detail.label} defKey={detail.key}
          onCancel={() => setConfirmDel(false)}
          onConfirm={deleteDef}
          deleting={deleting}
          err={delErr}
        />
      )}
    </DrawerShell>
  )
}
