import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'
import {
  MessageIcon,
  SearchIcon,
  CloseIcon,
  PhoneIcon,
  PinIcon,
  MuteIcon,
  BellIcon,
  MailIcon,
  RowsIcon,
  FilterIcon,
  EditIcon,
  MoreVerticalIcon,
  PanelRightIcon,
  PaperclipIcon,
  SmileIcon,
  ZapIcon,
  SendHorizontalIcon,
  PictureIcon,
  FileIcon,
  MapPinIcon,
  UserIcon,
} from '../components/icons'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

const CH_TONE: Record<string, string> = {
  WhatsApp: 'var(--gx-success)',
  Telegram: 'var(--azure-400)',
  SMS: 'var(--gx-warning)',
  Internal: 'var(--gx-gold)',
}
const EMOJIS = ['👍','🙏','✅','🔧','📶','📡','😊','🎉','👀','🚀','⚠️','💡','📞','🛠️','❤️','🔥']
const QUICK_REPLIES = [
  'On my way 🚗',
  'Issue resolved ✅',
  'Technician dispatched 🔧',
  'Please restart your router 🔌',
  'Thanks for your patience 🙏',
]

type Thread = {
  id: string
  entity_key: string | null
  record_id: string | null
  title: string | null
  created_by: string
  created_at: string | null
  channel?: string
  unread?: number
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
  const [chFilter, setChFilter] = useState('All')
  const [showInfo, setShowInfo] = useState(false)
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [muted, setMuted] = useState<Set<string>>(new Set())
  const [localUnread, setLocalUnread] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [showQuick, setShowQuick] = useState(false)
  const [reactions, setReactions] = useState<Record<string, string>>({})
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Scroll chat to bottom on new messages or thread switch
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [selected, messages?.length])

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

  async function handleSend() {
    const v = draft.trim()
    if (!v || !selected) return
    setDraft('')
    setShowEmoji(false); setShowQuick(false); setShowAttach(false)
    try {
      const r = await fetch(`${BASE}/api/threads/${selected}/messages`, {
        method: 'POST',
        headers: { ...authH(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: v }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: 'Could not send message' }))
        const msg = typeof e.detail === 'string' ? e.detail : 'Could not send message'
        toast.error(msg)
        return
      }
      await loadMessages(selected)
    } catch {
      toast.error('Could not send message')
    }
  }

  function togglePin(id: string) {
    setPinned(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleMute(id: string) {
    setMuted(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function markUnread(id: string) {
    setLocalUnread(s => { const n = new Set(s); n.add(id); return n })
  }
  function setReaction(threadId: string, msgIdx: number, emoji: string) {
    const key = `${threadId}-${msgIdx}`
    setReactions(r => ({ ...r, [key]: r[key] === emoji ? '' : emoji }))
  }

  const selectedThread = useMemo(
    () => threads?.find(t => t.id === selected) ?? null,
    [threads, selected],
  )

  const filteredThreads = useMemo(() => {
    if (!threads) return []
    const q = query.trim().toLowerCase()
    return threads
      .filter(t => chFilter === 'All' || t.channel === chFilter)
      .filter(t => !q || threadLabel(t).toLowerCase().includes(q))
      .sort((a, b) => (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0))
  }, [threads, query, chFilter, pinned])

  function isOutgoing(m: Message): boolean {
    if (!selectedThread) return false
    return m.author_user_id === selectedThread.created_by
  }

  const totalUnread = useMemo(
    () => (threads ?? []).reduce((s, t) => s + (t.unread ?? 0) + (localUnread.has(t.id) ? 1 : 0), 0),
    [threads, localUnread],
  )

  return (
    <div className="gx-comms comms-shell fade" style={{ height: 'calc(100vh - var(--gx-header-h))', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '18px 22px', gap: 14 }}>
      <div className="comms-head">
        <div className="vh-ic"><MessageIcon size={20} /></div>
        <div>
          <h1 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 21, fontWeight: 600, margin: 0, letterSpacing: '-.02em' }}>Messages</h1>
          <div className="sub" style={{ color: 'var(--gx-text-3)', fontSize: 12.5 }}>
            Omnichannel inbox{totalUnread > 0 ? ` · ${totalUnread} unread` : ''} · WhatsApp · Telegram · SMS
          </div>
        </div>
        <span className="spacer" />
        <button className="btn btn-secondary btn-sm hide-sm" onClick={() => toast.info('Filtering — configure routing in Studio')}>
          <FilterIcon size={14} />Filters
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => toast.info('New chat — pick a contact')}>
          <EditIcon size={14} />New chat
        </button>
      </div>

      <div className="msgr">
        {/* ── Conversation list ── */}
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
          <div className="msgr-tabs">
            {(['All', 'WhatsApp', 'Telegram', 'SMS', 'Internal'] as const).map(t => (
              <button key={t} className={'msgr-tab' + (chFilter === t ? ' on' : '')} onClick={() => setChFilter(t)}>
                {t !== 'All' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: CH_TONE[t] }} />}
                {t}
              </button>
            ))}
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {threads === null && !error && (
              <div className="hint" style={{ textAlign: 'center', padding: '30px 16px' }}>Loading…</div>
            )}
            {error && <div className="err" style={{ padding: 12 }}>{error}</div>}
            {threads && filteredThreads.length === 0 && !error && (
              <div className="hint" style={{ textAlign: 'center', padding: '30px 16px' }}>
                {query ? 'No conversations match.' : 'No conversations yet. Wire /api/threads to populate.'}
              </div>
            )}
            {filteredThreads.map(c => {
              const label = threadLabel(c)
              const isPinned = pinned.has(c.id)
              const isMuted = muted.has(c.id)
              const unreadCount = (c.unread ?? 0) + (localUnread.has(c.id) ? 1 : 0)
              return (
                <div
                  key={c.id}
                  className={'convo' + (selected === c.id ? ' on' : '')}
                  style={{ position: 'relative' }}
                  onClick={() => {
                    setSelected(c.id)
                    setShowInfo(false)
                    setLocalUnread(u => { const n = new Set(u); n.delete(c.id); return n })
                  }}
                >
                  <span style={{ position: 'relative', flexShrink: 0 }}>
                    <span className="avatar" style={{ width: 38, height: 38, fontSize: 13 }}>{initials(label)}</span>
                    {/* online indicator — wire GET /api/presence/{user_id} when available */}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isPinned && <PinIcon size={11} style={{ color: 'var(--gx-gold)' }} />}
                      <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                      {c.channel && <span style={{ width: 6, height: 6, borderRadius: '50%', background: CH_TONE[c.channel] ?? 'var(--gx-text-3)', flexShrink: 0 }} title={c.channel} />}
                      <span className="hint" style={{ marginLeft: 'auto', fontSize: 11, flexShrink: 0 }}>{timeAgo(c.created_at)}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 12, color: 'var(--gx-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {c.entity_key ? `${c.entity_key}${c.record_id ? ` · ${c.record_id.slice(0, 8)}` : ''}` : 'Conversation'}
                      </span>
                      {isMuted && <MuteIcon size={12} style={{ color: 'var(--gx-text-3)' }} />}
                      {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
                    </span>
                  </span>
                  <button
                    className="convo-menu tb-icon"
                    style={{ width: 26, height: 26 }}
                    onClick={e => { e.stopPropagation(); setMenu(menu === c.id ? null : c.id) }}
                  >
                    <MoreVerticalIcon size={15} />
                  </button>
                  {menu === c.id && (
                    <div className="menu fade-fast" style={{ position: 'absolute', right: 8, top: 44, zIndex: 20 }} onClick={e => e.stopPropagation()}>
                      <button className="menu-item" onClick={() => { togglePin(c.id); setMenu(null) }}>
                        <PinIcon size={15} />{isPinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button className="menu-item" onClick={() => { toggleMute(c.id); setMenu(null) }}>
                        {isMuted ? <BellIcon size={15} /> : <MuteIcon size={15} />}
                        {isMuted ? 'Unmute' : 'Mute'}
                      </button>
                      <button className="menu-item" onClick={() => { markUnread(c.id); setMenu(null) }}>
                        <MailIcon size={15} />Mark unread
                      </button>
                      <div className="menu-sep" />
                      <button className="menu-item" onClick={() => { toast.info('Wire /api/workitems to create'); setMenu(null) }}>
                        <RowsIcon size={15} />Create work item
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Chat pane ── */}
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
                  <div className="hint" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {selectedThread.channel && <span style={{ width: 6, height: 6, borderRadius: '50%', background: CH_TONE[selectedThread.channel] ?? 'var(--gx-text-3)' }} />}
                    {selectedThread.channel ? `${selectedThread.channel} · ` : ''}
                    {selectedThread.entity_key ? `${selectedThread.entity_key} record` : 'Thread'} · {timeAgo(selectedThread.created_at)}
                  </div>
                </div>
                <span className="spacer" />
                <button className="tb-icon" onClick={() => toast.info('Calling ' + threadLabel(selectedThread) + '…')}><PhoneIcon size={17} /></button>
                <button className="tb-icon" onClick={() => toast.info('In-thread search — wire /api/threads/{id}/messages?q=')}><SearchIcon size={17} /></button>
                <button className={'tb-icon' + (showInfo ? ' on' : '')} onClick={() => setShowInfo(v => !v)}><PanelRightIcon size={17} /></button>
              </div>

              <div className="chat-wrap">
                <div className="chat-body" ref={bodyRef}>
                  {messages === null && !msgError && (
                    <div className="hint" style={{ textAlign: 'center', padding: 20 }}>Loading…</div>
                  )}
                  {msgError && <div className="err" style={{ padding: 12 }}>{msgError}</div>}
                  {messages && messages.length === 0 && !msgError && (
                    <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
                      No messages yet. Wire /api/threads/&#123;id&#125;/messages to populate.
                    </div>
                  )}
                  {messages && messages.length > 0 && (
                    <div className="chat-day">{timeAgo(messages[0].created_at) || 'Earlier'}</div>
                  )}
                  {messages && messages.map((m, i) => {
                    const out = isOutgoing(m)
                    const dir = out ? 'out' : 'in'
                    const reactionVal = reactions[`${selected}-${i}`]
                    return (
                      <div key={m.id} className={'bubble-row ' + dir}>
                        <div className="bubble-wrap">
                          {!out && (
                            <div style={{ fontSize: 11, color: 'var(--gx-text-3)', marginBottom: 2, paddingLeft: 4 }}>
                              {m.author_name || 'Someone'}
                            </div>
                          )}
                          <div className={'bubble ' + dir} onDoubleClick={() => setReaction(selected!, i, '👍')}>
                            {m.body}
                            <span className="bt">{timeShort(m.created_at) || timeAgo(m.created_at)}</span>
                            <div className="bubble-react">
                              <button onClick={() => setReaction(selected!, i, '👍')}>👍</button>
                              <button onClick={() => setReaction(selected!, i, '❤️')}>❤️</button>
                              <button onClick={() => setReaction(selected!, i, '🙏')}>🙏</button>
                            </div>
                          </div>
                          {reactionVal && <span className="reaction-chip">{reactionVal}</span>}
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
                      <div className="hint" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center', marginTop: 3 }}>
                        {selectedThread.channel && <span style={{ width: 6, height: 6, borderRadius: '50%', background: CH_TONE[selectedThread.channel] ?? 'var(--gx-text-3)' }} />}
                        {selectedThread.channel ?? 'Conversation'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '0 0 14px' }}>
                      <button className="info-act" onClick={() => toast.info('Calling…')}><PhoneIcon size={16} /><span>Call</span></button>
                      <button className="info-act" onClick={() => toggleMute(selectedThread.id)}>
                        <MuteIcon size={16} /><span>{muted.has(selectedThread.id) ? 'Unmute' : 'Mute'}</span>
                      </button>
                      <button className="info-act" onClick={() => togglePin(selectedThread.id)}>
                        <PinIcon size={16} /><span>{pinned.has(selectedThread.id) ? 'Unpin' : 'Pin'}</span>
                      </button>
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
                    <div className="kv" style={{ padding: '8px 0' }}>
                      <span className="kv-k" style={{ width: 80 }}>Created</span>
                      <span className="kv-v">{timeAgo(selectedThread.created_at)}</span>
                    </div>
                    <div className="kv" style={{ padding: '8px 0' }}>
                      <span className="kv-k" style={{ width: 80 }}>Messages</span>
                      <span className="kv-v">{messages?.length ?? '—'}</span>
                    </div>
                    <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 14 }} onClick={() => toast.info('Wire /api/customers/{id} to open record')}>
                      <UserIcon size={14} />Open customer
                    </button>
                  </aside>
                )}
              </div>

              {(showEmoji || showAttach || showQuick) && (
                <div className="pop-scrim" onClick={() => { setShowEmoji(false); setShowAttach(false); setShowQuick(false) }} />
              )}
              <div className="chat-composer">
                <div style={{ position: 'relative' }}>
                  <button className={'tb-icon' + (showAttach ? ' on' : '')} onClick={() => { setShowAttach(v => !v); setShowEmoji(false); setShowQuick(false) }}>
                    <PaperclipIcon size={18} />
                  </button>
                  {showAttach && (
                    <div className="menu fade-fast" style={{ position: 'absolute', bottom: 42, left: 0 }}>
                      <button className="menu-item" onClick={() => { setShowAttach(false); toast.info('Photo — wire /api/threads/{id}/attachments') }}><PictureIcon size={15} />Photo</button>
                      <button className="menu-item" onClick={() => { setShowAttach(false); toast.info('Document — wire /api/threads/{id}/attachments') }}><FileIcon size={15} />Document</button>
                      <button className="menu-item" onClick={() => { setShowAttach(false); toast.info('Location — wire /api/threads/{id}/attachments') }}><MapPinIcon size={15} />Location</button>
                    </div>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <button className={'tb-icon' + (showEmoji ? ' on' : '')} onClick={() => { setShowEmoji(v => !v); setShowAttach(false); setShowQuick(false) }}>
                    <SmileIcon size={18} />
                  </button>
                  {showEmoji && (
                    <div className="emoji-pop fade-fast">
                      {EMOJIS.map(e => (
                        <button key={e} onClick={() => { setDraft(d => d + e); setShowEmoji(false); inputRef.current?.focus() }}>{e}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <button className={'tb-icon' + (showQuick ? ' on' : '')} title="Quick replies" onClick={() => { setShowQuick(v => !v); setShowEmoji(false); setShowAttach(false) }}>
                    <ZapIcon size={17} />
                  </button>
                  {showQuick && (
                    <div className="menu fade-fast" style={{ position: 'absolute', bottom: 42, left: 0, minWidth: 240 }}>
                      {QUICK_REPLIES.map(qr => (
                        <button key={qr} className="menu-item" onClick={() => { setDraft(qr); setShowQuick(false); inputRef.current?.focus() }}>{qr}</button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
                  placeholder="Type a message…"
                  className="inp"
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary btn-icon" onClick={handleSend} aria-label="Send">
                  <SendHorizontalIcon size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
