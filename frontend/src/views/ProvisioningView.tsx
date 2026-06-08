// ProvisioningView — Tech & NOC → Provisioning.
// Activation queue: services in PENDING status, ordered by created_at.
// Real data from GET /api/services?status=PENDING. Real data only.
import { useEffect, useState } from 'react'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { GearIcon } from '../components/icons'
import { BASE, authH } from '../lib/billing'
import { PENDING_SERVICES } from '../lib/pagination'


type Service = {
  id: string; subscription_id: string | null; customer_id: string | null
  plan_name: string; status: string; started_at: string; created_at: string
}

// DF-4 — canonical fmtDate in lib/time.ts. Local signature was tighter
// (non-nullable string); the canonical accepts null/undefined and returns
// '—' for empty, which is compatible at every call site here.
import { fmtDate } from '../lib/time'

export default function ProvisioningView({ token }: { token: string }) {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/services?status=PENDING&limit=${PENDING_SERVICES}`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (alive) { setServices(Array.isArray(d) ? d : d.services ?? []); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [token])

  const pending = services.filter(s => s.status === 'PENDING').length
  const active = services.filter(s => s.status === 'ACTIVE').length

  const kpis: KPISpec[] = loading
    ? [
        { label: 'Pending', value: 0, loading: true },
        { label: 'Active', value: 0, loading: true },
      ]
    : services.length === 0
    ? []
    : [
        { label: 'Pending', value: pending, warning: pending > 0 },
        { label: 'Active', value: active },
      ]

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Tech & NOC', 'Provisioning']}
      icon={<GearIcon size={20} />}
      title="Provisioning"
      subtitle="Service activation pipeline · Stages 9–11"
      kpis={kpis.length > 0 ? kpis : undefined}
    >
      <div>
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
                  <td style={{ fontWeight: 'var(--gx-weight-medium)' }}>{s.plan_name}</td>
                  <td><span className="badge badge-warning">{s.status}</span></td>
                  <td className="mono" style={{ fontSize: 'var(--gx-text-13)' }}>{fmtDate(s.started_at)}</td>
                  <td className="mono muted" style={{ fontSize: 'var(--gx-text-13)' }}>{fmtDate(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  )
}
