// ApprovalsTab — canonical Object Detail tab #6 (file 10).
// GET /api/approvals?target_entity_key=customer&target_record_id={id}
// Endpoint may or may not exist yet — handle 404 gracefully as empty state.

import { useEffect, useState } from 'react'
import { bget } from '../../lib/billing'
import { EmptyState } from '../../page-shell'
import { StatusPill } from '../../primitives'
import { fmtDateTime } from '../../lib/time'

type ApprovalRow = {
  id: string
  request_type?: string | null
  status?: string | null
  requested_by?: string | null
  requested_at?: string | null
  approver?: string | null
  decided_at?: string | null
  reason?: string | null
  [k: string]: any
}


function approvalPill(s: string | null | undefined): 'active' | 'critical' | 'neutral' | 'info' {
  const v = (s ?? '').toUpperCase()
  if (['APPROVED', 'GRANTED'].includes(v)) return 'active'
  if (['REJECTED', 'DENIED'].includes(v)) return 'critical'
  if (['PENDING', 'AWAITING'].includes(v)) return 'neutral'
  return 'info'
}

export default function ApprovalsTab({ token, entity, id }: { token: string; entity: string; id: string }) {
  const [rows, setRows] = useState<ApprovalRow[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<ApprovalRow[]>(token, `/api/approvals?target_entity_key=${encodeURIComponent(entity)}&target_record_id=${encodeURIComponent(id)}`)
      .then((r) => {
        if (cancelled) return
        // 404 = endpoint missing → empty state (per spec: handle gracefully).
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
          <div key={i} className="kpi-tile-skeleton" style={{ height: 12, width: '100%', marginBottom: 'var(--gx-space-5)' }} />
        ))}
      </div>
    )
  }
  if (rows === null) return <p className="muted">Could not load approvals.</p>
  if (rows.length === 0) return <EmptyState title="No approvals" message="Approval requests on this customer will appear here." />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">Request</th>
            <th scope="col">Status</th>
            <th scope="col">Requested by</th>
            <th scope="col">Requested at</th>
            <th scope="col">Decided at</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.request_type ?? <span className="mono">{r.id.slice(0, 8)}</span>}</td>
                <td>{r.status ? <StatusPill variant={approvalPill(r.status)} label={r.status} size="sm" /> : <span>—</span>}</td>
                <td>{r.requested_by ?? '—'}</td>
                <td><span className="mono">{fmtDateTime(r.requested_at)}</span></td>
                <td><span className="mono">{fmtDateTime(r.decided_at)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
