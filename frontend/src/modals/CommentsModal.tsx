import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import Composer from '../components/Composer'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'

import { BASE } from '../lib/config'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Comment = {
  id: string
  thread_id: string
  author_user_id: string
  author_name: string
  body: string
  created_at: string | null
}

// Record comments — a Modal listing a record's comment thread + a Composer (with emoji) to post.
export default function CommentsModal({ token, slug, recordId, label, onClose }: {
  token: string
  slug: string
  recordId: string
  label: string
  onClose: () => void
}) {
  const [items, setItems] = useState<Comment[] | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      const r = await fetch(`${BASE}/api/records/${slug}/${recordId}/comments`, { headers: authH(token) })
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: r.status === 403 ? 'Not allowed to view this record' : 'Failed to load comments' }))
        throw new Error(typeof e.detail === 'string' ? e.detail : 'Failed to load comments')
      }
      setItems(await r.json())
    } catch (e) {
      setError((e as Error).message)
      setItems([])
    }
  }

  useEffect(() => { load() }, [slug, recordId])

  async function post(body: string) {
    const r = await fetch(`${BASE}/api/records/${slug}/${recordId}/comments`, {
      method: 'POST',
      headers: { ...authH(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: 'Could not post comment' }))
      const msg = typeof e.detail === 'string' ? e.detail : 'Could not post comment'
      toast.error(msg)
      throw new Error(msg)
    }
    toast.success('Comment added')
    await load()
  }

  return (
    <Modal open onClose={onClose} title={`Comments · ${label}`} size="md">
      <div className="comments">
        {items === null && !error && <p className="muted">Loading…</p>}
        {error && <p className="err">{error}</p>}
        {items && !error && items.length === 0 && <p className="muted">No comments yet — start the thread.</p>}
        {items && items.map((c) => (
          <div className="comment" key={c.id}>
            <div className="comment-head">
              <strong>{c.author_name || 'Someone'}</strong>
              <span className="muted">{timeAgo(c.created_at)}</span>
            </div>
            <div className="comment-body">{c.body}</div>
          </div>
        ))}
      </div>
      <Composer onSend={post} placeholder="Write a comment…" />
    </Modal>
  )
}
