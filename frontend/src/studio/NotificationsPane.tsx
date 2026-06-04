// NotificationsPane — real backend-wired pane for the Studio Notifications group.
//
// ONE shared component drives all five Notifications leaves (email / SMS / push / in-app
// templates + Notification Rules) — DRY by design, per Gev's directive. The behavior is
// parametrized by:
//   - channel  — filters the list and locks the channel on the create form
//                ('email' | 'sms' | 'push' | 'inapp')
//   - rulesView — list and create rules (templates with a gxl_condition)
//
// Wiring:
//   GET    /meta/notification-defs[?channel=...]    → list view
//   GET    /meta/notification-defs/{key}            → detail
//   POST   /meta/notification-defs                  → create  (409 on duplicate key)
//   PATCH  /meta/notification-defs/{key}            → update
//   DELETE /meta/notification-defs/{key}            → hard delete
//   POST   /meta/notification-defs/{key}/preview    → render title+body with sample context
//   POST   /meta/notification-defs/{key}/test-send  → emit one notification to the caller
//
// Every write is gated server-side by `config.manage` (see backend/app/routers/notification_defs.py).
// 403 → <PermissionDenied/>. Other errors → <ErrorBanner/>. No mock data anywhere.
//
// Tokens: --gx-* only, no raw hex. Icons: lucide via ../components/icons.

import { useCallback, useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { Modal, ModalFooterActions } from '../components/Modal'  // MO-1/2/3 — canonical modal chrome
import { StudioDrawer } from '../primitives'  // DR-1
import {
  EditIcon, PlusIcon, CloseIcon, CheckIcon, RowsIcon, TrashIcon,
  PlayIcon, SendHorizontalIcon, ZapIcon,
} from '../components/icons'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

const CATEGORIES = ['system', 'billing', 'network', 'customer', 'internal']
const PRIORITIES = ['critical', 'warning', 'info']

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
type NotifChannel = 'email' | 'sms' | 'push' | 'inapp'

type NotifDef = {
  key: string
  label: string
  channel: string
  category: string
  priority: string
  title_template: string
  body_template: string
  enabled: boolean
  gxl_condition: string | null
  created_at: string | null
}

type Props = {
  token: string
  /** When set, the list is filtered by channel and the create form locks `channel`. */
  channel?: NotifChannel
  /** When true, surface notification rules (any def with a non-empty gxl_condition). */
  rulesView?: boolean
}

const CHANNEL_LABELS: Record<NotifChannel, string> = {
  email: 'Email Templates',
  sms: 'SMS Templates',
  push: 'Push Notifications',
  inapp: 'In-App Notifications',
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------
function CreateDefModal({
  token, channel, rulesView, onClose, onCreated,
}: {
  token: string
  channel?: NotifChannel
  rulesView?: boolean
  onClose: () => void
  onCreated: (key: string) => void
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [chosenChannel, setChosenChannel] = useState<string>(channel ?? 'inapp')
  const [category, setCategory] = useState('system')
  const [priority, setPriority] = useState('info')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [cond, setCond] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim() || !key.trim() || !title.trim() || !body.trim()) {
      setErr('Key, label, title template and body template are required.')
      return
    }
    if (rulesView && !cond.trim()) {
      setErr('A rule requires a GXL condition.')
      return
    }
    setSaving(true); setErr('')
    try {
      const payload: any = {
        key: key.trim(),
        label: label.trim(),
        channel: chosenChannel,
        category, priority,
        title_template: title,
        body_template: body,
        enabled: true,
      }
      if (cond.trim()) payload.gxl_condition = cond.trim()
      await apiFetch(token, '/meta/notification-defs', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      onCreated(key.trim())
    } catch (ex) {
      setErr((ex as Error).message)
      setSaving(false)
    }
  }

  const heading = rulesView ? 'New notification rule' : 'New template'
  const submitLabel = rulesView ? 'Create rule' : 'Create template'

  // MO-1 — migrated from hand-rolled fixed-overlay chrome to `<Modal>`. The
  // form submits through the footer's "Confirm" button via the standard
  // `form="notif-def-create-form"` HTML attribute.
  return (
    <Modal
      open
      onClose={() => { if (!saving) onClose() }}
      title={heading}
      size="lg"
      footer={
        <ModalFooterActions
          onCancel={onClose}
          onConfirm={() => {
            const f = document.getElementById('notif-def-create-form') as HTMLFormElement | null
            if (f) f.requestSubmit()
          }}
          confirmLabel={saving ? 'Creating…' : submitLabel}
          confirmDisabled={saving}
        />
      }
    >
      <form id="notif-def-create-form" onSubmit={submit}>
        {err && <ErrorBanner message={err} />}

        <div className="section-head" style={{ marginTop: 4 }}>
          <RowsIcon size={15} className="section-icon" /> Identity
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">
            <span>Key (unique) *</span>
            <input
              className="inp inp-sm mono" value={key} autoFocus
              onChange={(e) => setKey(e.target.value)}
              placeholder="ticket.opened"
            />
          </label>
          <label className="field">
            <span>Label *</span>
            <input
              className="inp inp-sm" value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ticket opened"
            />
          </label>

          {channel ? (
            <label className="field">
              <span>Channel</span>
              <input className="inp inp-sm mono" value={channel} disabled />
            </label>
          ) : (
            <label className="field">
              <span>Channel</span>
              <select
                className="inp inp-sm" value={chosenChannel}
                onChange={(e) => setChosenChannel(e.target.value)}
              >
                <option value="inapp">inapp</option>
                <option value="email">email</option>
                <option value="sms">sms</option>
                <option value="push">push</option>
                <option value="webhook">webhook</option>
                <option value="console">console</option>
              </select>
            </label>
          )}

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
        </div>

        <div className="section-head" style={{ marginTop: 16 }}>
          <EditIcon size={15} className="section-icon" /> Templates
        </div>
        <label className="field">
          <span>Title template *</span>
          <input
            className="inp inp-sm" value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New ticket: {subject}"
          />
        </label>
        <label className="field" style={{ marginTop: 8 }}>
          <span>Body template *</span>
          <textarea
            className="inp inp-sm" rows={3} value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="A ticket '{subject}' was opened (priority: {priority})."
            style={{ fontFamily: 'inherit', resize: 'vertical' }}
          />
        </label>
        <p className="hint" style={{ margin: '4px 0 0' }}>
          Placeholders in <code className="mono">{'{curly_braces}'}</code> resolve at emit time.
        </p>

        <div className="section-head" style={{ marginTop: 16 }}>
          <ZapIcon size={15} className="section-icon" />
          {rulesView ? ' GXL condition (required)' : ' GXL condition (optional)'}
        </div>
        <label className="field">
          <span>Condition</span>
          <input
            className="inp inp-sm mono" value={cond}
            onChange={(e) => setCond(e.target.value)}
            placeholder={rulesView ? "priority == 'high' and status == 'OPEN'" : '(leave empty for unconditional emit)'}
          />
        </label>
        <p className="hint" style={{ margin: '4px 0 0' }}>
          GXL expression — evaluated against the emit context. See backend/app/gxl.py.
        </p>

      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------
// MO-2 — canonical `<Modal>` chrome. Async error / loading state stays inline
// in the body (custom footer with disabled-while-busy) since `confirmDialog()`'s
// promise API doesn't expose those — a per-confirm Modal is the right primitive.
function ConfirmDeleteDialog({
  defLabel, defKey, onCancel, onConfirm, deleting, err,
}: {
  defLabel: string; defKey: string
  onCancel: () => void; onConfirm: () => void
  deleting: boolean; err: string
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Delete notification def?"
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-md" onClick={onConfirm} disabled={deleting}>
            <TrashIcon size={13} /> {deleting ? 'Deleting…' : 'Delete def'}
          </button>
        </>
      }
    >
      <p className="hint" style={{ margin: '0 0 14px' }}>
        This will hard-delete <strong>{defLabel}</strong> (<code className="mono">{defKey}</code>).
        Existing inbox rows that were rendered FROM this def are preserved (they're
        immutable post-emit). Future emits of <code className="mono">{defKey}</code> become a
        no-op until the def is recreated. Use <em>Disable</em> instead if you want to
        temporarily stop emits without losing the def.
      </p>
      {err && <ErrorBanner message={err} />}
    </Modal>
  )
}

// MO-3 — canonical `<Modal>` chrome. Test-send confirm with loading state.
function ConfirmTestSendDialog({
  defKey, channel, onCancel, onConfirm, sending,
}: {
  defKey: string; channel: string
  onCancel: () => void; onConfirm: () => void
  sending: boolean
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Send a test notification?"
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={onCancel} disabled={sending}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-md" onClick={onConfirm} disabled={sending}>
            <SendHorizontalIcon size={13} /> {sending ? 'Sending…' : 'Send test'}
          </button>
        </>
      }
    >
      <p className="hint" style={{ margin: '0 0 14px' }}>
        This will emit one notification through <code className="mono">{defKey}</code> on the
        <strong> {channel}</strong> channel, addressed to you. If a real adapter is not
        configured for this channel, the inbox row is still created (dev adapter) and the
        response will say so honestly.
      </p>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Detail drawer — edit + preview + test-send + delete
// ---------------------------------------------------------------------------
function DetailDrawer({
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
          <div style={{ marginTop: 8 }}>
            <input
              type="checkbox" checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </div>
        </label>
      </div>

      <div className="section-head" style={{ marginTop: 18 }}>
        <EditIcon size={15} className="section-icon" /> Templates
      </div>
      <label className="field">
        <span>Title template</span>
        <input
          className="inp inp-sm" value={titleT}
          onChange={(e) => setTitleT(e.target.value)}
        />
      </label>
      <label className="field" style={{ marginTop: 8 }}>
        <span>Body template</span>
        <textarea
          className="inp inp-sm" rows={3} value={bodyT}
          onChange={(e) => setBodyT(e.target.value)}
          style={{ fontFamily: 'inherit', resize: 'vertical' }}
        />
      </label>

      <div className="section-head" style={{ marginTop: 18 }}>
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
      {metaMsg && <div className="hint" style={{ marginTop: 8 }}>{metaMsg}</div>}
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button
          type="button" className="btn btn-primary btn-sm"
          onClick={saveMeta} disabled={savingMeta}
        >
          <CheckIcon size={13} /> {savingMeta ? 'Saving…' : 'Save changes'}
        </button>
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
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button
          type="button" className="btn btn-ghost btn-sm"
          onClick={runPreview} disabled={previewing}
        >
          <PlayIcon size={13} /> {previewing ? 'Rendering…' : 'Preview'}
        </button>
        <button
          type="button" className="btn btn-accent btn-sm"
          onClick={() => setConfirmSend(true)} disabled={sending}
        >
          <SendHorizontalIcon size={13} /> {sending ? 'Sending…' : 'Test send'}
        </button>
      </div>
      {previewErr && <div style={{ marginTop: 8 }}><ErrorBanner message={previewErr} /></div>}
      {preview && (
        <div
          style={{
            marginTop: 10, padding: 12,
            border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)',
            background: 'var(--gx-surface-2)',
          }}
        >
          <div className="hint" style={{ marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Rendered title
          </div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{preview.title}</div>
          <div className="hint" style={{ marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Rendered body
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{preview.body}</div>
        </div>
      )}
      {sendResult && (
        <div
          style={{
            marginTop: 10, padding: 10,
            border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)',
            background: sendResult.ok ? 'var(--gx-success-soft, var(--gx-surface-2))' : 'var(--gx-warning-soft, var(--gx-surface-2))',
            color: 'var(--gx-text-1)',
          }}
        >
          <strong>{sendResult.ok ? 'Test send delivered' : 'Test send not delivered'}</strong>
          <div className="hint" style={{ marginTop: 2 }}>{sendResult.msg}</div>
        </div>
      )}

      {/* danger zone */}
      <div className="section-head" style={{ marginTop: 22 }}>
        <TrashIcon size={15} className="section-icon" /> Danger zone
      </div>
      <div
        style={{
          padding: 14,
          border: '1px solid var(--gx-border)',
          borderRadius: 'var(--gx-radius-md)',
          background: 'var(--gx-surface-2)',
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <strong>Delete this notification def</strong>
        </div>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          Hard-delete <code className="mono">{detail.key}</code>. To soft-retire instead, toggle
          <strong> Enabled</strong> off in Identity above and Save — future emits become no-ops
          while history is preserved.
        </p>
        <button
          type="button" className="btn btn-danger btn-sm"
          onClick={() => setConfirmDel(true)}
        >
          <TrashIcon size={13} /> Delete def
        </button>
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

// DR-4 — `DrawerShell` now wraps the canonical `<StudioDrawer>` primitive.
function DrawerShell({
  onClose, title, children,
}: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <StudioDrawer open onClose={onClose} title={title} bodyPadding={20}>
      {children}
    </StudioDrawer>
  )
}

// ---------------------------------------------------------------------------
// Main pane — list + create + drill-in
// ---------------------------------------------------------------------------
export default function NotificationsPane({ token, channel, rulesView }: Props) {
  const [defs, setDefs] = useState<NotifDef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    const qs = channel ? `?channel=${encodeURIComponent(channel)}` : ''
    apiFetch(token, `/meta/notification-defs${qs}`)
      .then((d: NotifDef[]) => {
        if (!alive) return
        setDefs(Array.isArray(d) ? d : [])
      })
      .catch((ex) => {
        if (!alive) return
        if (ex instanceof FetchError && ex.status === 403) setDenied(true)
        else setError((ex as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token, channel])

  useEffect(() => load(), [load])

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to manage notifications." />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  // Rules view: only show defs that have a non-empty gxl_condition.
  let view = defs
  if (rulesView) view = view.filter((d) => !!(d.gxl_condition && d.gxl_condition.trim()))

  const q = search.trim().toLowerCase()
  const filtered = q
    ? view.filter((d) =>
        d.key.toLowerCase().includes(q) ||
        d.label.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q),
      )
    : view

  const headingLabel = rulesView ? 'Notification Rules' : (channel ? CHANNEL_LABELS[channel] : 'Notification Templates')
  const headingHint = rulesView
    ? 'Notification defs gated by a GXL condition — only emit when the rule passes.'
    : 'Templates for ' + (channel ?? 'all channels') + '. Edit, preview with sample context, and test-send to your own inbox.'
  const createLabel = rulesView ? 'New rule' : 'New template'

  return (
    <div>
      <div className="row" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>{headingLabel}</h3>
          <p className="hint" style={{ margin: 0 }}>{headingHint}</p>
        </div>
        <span className="spacer" />
        <button
          type="button" className="btn btn-primary btn-md"
          onClick={() => setShowCreate(true)}
        >
          <PlusIcon size={13} /> {createLabel}
        </button>
      </div>

      <div style={{ marginBottom: 12, maxWidth: 320 }}>
        <input
          className="inp inp-md"
          placeholder="Filter by key, label, or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={q ? 'No notification defs match the filter.' : (rulesView ? 'No rules yet.' : 'No templates yet.')}
          message={
            q
              ? 'Try a different query.'
              : `Create the first ${rulesView ? 'rule' : 'template'} using "${createLabel}" above.`
          }
        />
      ) : (
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Label</th>
                <th scope="col">Channel</th>
                <th scope="col">Category</th>
                <th scope="col">Priority</th>
                <th scope="col">Enabled</th>
                <th scope="col">Rule</th>
                <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.key}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOpenKey(d.key)}
                >
                  <td><code className="mono">{d.key}</code></td>
                  <td>{d.label}</td>
                  <td><span className="hint mono">{d.channel}</span></td>
                  <td><span className="hint">{d.category}</span></td>
                  <td><span className="hint">{d.priority}</span></td>
                  <td>{d.enabled ? <CheckIcon size={13} /> : <span className="hint">—</span>}</td>
                  <td>
                    {d.gxl_condition ? (
                      <span
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 6px',
                          border: '1px solid var(--gx-border)',
                          borderRadius: 'var(--gx-radius-sm, 4px)',
                          background: 'var(--gx-surface-2)',
                          fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 11,
                          color: 'var(--gx-text-2)',
                        }}
                        title={d.gxl_condition}
                      >
                        <ZapIcon size={11} /> rule
                      </span>
                    ) : <span className="hint">—</span>}
                  </td>
                  <td className="actions-col">
                    <button
                      type="button" className="btn btn-ghost btn-sm"
                      onClick={(ev) => { ev.stopPropagation(); setOpenKey(d.key) }}
                      aria-label={`Open ${d.label}`}
                    >
                      <EditIcon size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateDefModal
          token={token}
          channel={channel}
          rulesView={rulesView}
          onClose={() => setShowCreate(false)}
          onCreated={(k) => {
            setShowCreate(false)
            load()
            setOpenKey(k)
          }}
        />
      )}

      {openKey && (
        <DetailDrawer
          token={token}
          defKey={openKey}
          onClose={() => setOpenKey(null)}
          onChanged={() => load()}
          onDeleted={() => { setOpenKey(null); load() }}
        />
      )}
    </div>
  )
}
