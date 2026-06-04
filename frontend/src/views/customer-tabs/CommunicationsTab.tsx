// CommunicationsTab — canonical Object Detail tab #8 (file 10).
// GET /api/communications?related_entity_type=customer&related_entity_id={id}
// (Wave A Communication module — may not be deployed yet; 404 → empty state.)

import { useEffect, useState } from 'react'
import { bget } from '../../lib/billing'
import { EmptyState } from '../../page-shell'
import { fmtDateTime } from '../../lib/time'

type CommunicationRow = {
  id: string
  channel?: string | null
  direction?: string | null
  subject?: string | null
  body?: string | null
  from_address?: string | null
  to_address?: string | null
  occurred_at?: string | null
  created_at?: string | null
  [k: string]: any
}


export default function CommunicationsTab({ token, customerId }: { token: string; customerId: string }) {
  const [rows, setRows] = useState<CommunicationRow[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<CommunicationRow[]>(token, `/api/communications?related_entity_type=customer&related_entity_id=${encodeURIComponent(customerId)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        setRows(r.data)
      })
    return () => { cancelled = true }
  }, [token, customerId])

  if (rows === undefined) {
    return (
      <div className="card" style={{ padding: 14 }} aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="kpi-tile-skeleton" style={{ height: 12, width: '100%', marginBottom: 10 }} />
        ))}
      </div>
    )
  }
  if (rows === null) return <p className="muted">Could not load communications.</p>
  if (rows.length === 0) return <EmptyState title="No communications" message="Emails, calls, and messages will appear here." />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">Channel</th>
            <th scope="col">Direction</th>
            <th scope="col">Subject</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">At</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.channel ?? '—'}</td>
                <td>{r.direction ?? '—'}</td>
                <td>{r.subject ?? <span className="muted">—</span>}</td>
                <td>{r.from_address ?? '—'}</td>
                <td>{r.to_address ?? '—'}</td>
                <td><span className="mono">{fmtDateTime(r.occurred_at ?? r.created_at)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
