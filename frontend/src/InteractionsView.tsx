import { useEffect, useState } from 'react'
import { bget, bpost } from './billing'
import { Modal } from './Modal'
import { toast } from './Toast'
import { timeAgo } from './time'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from './States'
import { PhoneIcon, MailIcon, MessageIcon, EditIcon, InfoIcon } from './icons'
import { t } from './i18n'

// Interactions log (E14 /api/interactions) — list + "Log interaction" composer. Degrades on 404.
type Interaction = {
  id: string
  channel?: string
  direction?: string
  subject?: string | null
  body?: string
  agent_user_id?: string | null
  agent_name?: string | null
  occurred_at?: string | null
  created_at?: string | null
}

const CHANNELS = ['call', 'email', 'chat', 'sms', 'note', 'other']
const DIRECTIONS = ['inbound', 'outbound', 'internal']

function channelIcon(channel: string | null | undefined, size = 15) {
  switch ((channel ?? '').toLowerCase()) {
    case 'call': return <PhoneIcon size={size} />
    case 'email': return <MailIcon size={size} />
    case 'chat': return <MessageIcon size={size} />
    case 'sms': return <MessageIcon size={size} />
    case 'note': return <EditIcon size={size} />
    default: return <InfoIcon size={size} />
  }
}

export default function InteractionsView({ token, customerId, embedded }: { token: string; customerId?: string; embedded?: boolean }) {
  const [list, setList] = useState<Interaction[] | null>(null)
  const [channel, setChannel] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const p = new URLSearchParams()
    if (customerId) p.set('customer', customerId)
    if (channel) p.set('channel', channel)
    const qs = p.toString()
    const res = await bget<Interaction[]>(token, `/api/interactions${qs ? `?${qs}` : ''}`)
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError(t('interactions.loadError', 'Failed to load interactions')); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token, customerId, channel])

  if (denied) return <PermissionDenied message={t('interactions.denied', "You don't have permission to view interactions.")} />

  return (
    <div>
      <div className="view-head">
        {!embedded && <h2>Interactions</h2>}
        <button className={'btn btn-primary btn-sm' + (embedded ? '' : ' btn-md')} onClick={() => setLogOpen(true)}>Log interaction</button>
      </div>

      {!embedded && (
        <div className="list-toolbar">
          <div className="bill-filter">
            <span className="muted export-label">Channel</span>
            <select className="inp inp-sm" aria-label="Filter by channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">All</option>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <SkeletonRows />}
      {unavailable && <EmptyState icon={<MessageIcon size={40} />} title={t('interactions.unavailable', "Interactions aren't available yet")} message={t('interactions.unavailableMsg', 'Logged touchpoints will appear here once the contact-center service is enabled.')} />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<MessageIcon size={40} />} title="No interactions" message="Log the first customer touchpoint." />
      )}

      {list && list.length > 0 && (
        <div className="grid-wrap"><table className="grid">
          <thead><tr><th scope="col">Channel</th><th scope="col">Direction</th><th scope="col">Subject</th><th scope="col">Agent</th><th scope="col">When</th></tr></thead>
          <tbody>
            {list.map((it) => (
              <tr key={it.id}>
                <td><span className="chan-cell">{channelIcon(it.channel)} {it.channel ?? '—'}</span></td>
                <td>{it.direction ?? '—'}</td>
                <td>{it.subject || <span className="muted">{(it.body ?? '').slice(0, 60) || '—'}</span>}</td>
                <td>{it.agent_name ?? (it.agent_user_id ? it.agent_user_id.slice(0, 8) : '—')}</td>
                <td>{timeAgo(it.occurred_at ?? it.created_at ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {logOpen && (
        <LogModal token={token} customerId={customerId} onClose={() => setLogOpen(false)} onDone={() => { setLogOpen(false); load() }} />
      )}
    </div>
  )
}

function LogModal({ token, customerId, onClose, onDone }: { token: string; customerId?: string; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState('call')
  const [direction, setDirection] = useState('inbound')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!body.trim() || saving) return
    setSaving(true)
    try {
      await bpost(token, '/api/interactions', {
        channel, direction, subject: subject.trim() || undefined, body: body.trim(),
        customer_id: customerId || undefined,
      })
      toast.success(t('interactions.logged', 'Interaction logged'))
      onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Log interaction" size="md"
      footer={<>
        <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
        <button className="btn btn-accent btn-md" disabled={saving || !body.trim()} onClick={submit}>{saving ? 'Saving…' : 'Log'}</button>
      </>}>
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field"><span>Channel</span>
          <select className="inp inp-md" value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </label>
        <label className="field"><span>Direction</span>
          <select className="inp inp-md" value={direction} onChange={(e) => setDirection(e.target.value)}>{DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        </label>
        <label className="field"><span>Subject</span><input className="inp inp-md" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="optional" /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Notes *</span><textarea className="inp inp-md inp-area" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      </div>
    </Modal>
  )
}
