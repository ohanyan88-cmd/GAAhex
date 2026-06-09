// AttachmentsTab — canonical Object Detail tab #5 (file 10).
// GET /api/customer/{id}/attachments

import { useEffect, useState } from 'react'
import { bget } from '../../lib/billing'
import { EmptyState } from '../../page-shell'
import { fmtDateTime } from '../../lib/time'
import { useAuth } from '../../context/AuthContext'

type AttachmentRow = {
  id: string
  filename?: string | null
  name?: string | null
  mime_type?: string | null
  size?: number | null
  uploaded_by?: string | null
  uploaded_at?: string | null
  created_at?: string | null
  url?: string | null
  [k: string]: any
}


function fmtSize(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function AttachmentsTab({ entity, id }: { entity: string; id: string }) {
  const { token } = useAuth()
  const [rows, setRows] = useState<AttachmentRow[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<AttachmentRow[]>(token!, `/api/attachments?owner_entity_type=${encodeURIComponent(entity)}&owner_entity_id=${encodeURIComponent(id)}`)
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
      <div className="card" style={{ padding: 'var(--gx-space-7)' }} aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '100%', marginBottom: 'var(--gx-space-5)' }} />
        ))}
      </div>
    )
  }
  if (rows === null) return <p className="muted">Could not load attachments.</p>
  if (rows.length === 0) return <EmptyState title="No attachments" message="Files uploaded against this customer will appear here." />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">File</th>
            <th scope="col">Type</th>
            <th scope="col">Size</th>
            <th scope="col">Uploaded by</th>
            <th scope="col">Uploaded at</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const label = r.filename ?? r.name ?? r.id.slice(0, 8)
              return (
                <tr key={r.id}>
                  <td>
                    {r.url
                      ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--gx-link)' }}>{label}</a>
                      : <span>{label}</span>}
                  </td>
                  <td>{r.mime_type ?? '—'}</td>
                  <td><span className="mono">{fmtSize(r.size)}</span></td>
                  <td>{r.uploaded_by ?? '—'}</td>
                  <td><span className="mono">{fmtDateTime(r.uploaded_at ?? r.created_at)}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
