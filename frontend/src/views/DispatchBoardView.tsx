// DispatchBoardView — NMS → Support Dispatch Board.
// Workitems grouped by status — TODO / IN_PROGRESS / DONE / BLOCKED columns.
// Real data from GET /api/workitems. Real data only — missing → empty state.
import { useEffect, useState } from 'react'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { TruckIcon } from '../components/icons'
import { BASE, authH } from '../lib/billing'
import { DISPATCH_BOARD } from '../lib/pagination'


type WorkItem = {
  id: string; title: string; status: string; priority: string; kind: string
  assigned_user_id: string | null; created_at: string
}

const COLUMNS = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']
const COL_LABELS: Record<string, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', BLOCKED: 'Blocked', DONE: 'Done' }
const PRIORITY_DOT: Record<string, string> = { HIGH: 'var(--gx-danger-fg)', NORMAL: 'var(--gx-text-3)', LOW: 'var(--gx-interactive)' }

export default function DispatchBoardView({ token }: { token: string }) {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/workitems?limit=${DISPATCH_BOARD}`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (alive) { setItems(Array.isArray(d) ? d : d.items ?? []); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [token])

  const byStatus = COLUMNS.reduce<Record<string, WorkItem[]>>((acc, s) => {
    acc[s] = items.filter(i => i.status === s)
    return acc
  }, {})

  const kpis: KPISpec[] = loading
    ? [
        { label: 'To Do', value: 0, loading: true },
        { label: 'In Progress', value: 0, loading: true },
        { label: 'Blocked', value: 0, loading: true },
        { label: 'Done', value: 0, loading: true },
      ]
    : items.length === 0
    ? []
    : [
        { label: 'To Do', value: byStatus['TODO']?.length ?? 0 },
        { label: 'In Progress', value: byStatus['IN_PROGRESS']?.length ?? 0 },
        { label: 'Blocked', value: byStatus['BLOCKED']?.length ?? 0, danger: (byStatus['BLOCKED']?.length ?? 0) > 0 },
        { label: 'Done', value: byStatus['DONE']?.length ?? 0 },
      ]

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Tech & NOC', 'Support Dispatch Board']}
      icon={<TruckIcon size={20} />}
      title="Support Dispatch Board"
      subtitle="Field operations dispatch"
      kpis={kpis.length > 0 ? kpis : undefined}
    >
      <div>
        {loading && <SkeletonRows rows={8} />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && items.length === 0 && (
          <EmptyState icon={<TruckIcon size={36} />} title="No work items" message="Assign work items to field technicians to populate the dispatch board." />
        )}
        {!loading && items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--gx-space-8)' }}>
            {COLUMNS.map(col => (
              <div key={col}>
                <div className="section-label" style={{ marginBottom: 'var(--gx-space-4)' }}>
                  {COL_LABELS[col]} <span className="muted">({byStatus[col]?.length ?? 0})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-3)' }}>
                  {(byStatus[col] ?? []).map(item => (
                    <div key={item.id} className="card" style={{ padding: 'var(--gx-space-6)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--gx-space-3)' }}>
                        <span style={{ display: 'inline-block', width: 'var(--gx-space-4)', height: 'var(--gx-space-4)', borderRadius: '50%', background: PRIORITY_DOT[item.priority] ?? 'var(--gx-text-3)', marginTop: 'var(--gx-space-5)', flexShrink: 0 }} />
                        <span style={{ fontSize: 'var(--gx-text-13)', fontWeight: 'var(--gx-weight-medium)', lineHeight: 1.4 }}>{item.title}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--gx-space-2)', marginTop: 'var(--gx-space-2)' }}>
                        <span className="badge badge-neutral" style={{ fontSize: 'var(--gx-text-11)' }}>{item.kind}</span>
                        {!item.assigned_user_id && <span className="badge badge-warning" style={{ fontSize: 'var(--gx-text-11)' }}>unassigned</span>}
                      </div>
                    </div>
                  ))}
                  {(byStatus[col] ?? []).length === 0 && (
                    <p className="muted" style={{ fontSize: 'var(--gx-text-sm)', padding: 'var(--gx-space-4) 0' }}>Empty</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}
