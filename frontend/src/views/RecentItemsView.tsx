// RecentItemsView — Workspace → Recent Items.
// Real data from GET /api/activity?limit=50 (the audit event log, filtered to
// the signed-in user's actions). Displays the last-touched records in chronological
// order. No mock fallbacks: API errors → error banner, empty → empty state.
import { useEffect, useState } from 'react'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { ClockIcon } from '../components/icons'
import { BASE, authH } from '../lib/billing'
import { PageShell } from '../page-shell'


type ActivityEvent = {
  id: string
  action: string
  entity_key: string | null
  record_id: string | null
  description: string | null
  created_at: string
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

function label(e: ActivityEvent): string {
  const base = e.entity_key ? e.entity_key.replace(/_/g, ' ') : 'Record'
  return e.description || `${e.action} ${base}`
}

export default function RecentItemsView({ token, onNavigate }: {
  token: string
  onNavigate?: (entityKey: string, recordId: string) => void
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`${BASE}/api/activity?limit=50`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(data => { if (alive) { setEvents(Array.isArray(data) ? data : data.events ?? []); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [token])

  // Deduplicate by record_id — keep only the most recent event per record.
  const seen = new Set<string>()
  const unique = events.filter(e => {
    if (!e.record_id) return true
    if (seen.has(e.record_id)) return false
    seen.add(e.record_id); return true
  })

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Workspace', 'Recent Items']}
      icon={<ClockIcon size={20} />}
      title="Recent Items"
      subtitle={loading ? 'Recently visited records' : `${unique.length} item${unique.length === 1 ? '' : 's'}`}
    >
      <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
        {loading && <SkeletonRows rows={8} />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && unique.length === 0 && (
          <EmptyState icon={<ClockIcon size={36} />} title="No recent activity" message="Items you open or edit will appear here." />
        )}
        {!loading && unique.map(e => (
          <div
            key={e.id}
            className="card card-hover"
            style={{ padding: 'var(--sp-3) var(--sp-4)', marginBottom: 6, cursor: (onNavigate && e.entity_key && e.record_id) ? 'pointer' : 'default' }}
            onClick={() => e.entity_key && e.record_id && onNavigate?.(e.entity_key, e.record_id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{label(e)}</span>
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', marginLeft: 'var(--sp-4)' }}>{timeAgo(e.created_at)}</span>
            </div>
            {e.entity_key && (
              <span className="badge badge-neutral" style={{ fontSize: 11, marginTop: 4 }}>
                {e.entity_key.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        ))}
      </div>
    </PageShell>
  )
}
