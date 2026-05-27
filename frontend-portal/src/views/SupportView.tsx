import { useEffect, useState } from 'react'
import { api, type PortalTicket, type PortalReply } from '../api'

type View = 'list' | 'new' | 'detail'

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    OPEN: 'var(--primary)', IN_PROGRESS: 'var(--warning)', RESOLVED: 'var(--success)', CLOSED: 'var(--text-3)',
  }
  return (
    <span style={{
      background: `${colors[status] ?? 'var(--text-3)'}22`,
      color: colors[status] ?? 'var(--text-3)',
      border: `1px solid ${colors[status] ?? 'var(--text-3)'}`,
      borderRadius: 'var(--pill)',
      padding: '2px 10px',
      fontSize: 11,
      fontWeight: 600,
    }}>
      {status}
    </span>
  )
}

export default function SupportView() {
  const [view, setView] = useState<View>('list')
  const [tickets, setTickets] = useState<PortalTicket[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ ticket: PortalTicket; replies: PortalReply[] } | null>(null)
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.tickets().then(setTickets).catch(err => setError(err.message))
  }, [])

  async function openTicket(id: string) {
    setSelectedId(id)
    setDetail(null)
    setView('detail')
    const d = await api.ticket(id)
    setDetail(d)
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const t = await api.createTicket(newSubject, newBody)
      setTickets(prev => [t, ...prev])
      setNewSubject(''); setNewBody('')
      setView('list')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket')
    } finally {
      setLoading(false)
    }
  }

  async function submitReply(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) return
    setLoading(true)
    try {
      const r = await api.replyTicket(selectedId, replyBody)
      setDetail(prev => prev ? { ...prev, replies: [...prev.replies, r] } : prev)
      setReplyBody('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply')
    } finally {
      setLoading(false)
    }
  }

  if (view === 'new') {
    return (
      <div style={{ padding: 28 }}>
        <button onClick={() => setView('list')} style={{ background: 'none', color: 'var(--primary)', marginBottom: 16, fontSize: 13 }}>
          Back to tickets
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>New support ticket</h1>
        <form onSubmit={submitNew} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 540 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Subject</label>
            <input value={newSubject} onChange={e => setNewSubject(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Description</label>
            <textarea value={newBody} onChange={e => setNewBody(e.target.value)} rows={5} style={{ width: '100%', resize: 'vertical' }} />
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ background: 'var(--primary)', color: 'var(--text)', borderRadius: 'var(--radius)', padding: '9px 20px', fontWeight: 600, alignSelf: 'flex-start' }}>
            {loading ? 'Submitting...' : 'Submit ticket'}
          </button>
        </form>
      </div>
    )
  }

  if (view === 'detail') {
    return (
      <div style={{ padding: 28, maxWidth: 680 }}>
        <button onClick={() => setView('list')} style={{ background: 'none', color: 'var(--primary)', marginBottom: 16, fontSize: 13 }}>
          Back to tickets
        </button>
        {!detail ? (
          <div style={{ color: 'var(--text-3)' }}>Loading...</div>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700 }}>{detail.ticket.subject}</h1>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
                <StatusPill status={detail.ticket.status} />
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{new Date(detail.ticket.created_at).toLocaleDateString()}</span>
              </div>
              {detail.ticket.body && (
                <p style={{ marginTop: 14, color: 'var(--text-2)', lineHeight: 1.6 }}>{detail.ticket.body}</p>
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
              {detail.replies.length === 0 ? (
                <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No replies yet.</p>
              ) : (
                detail.replies.map(r => (
                  <div key={r.id} style={{
                    background: r.direction === 'inbound' ? 'var(--primary-soft)' : 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '10px 14px',
                    marginBottom: 8,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
                      {r.direction === 'inbound' ? 'You' : 'Support'} — {new Date(r.created_at).toLocaleString()}
                    </div>
                    <div style={{ color: 'var(--text)', lineHeight: 1.5 }}>{r.body}</div>
                  </div>
                ))
              )}
            </div>
            {['OPEN', 'IN_PROGRESS'].includes(detail.ticket.status) && (
              <form onSubmit={submitReply} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)} placeholder="Write a reply..." rows={3} style={{ width: '100%', resize: 'vertical' }} />
                <button type="submit" disabled={loading || !replyBody.trim()} style={{ background: 'var(--primary)', color: 'var(--text)', borderRadius: 'var(--radius)', padding: '8px 18px', fontWeight: 600, alignSelf: 'flex-start' }}>
                  {loading ? 'Sending...' : 'Send reply'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Support</h1>
        <button onClick={() => setView('new')} style={{ background: 'var(--primary)', color: 'var(--text)', borderRadius: 'var(--radius)', padding: '8px 16px', fontWeight: 600, fontSize: 13 }}>
          New ticket
        </button>
      </div>
      {error && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
      {tickets.length === 0 ? (
        <p style={{ color: 'var(--text-3)' }}>No tickets yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tickets.map(t => (
            <button key={t.id} onClick={() => openTicket(t.id)} style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
              textAlign: 'left',
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              color: 'var(--text)',
              transition: 'background 0.15s',
            }}>
              <span style={{ fontWeight: 600, flex: 1 }}>{t.subject}</span>
              <StatusPill status={t.status} />
              <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{new Date(t.created_at).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
