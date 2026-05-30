import { useEffect, useMemo, useState } from 'react'
import Composer from '../components/Composer'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import ViewHead from '../components/ViewHead'
import {
  MessageIcon,
  SearchIcon,
  CloseIcon,
  PhoneIcon,
  InfoIcon,
} from '../components/icons'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Thread = {
  id: string
  entity_key: string | null
  record_id: string | null
  title: string | null
  created_by: string
  created_at: string | null
}
type Message = {
  id: string
  thread_id: string
  author_user_id: string
  author_name: string
  body: string
  created_at: string | null
}

function threadLabel(t: Thread): string {
  if (t.title) return t.title
  if (t.entity_key) return `${t.entity_key} · record`
  return 'Conversation'
}

function initials(name: string): string {
  const s = name.trim()
  if (!s) return '·'
  const parts = s.split(/\s+/).slice(0, 2)
  return parts.map(p => p.charAt(0).toUpperCase()).join('') || s.charAt(0).toUpperCase()
}

function timeShort(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function MessagesView({ token }: { token: string }) {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [msgError, setMsgError] = useState('')
  const [query, setQuery] = useState('')
  const [showInfo, setShowInfo] = useState(false)
  // currentUserId is unknown at the view level (no /me wiring here); fall back to created_by of the
  // first message to keep "in/out" classification deterministic per-thread. The thread creator is
  // treated as "me" — adequate for visual styling; real ownership comes from auth.
  // TODO(backend): expose a /api/me endpoint or pass user_id from App.tsx so outgoing detection is
  // accurate cross-thread.

  async function loadThreads() {
    setError('')
    try {
      const r = await fetch(`${BASE}/api/threads`, { headers: authH(token) })
      if (!r.ok) throw new Error('Failed to load threads')
      const data: Thread[] = await r.json()
      setThreads(Array.isArray(data) ? data : [])
    } catch (e) {
      setError((e as Error).message)
      setThreads([])
    }
  }

  async function loadMessages(id: string) {
    setMsgError(''); setMessages(null)
    try {
      const r = await fetch(`${BASE}/api/threads/${id}/messages`, { headers: authH(token) })
      if (!r.ok) throw new Error('Failed to load messages')
      setMessages(await r.json())
    } catch (e) {
      setMsgError((e as Error).message)
      setMessages([])
    }
  }

  useEffect(() => { loadThreads() }, [token])
  useEffect(() => { if (selected) loadMessages(selected) }, [selected])

  async function post(body: string) {
    if (!selected) return
    const r = await fetch(`${BASE}/api/threads/${selected}/messages`, {
      method: 'POST',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: 'Could not send message' }))
      const msg = typeof e.detail === 'string' ? e.detail : 'Could not send message'
      toast.error(msg)
      throw new Error(msg)
    }
    await loadMessages(selected)
  }

  const selectedThread = useMemo(
    () => threads?.find(t => t.id === selected) ?? null,
    [threads, selected],
  )

  const filteredThreads = useMemo(() => {
    if (!threads) return []
    const q = query.trim().toLowerCase()
    if (!q) return threads
    return threads.filter(t => threadLabel(t).toLowerCase().includes(q))
  }, [threads, query])

  // "Out" = author matches the thread creator. Best-effort proxy for "me".
  function isOutgoing(m: Message): boolean {
    if (!selectedThread) return false
    return m.author_user_id === selectedThread.created_by
  }

  return (
    <div className="gx-comms comms-shell">
      <div className="comms-head">
        <div className="vh-ic"><MessageIcon size={18} /></div>
        <div>
          <h1 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Messages</h1>
          <div className="hint" style={{ fontSize: 12 }}>Customer conversations</div>
        </div>
        <span className="spacer" />
      </div>

      {error && <p className="err" style={{ margin: '0 0 8px' }}>{error}</p>}

      <div className="msgr">
        {/* ── Conversation list ───────────────────────────────────────── */}
        <div className="msgr-list">
          <div className="msgr-search">
            <SearchIcon size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13, fontFamily: 'var(--gx-font-sans)' }}
            />
            {query && (
              <button className="tb-icon" style={{ width: 22, height: 22 }} onClick={() => setQuery('')} aria-label="Clear search">
                <CloseIcon size={13} />
              </button>
            )}
          </div>
          {/* msgr-tabs (channel filter): backend has no `channel` on Thread today, so the tabs
              row is omitted. When `entity_key` becomes a routing facet, surface it here.
              TODO(backend): /api/threads could expose channel + unread counts to drive these tabs. */}

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {threads === null && !error && <p className="muted" style={{ padding: 12 }}>Loading…</p>}
            {threads && filteredThreads.length === 0 && !error && (
              <p className="muted" style={{ padding: 12 }}>
                {query ? 'No conversations match.' : 'No conversations yet. Comment threads on records appear here.'}
              </p>
            )}
            {filteredThreads.map((t) => {
              const label = threadLabel(t)
              return (
                <div
                  key={t.id}
                  className={'convo' + (selected === t.id ? ' on' : '')}
                  onClick={() => setSelected(t.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(t.id) } }}
                >
                  <span style={{ position: 'relative', flexShrink: 0 }}>
                    <span className="avatar" style={{ width: 38, height: 38, fontSize: 13 }}>{initials(label)}</span>
                    {/* online dot — kit shows it; no backend presence today.
                        TODO(backend): GET /api/presence/{user_id} → drive .gx-online indicator. */}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{label}</span>
                      <span className="hint" style={{ fontSize: 11, flexShrink: 0 }}>{timeAgo(t.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gx-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {t.entity_key ? `${t.entity_key}${t.record_id ? ` · ${t.record_id.slice(0, 8)}` : ''}` : 'Conversation'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Chat pane ──────────────────────────────────────────────── */}
        <div className="chat">
          {!selected && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)', padding: 24, textAlign: 'center' }}>
              Select a conversation to begin.
            </div>
          )}
          {selected && selectedThread && (
            <>
              <div className="chat-head">
                <span style={{ position: 'relative' }}>
                  <span className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{initials(threadLabel(selectedThread))}</span>
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{threadLabel(selectedThread)}</div>
                  <div className="hint" style={{ fontSize: 11 }}>
                    {selectedThread.entity_key
                      ? `${selectedThread.entity_key} record`
                      : 'Thread'}
                    {' · '}
                    {timeAgo(selectedThread.created_at)}
                  </div>
                </div>
                <span className="spacer" />
                <button className="tb-icon" title="Call (coming soon)" onClick={() => toast.info('Call — not yet wired')}>
                  <PhoneIcon size={17} />
                </button>
                <button className="tb-icon" title="Search in thread (coming soon)" onClick={() => toast.info('In-thread search — not yet wired')}>
                  <SearchIcon size={17} />
                </button>
                <button
                  className={'tb-icon' + (showInfo ? ' on' : '')}
                  title="Thread details"
                  onClick={() => setShowInfo(v => !v)}
                >
                  <InfoIcon size={17} />
                </button>
              </div>

              <div className="chat-wrap">
                <div className="chat-body">
                  {messages === null && !msgError && <p className="muted">Loading…</p>}
                  {msgError && <p className="err">{msgError}</p>}
                  {messages && messages.length === 0 && !msgError && (
                    <p className="muted" style={{ textAlign: 'center' }}>No messages yet.</p>
                  )}
                  {messages && messages.length > 0 && (
                    <div className="chat-day">{timeAgo(messages[0].created_at) || 'Earlier'}</div>
                  )}
                  {messages && messages.map((m) => {
                    const out = isOutgoing(m)
                    const dir = out ? 'out' : 'in'
                    return (
                      <div key={m.id} className={'bubble-row ' + dir}>
                        <div className="bubble-wrap">
                          {!out && (
                            <div style={{ fontSize: 11, color: 'var(--gx-text-3)', marginBottom: 2, paddingLeft: 4 }}>
                              {m.author_name || 'Someone'}
                            </div>
                          )}
                          <div className={'bubble ' + dir}>
                            {m.body}
                            <span className="bt">
                              {timeShort(m.created_at) || timeAgo(m.created_at)}
                              {/* Read receipts: backend has no `read_at` per recipient today.
                                  TODO(backend): expose Message.read_by → render ' · seen' suffix. */}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {/* Typing indicator: no presence channel today; not rendered.
                      TODO(backend): WebSocket /ws/threads/{id}/typing → set local `typing` state. */}
                </div>

                {showInfo && (
                  <aside className="chat-info">
                    <div style={{ textAlign: 'center', padding: '18px 0 12px' }}>
                      <span className="avatar" style={{ width: 64, height: 64, fontSize: 22, margin: '0 auto' }}>
                        {initials(threadLabel(selectedThread))}
                      </span>
                      <div style={{ fontWeight: 600, fontSize: 15, marginTop: 10 }}>{threadLabel(selectedThread)}</div>
                      <div className="hint" style={{ fontSize: 11.5, marginTop: 3 }}>
                        {selectedThread.entity_key || 'Conversation'}
                      </div>
                    </div>
                    <div className="hint" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', padding: '0 0 8px' }}>
                      Thread
                    </div>
                    <div className="kv" style={{ padding: '8px 0' }}>
                      <span className="kv-k" style={{ width: 90 }}>ID</span>
                      <span className="kv-v mono" style={{ fontSize: 11.5 }}>{selectedThread.id.slice(0, 12)}</span>
                    </div>
                    {selectedThread.entity_key && (
                      <div className="kv" style={{ padding: '8px 0' }}>
                        <span className="kv-k" style={{ width: 90 }}>Entity</span>
                        <span className="kv-v">{selectedThread.entity_key}</span>
                      </div>
                    )}
                    {selectedThread.record_id && (
                      <div className="kv" style={{ padding: '8px 0' }}>
                        <span className="kv-k" style={{ width: 90 }}>Record</span>
                        <span className="kv-v mono" style={{ fontSize: 11.5 }}>{selectedThread.record_id.slice(0, 12)}</span>
                      </div>
                    )}
                    <div className="kv" style={{ padding: '8px 0' }}>
                      <span className="kv-k" style={{ width: 90 }}>Created</span>
                      <span className="kv-v">{timeAgo(selectedThread.created_at)}</span>
                    </div>
                    <div className="kv" style={{ padding: '8px 0' }}>
                      <span className="kv-k" style={{ width: 90 }}>Messages</span>
                      <span className="kv-v">{messages?.length ?? '—'}</span>
                    </div>
                  </aside>
                )}
              </div>

              <div className="chat-composer">
                <Composer onSend={post} placeholder="Type a message…" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
