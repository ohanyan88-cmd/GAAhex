import { useEffect, useMemo, useState } from 'react'
import { getEntityDef } from '../lib/api'
import { bget, bpost, type Fetched, BASE, authH } from '../lib/billing'   // reuse the generic auth'd fetch helpers
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Modal'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { t } from '../lib/i18n'
import { PageShell } from '../page-shell'
import ReportSchedulePanel from '../modals/ReportSchedulePanel'
import { EditIcon, PlusIcon, CloseIcon, TrashIcon } from '../components/icons'
import { Donut, type DonutDatum } from '../components/charts/Donut'
import { KPITile } from '../primitives'

// Report Builder — form-heavy wizard that pairs a builder form with a runner/preview.
// Reskinned into the kit pattern: `.view → .view-inner gx-dash → .crumbs → .view-head`,
// then a two-column body (`.cols`): builder/list on the left, run preview on the right.
// Form sections use the kit's `.rec-form` + `.field`; preview uses `.card` + `.kpis`/
// charts. Data hooks (bget/bpost against /api/reports-builder/*) are UNCHANGED.
//
// NOTE on exports: the saved-report run endpoint (/api/reports-builder/{id}/run) returns
// aggregated JSON only — it does NOT accept ?format=csv|xlsx|pdf. Per-format file export
// lives on the per-entity records route (/api/{slug}/export) and is surfaced from the
// EntityView. We therefore do NOT show export buttons here (no inert UI — see doctrine
// rule 4: "If a button has no real action yet, REMOVE it rather than fake it").

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

const fmtNum = (n: number) => n.toLocaleString('en-US')

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
    if (!res.ok) { setError(t('reports.loadError', 'Failed to load reports')); setReports([]); return }
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
      if (!res.ok || !res.data) throw new Error(t('reports.runError', 'Failed to run report'))
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
      toast.success(t('reports.saved', 'Report saved'))
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
      toast.success(t('reports.deleted', 'Report deleted'))
      if (run?.id === r.id) setRun(null)
      await loadReports()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <PageShell
      type="CONFIGURATION"
      breadcrumb={['Analytics & AI', 'Report Builder']}
      icon={<EditIcon size={20} />}
      title="Report Builder"
      subtitle="Build & configure saved reports"
      primaryAction={!unavailable ? {
        label: building ? 'Close' : 'New report',
        icon: building ? <CloseIcon size={13} /> : <PlusIcon size={13} />,
        onClick: () => setBuilding((b) => !b),
      } : undefined}
    >
        {/* Builder form — kit `.card` + `.rec-form` + `.field` pattern. */}
        {building && (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h3>New report</h3>
            </div>
            <div className="card-pad">
              <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
                <label className="field">
                  <span>Name <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
                  <input className="inp inp-md" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leads by status" />
                </label>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <label className="field" style={{ flex: 1, minWidth: 200 }}>
                    <span>Entity <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
                    <select className="inp inp-md" value={entity} onChange={(e) => { setEntity(e.target.value); setField(''); setGroupBy('') }}>
                      <option value="">— pick —</option>
                      {entities.map((en) => <option key={en.key} value={en.key}>{en.label_plural}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ flex: 1, minWidth: 140 }}>
                    <span>Metric</span>
                    <select className="inp inp-md" value={metric} onChange={(e) => setMetric(e.target.value)}>
                      {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                </div>

                {metric !== 'count' && (
                  <label className="field">
                    <span>Field</span>
                    <select className="inp inp-md" value={field} onChange={(e) => setField(e.target.value)}>
                      <option value="">— pick —</option>
                      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                )}

                <label className="field">
                  <span>Group by</span>
                  <select className="inp inp-md" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    <option value="">— none —</option>
                    <option value="status">status</option>
                    {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </label>

                <label className="field">
                  <span>Filter (GXL)</span>
                  <input className="inp inp-md" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="status == 'NEW'" />
                </label>

                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                  <span>Shared with all members</span>
                </label>
              </div>

              <div className="rec-form-actions" style={{ marginTop: 12 }}>
                <button className="btn btn-ghost btn-md" onClick={() => setBuilding(false)}>Cancel</button>
                <button className="btn btn-primary btn-md" onClick={save} disabled={!name.trim() || !entity}>Save report</button>
              </div>
            </div>
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={loadReports} />}
        {reports === null && !error && <SkeletonRows />}
        {unavailable && <EmptyState title={t('reports.unavailable', "Report builder isn't available yet")} message={t('reports.unavailableMsg', 'Saved reports will appear here once the endpoint is enabled.')} />}
        {reports && !unavailable && reports.length === 0 && !error && (
          <EmptyState title="No reports yet" message="Build one to save a re-runnable aggregation." />
        )}

        {/* Saved reports + run preview as a two-column dashboard body. */}
        {reports && reports.length > 0 && (
          <div className="cols">
            <div className="card">
              <div className="card-head">
                <h3>Saved reports</h3>
              </div>
              <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {reports.map((r) => (
                  <div
                    key={r.id}
                    className={'rb-item' + (run?.id === r.id ? ' on' : '')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px',
                      borderRadius: 'var(--gx-radius-md)',
                      background: run?.id === r.id ? 'var(--gx-surface-2)' : 'transparent',
                      // D18: active run-row outline = azure (interactive selection)
                      border: '1px solid ' + (run?.id === r.id ? 'var(--gx-interactive)' : 'var(--gx-border)'),
                    }}
                  >
                    <button
                      className="rb-item-main"
                      onClick={() => doRun(r.id)}
                      style={{
                        flex: 1, textAlign: 'left',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        background: 'transparent', border: 0, cursor: 'pointer', font: 'inherit', color: 'inherit',
                        padding: 0,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{r.name}</span>
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <span className="pill pill-neutral pill-sm">{r.query.metric}</span>
                        {r.shared
                          ? <span className="pill pill-info pill-sm">shared</span>
                          : <span className="pill pill-neutral pill-sm">mine</span>}
                      </span>
                    </button>
                    {(r.mine || r.shared) && (
                      <button
                        className="iconbtn"
                        aria-label="Delete report"
                        title="Delete report"
                        onClick={() => remove(r)}
                        style={{ color: 'var(--gx-danger-fg)' }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>{run ? `${run.name}${run.matched != null ? ` · ${run.matched} record${run.matched === 1 ? '' : 's'}` : ''}` : 'Preview'}</h3>
              </div>
              <div className="card-pad">
                {!run && <p className="muted">Select a report to run it.</p>}
                {run && run.error && <ErrorBanner message={run.error === 'forbidden' ? "You can't view this report's data." : run.error} />}
                {run && !run.error && <RunView run={run} />}
              </div>
            </div>
          </div>
        )}

        {/* B24 — schedule panel; degrades silently if /api/report-schedules 404s */}
        {!unavailable && reports && reports.length > 0 && (
          <ReportSchedulePanel
            token={token}
            reports={(reports ?? []).map((r) => ({ id: r.id, name: r.name }))}
          />
        )}
    </PageShell>
  )
}

function RunView({ run }: { run: RunResult }) {
  const result = run.result
  const groups = asGroups(result)
  const isValue = result && typeof result === 'object' && 'value' in result

  // Donut for grouped result (categorical), bars for the table view underneath.
  const donutData: DonutDatum[] = useMemo(
    () => groups.map((g) => ({ label: g.group, value: g.value })),
    [groups],
  )
  const total = groups.reduce((s, g) => s + g.value, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isValue && (
        <div className="kpi-strip" style={{ marginBottom: 0 }}>
          <KPITile
            label={run.name}
            value={fmtNum(Number(result.value) || 0)}
            size="sm"
          />
        </div>
      )}
      {!isValue && groups.length === 0 && <p className="muted">No data.</p>}
      {!isValue && groups.length > 0 && (
        <>
          <Donut data={donutData} centerLabel={fmtNum(total)} centerCaption="total" />
          <div className="bars">
            {(() => {
              const max = groups.reduce((m, g) => Math.max(m, g.value), 0)
              return groups.map((g, i) => (
                <div key={i} className="bar-row">
                  <span className="bar-label" title={g.group}>{g.group}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: (max > 0 ? (g.value / max) * 100 : 0) + '%' }} /></div>
                  <span className="bar-val tnum">{fmtNum(g.value)}</span>
                </div>
              ))
            })()}
          </div>
        </>
      )}
    </div>
  )
}
