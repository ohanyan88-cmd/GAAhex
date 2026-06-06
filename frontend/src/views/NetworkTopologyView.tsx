// NetworkTopologyView — Tech & NOC → Network Topology.
// Lists sites/POPs from /api/sites (entity records with entity_key='site').
// Shows status, kind, address. Real data only — missing → empty state.
import { useEffect, useState } from 'react'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { ServerIcon } from '../components/icons'
import { BASE, authH } from '../lib/billing'


type Site = { id: string; status: string | null; data: Record<string, unknown> }

const KIND_COLORS: Record<string, string> = {
  // D18: POP kind = slate (passive categorical identity, not brand spine)
  POP: 'var(--gx-text-2)',
  datacenter: 'var(--gx-success)',
  tower: 'var(--gx-warning)',
}

export default function NetworkTopologyView({ token }: { token: string }) {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/sites?limit=200`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (alive) { setSites(Array.isArray(d) ? d : d.records ?? []); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [token])

  const live = sites.filter(s => s.status === 'LIVE').length
  const planned = sites.filter(s => s.status === 'PLANNED').length

  const kpis: KPISpec[] = loading
    ? [
        { label: 'Nodes', value: 0, loading: true },
        { label: 'Live', value: 0, loading: true },
        { label: 'Planned', value: 0, loading: true },
      ]
    : sites.length === 0
    ? []
    : [
        { label: 'Nodes', value: sites.length },
        { label: 'Live', value: live },
        { label: 'Planned', value: planned },
      ]

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Tech & NOC', 'Network Topology']}
      icon={<ServerIcon size={20} />}
      title="Network Topology"
      subtitle="Logical connectivity graph"
      kpis={kpis.length > 0 ? kpis : undefined}
    >
      <div>
        {loading && <SkeletonRows rows={6} />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && sites.length === 0 && (
          <EmptyState icon={<ServerIcon size={36} />} title="No sites yet" message="Add sites and POPs in Studio → Data to populate the network topology." />
        )}
        {!loading && sites.length > 0 && (
          <table className="grid" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Name</th><th>Kind</th><th>Status</th><th>Address</th>
              </tr>
            </thead>
            <tbody>
              {sites.map(site => {
                const d = site.data ?? {}
                const kind = String(d.kind ?? '—')
                return (
                  <tr key={site.id}>
                    <td style={{ fontWeight: 500 }}>{String(d.name ?? '—')}</td>
                    <td>
                      <span style={{ color: KIND_COLORS[kind] || 'inherit', fontWeight: 500 }}>{kind}</span>
                    </td>
                    <td>
                      <span className={`badge badge-${site.status === 'LIVE' ? 'success' : site.status === 'DECOMMISSIONED' ? 'danger' : 'neutral'}`}>
                        {site.status ?? '—'}
                      </span>
                    </td>
                    <td className="muted" style={{ fontSize: 'var(--gx-text-13)' }}>{String(d.address ?? '—')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  )
}
