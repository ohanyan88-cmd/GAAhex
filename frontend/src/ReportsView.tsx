import { useEffect, useState } from 'react'

// Reports view — consumes the Reports API (Task A). Self-contained: inlines its own
// fetch calls (same base + Authorization pattern as api.ts) and does NOT touch the shared api.ts.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Summary = { entity_key: string; route_slug: string; label_plural: string; count: number }
type StatusCount = { status: string; count: number }

async function fetchJson(token: string, path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    throw new Error(e.detail || `Failed to load ${path}`)
  }
  return r.json()
}

// The by-status endpoint may return [{status, count}] or {status: count}. Normalize both.
function normalizeByStatus(raw: any): StatusCount[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => ({ status: String(r.status ?? ''), count: Number(r.count ?? 0) }))
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([status, count]) => ({ status, count: Number(count) }))
  }
  return []
}

export default function ReportsView({ token }: { token: string }) {
  const [summary, setSummary] = useState<Summary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selected, setSelected] = useState<string | null>(null)
  const [byStatus, setByStatus] = useState<StatusCount[]>([])
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    fetchJson(token, '/reports/summary')
      .then((data) => { if (alive) setSummary(Array.isArray(data) ? data : []) })
      .catch((err) => { if (alive) setError((err as Error).message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  async function openEntity(slug: string) {
    setSelected(slug)
    setStatusLoading(true); setStatusError(''); setByStatus([])
    try {
      const raw = await fetchJson(token, `/reports/${slug}/by-status`)
      setByStatus(normalizeByStatus(raw))
    } catch (err) {
      setStatusError((err as Error).message)
    } finally {
      setStatusLoading(false)
    }
  }

  const maxCount = byStatus.reduce((m, s) => Math.max(m, s.count), 0)
  const selectedLabel = summary.find((s) => s.route_slug === selected)?.label_plural ?? selected

  return (
    <div>
      <div className="view-head"><h2>Reports</h2></div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="err">{error}</p>}

      {!loading && !error && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            {summary.map((s) => (
              <button
                key={s.entity_key}
                onClick={() => openEntity(s.route_slug)}
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid ' + (selected === s.route_slug ? 'var(--primary)' : 'var(--border)'),
                  borderRadius: 10,
                  padding: '14px 18px',
                  minWidth: 130,
                  textAlign: 'left',
                  boxShadow: 'var(--shadow)',
                  cursor: 'pointer',
                }}
              >
                <div className="muted" style={{ marginBottom: 6 }}>{s.label_plural}</div>
                <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{s.count}</div>
              </button>
            ))}
            {summary.length === 0 && <p className="muted">No entities to report on yet.</p>}
          </div>

          {selected && (
            <div>
              <div className="view-head"><h2 style={{ fontSize: 18 }}>{selectedLabel} · by status</h2></div>
              {statusLoading && <p className="muted">Loading…</p>}
              {statusError && <p className="err">{statusError}</p>}
              {!statusLoading && !statusError && (
                <div className="grid-wrap"><table className="grid">
                  <thead>
                    <tr><th scope="col">Status</th><th scope="col">Count</th><th scope="col" style={{ width: '50%' }}>Share</th></tr>
                  </thead>
                  <tbody>
                    {byStatus.map((s) => (
                      <tr key={s.status}>
                        <td>{s.status ? <span className="pill">{s.status}</span> : <span className="muted">—</span>}</td>
                        <td>{s.count}</td>
                        <td>
                          <div style={{ background: 'var(--surface-2)', borderRadius: 999, height: 10, width: '100%' }}>
                            <div style={{
                              background: 'var(--primary)',
                              borderRadius: 999,
                              height: 10,
                              width: (maxCount > 0 ? (s.count / maxCount) * 100 : 0) + '%',
                            }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {byStatus.length === 0 && (
                      <tr><td colSpan={3} className="muted">No records yet.</td></tr>
                    )}
                  </tbody>
                </table></div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
