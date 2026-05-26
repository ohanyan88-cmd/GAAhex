import { useEffect, useState } from 'react'
import { toast } from './Toast'
import { timeAgo } from './time'
import { EmptyState, ErrorBanner, PermissionDenied } from './States'
import { InboxIcon } from './icons'

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
const STATUSES = ['queued', 'sent', 'delivered', 'failed']

function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toLowerCase()
  const cls = s === 'failed' ? 'pill pill-danger'
    : (s === 'delivered' || s === 'sent') ? 'pill pill-success'
    : 'pill pill-muted'
  return status ? <span className={cls}>{status}</span> : <span>—</span>
}

export default function OutboundView({ token }: { token: string }) {
  const [list, setList] = useState<Outbound[] | null>(null)
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)

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
      <div className="view-head"><h2>Outbound</h2></div>

      <div className="list-toolbar">
        <div className="bill-filter">
          <span className="muted export-label">Channel</span>
          <select className="inp inp-sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">All</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="bill-filter">
          <span className="muted export-label">Status</span>
          <select className="inp inp-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
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
        <table className="grid">
          <thead><tr><th>Channel</th><th>To</th><th>Message</th><th>Status</th><th>When</th></tr></thead>
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
        </table>
      )}
    </div>
  )
}
