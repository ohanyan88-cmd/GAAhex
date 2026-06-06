// TasksTab — canonical Object Detail tab #3 (file 10).
// GET /api/tasks?parent_entity_type=customer&parent_entity_id={id}

import { useEffect, useState } from 'react'
import { bget } from '../../lib/billing'
import { EmptyState } from '../../page-shell'
import { StatusPill } from '../../primitives'
import { fmtDate } from '../../lib/time'

type TaskRow = {
  id: string
  title?: string | null
  status?: string | null
  priority?: string | null
  assignee?: string | null
  due_at?: string | null
  [k: string]: any
}


function taskPill(s: string | null | undefined): 'active' | 'neutral' | 'critical' | 'info' {
  const v = (s ?? '').toUpperCase()
  if (['DONE', 'COMPLETED', 'CLOSED'].includes(v)) return 'active'
  if (['BLOCKED', 'OVERDUE'].includes(v)) return 'critical'
  if (['TODO', 'NEW'].includes(v)) return 'neutral'
  return 'info'
}

// TB-4 — parameterized over (entity, id) so all detail views share this one component.
export default function TasksTab({ token, entity, id }: { token: string; entity: string; id: string }) {
  const [rows, setRows] = useState<TaskRow[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setRows(undefined)
    bget<TaskRow[]>(token, `/api/tasks?parent_entity_type=${encodeURIComponent(entity)}&parent_entity_id=${encodeURIComponent(id)}`)
      .then((r) => {
        if (cancelled) return
        if (r.status === 404) { setRows([]); return }  // missing endpoint → empty state
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
  if (rows === null) return <p className="muted">Could not load tasks.</p>
  if (rows.length === 0) return <EmptyState title="No tasks" message="Tasks linked to this customer will appear here." />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Assignee</th>
            <th scope="col">Due</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.title ?? <span className="mono">{r.id.slice(0, 8)}</span>}</td>
                <td>{r.status ? <StatusPill variant={taskPill(r.status)} label={r.status} size="sm" /> : <span>—</span>}</td>
                <td>{r.priority ?? '—'}</td>
                <td>{r.assignee ?? '—'}</td>
                <td><span className="mono">{fmtDate(r.due_at)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
