import { useEffect, useMemo, useState } from 'react'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import { PermissionDenied } from '../components/States'
import {
  InboxIcon, PlusIcon, MailIcon, SearchIcon,
  ClockIcon, CheckIcon, WarningIcon,
  StarIcon, ReplyIcon, ForwardIcon, RefreshIcon,
} from '../components/icons'
import { Modal } from '../components/Modal'
import { composeOutbound } from '../lib/api'
import { usePageConfig } from '../lib/pageConfig'

// Outbound delivery log (A12 GET /api/outbound) — admin view. Degrades quietly on 404.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// Field names mirror the backend `_serialize_outbound` payload (notifications.py).
// The recipient column is `to_addr` server-side — using `to` here silently breaks
// the list rendering, so keep this in lockstep with the serializer.
type Outbound = {
  id: string
  channel?: string
  to_addr?: string | null
  subject?: string | null
  body?: string | null
  status?: string | null
  error?: string | null
  created_at?: string | null
}

const CHANNELS = ['email', 'sms', 'push', 'webhook', 'inapp']
const CHANNEL_LABEL: Record<string, string> = { email: 'Email', sms: 'SMS', push: 'Push', webhook: 'Webhook', inapp: 'In-app' }
const COMPOSE_CHANNELS = ['email', 'sms']
const STATUSES = ['queued', 'sent', 'delivered', 'failed']

// Mail-style "folders" expressed as status filters over the outbound log. The data is one
// flat delivery log, not a per-recipient inbox — so the folder rail filters by delivery
// status / channel rather than by mailbox semantics.
//
// Doctrine rule #3 (missing → hide): only folders with a real backend mapping are listed.
// "Campaigns" and "Archive" were removed because the OutboundMessage model has no campaign
// linkage or archive flag — showing them as always-empty folders is a fake placeholder.
const FOLDERS: { key: string; label: string; icon: typeof InboxIcon; match: (o: Outbound) => boolean }[] = [
  { key: 'all',    label: 'All',    icon: InboxIcon,   match: () => true },
  { key: 'sent',   label: 'Sent',   icon: CheckIcon,   match: (o) => o.status === 'sent' || o.status === 'delivered' },
  { key: 'queued', label: 'Queued', icon: ClockIcon,   match: (o) => o.status === 'queued' },
  { key: 'failed', label: 'Failed', icon: WarningIcon, match: (o) => o.status === 'failed' },
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
  prefill,
  onClose,
  onSent,
}: {
  open: boolean
  token: string
  prefill?: Partial<ComposeForm> | null
  onClose: () => void
  onSent: () => void
}) {
  const [form, setForm] = useState<ComposeForm>(EMPTY_FORM)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // When the modal opens, seed the form with the prefill (Reply/Forward). When it closes,
  // reset so re-opening fresh doesn't carry old draft content.
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM, ...(prefill ?? {}) })
      setSending(false)
      setSendError('')
    }
  }, [open, prefill])

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

// P1 note: OutboundView has no `.view-head`/ViewHead surface today, so the Configure
// gear isn't rendered here yet — props are accepted so App.tsx can wire it uniformly.
export default function OutboundView({ token, configVersion = 0, canConfigure: _canConfigure = false, onConfigure: _onConfigure }: { token: string; configVersion?: number; canConfigure?: boolean; onConfigure?: () => void }) {
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
  const [composePrefill, setComposePrefill] = useState<Partial<ComposeForm> | null>(null)

  function openCompose(prefill: Partial<ComposeForm> | null = null) {
    setComposePrefill(prefill)
    setComposeOpen(true)
  }

  // Reply/Forward seed the Compose modal from the currently-selected message so the
  // buttons do real work (prefilled draft) instead of opening an empty form — which
  // would be a doctrine rule #4 violation (looks-real-does-nothing).
  function buildReply(o: Outbound): Partial<ComposeForm> {
    const channel = o.channel === 'sms' ? 'sms' : 'email'
    const subject = o.subject ? (o.subject.startsWith('Re: ') ? o.subject : `Re: ${o.subject}`) : ''
    return { channel, to: o.to_addr ?? '', subject, body: '' }
  }
  function buildForward(o: Outbound): Partial<ComposeForm> {
    const channel = o.channel === 'sms' ? 'sms' : 'email'
    const subject = o.subject ? (o.subject.startsWith('Fwd: ') ? o.subject : `Fwd: ${o.subject}`) : ''
    const quoted = o.body ? `\n\n---\n${o.body}` : ''
    return { channel, to: '', subject, body: quoted }
  }

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
          (o.to_addr ?? '').toLowerCase().includes(needle) ||
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
    <div className="gx-comms comms-shell fade" style={{ height: 'calc(100vh - var(--gx-header-h))', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '18px 22px', gap: 14 }}>
      <div className="comms-head">
        <div className="vh-ic"><MailIcon size={20} /></div>
        <div>
          <h1 className="comms-title">{cfg.title}</h1>
          <div className="sub comms-sub">Email · SMS · push · webhook · transactional</div>
        </div>
        <span className="spacer" />
        <button className="btn btn-secondary btn-sm hide-sm" onClick={load}><RefreshIcon size={14} />Sync</button>
        <button className="btn btn-primary btn-sm" onClick={() => openCompose()}><PlusIcon size={14} />Compose</button>
      </div>

      <div className="mail">
        {/* ── Folder rail ── */}
        <div className="mail-folders">
          <button className="btn btn-gold btn-sm" style={{ width: '100%', marginBottom: 10 }} onClick={() => openCompose()}>
            <PlusIcon size={14} />Compose
          </button>
          {FOLDERS.map(f => {
            const FIcon = f.icon
            const count = folderCounts[f.key] ?? 0
            const active = folder === f.key
            return (
              <button key={f.key} className={'mail-folder' + (active ? ' on' : '')} onClick={() => { setFolder(f.key); setSelected(null) }}>
                <FIcon size={15} />
                <span>{f.label}</span>
                {count > 0 && (
                  <span className="badge" style={{ marginLeft: 'auto', background: active ? 'var(--gx-primary)' : 'var(--gx-surface-2)', color: active ? 'var(--gx-on-primary)' : 'var(--gx-text-3)' }}>{count}</span>
                )}
              </button>
            )
          })}
          <div style={{ borderTop: '1px solid var(--gx-border-subtle)', margin: '12px 4px', paddingTop: 12 }}>
            <div className="lbl" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', padding: '0 6px 8px' }}>Channels</div>
            {CHANNELS.map(c => {
              const tone = c === 'email' ? 'var(--azure-400)' : c === 'sms' ? 'var(--gx-warning)' : c === 'push' ? 'var(--gx-success)' : c === 'webhook' ? 'var(--gx-gold)' : 'var(--gx-text-3)'
              return (
                <button key={c} className={'mail-folder' + (channel === c ? ' on' : '')} onClick={() => setChannel(channel === c ? '' : c)}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: tone }} /><span>{CHANNEL_LABEL[c] ?? c}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Message list ── */}
        <div className="mail-list">
          <div className="msgr-search" style={{ margin: 10 }}>
            <SearchIcon size={14} />
            <input
              placeholder="Search mail"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13, fontFamily: 'var(--gx-font-sans)' }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {list === null && !error && <div className="hint" style={{ textAlign: 'center', padding: '30px 16px' }}>Loading…</div>}
            {error && <div className="err" style={{ padding: 12 }}>{error} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>}
            {unavailable && <div className="hint" style={{ textAlign: 'center', padding: '30px 16px' }}>Wire /api/outbound to populate.</div>}
            {filtered.length === 0 && !error && !unavailable && list !== null && (
              <div className="hint" style={{ textAlign: 'center', padding: '30px 16px' }}>No messages match.</div>
            )}
            {filtered.map(o => {
              const isActive = current?.id === o.id
              const isQueued = (o.status ?? '').toLowerCase() === 'queued'
              const isFailed = (o.status ?? '').toLowerCase() === 'failed'
              return (
                <button key={o.id} className={'mail-row' + (isActive ? ' on' : '') + (isQueued ? ' unread' : '')} onClick={() => setSelected(o.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <StarIcon size={13} style={{ color: isFailed ? 'var(--gx-danger)' : 'var(--gx-text-3)', fill: 'none' }} />
                    <span style={{ fontWeight: isQueued ? 700 : 600, fontSize: 13 }}>{o.to_addr || '(no recipient)'}</span>
                    <span className="hint" style={{ marginLeft: 'auto', fontSize: 11 }}>{timeAgo(o.created_at ?? null)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: isQueued ? 600 : 400, marginTop: 3 }}>{o.subject || '(no subject)'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--gx-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {o.error ? <span style={{ color: 'var(--gx-danger)' }}>{o.error}</span> : preview(o)}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Read pane ── */}
        <div className="mail-read">
          {!current ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)' }}>
              Select a message to read.
            </div>
          ) : (
            <>
              <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--gx-border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <h2 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 19, fontWeight: 600, margin: 0, flex: 1, letterSpacing: '-.01em' }}>
                    {current.subject || '(no subject)'}
                  </h2>
                  {statusPill(current.status)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                  <span className="avatar" style={{ width: 36, height: 36 }}>{initials(current.to_addr)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      to <span className="mono" style={{ color: 'var(--gx-text-3)', fontWeight: 400, fontSize: 12 }}>&lt;{current.to_addr || '—'}&gt;</span>
                    </div>
                    <div className="hint" style={{ fontSize: 11.5 }}>{current.channel || '—'} · {timeAgo(current.created_at ?? null)}</div>
                  </div>
                  <button className="tb-icon" title="Reply" onClick={() => openCompose(buildReply(current))}><ReplyIcon size={17} /></button>
                  <button className="tb-icon" title="Forward" onClick={() => openCompose(buildForward(current))}><ForwardIcon size={17} /></button>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', fontSize: 13.5, lineHeight: 1.7, color: 'var(--gx-text-1)', whiteSpace: 'pre-wrap' }}>
                {current.error && (
                  <div style={{ display: 'flex', gap: 11, padding: '12px 14px', borderRadius: 'var(--gx-radius-md)', border: '1px solid var(--gx-border)', borderLeft: '3px solid var(--gx-danger)', background: 'var(--gx-surface-2)', marginBottom: 14 }}>
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
                <button className="btn btn-primary btn-sm" onClick={() => openCompose(buildReply(current))}><ReplyIcon size={14} />Reply</button>
                <button className="btn btn-secondary btn-sm" onClick={() => openCompose(buildForward(current))}><ForwardIcon size={14} />Forward</button>
                {/* Archive button removed (rule #4): the OutboundMessage model has no
                    archive flag and the backend exposes no archive endpoint, so the button
                    had nothing real to call. Re-add once a backend action exists. */}
              </div>
            </>
          )}
        </div>
      </div>

      <ComposeModal
        open={composeOpen}
        token={token}
        prefill={composePrefill}
        onClose={() => setComposeOpen(false)}
        onSent={load}
      />
    </div>
  )
}
