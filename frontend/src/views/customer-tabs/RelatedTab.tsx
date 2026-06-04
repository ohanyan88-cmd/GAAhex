// RelatedTab — canonical Object Detail tab #7 (file 10).
// GET /api/relationships/graph?entity_type=customer&entity_id={id}
// (Wave A Relationship module — may not be deployed yet; 404 → empty state.)

import { useEffect, useState } from 'react'
import { bget } from '../../lib/billing'
import { EmptyState } from '../../page-shell'

type RelatedRow = {
  id?: string
  entity_type?: string | null
  entity_id?: string | null
  relationship?: string | null
  direction?: string | null
  label?: string | null
  [k: string]: any
}

type RelatedGraph = {
  nodes?: RelatedRow[]
  edges?: RelatedRow[]
  rows?: RelatedRow[]
} | RelatedRow[]

function normalize(payload: RelatedGraph | null | undefined): RelatedRow[] {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  // Endpoint shape may be { nodes, edges } or { rows }. Prefer rows; else edges; else nodes.
  return payload.rows ?? payload.edges ?? payload.nodes ?? []
}

export default function RelatedTab({ token, entity, id }: { token: string; entity: string; id: string }) {
  const [rows, setRows] = useState<RelatedRow[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<RelatedGraph>(token, `/api/relationships/graph?entity_type=${encodeURIComponent(entity)}&entity_id=${encodeURIComponent(id)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok) { setRows(null); return }
        setRows(normalize(r.data))
      })
    return () => { cancelled = true }
  }, [token, entity, id])

  if (rows === undefined) {
    return (
      <div className="card" style={{ padding: 14 }} aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="kpi-tile-skeleton" style={{ height: 12, width: '100%', marginBottom: 10 }} />
        ))}
      </div>
    )
  }
  if (rows === null) return <p className="muted">Could not load related records.</p>
  if (rows.length === 0) return <EmptyState title="No related records" message="Linked records across modules will appear here." />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">Entity</th>
            <th scope="col">Record</th>
            <th scope="col">Relationship</th>
            <th scope="col">Direction</th>
            <th scope="col">Label</th>
          </tr></thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id ?? `${r.entity_type}-${r.entity_id}-${idx}`}>
                <td>{r.entity_type ?? '—'}</td>
                <td><span className="mono">{r.entity_id ? String(r.entity_id).slice(0, 8) : '—'}</span></td>
                <td>{r.relationship ?? '—'}</td>
                <td>{r.direction ?? '—'}</td>
                <td>{r.label ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
