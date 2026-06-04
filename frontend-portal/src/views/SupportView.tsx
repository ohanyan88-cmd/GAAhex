import { useEffect, useState } from 'react'
import { api, type PortalTicket, type PortalReply } from '../lib/api'
import { useI18n } from '../lib/i18n'  // T-P4-2

type View = 'list' | 'new' | 'detail'

function ticketPillClass(status: string): string {
  const map: Record<string, string> = {
    OPEN:        'pill',
    IN_PROGRESS: 'pill pill-warning',
    RESOLVED:    'pill pill-success',
    CLOSED:      'pill pill-muted',
  }
  return map[status] ?? 'pill pill-muted'
}

/* Back chevron */
function IconBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

/* Plus icon */
function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export default function SupportView() {
  const [view, setView]             = useState<View>('list')
  const [tickets, setTickets]       = useState<PortalTicket[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail]         = useState<{ ticket: PortalTicket; replies: PortalReply[] } | null>(null)
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody]       = useState('')
  const [replyBody, setReplyBody]   = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const { t } = useI18n()

  // T-P4-2 — value stays UPPER_SNAKE_CASE (B1).
  const ticketStatusLabel = (s: string): string => {
    const map: Record<string, string> = {
      OPEN:        t('sup.statusOpen', 'OPEN'),
      IN_PROGRESS: t('sup.statusInProgress', 'IN PROGRESS'),
      RESOLVED:    t('sup.statusResolved', 'RESOLVED'),
      CLOSED:      t('sup.statusClosed', 'CLOSED'),
    }
    return map[s] ?? s
  }
  const priorityLabel = (p: string): string => {
    const map: Record<string, string> = {
      LOW:    t('sup.priorityLow', 'LOW'),
      NORMAL: t('sup.priorityNormal', 'NORMAL'),
      HIGH:   t('sup.priorityHigh', 'HIGH'),
      URGENT: t('sup.priorityUrgent', 'URGENT'),
    }
    return map[p] ?? p
  }

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
      const created = await api.createTicket(newSubject, newBody)
      setTickets(prev => [created, ...prev])
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

  /* ── New ticket form ── */
  if (view === 'new') {
    return (
      <div>
        <div className="view-head">
          <button className="btn btn-ghost btn-sm row gap-4" onClick={() => setView('list')}>
            <IconBack /> {t('common.back', 'Back')}
          </button>
          <div className="view-title-wrap">
            <h2>{t('sup.newTicket', 'New support ticket')}</h2>
          </div>
        </div>

        <form onSubmit={submitNew} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
          <div className="field">
            <span className="uppercase-label">{t('sup.subject', 'Subject')}</span>
            <input
              className="inp inp-md"
              value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <span className="uppercase-label">{t('sup.body', 'Description')}</span>
            <textarea
              className="inp inp-area"
              value={newBody}
              onChange={e => setNewBody(e.target.value)}
              rows={5}
            />
          </div>
          {error && <span className="err">{error}</span>}
          <div className="row gap-8">
            <button
              type="submit"
              className="btn btn-primary btn-md"
              disabled={loading || !newSubject.trim()}
            >
              {loading ? t('sup.submitting', 'Submitting...') : t('sup.submit', 'Submit ticket')}
            </button>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setView('list')}>
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        </form>
      </div>
    )
  }

  /* ── Ticket detail ── */
  if (view === 'detail') {
    return (
      <div style={{ maxWidth: 700 }}>
        <div className="view-head">
          <button className="btn btn-ghost btn-sm row gap-4" onClick={() => setView('list')}>
            <IconBack /> {t('common.back', 'Back')}
          </button>
        </div>

        {!detail ? (
          <div className="loading-state">{t('common.loading', 'Loading...')}</div>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <h2>{detail.ticket.subject}</h2>
              <div className="row" style={{ marginTop: 10 }}>
                <span className={ticketPillClass(detail.ticket.status)}>{ticketStatusLabel(detail.ticket.status)}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(detail.ticket.created_at).toLocaleDateString()}
                </span>
              </div>
              {detail.ticket.body && (
                <p style={{ marginTop: 14, color: 'var(--text-2)', lineHeight: 1.65 }}>
                  {detail.ticket.body}
                </p>
              )}
            </div>

            <div className="section-divider" />

            {/* Replies thread */}
            <div className="comments" style={{ maxHeight: 'none', marginBottom: 18 }}>
              {detail.replies.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>{t('sup.noReplies', 'No replies yet.')}</p>
              ) : (
                detail.replies.map(r => (
                  <div
                    key={r.id}
                    className="comment"
                    style={r.direction === 'inbound' ? { background: 'var(--primary-soft)', border: '1px solid rgba(58,111,181,0.25)' } : undefined}
                  >
                    <div className="comment-head">
                      <span className="comment-author" style={{ color: r.direction === 'inbound' ? 'var(--primary-hover)' : 'var(--accent)' }}>
                        {r.direction === 'inbound' ? t('sup.you', 'You') : t('sup.support', 'Support')}
                      </span>
                      <span className="comment-time">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                    <div className="comment-body">{r.body}</div>
                  </div>
                ))
              )}
            </div>

            {/* Reply composer */}
            {['OPEN', 'IN_PROGRESS'].includes(detail.ticket.status) && (
              <form onSubmit={submitReply} className="composer">
                <textarea
                  className="inp inp-area"
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  placeholder={t('sup.replyPlaceholder', 'Write a reply...')}
                  rows={3}
                />
                <div className="composer-actions">
                  <button
                    type="submit"
                    className="btn btn-primary btn-md"
                    disabled={loading || !replyBody.trim()}
                  >
                    {loading ? t('sup.sending', 'Sending...') : t('sup.reply', 'Send reply')}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    )
  }

  /* ── Ticket list ── */
  return (
    <div>
      <div className="view-head">
        <div className="view-title-wrap">
          <h2>{t('sup.title', 'Support')}</h2>
          <span className="view-sub">{t('sup.subtitle', 'Your support tickets')}</span>
        </div>
        <div className="view-head-actions">
          <button className="btn btn-primary btn-md row gap-4" onClick={() => setView('new')}>
            <IconPlus /> {t('sup.newTicket', 'New ticket')}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner" style={{ marginBottom: 14 }}>
          <span className="error-banner-msg">{error}</span>
        </div>
      )}

      {tickets.length === 0 ? (
        <div className="empty-state">
          <h3>{t('sup.empty', 'No tickets yet')}</h3>
          <p>{t('sup.emptyHint', "Open a support ticket and we'll get back to you shortly.")}</p>
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>{t('sup.subject', 'Subject')}</th>
              <th>{t('bills.status', 'Status')}</th>
              <th>{t('sup.priority', 'Priority')}</th>
              <th>{t('sup.opened', 'Opened')}</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map(tk => (
              <tr key={tk.id} style={{ cursor: 'pointer' }} onClick={() => openTicket(tk.id)}>
                <td>
                  <button className="row-link">{tk.subject}</button>
                </td>
                <td><span className={ticketPillClass(tk.status)}>{ticketStatusLabel(tk.status)}</span></td>
                <td><span className="badge">{priorityLabel(tk.priority)}</span></td>
                <td className="cell-meta">{new Date(tk.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
