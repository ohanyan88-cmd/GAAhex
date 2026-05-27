import { useEffect, useState } from 'react'
import { toast } from './Toast'
import { timeAgo } from './time'
import { EmptyState, ErrorBanner, PermissionDenied } from './States'
import { InboxIcon, PlusIcon, MailIcon } from './icons'
import { Modal } from './Modal'
import { composeOutbound } from './api'

// Outbound delivery log (A12 GET /api/outbound) — admin view. Degrades quietly on 404.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Outbound = {
  id: string
  channel?: string
  to?: string
  subject?: string | null
  body?: string | null
  status?: string | null
  error?: string | null
  created_at?: string | null
}

const CHANNELS = ['email', 'sms', 'push', 'webhook', 'inapp']
const COMPOSE_CHANNELS = ['email', 'sms']
const STATUSES = ['queued', 'sent', 'delivered', 'failed']

function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toLowerCase()
  const cls = s === 'failed' ? 'pill pill-danger'
    : (s === 'delivered' || s === 'sent') ? 'pill pill-success'
    : 'pill pill-muted'
  return status ? <span className={cls}>{status}</span> : <span>—</span>
}

// ── Compose modal state ───────────────────────────────────────────────────────

type ComposeForm = {
  channel: string
  to: string
  subject: string
  body: string
}

const EMPTY_FORM: ComposeForm = { channel: 'email', to: '', subject: '', body: '' }

function ComposeModal({
  open,
  token,
  onClose,
  onSent,
}: {
  open: boolean
  token: string
  onClose: () => void
  onSent: () => void
}) {
  const [form, setForm] = useState<ComposeForm>(EMPTY_FORM)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  function reset() {
    setForm(EMPTY_FORM)
    setSending(false)
    setSendError('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  function set<K extends keyof ComposeForm>(key: K, value: ComposeForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (sendError) setSendError('')
  }

  async function handleSend() {
    if (!form.to.trim() || !form.body.trim() || sending) return
    setSending(true)
    setSendError('')
    const payload: { channel: string; to: string; subject?: string; body: string } = {
      channel: form.channel,
      to: form.to.trim(),
      body: form.body.trim(),
    }
    if (form.channel === 'email' && form.subject.trim()) {
      payload.subject = form.subject.trim()
    }
    const result = await composeOutbound(token, payload)
    setSending(false)
    if (result.ok) {
      toast.success(`Message sent${result.status ? ` (${result.status})` : ''}`)
      reset()
      onClose()
      onSent()
    } else {
      setSendError(result.error ?? 'Failed to send message')
    }
  }

  const canSend = form.to.trim().length > 0 && form.body.trim().length > 0 && !sending

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New Message"
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-md"
            disabled={!canSend}
            onClick={handleSend}
          >
            <MailIcon size={15} />
            {sending ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Channel</span>
        <select
          className="inp inp-md"
          value={form.channel}
          onChange={(e) => set('channel', e.target.value)}
        >
          {COMPOSE_CHANNELS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>To</span>
        <input
          type="text"
          className="inp inp-md"
          placeholder="Email or phone"
          value={form.to}
          onChange={(e) => set('to', e.target.value)}
        />
      </label>

      {form.channel === 'email' && (
        <label className="field">
          <span>Subject</span>
          <input
            type="text"
            className="inp inp-md"
            placeholder="Subject"
            value={form.subject}
            onChange={(e) => set('subject', e.target.value)}
          />
        </label>
      )}

      <label className="field">
        <span>Body</span>
        <textarea
          className="inp inp-md inp-area"
          rows={4}
          placeholder="Message body"
          value={form.body}
          onChange={(e) => set('body', e.target.value)}
        />
      </label>

      {sendError && (
        <p className="err">{sendError}</p>
      )}
    </Modal>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function OutboundView({ token }: { token: string }) {
  const [list, setList] = useState<Outbound[] | null>(null)
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const p = new URLSearchParams()
    if (channel) p.set('channel', channel)
    if (status) p.set('status', status)
    const qs = p.toString()
    try {
      const r = await fetch(`${BASE}/api/outbound${qs ? `?${qs}` : ''}`, { headers: authH(token) })
      if (r.status === 404) { setUnavailable(true); setList([]); return }
      if (r.status === 403) { setDenied(true); setList([]); return }
      if (!r.ok) { setError('Failed to load outbound log'); setList([]); return }
      const data = await r.json()
      setList(Array.isArray(data) ? data : [])
    } catch (e) {
      setError((e as Error).message); setList([])
    }
  }

  useEffect(() => { load() }, [token, channel, status])

  const preview = (o: Outbound) => (o.subject || o.body || '').slice(0, 80)

  if (denied) return <PermissionDenied message="Outbound delivery is admin-only." />

  return (
    <div>
      <div className="view-head">
        <h2>Outbound</h2>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setComposeOpen(true)}
        >
          <PlusIcon size={14} />
          New Message
        </button>
      </div>

      <div className="list-toolbar">
        <div className="bill-filter">
          <span className="muted export-label">Channel</span>
          <select className="inp inp-sm" aria-label="Filter by channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">All</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="bill-filter">
          <span className="muted export-label">Status</span>
          <select className="inp inp-sm" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState icon={<InboxIcon size={40} />} title="Outbound log isn't available yet" message="Sent messages will appear here once the delivery service is enabled." />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<InboxIcon size={40} />} title="No outbound messages" message="Nothing matches this filter." />
      )}

      {list && list.length > 0 && (
        <div className="grid-wrap"><table className="grid">
          <thead><tr><th scope="col">Channel</th><th scope="col">To</th><th scope="col">Message</th><th scope="col">Status</th><th scope="col">When</th></tr></thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td>{o.channel ?? '—'}</td>
                <td>{o.to ?? '—'}</td>
                <td className="ob-preview" title={o.error || preview(o)}>{o.error ? <span className="amt-neg-danger">{o.error}</span> : (preview(o) || '—')}</td>
                <td>{statusPill(o.status)}</td>
                <td>{timeAgo(o.created_at ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <ComposeModal
        open={composeOpen}
        token={token}
        onClose={() => setComposeOpen(false)}
        onSent={load}
      />
    </div>
  )
}
