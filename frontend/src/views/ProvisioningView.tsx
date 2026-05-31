// ProvisioningView — Network → Provisioning.
// Activation queue: services in PENDING status, ordered by created_at.
// Real data from GET /api/services?status=PENDING. Real data only.
import { useEffect, useState } from 'react'
import ViewHead from '../components/ViewHead'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { GearIcon } from '../components/icons'
import { BASE } from '../lib/billing'

const authH = (t: string) => ({ Authorization: `Bearer ${t}` })

type Service = {
  id: string; subscription_id: string | null; customer_id: string | null
  plan_name: string; status: string; started_at: string; created_at: string
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export default function ProvisioningView({ token }: { token: string }) {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/services?status=PENDING&limit=200`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (alive) { setServices(Array.isArray(d) ? d : d.services ?? []); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [token])

  return (
    <div className="view-root">
      <ViewHead icon={<GearIcon size={20} />} title="Provisioning Queue" sub={loading ? undefined : `${services.length} pending activation${services.length === 1 ? '' : 's'}`} />
      <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
        {loading && <SkeletonRows rows={6} />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && services.length === 0 && (
          <EmptyState icon={<GearIcon size={36} />} title="Queue is clear" message="No services are waiting for activation." />
        )}
        {!loading && services.length > 0 && (
          <table className="grid" style={{ width: '100%' }}>
            <thead>
              <tr><th>Plan</th><th>Status</th><th>Start Date</th><th>Created</th></tr>
            </thead>
            <tbody>
              {services.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{s.plan_name}</td>
                  <td><span className="badge badge-warning">{s.status}</span></td>
                  <td className="mono" style={{ fontSize: 13 }}>{fmtDate(s.started_at)}</td>
                  <td className="mono muted" style={{ fontSize: 13 }}>{fmtDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
