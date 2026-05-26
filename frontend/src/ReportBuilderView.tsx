import { useEffect, useState } from 'react'
import { getEntityDef } from './api'
import { bget, bpost, type Fetched } from './billing'   // reuse the generic auth'd fetch helpers
import { toast } from './Toast'
import { confirmDialog } from './Modal'
import { EmptyState, ErrorBanner } from './States'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

type Entity = { key: string; label: string; label_plural: string; route_slug: string }
type Field = { key: string; label: string; type: string }
type Query = { entity: string; metric: string; field?: string; group_by?: string; filter?: string }
type Report = { id: string; key: string; name: string; description?: string | null; query: Query; shared: boolean; mine: boolean }
type RunResult = { id: string; name: string; matched?: number; result?: any; error?: string }
type Group = { group: string; value: number }

const METRICS = ['count', 'sum', 'avg']
const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

function asGroups(result: any): Group[] {
  if (Array.isArray(result)) return result.map((d) => ({ group: String(d.group ?? '—'), value: Number(d.value) || 0 }))
  return []
}

export default function ReportBuilderView({ token, entities }: { token: string; entities: Entity[] }) {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [run, setRun] = useState<RunResult | null>(null)
  const [building, setBuilding] = useState(false)

  // builder form
  const [name, setName] = useState('')
  const [entity, setEntity] = useState('')
  const [metric, setMetric] = useState('count')
  const [field, setField] = useState('')
  const [groupBy, setGroupBy] = useState('')
  const [filter, setFilter] = useState('')
  const [shared, setShared] = useState(false)
  const [fields, setFields] = useState<Field[]>([])

  async function loadReports() {
    setError(''); setUnavailable(false); setReports(null)
    const res: Fetched<Report[]> = await bget(token, '/api/reports-builder')
    if (res.status === 404) { setUnavailable(true); setReports([]); return }
    if (!res.ok) { setError('Failed to load reports'); setReports([]); return }
    setReports(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { loadReports() }, [token])

  // load the chosen entity's fields for the field/group-by pickers
  useEffect(() => {
    if (!entity) { setFields([]); return }
    const ent = entities.find((e) => e.key === entity)
    if (!ent) { setFields([]); return }
    let alive = true
    getEntityDef(token, ent.route_slug)
      .then((d: any) => { if (alive) setFields((d.fields ?? []).filter((f: Field) => f.type !== 'status')) })
      .catch(() => { if (alive) setFields([]) })
    return () => { alive = false }
  }, [token, entity, entities])

  async function doRun(id: string) {
    try {
      const res: Fetched<RunResult> = await bget(token, `/api/reports-builder/${id}/run`)
      if (!res.ok || !res.data) throw new Error('Failed to run report')
      setRun(res.data)
    } catch (e) { toast.error((e as Error).message) }
  }

  async function save() {
    if (!name.trim() || !entity) return
    const query: Query = { entity, metric }
    if (field && metric !== 'count') query.field = field
    if (groupBy) query.group_by = groupBy
    if (filter.trim()) query.filter = filter.trim()
    try {
      const created = await bpost<Report>(token, '/api/reports-builder', { key: slugify(name), name: name.trim(), query, shared })
      toast.success('Report saved')
      setBuilding(false)
      setName(''); setEntity(''); setMetric('count'); setField(''); setGroupBy(''); setFilter(''); setShared(false)
      await loadReports()
      if (created?.id) doRun(created.id)
    } catch (e) { toast.error((e as Error).message) }
  }

  async function remove(r: Report) {
    const ok = await confirmDialog({ title: `Delete ${r.name}`, message: 'Delete this report?', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      const resp = await fetch(`${BASE}/api/reports-builder/${r.id}`, { method: 'DELETE', headers: authH(token) })
      if (!resp.ok) throw new Error(`Delete failed (${resp.status})`)
      toast.success('Report deleted')
      if (run?.id === r.id) setRun(null)
      await loadReports()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div>
      <div className="view-head">
        <h2>Report Builder</h2>
        {!unavailable && <button className="btn btn-primary btn-md" onClick={() => setBuilding((b) => !b)}>{building ? 'Close' : '+ New report'}</button>}
      </div>

      {building && (
        <div className="rec-form">
          <label className="field"><span>Name *</span><input className="inp inp-md" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leads by status" /></label>
          <label className="field"><span>Entity *</span>
            <select className="inp inp-md" value={entity} onChange={(e) => { setEntity(e.target.value); setField(''); setGroupBy('') }}>
              <option value="">— pick —</option>
              {entities.map((en) => <option key={en.key} value={en.key}>{en.label_plural}</option>)}
            </select>
          </label>
          <label className="field"><span>Metric</span>
            <select className="inp inp-md" value={metric} onChange={(e) => setMetric(e.target.value)}>
              {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          {metric !== 'count' && (
            <label className="field"><span>Field</span>
              <select className="inp inp-md" value={field} onChange={(e) => setField(e.target.value)}>
                <option value="">— pick —</option>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
          )}
          <label className="field"><span>Group by</span>
            <select className="inp inp-md" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="">— none —</option>
              <option value="status">status</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Filter (GXL)</span><input className="inp inp-md" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="status == 'NEW'" /></label>
          <label className="field"><span>Shared</span><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /></label>
          <div className="rec-form-actions"><button className="btn btn-accent btn-md" onClick={save} disabled={!name.trim() || !entity}>Save report</button></div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={loadReports} />}
      {reports === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState title="Report builder isn't available yet" message="Saved reports will appear here once the endpoint is enabled." />}
      {reports && !unavailable && reports.length === 0 && !error && (
        <EmptyState title="No reports yet" message="Build one to save a re-runnable aggregation." />
      )}

      {reports && reports.length > 0 && (
        <div className="rb-layout">
          <div className="rb-list">
            {reports.map((r) => (
              <div key={r.id} className={'rb-item' + (run?.id === r.id ? ' on' : '')}>
                <button className="rb-item-main" onClick={() => doRun(r.id)}>
                  <span className="rb-name">{r.name}</span>
                  <span className="rb-badges">
                    <span className="pill pill-muted">{r.query.metric}</span>
                    {r.shared ? <span className="pill">shared</span> : <span className="pill pill-muted">mine</span>}
                  </span>
                </button>
                {(r.mine || r.shared) && <button className="btn btn-danger btn-sm" aria-label="Delete report" onClick={() => remove(r)}>Delete</button>}
              </div>
            ))}
          </div>

          <div className="rb-result">
            {!run && <p className="muted">Select a report to run it.</p>}
            {run && run.error && <ErrorBanner message={run.error === 'forbidden' ? "You can't view this report's data." : run.error} />}
            {run && !run.error && <RunView run={run} />}
          </div>
        </div>
      )}
    </div>
  )
}

function RunView({ run }: { run: RunResult }) {
  const fmt = (n: number) => n.toLocaleString('en-US')
  const result = run.result
  const groups = asGroups(result)
  const isValue = result && typeof result === 'object' && 'value' in result

  return (
    <div className="widget">
      <div className="widget-label">{run.name}{run.matched != null ? ` · ${run.matched} records` : ''}</div>
      {isValue && <div className="kpi">{fmt(Number(result.value) || 0)}</div>}
      {!isValue && groups.length === 0 && <p className="muted">No data.</p>}
      {!isValue && groups.length > 0 && (
        <>
          <div className="bars">
            {(() => {
              const max = groups.reduce((m, g) => Math.max(m, g.value), 0)
              return groups.map((g, i) => (
                <div key={i} className="bar-row">
                  <span className="bar-label" title={g.group}>{g.group}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: (max > 0 ? (g.value / max) * 100 : 0) + '%' }} /></div>
                  <span className="bar-val">{fmt(g.value)}</span>
                </div>
              ))
            })()}
          </div>
        </>
      )}
    </div>
  )
}
