import { useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from './States'
import { DownloadIcon } from './icons'
import ViewHead from './ViewHead'

// Reports view — consumes the Reports API (Task A). Self-contained: inlines its own
// fetch calls (same base + Authorization pattern as api.ts) and does NOT touch the shared api.ts.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Summary = { entity_key: string; route_slug: string; label_plural: string; count: number }
type StatusCount = { status: string; count: number }

class FetchError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function fetchJson(token: string, path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    throw new FetchError(e.detail || `Failed to load ${path}`, r.status)
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
  const [denied, setDenied] = useState(false)

  const [selected, setSelected] = useState<string | null>(null)
  const [byStatus, setByStatus] = useState<StatusCount[]>([])
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState('')

  function loadSummary() {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    fetchJson(token, '/reports/summary')
      .then((data) => { if (alive) setSummary(Array.isArray(data) ? data : []) })
      .catch((err) => {
        if (!alive) return
        if (err instanceof FetchError && err.status === 403) { setDenied(true) }
        else { setError((err as Error).message) }
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }

  useEffect(loadSummary, [token])

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

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to view reports." />

  return (
    <div>
      <ViewHead icon={<DownloadIcon size={20} />} title="Reports" />

      {error && <ErrorBanner message={error} onRetry={loadSummary} />}

      {!error && (
        <>
          <div className="widgets">
            {summary.map((s) => (
              <button
                key={s.entity_key}
                onClick={() => openEntity(s.route_slug)}
                className="widget"
                style={{
                  background: selected === s.route_slug ? 'var(--surface-2)' : 'var(--surface)',
                  border: '1px solid ' + (selected === s.route_slug ? 'var(--accent)' : 'var(--border)'),
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div className="widget-label">{s.label_plural}</div>
                <div className="kpi">{s.count}</div>
              </button>
            ))}
            {summary.length === 0 && <EmptyState title="No entities to report on yet." message="Configure entity types in Studio to see reports here." />}
          </div>

          {selected && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, marginTop: 0 }}>{selectedLabel} · by status</h3>
              {statusLoading && <LoadingState />}
              {statusError && <ErrorBanner message={statusError} />}
              {!statusLoading && !statusError && (
                <div className="bars">
                  {byStatus.length > 0 ? (
                    byStatus.map((s) => (
                      <div key={s.status} className="bar-row">
                        <span className="bar-label">{s.status ? <span className="pill">{s.status}</span> : <span className="muted">—</span>}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: (maxCount > 0 ? (s.count / maxCount) * 100 : 0) + '%' }} />
                        </div>
                        <span className="bar-val">{s.count}</span>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No records yet.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
