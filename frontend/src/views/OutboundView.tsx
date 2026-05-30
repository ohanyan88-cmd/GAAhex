import { useEffect, useMemo, useState } from 'react'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  InboxIcon, PlusIcon, MailIcon, SearchIcon, ArchiveIcon,
  ClockIcon, FileIcon, CheckIcon, WarningIcon, SparkleIcon,
} from '../components/icons'
import { Modal } from '../components/Modal'
import { composeOutbound } from '../lib/api'
import { usePageConfig } from '../lib/pageConfig'

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

// Mail-style "folders" expressed as status filters over the outbound log. The data is one
// flat delivery log, not a per-recipient inbox — so the folder rail filters by delivery
// status / channel rather than by mailbox semantics.
const FOLDERS: { key: string; label: string; icon: typeof InboxIcon; match: (o: Outbound) => boolean }[] = [
  { key: 'all',       label: 'All',       icon: InboxIcon,    match: () => true },
  { key: 'sent',      label: 'Sent',      icon: CheckIcon,    match: (o) => o.status === 'sent' || o.status === 'delivered' },
  { key: 'queued',    label: 'Queued',    icon: ClockIcon,    match: (o) => o.status === 'queued' },
  { key: 'failed',    label: 'Failed',    icon: WarningIcon,  match: (o) => o.status === 'failed' },
  { key: 'campaigns', label: 'Campaigns', icon: SparkleIcon,  match: () => false }, // backend: no campaign model yet
  { key: 'archive',   label: 'Archive',   icon: ArchiveIcon,  match: () => false }, // backend: no archive flag yet
]

function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toLowerCase()
  const cls = s === 'failed' ? 'pill pill-danger'
    : (s === 'delivered' || s === 'sent') ? 'pill pill-success'
    : 'pill pill-muted'
  return status ? <span className={cls}>{status}</span> : <span>—</span>
}

function initials(s: string | undefined | null): string {
  if (!s) return '?'
  const t = s.trim()
  if (!t) return '?'
  // for "user@host" pick the first letter of user; for plain names take first 2 caps.
  if (t.includes('@')) return t.charAt(0).toUpperCase()
  const parts = t.split(/\s+/).slice(0, 2)
  return parts.map(p => p.charAt(0).toUpperCase()).join('') || t.charAt(0).toUpperCase()
}

function preview(o: Outbound) {
  return (o.subject || o.body || '').slice(0, 80)
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

export default function OutboundView({ token, configVersion = 0 }: { token: string; configVersion?: number }) {
  const cfg = usePageConfig(token, 'outbound', configVersion)
  const [list, setList] = useState<Outbound[] | null>(null)
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [folder, setFolder] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
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

  // Folder + search filtering applied on top of server-side channel/status filters.
  const folderDef = FOLDERS.find(f => f.key === folder) ?? FOLDERS[0]
  const folderCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const f of FOLDERS) m[f.key] = 0
    for (const o of list ?? []) for (const f of FOLDERS) if (f.match(o)) m[f.key] += 1
    return m
  }, [list])

  const filtered = useMemo(() => {
    if (!list) return []
    const needle = search.trim().toLowerCase()
    return list
      .filter(folderDef.match)
      .filter(o => {
        if (!needle) return true
        return (
          (o.to ?? '').toLowerCase().includes(needle) ||
          (o.subject ?? '').toLowerCase().includes(needle) ||
          (o.body ?? '').toLowerCase().includes(needle)
        )
      })
  }, [list, folderDef, search])

  const current = useMemo(
    () => filtered.find(o => o.id === selected) ?? filtered[0] ?? null,
    [filtered, selected],
  )

  if (denied) return <PermissionDenied message="Outbound delivery is admin-only." />

  return (
    <div className="gx-comms comms-shell">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="comms-head">
        <div className="vh-ic"><MailIcon size={18} /></div>
        <div>
          <h1 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>
            {cfg.title}
          </h1>
          <div className="hint" style={{ fontSize: 12 }}>Email · SMS · push · delivery log</div>
        </div>
        <span className="spacer" />
        <select className="inp inp-sm hide-sm" aria-label="Filter by channel" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 130 }}>
          <option value="">All channels</option>
          {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="inp inp-sm hide-sm" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 130 }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => setComposeOpen(true)}>
          <PlusIcon size={13} /> Compose
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && (
        <EmptyState
          icon={<InboxIcon size={40} />}
          title="Outbound log isn't available yet"
          message="Sent messages will appear here once the delivery service is enabled."
        />
      )}

      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<InboxIcon size={40} />} title="No outbound messages" message="Nothing matches this filter." />
      )}

      {list && list.length > 0 && !unavailable && (
        <div className="mail">
          {/* ── Folder rail ───────────────────────────────────────────── */}
          <div className="mail-folders">
            <button
              className="btn btn-primary btn-sm"
              style={{ width: '100%', marginBottom: 10 }}
              onClick={() => setComposeOpen(true)}
            >
              <PlusIcon size={13} /> Compose
            </button>
            {FOLDERS.map(f => {
              const Icon = f.icon
              const count = folderCounts[f.key] ?? 0
              const active = folder === f.key
              return (
                <button
                  key={f.key}
                  className={'mail-folder' + (active ? ' on' : '')}
                  onClick={() => { setFolder(f.key); setSelected(null) }}
                >
                  <Icon size={15} />
                  <span style={{ flex: 1, textAlign: 'left' }}>{f.label}</span>
                  {count > 0 && (
                    <span
                      className="badge"
                      style={{
                        background: active ? 'var(--gx-primary)' : 'var(--gx-surface-2)',
                        color: active ? '#fff' : 'var(--gx-text-3)',
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
            {/* Labels section — backend has no label model today.
                TODO(backend): expose Outbound.labels[] → render colored swatches. */}
            <div style={{ borderTop: '1px solid var(--gx-border-subtle)', margin: '12px 4px', paddingTop: 12 }}>
              <div className="hint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', padding: '0 6px 8px' }}>
                Channels
              </div>
              {CHANNELS.map((c) => (
                <button
                  key={c}
                  className={'mail-folder' + (channel === c ? ' on' : '')}
                  onClick={() => setChannel(channel === c ? '' : c)}
                  style={{ textTransform: 'capitalize' }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--gx-primary-soft)', border: '1px solid var(--gx-border)' }} />
                  <span>{c}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Message list ──────────────────────────────────────────── */}
          <div className="mail-list">
            <div className="msgr-search" style={{ margin: 10 }}>
              <SearchIcon size={14} />
              <input
                placeholder="Search mail"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13, fontFamily: 'var(--gx-font-sans)' }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {filtered.length === 0 && (
                <p className="muted" style={{ padding: 16, textAlign: 'center' }}>No messages match.</p>
              )}
              {filtered.map((o) => {
                const selectedRow = current?.id === o.id
                const isQueued = (o.status ?? '').toLowerCase() === 'queued'
                return (
                  <button
                    key={o.id}
                    className={'mail-row' + (selectedRow ? ' on' : '') + (isQueued ? ' unread' : '')}
                    onClick={() => setSelected(o.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <FileIcon size={13} style={{ color: 'var(--gx-text-3)' }} />
                      <span style={{ fontWeight: isQueued ? 700 : 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {o.to || '(no recipient)'}
                      </span>
                      <span className="hint" style={{ marginLeft: 'auto', fontSize: 11 }}>{timeAgo(o.created_at ?? null)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: isQueued ? 600 : 400, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.subject || o.body?.slice(0, 60) || '(no subject)'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--gx-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {o.error ? <span style={{ color: 'var(--gx-danger)' }}>{o.error}</span> : preview(o)}
                      </span>
                      <span style={{ fontSize: 10, padding: '1px 6px', background: 'var(--gx-surface-2)', borderRadius: 3, color: 'var(--gx-text-3)', textTransform: 'uppercase' }}>
                        {o.channel || '—'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Read pane ─────────────────────────────────────────────── */}
          <div className="mail-read">
            {!current && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)' }}>
                Select a message to read.
              </div>
            )}
            {current && (
              <>
                <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--gx-border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <h2 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 19, fontWeight: 600, margin: 0, flex: 1, letterSpacing: '-.01em' }}>
                      {current.subject || '(no subject)'}
                    </h2>
                    {statusPill(current.status)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                    <span className="avatar" style={{ width: 36, height: 36 }}>{initials(current.to)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        to <span className="mono" style={{ color: 'var(--gx-text-2)', fontWeight: 400, fontSize: 12 }}>{current.to || '—'}</span>
                      </div>
                      <div className="hint" style={{ fontSize: 11.5 }}>
                        {current.channel || '—'} · {timeAgo(current.created_at ?? null)}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', fontSize: 13.5, lineHeight: 1.7, color: 'var(--gx-text-1)', whiteSpace: 'pre-wrap' }}>
                  {current.error && (
                    <div className="banner" style={{ display: 'flex', gap: 11, padding: '12px 14px', borderRadius: 'var(--gx-radius-md)', border: '1px solid var(--gx-border)', borderLeft: '3px solid var(--gx-danger)', background: 'var(--gx-danger-soft, var(--gx-surface-2))', marginBottom: 14 }}>
                      <WarningIcon size={16} style={{ color: 'var(--gx-danger)' }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12.5 }}>Delivery error</div>
                        <div style={{ fontSize: 12, color: 'var(--gx-text-2)', marginTop: 2 }}>{current.error}</div>
                      </div>
                    </div>
                  )}
                  {current.body || <span className="muted">(empty body)</span>}
                </div>
                <div style={{ padding: '14px 22px', borderTop: '1px solid var(--gx-border-subtle)', display: 'flex', gap: 10 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setComposeOpen(true)}>
                    <MailIcon size={14} /> New message
                  </button>
                  <span className="spacer" />
                  {/* Reply / Forward / Archive — these are outbound-log entries, not inbound mail.
                      TODO(backend): true inbound mail (with reply/forward) needs an Inbox model. */}
                </div>
              </>
            )}
          </div>
        </div>
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
