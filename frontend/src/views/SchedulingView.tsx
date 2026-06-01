// SchedulingView — Tech & NOC → Scheduling.
// Lists schedule_slot records sorted by date, grouped by status.
// Real data from GET /api/schedule-slots. Real data only.
import { useEffect, useState } from 'react'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { CalendarIcon } from '../components/icons'
import { BASE } from '../lib/billing'

const authH = (t: string) => ({ Authorization: `Bearer ${t}` })
type Slot = { id: string; status: string | null; data: Record<string, unknown> }

const STATUS_ORDER = ['OPEN', 'FILLED', 'CANCELLED']
const STATUS_CLASS: Record<string, string> = { OPEN: 'badge-primary', FILLED: 'badge-success', CANCELLED: 'badge-neutral' }

export default function SchedulingView({ token }: { token: string }) {
  const [slots, setSlots] = useState<Slot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/schedule-slots?limit=200`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (alive) { setSlots(Array.isArray(d) ? d : d.records ?? []); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [token])

  const byStatus = STATUS_ORDER.reduce<Record<string, Slot[]>>((acc, s) => {
    acc[s] = slots.filter(sl => (sl.status ?? 'OPEN') === s)
    return acc
  }, {})

  const open = byStatus['OPEN']?.length ?? 0
  const filled = byStatus['FILLED']?.length ?? 0

  const kpis: KPISpec[] = loading
    ? [
        { label: 'Open', value: 0, loading: true },
        { label: 'Filled', value: 0, loading: true },
        { label: 'Cancelled', value: 0, loading: true },
      ]
    : slots.length === 0
    ? []
    : [
        { label: 'Open', value: open },
        { label: 'Filled', value: filled },
        { label: 'Cancelled', value: byStatus['CANCELLED']?.length ?? 0, muted: true },
      ]

  return (
    <PageShell
      type="operations"
      breadcrumb={['Tech & NOC', 'Scheduling']}
      icon={<CalendarIcon size={20} />}
      title="Scheduling"
      subtitle="Technician calendar & field dispatch slots"
      kpis={kpis.length > 0 ? kpis : undefined}
    >
      <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
        {loading && <SkeletonRows rows={6} />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && slots.length === 0 && (
          <EmptyState icon={<CalendarIcon size={36} />} title="No schedule slots" message="Create schedule slots in the entity browser or via the API to populate this view." />
        )}
        {!loading && STATUS_ORDER.map(status => {
          const group = byStatus[status] ?? []
          if (group.length === 0) return null
          return (
            <div key={status} style={{ marginBottom: 'var(--sp-6)' }}>
              <div className="section-label" style={{ marginBottom: 'var(--sp-2)' }}>
                {status} <span className="muted">({group.length})</span>
              </div>
              <table className="grid" style={{ width: '100%' }}>
                <thead><tr><th>Title</th><th>Date</th><th>Technician</th><th>Status</th></tr></thead>
                <tbody>
                  {group.map(sl => {
                    const d = sl.data ?? {}
                    return (
                      <tr key={sl.id}>
                        <td style={{ fontWeight: 500 }}>{String(d.title ?? '—')}</td>
                        <td className="mono" style={{ fontSize: 13 }}>{String(d.date ?? '—')}</td>
                        <td className="muted" style={{ fontSize: 13 }}>{String(d.tech ?? '—')}</td>
                        <td><span className={`badge ${STATUS_CLASS[status] ?? 'badge-neutral'}`}>{status}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </PageShell>
  )
}
