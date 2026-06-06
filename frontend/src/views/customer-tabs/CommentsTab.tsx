// CommentsTab — canonical Object Detail tab #4 (file 10).
// GET /api/customer/{id}/comments

import { useEffect, useState } from 'react'
import { bget } from '../../lib/billing'
import { EmptyState } from '../../page-shell'
import { fmtDateTime } from '../../lib/time'

type CommentRow = {
  id: string
  author?: string | null
  author_name?: string | null
  body?: string | null
  text?: string | null
  created_at?: string | null
  [k: string]: any
}


export default function CommentsTab({ token, entity, id }: { token: string; entity: string; id: string }) {
  const [rows, setRows] = useState<CommentRow[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<CommentRow[]>(token, `/api/comments?owner_entity_type=${encodeURIComponent(entity)}&owner_entity_id=${encodeURIComponent(id)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        setRows(r.data)
      })
    return () => { cancelled = true }
  }, [token, entity, id])

  if (rows === undefined) {
    return (
      <div className="card" style={{ padding: 14 }} aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="kpi-tile-skeleton" style={{ height: 14, width: '100%', marginBottom: 10 }} />
        ))}
      </div>
    )
  }
  if (rows === null) return <p className="muted">Could not load comments.</p>
  if (rows.length === 0) return <EmptyState title="No comments yet" message="Comments on this customer will appear here." />

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ padding: 'var(--gx-space-6) var(--gx-space-7)', borderBottom: '1px solid var(--gx-border)' }}>
            <div style={{ fontSize: 13 }}>
              <strong>{r.author_name ?? r.author ?? 'Unknown'}</strong>
              <span className="muted mono" style={{ marginLeft: 'var(--gx-space-3)', fontSize: 11 }}>{fmtDateTime(r.created_at)}</span>
            </div>
            <div style={{ fontSize: 'var(--gx-text-13)', marginTop: 'var(--gx-space-2)', whiteSpace: 'pre-wrap' }}>
              {r.body ?? r.text ?? ''}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
