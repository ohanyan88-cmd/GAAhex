import { useEffect, useMemo, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { DownloadIcon, GearIcon } from '../components/icons'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { Donut, type DonutDatum } from '../components/charts/Donut'
import { Spark } from '../components/charts/Spark'

// Reports — consumes the Reports API (Task A). Re-laid into the kit's `gx-dash` dashboard
// pattern: a KPI strip of entity counts (each tile is clickable — selecting one drives the
// drill-down), then a two-column card body for "by status" — donut on the left, bar table
// on the right. Self-contained fetch (same base + Authorization pattern as api.ts); does
// NOT touch shared api.ts. No charting library; no new CSS.
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

const fmtNum = (n: number) => n.toLocaleString('en-US')

export default function ReportsView({ token, configVersion = 0, canConfigure = false, onConfigure }: { token: string; configVersion?: number; canConfigure?: boolean; onConfigure?: () => void }) {
  const cfg = usePageConfig(token, 'reports', configVersion)
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

  // Auto-select the first entity once the summary lands, so the drill-down isn't blank.
  useEffect(() => {
    if (!selected && summary.length > 0) openEntity(summary[0].route_slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary])

  const selectedLabel = summary.find((s) => s.route_slug === selected)?.label_plural ?? selected
  const totalReportable = summary.reduce((s, e) => s + e.count, 0)

  // Donut data for the selected entity's by-status breakdown.
  const donutData: DonutDatum[] = useMemo(
    () => byStatus.map((s) => ({ label: s.status || '—', value: s.count })),
    [byStatus],
  )
  const byStatusTotal = byStatus.reduce((s, x) => s + x.count, 0)

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to view reports." />

  return (
    <div className="view-inner gx-dash fade">
        <div className="crumbs"><span>Insights</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>

        <ViewHead
          icon={<DownloadIcon size={20} />}
          title={cfg.title}
          sub={summary.length > 0
            ? `${summary.length} entity type${summary.length === 1 ? '' : 's'} · ${fmtNum(totalReportable)} record${totalReportable === 1 ? '' : 's'}`
            : 'Reports across configured entities'}
          actions={
            canConfigure && onConfigure ? (
              <button className="btn btn-ghost btn-sm hide-sm" onClick={onConfigure} title="Configure this page">
                <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />Configure page
              </button>
            ) : null
          }
        />

        {error && <ErrorBanner message={error} onRetry={loadSummary} />}

        {!error && summary.length === 0 && (
          <EmptyState title="No entities to report on yet." message="Configure entity types in Studio to see reports here." />
        )}

        {!error && summary.length > 0 && (
          <>
            {/* KPI strip — each entity is a clickable tile. The first tile gets the gold
                marquee accent (kit convention: headline metric first). */}
            <div className="kpis">
              {summary.map((s, i) => (
                <EntityKpi
                  key={s.entity_key}
                  label={s.label_plural}
                  value={s.count}
                  active={selected === s.route_slug}
                  marquee={i === 0}
                  onClick={() => openEntity(s.route_slug)}
                />
              ))}
            </div>

            {selected && (
              <div className="cols">
                <div className="card">
                  <div className="card-head">
                    <h3>{selectedLabel} · by status</h3>
                  </div>
                  <div className="card-pad">
                    {statusLoading && <LoadingState />}
                    {statusError && <ErrorBanner message={statusError} />}
                    {!statusLoading && !statusError && byStatus.length === 0 && (
                      <p className="muted">No records yet.</p>
                    )}
                    {!statusLoading && !statusError && byStatus.length > 0 && (
                      <Donut data={donutData} centerLabel={fmtNum(byStatusTotal)} centerCaption="total" />
                    )}
                  </div>
                </div>

                <div className="card">
                  <div className="card-head">
                    <h3>Breakdown</h3>
                  </div>
                  <div className="card-pad">
                    {!statusLoading && !statusError && byStatus.length > 0 ? (
                      <StatusBars data={byStatus} />
                    ) : (
                      !statusLoading && !statusError && <p className="muted">No records yet.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
    </div>
  )
}

// Clickable KPI tile. Pressed state uses `kpi--marquee` lookalike via aria-pressed
// + a subtle outline ring through a CSS var; no new CSS — we re-use the kit's
// existing `.kpi` chrome.
function EntityKpi({
  label, value, active, marquee, onClick,
}: {
  label: string
  value: number
  active: boolean
  marquee: boolean
  onClick: () => void
}) {
  const cls = 'kpi' + (marquee ? ' kpi--marquee' : '') + (active ? ' on' : '')
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-pressed={active}
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        background: 'transparent',
        font: 'inherit',
        // Active tile gets an accent outline ring via the kit's primary color.
        outline: active ? '1px solid var(--gx-primary)' : 'none',
        outlineOffset: active ? -1 : 0,
      }}
    >
      <div className="klbl">{label}</div>
      <div className="kval tnum">{fmtNum(value)}</div>
      <div className="kfoot">
        <span className="kdelta" style={{ color: 'var(--gx-text-3)' }}>—</span>
        <Spark color={marquee ? 'var(--gx-gold)' : 'var(--gx-primary)'} />
      </div>
    </button>
  )
}

// By-status as a kit `.bars` table.
function StatusBars({ data }: { data: StatusCount[] }) {
  const max = data.reduce((m, s) => Math.max(m, s.count), 0)
  return (
    <div className="bars">
      {data.map((s) => (
        <div key={s.status} className="bar-row">
          <span className="bar-label">{s.status ? <span className="pill pill-neutral pill-sm">{s.status}</span> : <span className="muted">—</span>}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: (max > 0 ? (s.count / max) * 100 : 0) + '%' }} />
          </div>
          <span className="bar-val tnum">{fmtNum(s.count)}</span>
        </div>
      ))}
    </div>
  )
}
