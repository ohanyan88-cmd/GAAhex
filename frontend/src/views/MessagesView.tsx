import { useEffect, useMemo, useRef, useState } from 'react'
import { timeAgo } from '../lib/time'
import { type Capabilities, FULL_ACCESS } from '../lib/capabilities'
import { Button } from '../primitives'  // T-P3-7
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_CHANNEL_LABELS,
  type CommunicationChannel,
} from '../lib/lifecycle'
import { PageShell } from '../page-shell'
import {
  MessageIcon,
  SearchIcon,
  CloseIcon,
  PanelRightIcon,
  SmileIcon,
  SendHorizontalIcon,
} from '../components/icons'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

// Emoji palette for the composer picker. Per icons.tsx convention, emoji are
// allowed in human communication (the chat itself) but never as product UI chrome.
const EMOJIS = ['👍','🙏','✅','🔧','📶','📡','😊','🎉','👀','🚀','⚠️','💡','📞','🛠️','❤️','🔥']

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
type Me = { id: string; email: string; name: string }

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

function dayLabel(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const today = new Date()
    const isSameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    if (isSameDay) return 'Today'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export default function MessagesView({
  token,
  capabilities: _capabilities = FULL_ACCESS,
}: {
  token: string
  capabilities?: Capabilities
}) {
  const [me, setMe] = useState<Me | null>(null)
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [msgError, setMsgError] = useState('')
  const [query, setQuery] = useState('')
  const [showInfo, setShowInfo] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  // Channel chips — UI-only for now. The backend Thread model doesn't carry a channel
  // discriminator yet, so chip clicks act as a visual filter only ("All" = show all threads).
  // When the channel column lands, this state becomes the actual filter key for /api/threads.
  const [channel, setChannel] = useState<CommunicationChannel | 'All'>('All')
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Scroll chat to bottom on new messages or thread switch
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [selected, messages?.length])

  async function loadMe() {
    try {
      const r = await fetch(`${BASE}/auth/me`, { headers: authH(token) })
      if (!r.ok) return
      setMe(await r.json())
    } catch {
      /* non-fatal: outgoing/incoming styling will fall back to "incoming" */
    }
  }

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
    setMsgError(''); setMessages(null); setSendError('')
    try {
      const r = await fetch(`${BASE}/api/threads/${id}/messages`, { headers: authH(token) })
      if (!r.ok) throw new Error('Failed to load messages')
      setMessages(await r.json())
    } catch (e) {
      setMsgError((e as Error).message)
      setMessages([])
    }
  }

  useEffect(() => { loadMe(); loadThreads() }, [token])
  useEffect(() => { if (selected) loadMessages(selected) }, [selected])

  async function handleSend() {
    const v = draft.trim()
    if (!v || !selected || sending) return
    setSending(true)
    setSendError('')
    setShowEmoji(false); setShowAttach(false)
    try {
      const r = await fetch(`${BASE}/api/threads/${selected}/messages`, {
        method: 'POST',
        headers: { ...authH(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: v }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: 'Could not send message' }))
        const msg = typeof e.detail === 'string' ? e.detail : 'Could not send message'
        setSendError(msg)
        return
      }
      setDraft('')
      await loadMessages(selected)
    } catch {
      setSendError('Could not send message')
    } finally {
      setSending(false)
    }
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

  function isOutgoing(m: Message): boolean {
    return !!me && m.author_user_id === me.id
  }

  return (
    <PageShell
      type="COMMUNICATION"
      breadcrumb={['Workspace', 'Communications']}
      icon={<MessageIcon size={20} />}
      title="Communications"
      subtitle="Conversations with leads, customers, orders, and tickets across approved channels"
      statusSummary={{
        label: 'Channel = how we talk · Lead Source = how the lead came in',
        variant: 'info',
      }}
      filters={{
        search: {
          value: query,
          onChange: setQuery,
          placeholder: 'Search conversations…',
        },
        quick: [
          {
            label: 'Channel',
            value: channel,
            options: [
              { label: 'All', value: 'All' },
              ...COMMUNICATION_CHANNELS.map((c) => ({ label: COMMUNICATION_CHANNEL_LABELS[c], value: c })),
            ],
            onChange: (v) => setChannel(v as typeof channel),
          },
        ],
      }}
      workspaceClassName="gx-comms"
    >
      <div className="msgr" style={{ gridColumn: '1 / -1' }}>
        {/* Conversation list */}
        <div className="msgr-list">
          <div className="msgr-search">
            <SearchIcon size={14} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search conversations"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13, fontFamily: 'var(--gx-font-sans)' }}
            />
            {query && (
              <button className="tb-icon" style={{ width: 22, height: 22 }} onClick={() => setQuery('')}>
                <CloseIcon size={13} />
              </button>
            )}
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {threads === null && !error && (
              <>
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="convo" style={{ pointerEvents: 'none' }}>
                    <span className="kpi-tile-skeleton" style={{ width: 38, height: 38, borderRadius: '50%' }} />
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="kpi-tile-skeleton" style={{ height: 11, width: '60%' }} />
                      <span className="kpi-tile-skeleton" style={{ height: 10, width: '80%' }} />
                    </span>
                  </div>
                ))}
              </>
            )}
            {error && <div className="err" style={{ padding: 12 }}>{error}</div>}
            {threads && filteredThreads.length === 0 && !error && (
              <div className="hint" style={{ textAlign: 'center', padding: '30px 16px' }}>
                {query ? 'No conversations match.' : 'No conversations yet.'}
              </div>
            )}
            {filteredThreads.map(c => {
              const label = threadLabel(c)
              return (
                <div
                  key={c.id}
                  className={'convo' + (selected === c.id ? ' on' : '')}
                  onClick={() => { setSelected(c.id); setShowInfo(false) }}
                >
                  <span style={{ flexShrink: 0 }}>
                    <span className="avatar" style={{ width: 38, height: 38, fontSize: 13 }}>{initials(label)}</span>
                  </span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                      <span className="hint" style={{ marginLeft: 'auto', fontSize: 11, flexShrink: 0 }}>{timeAgo(c.created_at)}</span>
                    </span>
                    {c.entity_key && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', marginTop: 2 }}>
                        <span style={{ fontSize: 12, color: 'var(--gx-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {c.entity_key}{c.record_id ? ` · ${c.record_id.slice(0, 8)}` : ''}
                        </span>
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Chat pane */}
        <div className="chat">
          {!selected && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)', padding: 'var(--gx-space-7)', textAlign: 'center' }}>
              Select a conversation to begin.
            </div>
          )}
          {selected && selectedThread && (
            <>
              <div className="chat-head">
                <span style={{ flexShrink: 0 }}>
                  <span className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{initials(threadLabel(selectedThread))}</span>
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{threadLabel(selectedThread)}</div>
                  <div className="hint" style={{ fontSize: 11 }}>
                    {selectedThread.entity_key ? `${selectedThread.entity_key} record · ` : ''}
                    {timeAgo(selectedThread.created_at)}
                  </div>
                </div>
                <span className="spacer" />
                <button className={'tb-icon' + (showInfo ? ' on' : '')} onClick={() => setShowInfo(v => !v)} aria-label="Toggle details">
                  <PanelRightIcon size={17} />
                </button>
              </div>

              <div className="chat-wrap">
                <div className="chat-body" ref={bodyRef}>
                  {messages === null && !msgError && (
                    <>
                      {[0, 1, 2].map(i => (
                        <div key={i} className={'bubble-row ' + (i % 2 ? 'out' : 'in')}>
                          <span className="kpi-tile-skeleton" style={{ width: 180, height: 36, borderRadius: 14 }} />
                        </div>
                      ))}
                    </>
                  )}
                  {msgError && <div className="err" style={{ padding: 12 }}>{msgError}</div>}
                  {messages && messages.length === 0 && !msgError && (
                    <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
                      No messages yet.
                    </div>
                  )}
                  {messages && messages.length > 0 && dayLabel(messages[0].created_at) && (
                    <div className="chat-day">{dayLabel(messages[0].created_at)}</div>
                  )}
                  {messages && messages.map(m => {
                    const out = isOutgoing(m)
                    const dir = out ? 'out' : 'in'
                    return (
                      <div key={m.id} className={'bubble-row ' + dir}>
                        <div className="bubble-wrap">
                          {!out && m.author_name && (
                            <div style={{ fontSize: 11, color: 'var(--gx-text-3)', marginBottom: 'var(--gx-space-1)', paddingLeft: 4 }}>
                              {m.author_name}
                            </div>
                          )}
                          <div className={'bubble ' + dir}>
                            {m.body}
                            <span className="bt">{timeShort(m.created_at) || timeAgo(m.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {showInfo && (
                  <aside className="chat-info">
                    <div style={{ textAlign: 'center', padding: '18px 0 12px' }}>
                      <span className="avatar" style={{ width: 64, height: 64, fontSize: 22, margin: '0 auto' }}>
                        {initials(threadLabel(selectedThread))}
                      </span>
                      <div style={{ fontWeight: 600, fontSize: 15, marginTop: 10 }}>{threadLabel(selectedThread)}</div>
                    </div>
                    <div className="lbl" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gx-text-3)', padding: '0 0 8px' }}>Thread</div>
                    <div className="kv" style={{ padding: '8px 0' }}>
                      <span className="kv-k" style={{ width: 80 }}>ID</span>
                      <span className="kv-v mono" style={{ fontSize: 11.5 }}>{selectedThread.id.slice(0, 12)}</span>
                    </div>
                    {selectedThread.entity_key && (
                      <div className="kv" style={{ padding: '8px 0' }}>
                        <span className="kv-k" style={{ width: 80 }}>Entity</span>
                        <span className="kv-v">{selectedThread.entity_key}</span>
                      </div>
                    )}
                    {selectedThread.record_id && (
                      <div className="kv" style={{ padding: '8px 0' }}>
                        <span className="kv-k" style={{ width: 80 }}>Record</span>
                        <span className="kv-v mono" style={{ fontSize: 11.5 }}>{selectedThread.record_id.slice(0, 12)}</span>
                      </div>
                    )}
                    {selectedThread.created_at && (
                      <div className="kv" style={{ padding: '8px 0' }}>
                        <span className="kv-k" style={{ width: 80 }}>Created</span>
                        <span className="kv-v">{timeAgo(selectedThread.created_at)}</span>
                      </div>
                    )}
                    {messages && (
                      <div className="kv" style={{ padding: '8px 0' }}>
                        <span className="kv-k" style={{ width: 80 }}>Messages</span>
                        <span className="kv-v">{messages.length}</span>
                      </div>
                    )}
                  </aside>
                )}
              </div>

              {(showEmoji || showAttach) && (
                <div className="pop-scrim" onClick={() => { setShowEmoji(false); setShowAttach(false) }} />
              )}
              {sendError && (
                <div className="err" style={{ margin: '0 14px 8px' }}>{sendError}</div>
              )}
              <div className="chat-composer">
                <div style={{ position: 'relative' }}>
                  <button
                    className={'tb-icon' + (showEmoji ? ' on' : '')}
                    onClick={() => { setShowEmoji(v => !v); setShowAttach(false) }}
                    aria-label="Insert emoji"
                  >
                    <SmileIcon size={18} />
                  </button>
                  {showEmoji && (
                    <div className="emoji-pop fade-fast">
                      {EMOJIS.map(e => (
                        <button
                          key={e}
                          onClick={() => { setDraft(d => d + e); setShowEmoji(false); inputRef.current?.focus() }}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !sending) handleSend() }}
                  placeholder="Type a message…"
                  className="inp"
                  style={{ flex: 1 }}
                  disabled={sending}
                />
                <Button
                  variant="primary"
                  iconOnly
                  onClick={handleSend}
                  aria-label="Send"
                  disabled={sending || !draft.trim()}
                >
                  <SendHorizontalIcon size={16} />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </PageShell>
  )
}
