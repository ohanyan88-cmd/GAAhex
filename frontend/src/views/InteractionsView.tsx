import { useEffect, useMemo, useRef, useState } from 'react'
import { bget, bpost } from '../lib/billing'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import {
  PhoneIcon, MailIcon, MessageIcon, EditIcon, InfoIcon, PlusIcon,
  SearchIcon, CloseIcon, PanelRightIcon,
} from '../components/icons'
import { t } from '../lib/i18n'
import { Button, StatusPill } from '../primitives'

// ─── Types ───────────────────────────────────────────────────────────────────

type Interaction = {
  id: string
  channel?: string
  direction?: string
  subject?: string | null
  body?: string
  occurred_at?: string | null
  created_at?: string | null
  customer_id?: string | null
  ticket_id?: string | null
}

const CHANNELS = ['call', 'email', 'chat', 'sms', 'note', 'other']
const DIRECTIONS = ['inbound', 'outbound', 'internal']

// ─── Helpers ─────────────────────────────────────────────────────────────────

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

function mapDirection(dir: string | null | undefined): PillVariant {
  const d = (dir ?? '').toLowerCase()
  if (d === 'inbound') return 'info'
  if (d === 'outbound') return 'active'
  if (d === 'internal') return 'neutral'
  return 'info'
}

function channelIcon(channel: string | null | undefined, size = 14) {
  switch ((channel ?? '').toLowerCase()) {
    case 'call':  return <PhoneIcon size={size} />
    case 'email': return <MailIcon size={size} />
    case 'chat':  return <MessageIcon size={size} />
    case 'sms':   return <MessageIcon size={size} />
    case 'note':  return <EditIcon size={size} />
    default:      return <InfoIcon size={size} />
  }
}

// Channel dot colour (matches the tone approach in the kit's CH_TONE map)
function channelColor(channel: string | null | undefined): string {
  switch ((channel ?? '').toLowerCase()) {
    case 'call':  return 'var(--gx-success)'
    case 'email': return 'var(--gx-primary)'
    case 'chat':  return 'var(--gx-warning)'
    case 'sms':   return 'var(--gx-gold)'
    case 'note':  return 'var(--gx-text-3)'
    default:      return 'var(--gx-text-3)'
  }
}

/** Direction arrow — inline SVG, no emoji */
function directionArrow(direction: string | null | undefined) {
  const d = (direction ?? '').toLowerCase()
  if (d === 'inbound') {
    // Arrow pointing down-left (inbound)
    return (
      // D18: direction indicator = slate (passive metadata, not interactive)
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--gx-text-2)' }}>
        <path d="M10 2L2 10M2 10h6M2 10V4" />
      </svg>
    )
  }
  if (d === 'outbound') {
    // Arrow pointing up-right (outbound)
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--gx-success)' }}>
        <path d="M2 10L10 2M10 2H4M10 2v6" />
      </svg>
    )
  }
  // internal — horizontal arrows
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--gx-text-3)' }}>
      <path d="M2 6h8M7 3l3 3-3 3" />
    </svg>
  )
}

/** Row label: prefer subject, fall back to body snippet, fall back to channel */
function interactionLabel(it: Interaction): string {
  if (it.subject) return it.subject
  if (it.body) return it.body.slice(0, 60)
  return it.channel ?? 'Interaction'
}

/** Avatar initials from customer_id or channel */
function avatarText(it: Interaction): string {
  if (it.customer_id) return it.customer_id.slice(0, 2).toUpperCase()
  return (it.channel ?? 'I').slice(0, 2).toUpperCase()
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InteractionsView({
  token,
  customerId,
  embedded,
}: {
  token: string
  customerId?: string
  embedded?: boolean
}) {
  const [list, setList] = useState<Interaction[] | null>(null)
  const [channel, setChannel] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [query, setQuery] = useState('')

  // Messenger state
  const [selected, setSelected] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  // When logging a follow-up from the detail pane, pre-fill customer/ticket
  const [followUpFor, setFollowUpFor] = useState<Interaction | null>(null)

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const p = new URLSearchParams()
    if (customerId) p.set('customer', customerId)
    if (channel)    p.set('channel', channel)
    const qs = p.toString()
    const res = await bget<Interaction[]>(token, `/api/interactions${qs ? `?${qs}` : ''}`)
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) {
      console.error('[interactions] load failed', res.status)
      setError(t('interactions.loadError', 'Failed to load interactions'))
      setList([])
      return
    }
    const rows = Array.isArray(res.data) ? res.data : []
    // Sort desc by occurred_at
    rows.sort((a, b) => {
      const ta = a.occurred_at ?? a.created_at ?? ''
      const tb = b.occurred_at ?? b.created_at ?? ''
      return tb.localeCompare(ta)
    })
    setList(rows)
  }

  useEffect(() => { load() }, [token, customerId, channel])
  // Reset selection when list reloads
  useEffect(() => { setSelected(null) }, [customerId, channel])

  const all = list ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((it) => {
      const fields = [
        it.channel ?? '',
        it.direction ?? '',
        it.subject ?? '',
        it.body ?? '',
        it.customer_id ?? '',
        it.ticket_id ?? '',
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  }, [all, query])

  const selectedInteraction = useMemo(
    () => filtered.find((it) => it.id === selected) ?? null,
    [filtered, selected],
  )

  // ─── Embedded mode (unchanged compact table pattern) ──────────────────────

  if (denied) return <PermissionDenied message={t('interactions.denied', "You don't have permission to view interactions.")} />

  if (embedded) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{t('interactions.title', 'Interactions')}</h3>
          <Button variant="primary" size="sm"
            onClick={() => { setFollowUpFor(null); setLogOpen(true) }}>
            <PlusIcon size={13} /> Log
          </Button>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <SkeletonRows />}
        {unavailable && <EmptyState icon={<MessageIcon size={40} />} title={t('interactions.unavailable', "Interactions aren't available yet")} message={t('interactions.unavailableMsg', 'Logged touchpoints will appear here once the contact-center service is enabled.')} />}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<MessageIcon size={40} />} title="No interactions" message="Log the first customer touchpoint." />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="grid-wrap">
              <table className="grid">
                <thead><tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Subject</th>
                  <th scope="col">When</th>
                </tr></thead>
                <tbody>
                  {all.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {channelIcon(it.channel)} {it.channel ?? '—'}
                        </span>
                      </td>
                      <td>{it.direction ? <StatusPill variant={mapDirection(it.direction)} label={it.direction} size="sm" /> : <span>—</span>}</td>
                      <td>{it.subject || <span style={{ color: 'var(--gx-text-3)' }}>{(it.body ?? '').slice(0, 60) || '—'}</span>}</td>
                      <td><span className="mono" style={{ color: 'var(--gx-text-3)' }}>{timeAgo(it.occurred_at ?? it.created_at ?? null)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {logOpen && (
          <LogModal
            token={token}
            customerId={followUpFor?.customer_id ?? customerId}
            ticketId={followUpFor?.ticket_id ?? undefined}
            onClose={() => { setLogOpen(false); setFollowUpFor(null) }}
            onDone={() => { setLogOpen(false); setFollowUpFor(null); load() }}
          />
        )}
      </div>
    )
  }

  // ─── Standalone — Messenger/comms pattern ─────────────────────────────────

  return (
    <div
      className="gx-comms comms-shell fade"
      style={{ height: 'calc(100vh - var(--gx-header-h))', overflow: 'hidden' }}
    >
      {/* Header */}
      <div className="comms-head">
        <div className="vh-ic"><MessageIcon size={20} /></div>
        <div>
          <h1 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 21, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>
            {t('interactions.title', 'Interactions')}
          </h1>
          <div className="sub" style={{ color: 'var(--gx-text-3)', fontSize: 12.5 }}>
            {t('interactions.sub', 'Contact log · calls · emails · chats · notes')}
          </div>
        </div>
        <span className="spacer" />
        <Button variant="primary" size="sm"
            onClick={() => { setFollowUpFor(null); setLogOpen(true) }}>
          <PlusIcon size={13} /> Log interaction
        </Button>
      </div>

      {/* Body: left rail + right pane */}
      <div className="msgr">
        {/* ── Left rail ─────────────────────────────────── */}
        <div className="msgr-list">
          {/* Search */}
          <div className="msgr-search">
            <SearchIcon size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search interactions"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13, fontFamily: 'var(--gx-font-sans)' }}
            />
            {query && (
              <button className="tb-icon" style={{ width: 22, height: 22 }} onClick={() => setQuery('')}>
                <CloseIcon size={13} />
              </button>
            )}
          </div>

          {/* Channel filter tabs */}
          <div className="msgr-tabs">
            <button
              className={'msgr-tab' + (!channel ? ' on' : '')}
              onClick={() => setChannel('')}
            >
              All
            </button>
            {CHANNELS.map((c) => (
              <button
                key={c}
                className={'msgr-tab' + (channel === c ? ' on' : '')}
                onClick={() => setChannel(c)}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: channelColor(c), display: 'inline-block' }} />
                {c}
              </button>
            ))}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* Loading skeleton */}
            {list === null && !error && (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="convo" style={{ pointerEvents: 'none' }}>
                    <span className="kpi-tile-skeleton" style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0 }} />
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="kpi-tile-skeleton" style={{ height: 11, width: '55%' }} />
                      <span className="kpi-tile-skeleton" style={{ height: 10, width: '75%' }} />
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* Error */}
            {error && <div className="err" style={{ padding: 12 }}>{error} <button className="btn-link" onClick={load}>Retry</button></div>}

            {/* Unavailable */}
            {unavailable && !error && (
              <div className="hint" style={{ textAlign: 'center', padding: '30px 16px' }}>
                {t('interactions.unavailable', "Interactions aren't available yet")}
              </div>
            )}

            {/* Empty */}
            {list !== null && !unavailable && filtered.length === 0 && !error && (
              <div className="hint" style={{ textAlign: 'center', padding: '30px 16px' }}>
                {query ? 'No matching interactions.' : 'No interactions yet.'}
              </div>
            )}

            {/* Interaction rows */}
            {filtered.map((it) => (
              <div
                key={it.id}
                className={'convo' + (selected === it.id ? ' on' : '')}
                onClick={() => { setSelected(it.id); setShowInfo(false) }}
              >
                {/* Avatar with channel dot */}
                <span style={{ position: 'relative', flexShrink: 0 }}>
                  <span
                    className="avatar"
                    style={{ width: 38, height: 38, fontSize: 13 }}
                  >
                    {channelIcon(it.channel, 16)}
                  </span>
                  <span
                    style={{
                      position: 'absolute', right: 0, bottom: 0,
                      width: 10, height: 10, borderRadius: '50%',
                      background: channelColor(it.channel),
                      border: '2px solid var(--gx-surface)',
                    }}
                  />
                </span>

                {/* Text */}
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Direction arrow */}
                    {directionArrow(it.direction)}
                    <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {interactionLabel(it)}
                    </span>
                    <span className="hint" style={{ marginLeft: 'auto', fontSize: 11, flexShrink: 0 }}>
                      {timeAgo(it.occurred_at ?? it.created_at ?? null)}
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span style={{ fontSize: 12, color: 'var(--gx-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {it.channel ?? ''}
                      {it.customer_id ? ` · cust ${it.customer_id.slice(0, 8)}` : ''}
                    </span>
                    {it.ticket_id && (
                      <span className="mono" style={{ fontSize: 11, color: 'var(--gx-link)', flexShrink: 0 }}>
                        TK {it.ticket_id.slice(0, 8)}
                      </span>
                    )}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right pane ────────────────────────────────── */}
        <div className="chat">
          {/* No-selection placeholder */}
          {!selected && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)', padding: 24, textAlign: 'center' }}>
              Select an interaction to view details.
            </div>
          )}

          {selected && selectedInteraction && (
            <InteractionDetail
              interaction={selectedInteraction}
              showInfo={showInfo}
              onToggleInfo={() => setShowInfo((v) => !v)}
              onLogFollowUp={() => { setFollowUpFor(selectedInteraction); setLogOpen(true) }}
            />
          )}
        </div>
      </div>

      {/* Log modal */}
      {logOpen && (
        <LogModal
          token={token}
          customerId={followUpFor?.customer_id ?? customerId}
          ticketId={followUpFor?.ticket_id ?? undefined}
          onClose={() => { setLogOpen(false); setFollowUpFor(null) }}
          onDone={() => { setLogOpen(false); setFollowUpFor(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Detail pane ─────────────────────────────────────────────────────────────

function InteractionDetail({
  interaction: it,
  showInfo,
  onToggleInfo,
  onLogFollowUp,
}: {
  interaction: Interaction
  showInfo: boolean
  onToggleInfo: () => void
  onLogFollowUp: () => void
}) {
  const label = interactionLabel(it)

  return (
    <>
      {/* Pane header */}
      <div className="chat-head">
        <span style={{ flexShrink: 0 }}>
          <span className="avatar" style={{ width: 34, height: 34, fontSize: 13 }}>
            {channelIcon(it.channel, 15)}
          </span>
        </span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
            {label}
          </div>
          <div className="hint" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: channelColor(it.channel) }} />
            {it.channel ?? '—'}
            {it.direction && <>{' · '}{it.direction}</>}
          </div>
        </div>
        <span className="spacer" />
        <button
          className={'tb-icon' + (showInfo ? ' on' : '')}
          onClick={onToggleInfo}
          aria-label="Toggle details panel"
        >
          <PanelRightIcon size={17} />
        </button>
      </div>

      <div className="chat-wrap">
        {/* Main detail body */}
        <div className="chat-body" style={{ overflowY: 'auto', padding: '20px 22px' }}>
          {/* Body / notes */}
          {it.body ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--gx-text-1)', whiteSpace: 'pre-wrap', marginBottom: 20 }}>
              {it.body}
            </div>
          ) : (
            <div style={{ color: 'var(--gx-text-3)', fontSize: 13, marginBottom: 20, fontStyle: 'italic' }}>
              No notes recorded for this interaction.
            </div>
          )}

          {/* Field grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: 20 }}>
            <KV label="Channel" value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {channelIcon(it.channel, 13)} {it.channel ?? '—'}
              </span>
            } />
            <KV label="Direction" value={
              it.direction
                ? <StatusPill variant={mapDirection(it.direction)} label={it.direction} size="sm" />
                : <span style={{ color: 'var(--gx-text-3)' }}>—</span>
            } />
            <KV label="Occurred" value={
              <span className="mono" style={{ fontSize: 12 }}>
                {it.occurred_at ? new Date(it.occurred_at).toLocaleString() : '—'}
              </span>
            } />
            <KV label="Logged" value={
              <span className="mono" style={{ fontSize: 12 }}>
                {it.created_at ? timeAgo(it.created_at) : '—'}
              </span>
            } />
            {it.customer_id && (
              <KV label="Customer" value={
                <span className="mono" style={{ fontSize: 12, color: 'var(--gx-link)' }}>{it.customer_id}</span>
              } />
            )}
            {it.ticket_id && (
              <KV label="Ticket" value={
                <span className="mono" style={{ fontSize: 12, color: 'var(--gx-link)' }}>{it.ticket_id}</span>
              } />
            )}
            {it.subject && (
              <KV label="Subject" value={it.subject} />
            )}
          </div>
        </div>

        {/* Info sidebar */}
        {showInfo && (
          <aside className="chat-info">
            <div style={{ textAlign: 'center', padding: '18px 0 12px' }}>
              <span className="avatar" style={{ width: 56, height: 56, fontSize: 20, margin: '0 auto' }}>
                {channelIcon(it.channel, 22)}
              </span>
              <div style={{ fontWeight: 600, fontSize: 14, marginTop: 10 }}>
                {it.channel ? it.channel.charAt(0).toUpperCase() + it.channel.slice(1) : 'Interaction'}
              </div>
              <div className="hint" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center', marginTop: 3 }}>
                {it.direction ?? 'unknown direction'}
              </div>
            </div>

            <div className="lbl" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', padding: '0 0 8px' }}>
              Details
            </div>
            {it.customer_id && (
              <div className="kv" style={{ padding: '7px 0' }}>
                <span className="kv-k" style={{ width: 72 }}>Customer</span>
                <span className="kv-v mono" style={{ fontSize: 11.5, color: 'var(--gx-link)' }}>{it.customer_id.slice(0, 12)}</span>
              </div>
            )}
            {it.ticket_id && (
              <div className="kv" style={{ padding: '7px 0' }}>
                <span className="kv-k" style={{ width: 72 }}>Ticket</span>
                <span className="kv-v mono" style={{ fontSize: 11.5, color: 'var(--gx-link)' }}>{it.ticket_id.slice(0, 12)}</span>
              </div>
            )}
            <div className="kv" style={{ padding: '7px 0' }}>
              <span className="kv-k" style={{ width: 72 }}>ID</span>
              <span className="kv-v mono" style={{ fontSize: 11.5 }}>{it.id.slice(0, 12)}</span>
            </div>
            <div className="kv" style={{ padding: '7px 0' }}>
              <span className="kv-k" style={{ width: 72 }}>Occurred</span>
              <span className="kv-v" style={{ fontSize: 11.5 }}>{it.occurred_at ? timeAgo(it.occurred_at) : '—'}</span>
            </div>
          </aside>
        )}
      </div>

      {/* Action bar — "Log follow-up" is a real POST action */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--gx-border-subtle)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <Button variant="primary" size="sm"
            onClick={onLogFollowUp}>
          <PlusIcon size={13} /> Log follow-up
        </Button>
        <span className="spacer" />
        <span className="hint" style={{ fontSize: 11 }}>
          {timeAgo(it.occurred_at ?? it.created_at ?? null)}
        </span>
      </div>
    </>
  )
}

// ─── KV row helper ─────────────────────────────────────────────────────────────

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="lbl" style={{ fontSize: 10.5, color: 'var(--gx-text-3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.08em' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--gx-text-1)' }}>{value}</div>
    </div>
  )
}

// ─── Log / follow-up modal ────────────────────────────────────────────────────

function LogModal({
  token,
  customerId,
  ticketId,
  onClose,
  onDone,
}: {
  token: string
  customerId?: string | null
  ticketId?: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [channel, setChannel] = useState('call')
  const [direction, setDirection] = useState('inbound')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!body.trim() || saving) return
    setSaving(true)
    try {
      // Backend expects customer_id (not customer); see backend/app/routers/interactions.py.
      await bpost(token, '/api/interactions', {
        channel,
        direction,
        subject: subject.trim() || undefined,
        body: body.trim(),
        customer_id: customerId || undefined,
        ticket_id: ticketId || undefined,
        occurred_at: new Date().toISOString(),
      })
      toast.success(t('interactions.logged', 'Interaction logged'))
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Log interaction"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="gold" size="md"
            disabled={saving || !body.trim()}
            onClick={submit}>
            {saving ? 'Saving…' : 'Log'}
          </Button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Channel</span>
          <select className="inp inp-md" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Direction</span>
          <select className="inp inp-md" value={direction} onChange={(e) => setDirection(e.target.value)}>
            {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Subject</span>
          <input className="inp inp-md" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="optional" />
        </label>
        {customerId && (
          <label className="field">
            <span>Customer</span>
            <input className="inp inp-md" value={customerId} readOnly style={{ color: 'var(--gx-text-2)' }} />
          </label>
        )}
        {ticketId && (
          <label className="field">
            <span>Ticket</span>
            <input className="inp inp-md" value={ticketId} readOnly style={{ color: 'var(--gx-text-2)' }} />
          </label>
        )}
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Notes *</span>
          <textarea
            className="inp inp-md inp-area"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  )
}
