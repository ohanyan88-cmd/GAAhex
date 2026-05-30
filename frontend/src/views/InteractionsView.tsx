import { useEffect, useMemo, useState } from 'react'
import { bget, bpost } from '../lib/billing'
import ViewHead from '../components/ViewHead'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import {
  PhoneIcon, MailIcon, MessageIcon, EditIcon, InfoIcon, PlusIcon,
  SearchIcon, ArrowUpIcon, ArrowDownIcon,
  ChevronLeftIcon, ArrowRightIcon,
} from '../components/icons'
import { t } from '../lib/i18n'
import { StatusPill } from '../primitives'

// Interactions log — served by /api/interactions (contact-center router, doc 27). Supports
// embedded mode (in CustomerView / CustomerBillingModal) by filtering by the customer field
// via the backend's `customer` query param.
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

// Map interaction direction → StatusPill variant (informational; no critical paths here).
type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapDirection(dir: string | null | undefined): PillVariant {
  const d = (dir ?? '').toLowerCase()
  if (d === 'inbound') return 'info'
  if (d === 'outbound') return 'active'
  if (d === 'internal') return 'neutral'
  return 'info'
}

function channelIcon(channel: string | null | undefined, size = 13) {
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

  // Toolbar / table interaction state.
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const p = new URLSearchParams()
    if (customerId) p.set('customer', customerId)
    if (channel) p.set('channel', channel)
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
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token, customerId, channel])
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir, channel, customerId])

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
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  }, [all, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (it: Interaction): string => {
      switch (k) {
        case 'channel': return it.channel ?? ''
        case 'direction': return it.direction ?? ''
        case 'subject': return it.subject ?? (it.body ?? '')
        case 'when': return it.occurred_at ?? it.created_at ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => String(get(a)).localeCompare(String(get(b))) * dir)
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  if (denied) return <PermissionDenied message={t('interactions.denied', "You don't have permission to view interactions.")} />

  // === EMBEDDED MODE === — used inside CustomerView. No outer .view shell, no toolbar; the host
  // page already supplies the chrome. Keep the compact card+table look.
  if (embedded) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{t('interactions.title', 'Interactions')}</h3>
          <button className="btn btn-primary btn-sm" onClick={() => setLogOpen(true)}>
            <PlusIcon size={13} /> Log
          </button>
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
          <LogModal token={token} customerId={customerId} onClose={() => setLogOpen(false)} onDone={() => { setLogOpen(false); load() }} />
        )}
      </div>
    )
  }

  // === STANDALONE MODE === — list pattern (crumbs · view-head · toolbar · grid · foot).
  return (
    <div className="view-inner fade">
        <div className="crumbs">
          <span>CRM</span><span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>{t('interactions.title', 'Interactions')}</span>
        </div>

        <ViewHead
          icon={<MessageIcon size={18} />}
          title={t('interactions.title', 'Interactions')}
          sub={`${all.length} record${all.length !== 1 ? 's' : ''} · calls · emails · chats · notes`}
          actions={
            <button className="btn btn-primary btn-sm" onClick={() => setLogOpen(true)}>
              <PlusIcon size={13} /> Log interaction
            </button>
          }
        />

        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <SkeletonRows />}
        {unavailable && <EmptyState icon={<MessageIcon size={40} />} title={t('interactions.unavailable', "Interactions aren't available yet")} message={t('interactions.unavailableMsg', 'Logged touchpoints will appear here once the contact-center service is enabled.')} />}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<MessageIcon size={40} />} title="No interactions" message="Log the first customer touchpoint." />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search interactions"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <select
                className="inp inp-sm"
                aria-label="Filter by channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                style={{ width: 140 }}
              >
                <option value="">All channels</option>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="spacer" />
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {(['channel', 'direction', 'subject', 'when'] as const).map((k) => (
                      <th
                        key={k}
                        scope="col"
                        onClick={() => toggleSort(k)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {k === 'channel' ? 'Channel'
                           : k === 'direction' ? 'Direction'
                           : k === 'subject' ? 'Subject'
                           : 'When'}
                          {sortKey === k && (sortDir === 1 ? <ArrowUpIcon size={11} /> : <ArrowDownIcon size={11} />)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((it) => (
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
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching interactions.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
                {sorted.length === 0
                  ? '0 interactions'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeftIcon size={13} /> Prev
              </button>
              <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>Page {page} of {pageCount}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next <ArrowRightIcon size={13} />
              </button>
            </div>
          </div>
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
      // Backend expects customer_id (not customer); see backend/app/routers/interactions.py.
      await bpost(token, '/api/interactions', {
        channel,
        direction,
        subject: subject.trim() || undefined,
        body: body.trim(),
        customer_id: customerId || undefined,
        occurred_at: new Date().toISOString(),
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
