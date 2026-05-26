import { useEffect, useState } from 'react'
import { WarningIcon } from './icons'

// Dashboards — picks a board and renders its config-driven widgets from /dashboards/{key}/data.
// Self-contained inline fetch (same pattern as api.ts / ReportsView). No chart library: KPIs are
// big numbers, bar/donut are CSS + inline-SVG, table is a plain grid. A widget that returns
// {error} is shown gracefully and never crashes the board.
const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Board = { key: string; label: string; description?: string | null; order: number }
type WidgetOut = { widget_key: string; type: string; label: string; result?: any; error?: string }
type BoardData = { key: string; label: string; widgets: WidgetOut[] }
type Group = { group: string; value: number }

// Categorical chart palette — brand hues only (see BRAND.md): cobalt, gold, mint, amber,
// crimson, then derived cobalt/gold steps and a neutral. No off-palette colors.
const PALETTE = ['#3A6FB5', '#C5A059', '#2ECC71', '#F5A623', '#E63946', '#4A82CC', '#D4B26C', '#AEB7C2']

async function jget(token: string, path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: authH(token) })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    throw new Error(e.detail || `Failed to load ${path}`)
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

export default function DashboardView({ token }: { token: string }) {
  const [boards, setBoards] = useState<Board[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [boardLoading, setBoardLoading] = useState(false)
  const [boardError, setBoardError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    jget(token, '/dashboards')
      .then((d: Board[]) => {
        if (!alive) return
        const list = Array.isArray(d) ? d : []
        setBoards(list)
        if (list.length) setSelected(list[0].key)
      })
      .catch((e) => { if (alive) setError((e as Error).message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

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

  if (loading) return <p className="muted">Loading…</p>
  if (error) return <p className="err">{error}</p>

  return (
    <div>
      <div className="view-head"><h2>Dashboards</h2></div>

      {boards.length === 0 && <p className="muted">No dashboards configured yet.</p>}

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

      {boardLoading && <p className="muted">Loading…</p>}
      {boardError && <p className="err">{boardError}</p>}

      {!boardLoading && !boardError && data && (
        <div className="widgets">
          {data.widgets.length === 0 && <p className="muted">This board has no widgets.</p>}
          {data.widgets.map((w) => (
            <div key={w.widget_key} className={'widget' + (w.type === 'kpi' ? ' widget-kpi' : '')}>
              <div className="widget-label">{w.label}</div>
              <Widget w={w} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Widget({ w }: { w: WidgetOut }) {
  if (w.error) return <p className="err widget-err"><WarningIcon size={14} /> {friendlyError(w.error)}</p>

  if (w.type === 'kpi') return <div className="kpi">{fmtNum(kpiValue(w.result))}</div>

  const groups = asGroups(w.result)
  if (groups.length === 0) return <p className="muted">No data.</p>

  if (w.type === 'donut') return <Donut data={groups} />
  if (w.type === 'bar' || w.type === 'line') return <Bars data={groups} />
  if (w.type === 'table') return <GroupTable data={groups} />

  // unknown widget type → safe fallback
  return <Bars data={groups} />
}

function Bars({ data }: { data: Group[] }) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0)
  return (
    <div className="bars">
      {data.map((d, i) => (
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
    <table className="grid">
      <thead><tr><th>Group</th><th>Value</th></tr></thead>
      <tbody>
        {data.map((d, i) => (
          <tr key={i}><td>{d.group}</td><td>{fmtNum(d.value)}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

function Donut({ data }: { data: Group[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const R = 42
  const C = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 100 100" className="donut" role="img">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#262D37" strokeWidth="14" />
        {total > 0 && data.map((d, i) => {
          const len = (d.value / total) * C
          const seg = (
            <circle
              key={i}
              cx="50" cy="50" r={R} fill="none"
              stroke={PALETTE[i % PALETTE.length]} strokeWidth="14"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          )
          offset += len
          return seg
        })}
        <text x="50" y="53" textAnchor="middle" className="donut-total">{fmtNum(total)}</text>
      </svg>
      <div className="legend">
        {data.map((d, i) => (
          <div key={i} className="legend-row">
            <span className="legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="legend-name" title={d.group}>{d.group}</span>
            <span className="legend-val">{fmtNum(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
