// AuditTab — canonical Object Detail tab #9 (file 10).
// GET /api/audit-log?entity_key=customer&record_id={id}

import { useEffect, useState } from 'react'
import { bget } from '../../lib/billing'
import { EmptyState } from '../../page-shell'
import { fmtDateTime } from '../../lib/time'

type AuditRow = {
  id: string
  action?: string | null
  actor?: string | null
  actor_id?: string | null
  field?: string | null
  old_value?: string | null
  new_value?: string | null
  at?: string | null
  created_at?: string | null
  [k: string]: any
}


export default function AuditTab({ token, customerId }: { token: string; customerId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<AuditRow[]>(token, `/api/audit-log?entity_key=customer&record_id=${encodeURIComponent(customerId)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        // Newest-first (defensive sort).
        const sorted = [...r.data].sort((a, b) => {
          const ta = Date.parse(a.at ?? a.created_at ?? '') || 0
          const tb = Date.parse(b.at ?? b.created_at ?? '') || 0
          return tb - ta
        })
        setRows(sorted)
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
  if (rows === null) return <p className="muted">Could not load audit log.</p>
  if (rows.length === 0) return <EmptyState title="No audit entries" message="Field-level changes to this customer will appear here." />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">When</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Field</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><span className="mono">{fmtDateTime(r.at ?? r.created_at)}</span></td>
                <td>{r.actor ?? r.actor_id ?? '—'}</td>
                <td>{r.action ?? '—'}</td>
                <td>{r.field ?? '—'}</td>
                <td><span className="muted">{r.old_value ?? '—'}</span></td>
                <td>{r.new_value ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
