// TimelineTab — canonical Object Detail tab #2 (file 10).
// GET /api/activity?entity_key=customer&record_id={id} — newest-first.
// Reuses the same bget pattern as the rest of CustomerView.

import { useEffect, useState } from 'react'
import { bget } from '../../lib/billing'
import { EmptyState } from '../../page-shell'

type ActivityRow = {
  id: string
  action?: string | null
  actor?: string | null
  actor_node_id?: string | null
  message?: string | null
  at?: string | null
  created_at?: string | null
  [k: string]: any
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function TimelineTab({ token, customerId }: { token: string; customerId: string }) {
  const [rows, setRows] = useState<ActivityRow[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<ActivityRow[]>(token, `/api/activity?entity_key=customer&record_id=${encodeURIComponent(customerId)}`)
      .then((r) => {
        if (cancelled) return
        if (!r.ok || !Array.isArray(r.data)) { setRows(null); return }
        // Newest-first — defensive sort on `at` || `created_at` desc.
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
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi-tile-skeleton" style={{ height: 12, width: '100%', marginBottom: 10 }} />
        ))}
      </div>
    )
  }
  if (rows === null) return <p className="muted">Could not load the activity timeline.</p>
  if (rows.length === 0) return <EmptyState title="No activity yet" message="Changes to this customer will appear here." />

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--gx-border, #e2e8f0)' }}>
            <div style={{ fontSize: 13 }}>
              <strong>{r.action ?? 'event'}</strong>
              {r.actor && <span className="muted" style={{ marginLeft: 6 }}>· {r.actor}</span>}
            </div>
            {r.message && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r.message}</div>}
            <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>{fmtDateTime(r.at ?? r.created_at)}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
