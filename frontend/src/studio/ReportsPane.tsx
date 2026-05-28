import { useEffect, useState } from 'react'
import { LoadingState, EmptyState, ErrorBanner, PermissionDenied } from '../States'
import {
  DownloadIcon, PlusIcon, EditIcon, TrashIcon, PlayIcon,
  CloseIcon, CalendarIcon, PauseIcon, CheckIcon, InfoIcon,
  ChartIcon, ArrowRightIcon,
} from '../icons'

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: 'Bearer ' + token })

// ── Types ─────────────────────────────────────────────────────────────────────

type Entity = { key: string; label: string }
type Query = { entity: string; metric: string; field?: string; group_by?: string; filter?: string }
type Report = {
  id: string; key: string; name: string
  description?: string | null; query: Query; shared: boolean; mine: boolean
}
type RunResult = { id: string; name: string; matched?: number; result?: any; error?: string }
type Schedule = {
  id: string; report_id: string; cadence: string; channel: string
  recipients: string[]; status: string; next_run_at?: string | null; created_at?: string | null
}

// ── FetchError ────────────────────────────────────────────────────────────────

class FetchError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function jreq(token: string, path: string, method = 'GET', body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { ...authH(token), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  const r = await fetch(`${BASE}${path}`, opts)
  if (r.status === 204) return null
  const data = await r.json().catch(() => ({ detail: 'Error' }))
  if (!r.ok) throw new FetchError(data.detail || `Request failed (${r.status})`, r.status)
  return data
}

const METRICS = ['count', 'sum', 'avg']
const CADENCES = ['daily', 'weekly', 'monthly']

function fmtDt(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

// ── Main pane ─────────────────────────────────────────────────────────────────

export default function ReportsPane({ token }: { token: string }) {
  const [tab, setTab] = useState<'reports' | 'schedules'>('reports')

  return (
    <div>
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>Reports</h3>
          <p className="hint" style={{ margin: 0 }}>
            Saved report definitions, run results, and delivery schedules.
          </p>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={'tab' + (tab === 'reports' ? ' on' : '')} onClick={() => setTab('reports')}>
          Definitions
        </button>
        <button className={'tab' + (tab === 'schedules' ? ' on' : '')} onClick={() => setTab('schedules')}>
          Schedules
        </button>
      </div>

      {tab === 'reports' && <ReportsList token={token} />}
      {tab === 'schedules' && <SchedulesList token={token} />}
    </div>
  )
}

// ── Reports list + CRUD ───────────────────────────────────────────────────────

function ReportsList({ token }: { token: string }) {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [entities, setEntities] = useState<Entity[]>([])

  // run result state
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [runError, setRunError] = useState('')

  // editor state
  const [editing, setEditing] = useState<Report | null>(null)    // non-null = edit mode
  const [creating, setCreating] = useState(false)

  function load() {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    Promise.all([
      jreq(token, '/api/reports-builder'),
      jreq(token, '/meta/entities').catch(() => []),
    ])
      .then(([reps, ents]) => {
        if (!alive) return
        setReports(Array.isArray(reps) ? reps : [])
        setEntities(Array.isArray(ents) ? ents : [])
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof FetchError && e.status === 403) setDenied(true)
        else setError((e as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }

  useEffect(load, [token])

  async function runReport(id: string) {
    setRunning(id); setRunResult(null); setRunError('')
    try {
      const res = await jreq(token, `/api/reports-builder/${id}/run`)
      setRunResult(res)
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  async function deleteReport(r: Report) {
    if (!confirm(`Delete report "${r.name}"?`)) return
    try {
      await jreq(token, `/api/reports-builder/${r.id}`, 'DELETE')
      setReports((prev) => (prev ?? []).filter((x) => x.id !== r.id))
      if (runResult?.id === r.id) setRunResult(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to view reports." />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  return (
    <div>
      <div className="section-head" style={{ marginTop: 0 }}>
        <DownloadIcon size={15} className="section-icon" /> Saved reports
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => { setCreating(true); setEditing(null) }}>
          <PlusIcon size={13} /> New report
        </button>
      </div>

      {(creating || editing) && (
        <ReportForm
          token={token}
          entities={entities}
          initial={editing ?? undefined}
          onSaved={(r) => {
            if (editing) {
              setReports((prev) => (prev ?? []).map((x) => (x.id === r.id ? r : x)))
            } else {
              setReports((prev) => [...(prev ?? []), r])
            }
            setCreating(false); setEditing(null)
          }}
          onCancel={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {!creating && !editing && (
        <>
          {(reports ?? []).length === 0 && (
            <EmptyState title="No reports yet." message="Create a report definition to save and re-run aggregations." />
          )}

          {(reports ?? []).length > 0 && (
            <div className="grid-wrap">
              <table className="grid studio">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Metric</th>
                    <th scope="col">Scope</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {(reports ?? []).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                        {r.description && <div className="hint" style={{ fontSize: 11 }}>{r.description}</div>}
                      </td>
                      <td><code className="mono">{r.query?.entity ?? '—'}</code></td>
                      <td>{r.query?.metric ?? 'count'}</td>
                      <td>{r.shared ? 'Shared' : 'Private'}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Run report"
                            disabled={running === r.id}
                            onClick={() => runReport(r.id)}
                          >
                            <PlayIcon size={13} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Edit"
                            onClick={() => { setEditing(r); setCreating(false) }}
                          >
                            <EditIcon size={13} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Delete"
                            onClick={() => deleteReport(r)}
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {runError && <ErrorBanner message={runError} />}

          {runResult && (
            <div style={{ marginTop: 20 }}>
              <div className="section-head">
                <ChartIcon size={15} className="section-icon" /> Run result — {runResult.name}
                <span className="spacer" />
                <button className="btn btn-ghost btn-sm" onClick={() => setRunResult(null)}>
                  <CloseIcon size={13} />
                </button>
              </div>

              {runResult.error ? (
                <ErrorBanner message={runResult.error} />
              ) : (
                <RunResultTable result={runResult} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Run result table ──────────────────────────────────────────────────────────

function RunResultTable({ result }: { result: RunResult }) {
  const matched = result.matched ?? 0
  const raw = result.result

  const rows: { group: string; value: number }[] = Array.isArray(raw)
    ? raw.map((d: any) => ({ group: String(d.group ?? '—'), value: Number(d.value) || 0 }))
    : raw && typeof raw === 'object' && 'value' in raw
      ? [{ group: 'Total', value: Number(raw.value) || 0 }]
      : []

  return (
    <div>
      <p className="hint" style={{ marginBottom: 8 }}>
        Matched {matched.toLocaleString()} record{matched !== 1 ? 's' : ''}.
      </p>
      {rows.length === 0 ? (
        <EmptyState title="No data returned." />
      ) : (
        <div className="grid-wrap">
          <table className="grid studio">
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.group}</td>
                  <td>{r.value.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Report create / edit form ─────────────────────────────────────────────────

function ReportForm({
  token, entities, initial, onSaved, onCancel,
}: {
  token: string
  entities: Entity[]
  initial?: Report
  onSaved: (r: Report) => void
  onCancel: () => void
}) {
  const isEdit = !!initial

  const [name, setName] = useState(initial?.name ?? '')
  const [key, setKey] = useState(initial?.key ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [entity, setEntity] = useState(initial?.query?.entity ?? '')
  const [metric, setMetric] = useState(initial?.query?.metric ?? 'count')
  const [field, setField] = useState(initial?.query?.field ?? '')
  const [groupBy, setGroupBy] = useState(initial?.query?.group_by ?? '')
  const [filter, setFilter] = useState(initial?.query?.filter ?? '')
  const [shared, setShared] = useState(initial?.shared ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      const query: Query = {
        entity,
        metric,
        ...(field.trim() ? { field: field.trim() } : {}),
        ...(groupBy.trim() ? { group_by: groupBy.trim() } : {}),
        ...(filter.trim() ? { filter: filter.trim() } : {}),
      }
      let saved: Report
      if (isEdit) {
        saved = await jreq(token, `/api/reports-builder/${initial!.id}`, 'PATCH', {
          name: name.trim(),
          description: description.trim() || null,
          query,
        })
      } else {
        saved = await jreq(token, '/api/reports-builder', 'POST', {
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || null,
          query,
          shared,
        })
      }
      onSaved(saved)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: 24, padding: '16px 20px', background: 'var(--surface-2)', borderRadius: 8 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <strong>{isEdit ? 'Edit report' : 'New report'}</strong>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          <CloseIcon size={13} />
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      <form onSubmit={submit}>
        <div className="rec-form">
          {!isEdit && (
            <label className="field">
              <span>Key (snake_case) *</span>
              <input
                className="inp inp-md"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="monthly_revenue"
                required
              />
            </label>
          )}
          <label className="field">
            <span>Name *</span>
            <input
              className="inp inp-md"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Monthly Revenue"
              required
            />
          </label>
          <label className="field">
            <span>Description</span>
            <input
              className="inp inp-md"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional summary"
            />
          </label>
        </div>

        <div className="section-head" style={{ marginTop: 14 }}>
          <ArrowRightIcon size={14} className="section-icon" /> Query
        </div>
        <div className="rec-form">
          <label className="field">
            <span>Entity *</span>
            <select
              className="inp inp-md"
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              required
            >
              <option value="">— pick entity —</option>
              {entities.map((en) => (
                <option key={en.key} value={en.key}>{en.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Metric</span>
            <select className="inp inp-md" value={metric} onChange={(e) => setMetric(e.target.value)}>
              {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Field (for sum/avg)</span>
            <input
              className="inp inp-md"
              value={field}
              onChange={(e) => setField(e.target.value)}
              placeholder="amount"
            />
          </label>
          <label className="field">
            <span>Group by</span>
            <input
              className="inp inp-md"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              placeholder="status"
            />
          </label>
          <label className="field">
            <span>Filter (GXL expression)</span>
            <input
              className="inp inp-md"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="status == 'ACTIVE'"
            />
          </label>
          {!isEdit && (
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              <span>Shared (tenant-wide)</span>
            </label>
          )}
        </div>

        <div className="row" style={{ marginTop: 16, gap: 8 }}>
          <button type="submit" className="btn btn-accent btn-sm" disabled={saving}>
            <CheckIcon size={13} /> {isEdit ? 'Save changes' : 'Create report'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Schedules list + CRUD ─────────────────────────────────────────────────────

function SchedulesList({ token }: { token: string }) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [creating, setCreating] = useState(false)

  function load() {
    let alive = true
    setLoading(true); setError(''); setDenied(false)
    Promise.all([
      jreq(token, '/api/report-schedules'),
      jreq(token, '/api/reports-builder').catch(() => []),
    ])
      .then(([scheds, reps]) => {
        if (!alive) return
        setSchedules(Array.isArray(scheds) ? scheds : [])
        setReports(Array.isArray(reps) ? reps : [])
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof FetchError && e.status === 403) setDenied(true)
        else setError((e as Error).message)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }

  useEffect(load, [token])

  async function toggleStatus(s: Schedule) {
    const newStatus = s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    const endpoint = newStatus === 'PAUSED'
      ? `/api/report-schedules/${s.id}/pause`
      : `/api/report-schedules/${s.id}/resume`
    try {
      const updated = await jreq(token, endpoint, 'POST')
      setSchedules((prev) => (prev ?? []).map((x) => (x.id === s.id ? updated : x)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function deleteSchedule(s: Schedule) {
    const rName = reports.find((r) => r.id === s.report_id)?.name ?? s.report_id
    if (!confirm(`Delete schedule for "${rName}"?`)) return
    try {
      await jreq(token, `/api/report-schedules/${s.id}`, 'DELETE')
      setSchedules((prev) => (prev ?? []).filter((x) => x.id !== s.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <LoadingState />
  if (denied) return <PermissionDenied message="You don't have permission to view report schedules." />
  if (error) return <ErrorBanner message={error} onRetry={load} />

  const reportName = (id: string) => reports.find((r) => r.id === id)?.name ?? id

  return (
    <div>
      <div className="section-head" style={{ marginTop: 0 }}>
        <CalendarIcon size={15} className="section-icon" /> Report schedules
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <PlusIcon size={13} /> New schedule
        </button>
      </div>

      {creating && (
        <ScheduleForm
          token={token}
          reports={reports}
          onSaved={(s) => { setSchedules((prev) => [s, ...(prev ?? [])]); setCreating(false) }}
          onCancel={() => setCreating(false)}
        />
      )}

      {!creating && (
        <>
          {(schedules ?? []).length === 0 && (
            <EmptyState
              title="No schedules yet."
              message="Schedule a report for automatic recurring delivery."
            />
          )}

          {(schedules ?? []).length > 0 && (
            <div className="grid-wrap">
              <table className="grid studio">
                <thead>
                  <tr>
                    <th scope="col">Report</th>
                    <th scope="col">Cadence</th>
                    <th scope="col">Channel</th>
                    <th scope="col">Recipients</th>
                    <th scope="col">Status</th>
                    <th scope="col">Next run</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {(schedules ?? []).map((s) => (
                    <tr key={s.id}>
                      <td>{reportName(s.report_id)}</td>
                      <td>{s.cadence}</td>
                      <td>{s.channel}</td>
                      <td>
                        {s.recipients.length > 0
                          ? s.recipients.join(', ')
                          : <span className="hint">—</span>}
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: s.status === 'ACTIVE' ? 'var(--success-soft)' : 'var(--surface-2)',
                          color: s.status === 'ACTIVE' ? 'var(--success)' : 'var(--text-3)',
                        }}>
                          {s.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{fmtDt(s.next_run_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            title={s.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                            onClick={() => toggleStatus(s)}
                          >
                            {s.status === 'ACTIVE' ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Delete"
                            onClick={() => deleteSchedule(s)}
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Schedule create form ──────────────────────────────────────────────────────

function ScheduleForm({
  token, reports, onSaved, onCancel,
}: {
  token: string
  reports: Report[]
  onSaved: (s: Schedule) => void
  onCancel: () => void
}) {
  const [reportId, setReportId] = useState(reports[0]?.id ?? '')
  const [cadence, setCadence] = useState('daily')
  const [channel, setChannel] = useState('email')
  const [recipients, setRecipients] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSaving(true)
    try {
      const recList = recipients.split(',').map((r) => r.trim()).filter(Boolean)
      const saved = await jreq(token, '/api/report-schedules', 'POST', {
        report_id: reportId,
        cadence,
        channel,
        recipients: recList,
      })
      onSaved(saved)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: 24, padding: '16px 20px', background: 'var(--surface-2)', borderRadius: 8 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <strong>New schedule</strong>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          <CloseIcon size={13} />
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {reports.length === 0 ? (
        <div className="error-banner" style={{ borderLeftColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
          <InfoIcon size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span>No reports available. Create a report definition first.</span>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="rec-form">
            <label className="field">
              <span>Report *</span>
              <select className="inp inp-md" value={reportId} onChange={(e) => setReportId(e.target.value)} required>
                {reports.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Cadence *</span>
              <select className="inp inp-md" value={cadence} onChange={(e) => setCadence(e.target.value)}>
                {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Channel *</span>
              <input
                className="inp inp-md"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="email"
                required
              />
            </label>
            <label className="field">
              <span>Recipients (comma-separated)</span>
              <input
                className="inp inp-md"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="ops@example.com, mgr@example.com"
              />
              <span className="hint">Leave empty to send to the channel default.</span>
            </label>
          </div>

          <div className="row" style={{ marginTop: 16, gap: 8 }}>
            <button type="submit" className="btn btn-accent btn-sm" disabled={saving}>
              <CheckIcon size={13} /> Create schedule
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
