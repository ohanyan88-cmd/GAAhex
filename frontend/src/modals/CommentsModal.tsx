import { Modal } from '../components/Modal'
import Composer from '../components/Composer'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'
import { useAuth } from '../context/AuthContext'
import { useFetch } from '../hooks/useFetch'

type Comment = {
  id: string
  thread_id: string
  author_user_id: string
  author_name: string
  body: string
  created_at: string | null
}

// Record comments — a Modal listing a record's comment thread + a Composer (with emoji) to post.
export default function CommentsModal({ slug, recordId, label, onClose }: {
  slug: string
  recordId: string
  label: string
  onClose: () => void
}) {
  const { token } = useAuth()
  const { data: items, loading, error, refetch } = useFetch<Comment[]>(
    `/api/records/${slug}/${recordId}/comments`
  )

  async function post(body: string) {
    const r = await fetch(`${BASE}/api/records/${slug}/${recordId}/comments`, {
      method: 'POST',
      headers: { ...authH(token!), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: 'Could not post comment' }))
      const msg = typeof e.detail === 'string' ? e.detail : 'Could not post comment'
      toast.error(msg)
      throw new Error(msg)
    }
    toast.success('Comment added')
    refetch()
  }

  return (
    <Modal open onClose={onClose} title={`Comments · ${label}`} size="md">
      <div className="comments">
        {loading && <p className="muted">Loading…</p>}
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
