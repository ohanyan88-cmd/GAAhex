// DispatchBoardView — Network → Dispatch Board.
// Workitems grouped by status — TODO / IN_PROGRESS / DONE / BLOCKED columns.
// Real data from GET /api/workitems. Real data only — missing → empty state.
import { useEffect, useState } from 'react'
import ViewHead from '../components/ViewHead'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { TruckIcon } from '../components/icons'
import { BASE } from '../lib/billing'

const authH = (t: string) => ({ Authorization: `Bearer ${t}` })

type WorkItem = {
  id: string; title: string; status: string; priority: string; kind: string
  assigned_user_id: string | null; created_at: string
}

const COLUMNS = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']
const COL_LABELS: Record<string, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', BLOCKED: 'Blocked', DONE: 'Done' }
const PRIORITY_DOT: Record<string, string> = { HIGH: '#ef4444', NORMAL: '#6b7280', LOW: '#3b82f6' }

export default function DispatchBoardView({ token }: { token: string }) {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/workitems?limit=200`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (alive) { setItems(Array.isArray(d) ? d : d.items ?? []); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [token])

  const byStatus = COLUMNS.reduce<Record<string, WorkItem[]>>((acc, s) => {
    acc[s] = items.filter(i => i.status === s)
    return acc
  }, {})

  const active = items.filter(i => i.status !== 'DONE').length

  return (
    <div className="view-root">
      <ViewHead icon={<TruckIcon size={20} />} title="Dispatch Board" sub={loading ? undefined : `${active} active · ${items.length} total`} />
      <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
        {loading && <SkeletonRows rows={8} />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && items.length === 0 && (
          <EmptyState icon={<TruckIcon size={36} />} title="No work items" message="Assign work items to field technicians to populate the dispatch board." />
        )}
        {!loading && items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--sp-4)' }}>
            {COLUMNS.map(col => (
              <div key={col}>
                <div className="section-label" style={{ marginBottom: 'var(--sp-2)' }}>
                  {COL_LABELS[col]} <span className="muted">({byStatus[col]?.length ?? 0})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(byStatus[col] ?? []).map(item => (
                    <div key={item.id} className="card" style={{ padding: 'var(--sp-3)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: PRIORITY_DOT[item.priority] ?? '#6b7280', marginTop: 5, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>{item.title}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <span className="badge badge-neutral" style={{ fontSize: 11 }}>{item.kind}</span>
                        {!item.assigned_user_id && <span className="badge badge-warning" style={{ fontSize: 11 }}>unassigned</span>}
                      </div>
                    </div>
                  ))}
                  {(byStatus[col] ?? []).length === 0 && (
                    <p className="muted" style={{ fontSize: 12, padding: 'var(--sp-2) 0' }}>Empty</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
