import { useEffect, useMemo, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import ViewHead from '../components/ViewHead'
import { ChartIcon, ArrowUpIcon, ArrowDownIcon } from '../components/icons'
import { usePageConfig } from '../lib/pageConfig'
import { Donut, type DonutDatum } from '../components/charts/Donut'
import { LineChart } from '../components/charts/LineChart'
import { Spark } from '../components/charts/Spark'

// Dashboards — picks a board and renders its config-driven widgets from /dashboards/{key}/data.
// Self-contained inline fetch (same pattern as api.ts / ReportsView). No chart library: KPIs are
// big numbers, bar/donut/line are hand-rolled inline-SVG (lifted from the GAAex design kit), and
// the table is a plain grid. A widget that returns {error} is shown gracefully and never crashes
// the board.
//
// PROMPT 7 reskin (Portal sandbox) — fetch logic + widget config flow is UNCHANGED. Markup is
// re-laid into the kit's `ModuleDashboard` idiom: a .gx-dash root wrapping a KPI strip
// (.kpis/.kpi tiles with Space Grotesk numerals, delta pills, sparklines, and a gold marquee
// accent on the first KPI) and a two-column body (.cols) for the breakdown / chart widgets.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Board = { key: string; label: string; description?: string | null; order: number }
type WidgetOut = { widget_key: string; type: string; label: string; result?: any; error?: string }
type BoardData = { key: string; label: string; widgets: WidgetOut[] }
type Group = { group: string; value: number }
type Range = '30d' | 'qtd' | 'ytd'

class FetchError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function jget(token: string, path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    throw new FetchError(e.detail || `Failed to load ${path}`, r.status)
  }
  return r.json()
}

// Normalize either {value} or [{group,value}] into grouped rows.
function asGroups(result: any): Group[] {
  if (Array.isArray(result)) return result.map((d) => ({ group: String(d.group ?? '—'), value: Number(d.value) || 0 }))
  if (result && typeof result === 'object' && 'value' in result) return [{ group: 'Total', value: Number(result.value) || 0 }]
  return []
}
function kpiValue(result: any): number {
  if (Array.isArray(result)) return result.reduce((s, d) => s + (Number(d.value) || 0), 0)
  return Number(result?.value) || 0
}
const fmtNum = (n: number) => n.toLocaleString()

function friendlyError(e: string): string {
  if (e === 'forbidden') return "You don't have access to this widget's data."
  return e
}

export default function DashboardView({ token, configVersion = 0 }: { token: string; configVersion?: number }) {
  const cfg = usePageConfig(token, 'dashboards', configVersion)
  const [boards, setBoards] = useState<Board[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [boardLoading, setBoardLoading] = useState(false)
  const [boardError, setBoardError] = useState('')
  // Range toggle (kit's .seg). The backend currently returns one set of values per board
  // (no period parameter), so the toggle is visual-only for now — TODO below.
  const [range, setRange] = useState<Range>('30d')

  function loadBoards() {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    jget(token, '/dashboards')
      .then((d: Board[]) => {
        if (!alive) return
        const list = Array.isArray(d) ? d : []
        setBoards(list)
        if (list.length) setSelected(list[0].key)
      })
      .catch((e) => {
        if (!alive) return
        if (e instanceof FetchError && e.status === 403) { setDenied(true) }
        else { setError((e as Error).message) }
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }

  useEffect(loadBoards, [token])

  useEffect(() => {
    if (!selected) { setData(null); return }
    let alive = true
    setBoardLoading(true); setBoardError(''); setData(null)
    jget(token, `/dashboards/${selected}/data`)
      .then((d: BoardData) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setBoardError((e as Error).message) })
      .finally(() => { if (alive) setBoardLoading(false) })
    return () => { alive = false }
  }, [token, selected])

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to view dashboards." />
  if (error) return <ErrorBanner message={error} onRetry={loadBoards} />

  const activeBoard = boards.find((b) => b.key === selected)

  // Split widgets by type so we can render KPIs in the .kpis strip and everything
  // else (donut/line/bar/table) into the .cols / full-width cards below. Order is
  // preserved within each bucket so the board author's intent stays visible.
  const widgets = data?.widgets ?? []
  const kpiWidgets = widgets.filter((w) => w.type === 'kpi')
  const otherWidgets = widgets.filter((w) => w.type !== 'kpi')

  return (
    <div className="view">
      <div className="view-inner gx-dash fade">
        <ViewHead
          icon={<ChartIcon size={20} />}
          title={cfg.title}
          sub={activeBoard?.description ?? activeBoard?.label ?? 'Live metrics and KPIs'}
          actions={
            <div className="seg" role="tablist" aria-label="Range">
              <button
                type="button"
                className={range === '30d' ? 'on' : ''}
                onClick={() => setRange('30d')}
                aria-pressed={range === '30d'}
              >30d</button>
              <button
                type="button"
                className={range === 'qtd' ? 'on' : ''}
                onClick={() => setRange('qtd')}
                aria-pressed={range === 'qtd'}
                title="TODO — backend endpoint does not yet accept a period; QTD/YTD currently show the same data as 30d."
              >QTD</button>
              <button
                type="button"
                className={range === 'ytd' ? 'on' : ''}
                onClick={() => setRange('ytd')}
                aria-pressed={range === 'ytd'}
                title="TODO — backend endpoint does not yet accept a period; QTD/YTD currently show the same data as 30d."
              >YTD</button>
            </div>
          }
        />

        {boards.length === 0 && <EmptyState title="No dashboards configured yet." message="Ask an admin to configure a dashboard for your role." />}

        {boards.length > 0 && (
          <div className="tabs">
            {boards.map((b) => (
              <button
                key={b.key}
                className={'tab' + (selected === b.key ? ' on' : '')}
                onClick={() => setSelected(b.key)}
                title={b.description ?? ''}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}

        {boardLoading && <LoadingState />}
        {boardError && <ErrorBanner message={boardError} />}

        {!boardLoading && !boardError && data && widgets.length === 0 && (
          <EmptyState
            title="This board has no widgets."
            message="Add widgets in Studio to populate this dashboard."
          />
        )}

        {/* KPI strip — first KPI gets the gold marquee accent. Why first?
            Board authors place their headline metric first by convention (see
            kit's ModuleDashboard, which marks index 1 of 4 with the gold mark;
            we follow the same instinct: the first KPI is the one a viewer
            looks at first, so it earns the accent). */}
        {kpiWidgets.length > 0 && (
          <div className="kpis">
            {kpiWidgets.map((w, i) => (
              <KpiTile key={w.widget_key} w={w} marquee={i === 0} />
            ))}
          </div>
        )}

        {/* Body — donuts/lines/bars/tables. Two-column when there are at least
            two non-KPI widgets, otherwise a single full-width card. The kit's
            `.cols` is 1.6fr / 1fr (chart-heavy on the left, breakdown on the
            right). Widgets beyond two cascade into additional rows. */}
        {otherWidgets.length === 1 && (
          <div className="card" style={{ marginTop: 4 }}>
            <WidgetCard w={otherWidgets[0]} />
          </div>
        )}
        {otherWidgets.length >= 2 && (
          <>
            <div className="cols">
              <div className="card"><WidgetCard w={otherWidgets[0]} /></div>
              <div className="card"><WidgetCard w={otherWidgets[1]} /></div>
            </div>
            {otherWidgets.slice(2).map((w) => (
              <div className="card" key={w.widget_key} style={{ marginTop: 18 }}>
                <WidgetCard w={w} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── KPI tile ─────────────────────────
// Reads {value, delta?, deltaPositive?, sparkValues?} from the widget result.
// All extra fields are optional — if the backend only returns {value}, we render
// the value and skip the delta/spark. (TODO: standardize the KPI payload shape
// so deltas are returned consistently from every widget evaluator.)
function KpiTile({ w, marquee }: { w: WidgetOut; marquee?: boolean }) {
  if (w.error) {
    return (
      <div className={'kpi' + (marquee ? ' kpi--marquee' : '')}>
        <div className="klbl">{w.label}</div>
        <ErrorBanner message={friendlyError(w.error)} />
      </div>
    )
  }
  const v = kpiValue(w.result)
  const r: any = w.result || {}
  const delta: string | undefined = typeof r.delta === 'string' ? r.delta : undefined
  const deltaPositive: boolean | undefined =
    typeof r.deltaPositive === 'boolean' ? r.deltaPositive : undefined
  const sparkValues: number[] | undefined = Array.isArray(r.sparkValues)
    ? r.sparkValues.map((n: any) => Number(n) || 0)
    : undefined
  const cls = 'kpi' + (marquee ? ' kpi--marquee' : '')
  return (
    <div className={cls}>
      <div className="klbl">{w.label}</div>
      <div className="kval tnum">{fmtNum(v)}</div>
      <div className="kfoot">
        {delta ? (
          <span className={'kdelta ' + (deltaPositive ? 'up' : 'down')}>
            {deltaPositive ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />}
            {delta}
          </span>
        ) : (
          <span className="kdelta" style={{ color: 'var(--gx-text-3)' }}>—</span>
        )}
        <Spark
          values={sparkValues}
          color={
            marquee
              ? 'var(--gx-gold)'
              : deltaPositive === false
                ? 'var(--gx-danger)'
                : 'var(--gx-success)'
          }
        />
      </div>
    </div>
  )
}

// ───────────────────────── Non-KPI widget card ─────────────────────────
// Wraps a donut/line/bar/table widget with the kit's .card-head + .card-pad chrome.
function WidgetCard({ w }: { w: WidgetOut }) {
  return (
    <>
      <div className="card-head">
        <h3>{w.label}</h3>
      </div>
      <div className="card-pad">
        <NonKpiWidget w={w} />
      </div>
    </>
  )
}

function NonKpiWidget({ w }: { w: WidgetOut }) {
  if (w.error) return <ErrorBanner message={friendlyError(w.error)} />

  const groups = asGroups(w.result)
  if (groups.length === 0) return <EmptyState title="No data." />

  if (w.type === 'donut') return <DonutWidget groups={groups} />
  if (w.type === 'line') return <LineWidget groups={groups} />
  if (w.type === 'bar') return <BarWidget groups={groups} />
  if (w.type === 'table') return <GroupTable data={groups} />

  // unknown widget type → safe fallback to bars (same as the previous behaviour)
  return <BarWidget groups={groups} />
}

function DonutWidget({ groups }: { groups: Group[] }) {
  const data: DonutDatum[] = useMemo(
    () => groups.map((g) => ({ label: g.group, value: g.value })),
    [groups],
  )
  const total = groups.reduce((s, g) => s + g.value, 0)
  return (
    <Donut data={data} centerLabel={fmtNum(total)} centerCaption="total" />
  )
}

// Renders bar/line widgets as a LineChart for visual consistency with the kit.
// "Current" is the live series; "Prior" is a stubbed comparison until the backend
// returns prior-period data. We mark Prior as dashed so it's visually distinct
// without claiming it's real data.
function LineWidget({ groups }: { groups: Group[] }) {
  const values = groups.map((g) => g.value)
  const prior = values.map((v) => Math.round(v * 0.86)) // TODO: real prior-period series
  return (
    <LineChart
      series={[
        { label: 'Current', values, color: 'var(--viz-1)', fillUnder: true },
        { label: 'Prior (stub)', values: prior, color: 'var(--viz-2)', dashed: true },
      ]}
    />
  )
}

// Keeps the original "bars" feel for `bar` widgets (categorical breakdown) by
// reusing the inline CSS `.bars` rules that already exist in styles.css.
function BarWidget({ groups }: { groups: Group[] }) {
  const max = groups.reduce((m, d) => Math.max(m, d.value), 0)
  return (
    <div className="bars">
      {groups.map((d, i) => (
        <div key={i} className="bar-row">
          <span className="bar-label" title={d.group}>{d.group}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: (max > 0 ? (d.value / max) * 100 : 0) + '%' }} />
          </div>
          <span className="bar-val">{fmtNum(d.value)}</span>
        </div>
      ))}
    </div>
  )
}

function GroupTable({ data }: { data: Group[] }) {
  return (
    <div className="grid-wrap"><table className="grid">
      <thead><tr><th scope="col">Group</th><th scope="col">Value</th></tr></thead>
      <tbody>
        {data.map((d, i) => (
          <tr key={i}><td>{d.group}</td><td>{fmtNum(d.value)}</td></tr>
        ))}
      </tbody>
    </table></div>
  )
}
