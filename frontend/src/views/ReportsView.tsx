import { useEffect, useMemo, useState } from 'react'
import { SkeletonRows, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { DownloadIcon, GearIcon } from '../components/icons'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { Donut, type DonutDatum } from '../components/charts/Donut'
import { can, type Capabilities } from '../lib/capabilities'

// Reports — consumes the Reports API (Task A). Re-laid into the kit's `gx-dash` dashboard
// pattern: a KPI strip of entity counts (each tile is clickable — selecting one drives the
// drill-down), then a two-column card body for "by status" — donut on the left, bar table
// on the right. Self-contained fetch (same base + Authorization pattern as api.ts); does
// NOT touch shared api.ts. No charting library; no new CSS.
// Doctrine: real data only — we don't have a historical series for entity counts, so no
// sparkline is rendered (rule 3: missing → hide; never fake a trend).
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Summary = { entity_key: string; route_slug: string; label_plural: string; count: number }
type StatusCount = { status: string; label: string; count: number }

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

// The by-status endpoint returns {entity_key, label_plural, by_status: [{status, label, count}]}.
// Tolerate older array / dict shapes too in case other deployments differ. Always returns the
// normalized [{status, label, count}] used by the donut/bar chart.
function normalizeByStatus(raw: any): StatusCount[] {
  // canonical shape from backend/app/routers/reports.py
  if (raw && typeof raw === 'object' && Array.isArray(raw.by_status)) {
    return raw.by_status.map((r: any) => ({
      status: String(r.status ?? ''),
      label: String(r.label ?? r.status ?? ''),
      count: Number(r.count ?? 0),
    }))
  }
  if (Array.isArray(raw)) {
    return raw.map((r) => ({
      status: String(r.status ?? ''),
      label: String(r.label ?? r.status ?? ''),
      count: Number(r.count ?? 0),
    }))
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([status, count]) => ({
      status,
      label: status,
      count: Number(count),
    }))
  }
  return []
}

const fmtNum = (n: number) => n.toLocaleString('en-US')

export default function ReportsView({
  token,
  configVersion = 0,
  canConfigure = false,
  capabilities,
  onConfigure,
}: {
  token: string
  configVersion?: number
  canConfigure?: boolean
  capabilities?: Capabilities
  onConfigure?: () => void
}) {
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
      .then((data) => {
        // Doctrine rule 6: client-side capability gate matches server-side filter,
        // so we never even surface entities the user can't `view`.
        const rows: Summary[] = Array.isArray(data) ? data : []
        const filtered = capabilities
          ? rows.filter((r) => can(capabilities, r.entity_key, 'view'))
          : rows
        if (alive) setSummary(filtered)
      })
      .catch((err) => {
        if (!alive) return
        if (err instanceof FetchError && err.status === 403) { setDenied(true) }
        else {
          // eslint-disable-next-line no-console
          console.error('[Reports] /reports/summary failed:', err)
          setError((err as Error).message)
        }
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }

  useEffect(loadSummary, [token, capabilities])

  async function openEntity(slug: string) {
    setSelected(slug)
    setStatusLoading(true); setStatusError(''); setByStatus([])
    try {
      const raw = await fetchJson(token, `/reports/${slug}/by-status`)
      setByStatus(normalizeByStatus(raw))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[Reports] /reports/${slug}/by-status failed:`, err)
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

  // Donut data for the selected entity's by-status breakdown — use real backend label.
  const donutData: DonutDatum[] = useMemo(
    () => byStatus.map((s) => ({ label: s.label || s.status || '—', value: s.count })),
    [byStatus],
  )
  const byStatusTotal = byStatus.reduce((s, x) => s + x.count, 0)

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
                <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
              </button>
            ) : null
          }
        />

        {error && <ErrorBanner message={error} onRetry={loadSummary} />}

        {loading && <SkeletonRows rows={4} />}

        {!loading && !error && summary.length === 0 && (
          <EmptyState title="No entities to report on yet." message="Configure entity types in Studio to see reports here." />
        )}

        {!loading && !error && summary.length > 0 && (
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
                    {statusLoading && <SkeletonRows rows={3} />}
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
  // Doctrine rule 3: no historical series → no sparkline / no delta. The kit's `.kfoot`
  // slot is intentionally empty here; we'll fill it once a real time-series endpoint exists.
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
    </button>
  )
}

// By-status as a kit `.bars` table. Uses the backend-supplied human label, not the raw key.
function StatusBars({ data }: { data: StatusCount[] }) {
  const max = data.reduce((m, s) => Math.max(m, s.count), 0)
  return (
    <div className="bars">
      {data.map((s) => (
        <div key={s.status} className="bar-row">
          <span className="bar-label">
            {s.label || s.status
              ? <span className="pill pill-neutral pill-sm">{s.label || s.status}</span>
              : <span className="muted">—</span>}
          </span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: (max > 0 ? (s.count / max) * 100 : 0) + '%' }} />
          </div>
          <span className="bar-val tnum">{fmtNum(s.count)}</span>
        </div>
      ))}
    </div>
  )
}
