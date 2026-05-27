import { useEffect, useState } from 'react'
import Composer from './Composer'
import { toast } from './Toast'
import { timeAgo } from './time'
import ViewHead from './ViewHead'
import { MessageIcon } from './icons'

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

export default function MessagesView({ token }: { token: string }) {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [msgError, setMsgError] = useState('')

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

  return (
    <div>
      <ViewHead
        icon={<MessageIcon size={20} />}
        title="Messages"
      />
      {error && <p className="err">{error}</p>}

      <div className="messages">
        <div className="thread-list">
          {threads === null && !error && <p className="muted" style={{ padding: 12 }}>Loading…</p>}
          {threads && threads.length === 0 && !error && (
            <p className="muted" style={{ padding: 12 }}>No conversations yet. Comment threads on records appear here.</p>
          )}
          {threads && threads.map((t) => (
            <button
              key={t.id}
              className={'thread-item' + (selected === t.id ? ' on' : '')}
              onClick={() => setSelected(t.id)}
            >
              <div className="thread-title">{threadLabel(t)}</div>
              <div className="thread-sub">{timeAgo(t.created_at)}</div>
            </button>
          ))}
        </div>

        <div className="thread-pane">
          {!selected && <div className="msg-placeholder muted">Select a conversation.</div>}
          {selected && (
            <>
              <div className="msg-scroll">
                {messages === null && !msgError && <p className="muted">Loading…</p>}
                {msgError && <p className="err">{msgError}</p>}
                {messages && messages.length === 0 && !msgError && <p className="muted">No messages yet.</p>}
                {messages && messages.map((m) => (
                  <div className="msg" key={m.id}>
                    <div className="msg-head">
                      <strong>{m.author_name || 'Someone'}</strong>
                      <span className="muted">{timeAgo(m.created_at)}</span>
                    </div>
                    <div className="msg-bubble">{m.body}</div>
                  </div>
                ))}
              </div>
              <div className="msg-compose">
                <Composer onSend={post} placeholder="Write a message…" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
