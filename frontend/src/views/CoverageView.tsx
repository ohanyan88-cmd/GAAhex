// CoverageView — Tech & NOC → Service Qualification.
// Lists coverage_check records with pass/fail stats.
// When lat/lon data is present, shows coordinates.
// Real data from GET /api/coverage-checks. Real data only.
import { useEffect, useState } from 'react'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { ShieldIcon } from '../components/icons'
import { BASE, authH } from '../lib/billing'

type Check = { id: string; status: string | null; data: Record<string, unknown> }

export default function CoverageView({ token }: { token: string }) {
  const [checks, setChecks] = useState<Check[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${BASE}/api/coverage-checks?limit=200`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (alive) { setChecks(Array.isArray(d) ? d : d.records ?? []); setLoading(false) } })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [token])

  const pass = checks.filter(c => (c.data?.result ?? c.status) === 'PASS').length
  const fail = checks.filter(c => (c.data?.result ?? c.status) === 'FAIL').length
  const pending = checks.filter(c => {
    const r = c.data?.result ?? c.status
    return r !== 'PASS' && r !== 'FAIL'
  }).length
  const pct = checks.length > 0 ? Math.round(pass / checks.length * 100) : null

  const kpis: KPISpec[] = loading
    ? [
        { label: 'Pass', value: 0, loading: true },
        { label: 'Fail', value: 0, loading: true },
        { label: 'Pending', value: 0, loading: true },
      ]
    : checks.length === 0
    ? []
    : [
        { label: 'Pass', value: pass },
        { label: 'Fail', value: fail, danger: fail > 0 },
        { label: 'Pending', value: pending, warning: pending > 0 },
        ...(pct !== null ? [{ label: 'Coverage rate', value: `${pct}%` }] : []),
      ]

  return (
    <PageShell
      type="OPERATIONS"
      breadcrumb={['Tech & NOC', 'Service Qualification']}
      icon={<ShieldIcon size={20} />}
      title="Service Qualification"
      subtitle="Network coverage check & feasibility"
      kpis={kpis.length > 0 ? kpis : undefined}
    >
      <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
        {loading && <SkeletonRows rows={6} />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && checks.length === 0 && (
          <EmptyState icon={<ShieldIcon size={36} />} title="No coverage checks" message="Run feasibility checks against customer addresses to populate coverage data." />
        )}
        {!loading && checks.length > 0 && (
          <table className="grid" style={{ width: '100%' }}>
            <thead><tr><th>Address</th><th>Result</th><th>Lat</th><th>Lon</th></tr></thead>
            <tbody>
              {checks.map(c => {
                const d = c.data ?? {}
                const result = String(d.result ?? c.status ?? '—')
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{String(d.address ?? '—')}</td>
                    <td>
                      <span className={`badge ${result === 'PASS' ? 'badge-success' : result === 'FAIL' ? 'badge-danger' : 'badge-neutral'}`}>
                        {result}
                      </span>
                    </td>
                    <td className="mono muted" style={{ fontSize: 12 }}>{d.lat ? String(d.lat) : '—'}</td>
                    <td className="mono muted" style={{ fontSize: 12 }}>{d.lon ? String(d.lon) : '—'}</td>
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
