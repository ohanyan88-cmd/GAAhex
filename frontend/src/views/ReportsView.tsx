import { useEffect, useMemo, useState } from 'react'
import { SkeletonRows, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { BookmarkIcon } from '../components/icons'
import { usePageConfig } from '../lib/pageConfig'
import { Donut, type DonutDatum } from '../components/charts/Donut'
import { can, type Capabilities } from '../lib/capabilities'
import { KPITile } from '../primitives'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'

// Reports — consumes the Reports API (Task A). Re-laid into the kit's `gx-dash` dashboard
// pattern: a KPI strip of entity counts (each tile is clickable — selecting one drives the
// drill-down), then a two-column card body for "by status" — donut on the left, bar table
// on the right. Self-contained fetch (same base + Authorization pattern as api.ts); does
// NOT touch shared api.ts. No charting library; no new CSS.
// Doctrine: real data only — we don't have a historical series for entity counts, so no
// sparkline is rendered (rule 3: missing → hide; never fake a trend).
import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

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

  // KPIs: total reportable count + entity type count (only when data has loaded)
  const kpis: KPISpec[] | undefined = !loading && summary.length > 0 ? [
    { label: 'Total records',   value: fmtNum(totalReportable) },
    { label: 'Entity types',    value: summary.length },
  ] : undefined

  return (
    <PageShell
      type="ANALYTICS"
      breadcrumb={['Analytics & AI', 'Reports & AI Insights']}
      icon={<BookmarkIcon size={18} />}
      title="Reports"
      subtitle="Saved reports & scheduled exports"
      kpis={kpis}
    >

        {error && <ErrorBanner message={error} onRetry={loadSummary} />}

        {loading && <SkeletonRows rows={4} />}

        {!loading && !error && summary.length === 0 && (
          <EmptyState title="No entities to report on yet." message="Configure entity types in Studio to see reports here." />
        )}

        {!loading && !error && summary.length > 0 && (
          <>
            {/* KPI strip — each entity is a clickable tile. Per the KPI Tile
                Standard (D17) every tile uses the same visual treatment;
                colored value text (warning/danger/muted) reflects state. */}
            <div className="kpis">
              {summary.map((s) => (
                <EntityKpi
                  key={s.entity_key}
                  label={s.label_plural}
                  value={s.count}
                  active={selected === s.route_slug}
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
                      <EmptyState title="No records yet" message="Once the selected report has data, the status distribution donut will render here." />
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
                      !statusLoading && !statusError && <EmptyState title="No records yet" message="The status-bar breakdown will populate alongside the donut once data is available." />
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
    </PageShell>
  )
}

// Clickable KPI tile. Adapter onto the shared <KPITile> primitive — gives every
// entity tile the same hover behavior / focus ring as every other dashboard in
// the app, per the KPI Tile Standard (D17). The `active` outline indicates the
// currently-pinned entity in the picker, not a "premium" highlight.
// Doctrine rule 3: no historical series → no sparkline / no delta. We'll wire that
// once a real time-series endpoint exists.
function EntityKpi({
  label, value, active, onClick,
}: {
  label: string
  value: number
  active: boolean
  onClick: () => void
}) {
  return (
    // D18: KPI tile acting as an active filter selection = azure outline (interactive selected state)
    <div style={active ? { outline: '1px solid var(--gx-interactive)', outlineOffset: -1, borderRadius: 'var(--gx-radius-lg)' } : undefined}>
      <KPITile
        label={label}
        value={fmtNum(value)}
        size="sm"
        onClick={onClick}
        ariaLabel={`${label} — ${fmtNum(value)}. Click to open the ${label} list.`}
      />
    </div>
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
