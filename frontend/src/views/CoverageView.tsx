// CoverageView — Network → Coverage & GIS.
// Lists coverage_check records with pass/fail stats.
// When lat/lon data is present, shows coordinates.
// Real data from GET /api/coverage-checks. Real data only.
import { useEffect, useState } from 'react'
import ViewHead from '../components/ViewHead'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { ShieldIcon } from '../components/icons'
import { BASE } from '../lib/billing'

const authH = (t: string) => ({ Authorization: `Bearer ${t}` })
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
  const pct = checks.length > 0 ? Math.round(pass / checks.length * 100) : null

  return (
    <div className="view-root">
      <ViewHead
        icon={<ShieldIcon size={20} />}
        title="Coverage & GIS"
        sub={loading ? undefined : checks.length === 0 ? undefined : `${pass} pass · ${fail} fail${pct !== null ? ` · ${pct}% coverage` : ''}`}
      />
      <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
        {loading && <SkeletonRows rows={6} />}
        {error && <ErrorBanner message={error} />}
        {!loading && !error && checks.length === 0 && (
          <EmptyState icon={<ShieldIcon size={36} />} title="No coverage checks" message="Run feasibility checks against customer addresses to populate coverage data." />
        )}
        {!loading && checks.length > 0 && (
          <>
            {pct !== null && (
              <div style={{ display: 'flex', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}>
                {[
                  { label: 'Total checks', value: checks.length },
                  { label: 'Pass', value: pass },
                  { label: 'Fail', value: fail },
                  { label: 'Coverage rate', value: `${pct}%` },
                ].map(stat => (
                  <div key={stat.label} className="card" style={{ padding: 'var(--sp-3) var(--sp-4)', minWidth: 120 }}>
                    <div className="muted" style={{ fontSize: 12 }}>{stat.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            )}
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
          </>
        )}
      </div>
    </div>
  )
}
