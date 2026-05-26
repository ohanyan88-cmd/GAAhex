import { useEffect, useState } from 'react'
import { getEntityDef, createRecord, transitionRecord } from './api'
import RefPicker, { refTargetKey, loadRefLabels } from './RefPicker'
import { CheckIcon, ArrowRightIcon, SearchIcon, CloseIcon, WarningIcon, MessageIcon, ClockIcon, ReceiptIcon, SparkleIcon, UsersIcon } from './icons'
import { confirmDialog, Modal } from './Modal'
import { toast } from './Toast'
import CommentsModal from './CommentsModal'
import CustomerBillingModal from './CustomerBillingModal'
import AiAssistModal from './AiAssistModal'
import { Select, MultiSelect } from './Select'
import { EmptyState, PermissionDenied, NotFound } from './States'
import ActivityTimeline from './ActivityTimeline'
import { useI18n } from './i18n'

type Field = { key: string; label: string; type: string; required: boolean; order: number; config: any; editable?: boolean }
type Status = { key: string; label: string; order: number; is_initial: boolean }
type Transition = { from: string; to: string }
type Def = { key: string; label: string; label_plural: string; route_slug: string; fields: Field[]; statuses: Status[]; transitions: Transition[] }
type Row = Record<string, any>
type Mode = 'idle' | 'creating' | 'editing'
type SavedView = { id: string | number; name: string; q?: string; filter?: string; sort?: string }

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// Pull the offending field key out of a backend 422 message (e.g. "Invalid email for 'email'").
function errFieldOf(msg: string): string | null {
  const m = msg.match(/'([^']+)'/)
  return m ? m[1] : null
}

// PATCH lives here (api.ts is out of this lane) — same shape as api.ts's helpers.
async function patchRecord(token: string, slug: string, id: string, data: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/${slug}/${id}`, {
    method: 'PATCH',
    headers: { ...authH(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: 'Error' }))
    const d = e.detail ?? 'Error'
    throw new Error(typeof d === 'string' ? d : JSON.stringify(d))
  }
  return r.json()
}

// One generic component renders EVERY entity from its config — no per-entity code.
export default function EntityView({ token, slug, onOpenCustomer }: { token: string; slug: string; onOpenCustomer?: (id: string) => void }) {
  const { t } = useI18n()
  const [def, setDef] = useState<Def | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [form, setForm] = useState<Record<string, any>>({})
  const [mode, setMode] = useState<Mode>('idle')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingStatus, setEditingStatus] = useState<string | null>(null)
  const [refLabels, setRefLabels] = useState<Record<string, Record<string, string>>>({})
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // search / saved views (Task A contract: GET /api/{slug}?q=&filter=&sort= + /api/views)
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState('')
  const [views, setViews] = useState<SavedView[]>([])
  const [viewsAvailable, setViewsAvailable] = useState(false)
  const [activeView, setActiveView] = useState('')
  const [commentsRow, setCommentsRow] = useState<Row | null>(null)
  const [activityRow, setActivityRow] = useState<Row | null>(null)
  const [billingRow, setBillingRow] = useState<Row | null>(null)
  const [aiRow, setAiRow] = useState<Row | null>(null)
  const [fatal, setFatal] = useState<null | 'denied' | 'notfound'>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTo, setBulkTo] = useState('')

  async function load(s: string) {
    setLoading(true); setFatal(null)
    try {
      let d: Def
      try { d = await getEntityDef(token, s) } catch { setFatal('notfound'); return }
      setDef(d)
      // build the list request to A's contract; FastAPI ignores params an older build doesn't declare
      const params = new URLSearchParams()
      if (appliedQ) params.set('q', appliedQ)
      if (filter) params.set('filter', filter)
      if (sort) params.set('sort', sort)
      const qs = params.toString()
      const r = await fetch(`${BASE}/api/${s}${qs ? `?${qs}` : ''}`, { headers: authH(token) })
      if (r.status === 403) { setFatal('denied'); return }
      if (!r.ok) throw new Error('Failed to load records')
      setRows(await r.json())
      setSelected(new Set())          // clear selection whenever the list reloads
      // build { fieldKey -> { id -> label } } maps for every ref field, for the list display
      const maps: Record<string, Record<string, string>> = {}
      for (const f of d.fields.filter((x) => x.type === 'ref')) {
        const tk = refTargetKey(f.config)
        if (tk) maps[f.key] = await loadRefLabels(token, tk)
      }
      setRefLabels(maps)
    } finally {
      setLoading(false)
    }
  }

  // Saved views are optional: if /api/views isn't merged yet it 404s → hide the control quietly.
  async function loadViews(s: string) {
    try {
      const r = await fetch(`${BASE}/api/views?entity=${encodeURIComponent(s)}`, { headers: authH(token) })
      if (!r.ok) { setViewsAvailable(false); setViews([]); return }
      const data = await r.json()
      setViews(Array.isArray(data) ? data : [])
      setViewsAvailable(true)
    } catch {
      setViewsAvailable(false); setViews([])
    }
  }

  // slug change → reset view state, then load
  useEffect(() => {
    closeForm(); setError(''); setErrorField(null)
    setQ(''); setAppliedQ(''); setFilter(''); setSort(''); setActiveView('')
    loadViews(slug)
  }, [slug])

  // debounce the search box (~300ms)
  useEffect(() => {
    const id = setTimeout(() => setAppliedQ(q), 300)
    return () => clearTimeout(id)
  }, [q])

  // (re)fetch records on slug / applied search / filter / sort change
  useEffect(() => {
    load(slug).catch((e) => setError((e as Error).message))
  }, [slug, appliedQ, filter, sort])

  function closeForm() {
    setMode('idle'); setForm({}); setEditingId(null); setEditingStatus(null); setErrorField(null)
  }

  function openCreate() {
    setError(''); setErrorField(null); setForm({}); setEditingId(null); setEditingStatus(null); setMode('creating')
  }

  function openEdit(row: Row) {
    if (!def) return
    setError(''); setErrorField(null)
    const f: Record<string, any> = {}
    def.fields.forEach((fld) => { if (fld.type !== 'status') f[fld.key] = row[fld.key] ?? '' })
    setForm(f)
    setEditingId(row.id)
    setEditingStatus(row.status ?? null)
    setMode('editing')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setErrorField(null)
    try {
      const payload: Record<string, unknown> = {}
      def!.fields.forEach((f) => {
        if (f.type === 'status') return            // status is lifecycle-managed, never sent here
        if (f.editable === false) return           // read-only fields are never submitted
        const v = form[f.key]
        if (mode === 'creating') {
          if (v !== undefined && v !== '') payload[f.key] = v
        } else {
          if (v !== undefined) payload[f.key] = v  // editing: send all (allows clearing a field)
        }
      })
      const wasEditing = mode === 'editing'
      if (wasEditing && editingId) await patchRecord(token, slug, editingId, payload)
      else await createRecord(token, slug, payload)
      closeForm()
      await load(slug)
      toast.success(`${def!.label} ${wasEditing ? 'updated' : 'created'}`)
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      setErrorField(errFieldOf(msg))
    }
  }

  async function doTransition(id: string, to: string) {
    setError(''); setErrorField(null)
    try {
      await transitionRecord(token, slug, id, to)
      await load(slug)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function doDelete(row: Row) {
    const ok = await confirmDialog({
      title: `Delete ${def!.label}`,
      message: `Delete this ${def!.label}? This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setError(''); setErrorField(null)
    try {
      const r = await fetch(`${BASE}/api/${slug}/${row.id}`, { method: 'DELETE', headers: authH(token) })
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: r.status === 403 ? 'Not allowed to delete this record' : 'Error' }))
        const d = e.detail ?? 'Error'
        throw new Error(typeof d === 'string' ? d : JSON.stringify(d))
      }
      if (editingId === row.id) closeForm()
      await load(slug)
      toast.success(`${def!.label} deleted`)
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      toast.error(msg)
    }
  }

  async function saveView() {
    const name = window.prompt('Save current view as:')
    if (!name || !name.trim()) return
    try {
      const r = await fetch(`${BASE}/api/views`, {
        method: 'POST',
        headers: { ...authH(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), entity: slug, q: appliedQ, filter, sort }),
      })
      if (!r.ok) throw new Error('Could not save view')
      await loadViews(slug)
      toast.success('View saved')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function applyView(id: string) {
    setActiveView(id)
    const v = views.find((x) => String(x.id) === id)
    setQ(v?.q ?? ''); setAppliedQ(v?.q ?? ''); setFilter(v?.filter ?? ''); setSort(v?.sort ?? '')
  }

  if (loading && !def && !fatal) return <p className="muted">Loading…</p>
  if (fatal === 'notfound') return <NotFound what="entity" message={`No entity matches “${slug}”.`} />
  if (fatal === 'denied') {
    return (
      <div>
        <div className="view-head"><h2>{def?.label_plural ?? slug}</h2></div>
        <PermissionDenied message="You don't have permission to view these records." />
      </div>
    )
  }
  if (!def) return <p className="err">Could not load this entity.</p>

  const cols = def.fields.filter((f) => f.type !== 'status')
  const hasWorkflow = (def.transitions ?? []).length > 0
  const nextFrom = (status: string | null) => (def.transitions ?? []).filter((t) => t.from === status).map((t) => t.to)
  const formOpen = mode !== 'idle'

  const cellValue = (c: Field, r: Row) => (c.type === 'ref' ? (refLabels[c.key]?.[r[c.key]] ?? r[c.key]) : r[c.key])

  // client-side filter as graceful degradation: works even if the backend ignores ?q= (older build)
  const needle = appliedQ.trim().toLowerCase()
  const visibleRows = !needle ? rows : rows.filter((r) =>
    cols.some((c) => String(cellValue(c, r) ?? '').toLowerCase().includes(needle)) ||
    String(r.status ?? '').toLowerCase().includes(needle),
  )

  function renderCell(c: Field, r: Row) {
    const v = cellValue(c, r)
    if (c.type === 'boolean') return r[c.key] ? <CheckIcon size={15} /> : ''
    if (Array.isArray(v)) return v.join(', ')
    return String(v ?? '')
  }

  async function doExport(format: 'csv' | 'json') {
    toast.info(`Exporting ${format.toUpperCase()}…`)
    try {
      const params = new URLSearchParams({ format })
      if (appliedQ) params.set('q', appliedQ)
      if (filter) params.set('filter', filter)
      if (sort) params.set('sort', sort)
      const r = await fetch(`${BASE}/api/${slug}/export?${params.toString()}`, { headers: authH(token) })
      if (!r.ok) throw new Error(`Export failed (${r.status})`)
      const blob = await r.blob()
      const cd = r.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename="?([^";]+)"?/)
      const filename = m ? m[1] : `${slug}.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const transitionTargets = Array.from(new Set((def.transitions ?? []).map((t) => t.to)))
  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id))
  const someSelected = visibleRows.some((r) => selected.has(r.id))

  function toggleRow(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected((prev) => {
      const n = new Set(prev)
      if (visibleRows.every((r) => n.has(r.id))) visibleRows.forEach((r) => n.delete(r.id))
      else visibleRows.forEach((r) => n.add(r.id))
      return n
    })
  }

  // POST /api/{slug}/bulk — partial-failure aware; Toasts the {succeeded, failed} summary.
  async function runBulk(action: 'delete' | 'transition', to?: string) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    try {
      const r = await fetch(`${BASE}/api/${slug}/bulk`, {
        method: 'POST',
        headers: { ...authH(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids, to }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        const d = data?.detail
        throw new Error(typeof d === 'string' ? d : `Bulk action failed (${r.status})`)
      }
      const sum = data?.summary ?? { succeeded: 0, failed: ids.length }
      if (sum.failed > 0) {
        const reasons = Array.from(new Set((data?.results ?? []).filter((x: any) => !x.ok)
          .map((x: any) => (typeof x.error === 'string' ? x.error : JSON.stringify(x.error))))).slice(0, 2).join('; ')
        toast.warning(`${sum.succeeded} succeeded, ${sum.failed} failed${reasons ? `: ${reasons}` : ''}`)
      } else {
        toast.success(`${sum.succeeded} ${action === 'delete' ? 'deleted' : 'moved'}`)
      }
      setBulkTo('')
      await load(slug)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function bulkDelete() {
    const n = selected.size
    const ok = await confirmDialog({
      title: `Delete ${n} ${def!.label_plural.toLowerCase()}`,
      message: `Delete ${n} selected record${n === 1 ? '' : 's'}? This can't be undone.`,
      confirmLabel: 'Delete', danger: true,
    })
    if (!ok) return
    await runBulk('delete')
  }

  const colSpan = cols.length + 3 + (hasWorkflow ? 1 : 0)

  return (
    <div>
      <div className="view-head">
        <h2>{def.label_plural}</h2>
        <button
          className={formOpen ? 'btn btn-ghost btn-md' : 'btn btn-primary btn-md'}
          onClick={() => (formOpen ? closeForm() : openCreate())}
        >
          {formOpen ? t('common.close', 'Close') : `+ ${t('common.new', 'New')} ${def.label}`}
        </button>
      </div>

      {error && !errorField && <p className="err">{error}</p>}

      {formOpen && (
        <form className="rec-form" onSubmit={submit}>
          {def.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              token={token}
              mode={mode}
              currentStatus={editingStatus}
              errorField={errorField}
              errorMsg={error}
              value={form[f.key]}
              onChange={(v) => setForm({ ...form, [f.key]: v })}
            />
          ))}
          <div className="rec-form-actions">
            <button type="submit" className="btn btn-accent btn-md">{mode === 'editing' ? t('common.save', 'Save changes') : t('common.create', 'Create')}</button>
          </div>
        </form>
      )}

      {rows.length === 0 && !loading && !formOpen ? (
        <EmptyState
          title={`${t('common.noneYet', 'No')} ${def.label_plural.toLowerCase()} ${t('common.yet', 'yet')}`}
          message={t('common.createFirst', 'Create the first one to get started.')}
          action={<button className="btn btn-primary btn-md" onClick={openCreate}>+ {t('common.new', 'New')} {def.label}</button>}
        />
      ) : (
        <>
      <div className="list-toolbar">
        <div className="search search-md">
          <SearchIcon className="search-icon" size={16} />
          <input
            className="search-input"
            placeholder={`Search ${def.label_plural.toLowerCase()}…`}
            aria-label={`Search ${def.label_plural}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="search-clear" aria-label="Clear search" onClick={() => setQ('')}>
              <CloseIcon size={14} />
            </button>
          )}
        </div>

        {viewsAvailable && (
          <div className="saved-views">
            <select className="inp inp-sm" aria-label="Saved views" value={activeView} onChange={(e) => applyView(e.target.value)}>
              <option value="">All records</option>
              {views.map((v) => <option key={String(v.id)} value={String(v.id)}>{v.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={saveView}>Save view</button>
          </div>
        )}

        <div className={'export-group' + (viewsAvailable ? '' : ' export-start')}>
          <span className="muted export-label">Export</span>
          <button className="btn btn-ghost btn-sm" onClick={() => doExport('csv')}>CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={() => doExport('json')}>JSON</button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{selected.size} selected</span>
          {transitionTargets.length > 0 && (
            <span className="bulk-move">
              <select className="inp inp-sm" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} aria-label="Move to status">
                <option value="">Move to…</option>
                {transitionTargets.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className="btn btn-ghost btn-sm" disabled={!bulkTo} onClick={() => runBulk('transition', bulkTo)}>Move</button>
            </span>
          )}
          <button className="btn btn-danger btn-sm" onClick={bulkDelete}>Delete selected</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th className="sel-col" scope="col">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                onChange={toggleAll}
                aria-label="Select all"
              />
            </th>
            {cols.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
            <th scope="col">Status</th>
            {hasWorkflow && <th scope="col">Move to</th>}
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr key={r.id} className={selected.has(r.id) ? 'row-selected' : ''}>
              <td className="sel-col"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} aria-label="Select row" /></td>
              {cols.map((c) => <td key={c.key}>{renderCell(c, r)}</td>)}
              <td>{r.status ? <span className="pill">{r.status}</span> : ''}</td>
              {hasWorkflow && (
                <td>
                  {nextFrom(r.status).map((to) => (
                    <button key={to} className="btn btn-ghost btn-sm" onClick={() => doTransition(r.id, to)}>
                      <ArrowRightIcon size={13} /> {to}
                    </button>
                  ))}
                </td>
              )}
              <td className="row-actions">
                {(def.key === 'lead' || def.key === 'customer') && (
                  <button className="btn btn-ghost btn-sm" aria-label={t('ai.title', 'AI assist')} title={t('ai.title', 'AI assist')} onClick={() => setAiRow(r)}><SparkleIcon size={14} /></button>
                )}
                {def.key === 'customer' && onOpenCustomer && (
                  <button className="btn btn-ghost btn-sm" aria-label={t('cust.openWorkspace', 'Open workspace')} title={t('cust.openWorkspace', 'Open workspace')} onClick={() => onOpenCustomer(r.id)}><UsersIcon size={14} /></button>
                )}
                {def.key === 'customer' && (
                  <button className="btn btn-ghost btn-sm" aria-label="Billing" title="Billing" onClick={() => setBillingRow(r)}><ReceiptIcon size={14} /></button>
                )}
                <button className="btn btn-ghost btn-sm" aria-label="Activity" title="Activity" onClick={() => setActivityRow(r)}><ClockIcon size={14} /></button>
                <button className="btn btn-ghost btn-sm" aria-label="Comments" title="Comments" onClick={() => setCommentsRow(r)}><MessageIcon size={14} /></button>
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>{t('common.edit', 'Edit')}</button>
                <button className="btn btn-danger btn-sm" onClick={() => doDelete(r)}>{t('common.delete', 'Delete')}</button>
              </td>
            </tr>
          ))}
          {!loading && visibleRows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="muted">
                {needle ? `No records match “${appliedQ}”.` : 'No records yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
        </>
      )}

      {commentsRow && (
        <CommentsModal
          token={token}
          slug={slug}
          recordId={commentsRow.id}
          label={def.label}
          onClose={() => setCommentsRow(null)}
        />
      )}

      {activityRow && (
        <Modal open onClose={() => setActivityRow(null)} title={`Activity · ${def.label}`} size="md">
          <ActivityTimeline token={token} entity={slug} record={activityRow.id} />
        </Modal>
      )}

      {billingRow && (
        <CustomerBillingModal
          token={token}
          customerId={billingRow.id}
          customerLabel={billingRow.name ?? billingRow.title ?? String(billingRow.id).slice(0, 8)}
          onClose={() => setBillingRow(null)}
        />
      )}

      {aiRow && (
        <AiAssistModal
          token={token}
          entityKey={def.key}
          recordId={aiRow.id}
          label={aiRow.name ?? aiRow.title ?? aiRow.subject ?? String(aiRow.id).slice(0, 8)}
          onClose={() => setAiRow(null)}
        />
      )}
    </div>
  )
}

function FieldInput({ field, value, onChange, token, mode, currentStatus, errorField, errorMsg }: {
  field: Field
  value: any
  onChange: (v: any) => void
  token: string
  mode: Mode
  currentStatus: string | null
  errorField: string | null
  errorMsg: string
}) {
  const f = field
  const isErr = errorField === f.key
  const cls = 'inp inp-md' + (isErr ? ' is-error' : '')
  let input: React.ReactNode

  // read-only field (per-field `editable` flag from /meta; absent ⇒ editable)
  if (f.editable === false) {
    const display = Array.isArray(value) ? value.join(', ') : (value === true ? 'Yes' : value === false ? 'No' : (value ?? '—'))
    return (
      <label className="field">
        <span>{f.label}</span>
        <span className="field-readonly">{String(display) || '—'}</span>
      </label>
    )
  }

  if (f.type === 'status') {
    // status is set by the workflow, never edited directly
    return (
      <label className="field">
        <span>{f.label}</span>
        {mode === 'editing'
          ? <span className="pill">{currentStatus ?? '—'}</span>
          : <em className="muted">set by workflow</em>}
      </label>
    )
  } else if (f.type === 'ref') {
    input = <RefPicker token={token} targetKey={refTargetKey(f.config)} value={value} onChange={onChange} />
  } else if (f.type === 'boolean') {
    input = <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
  } else if (f.type === 'number' || f.type === 'money') {
    input = <input type="number" className={cls + ' inp-numeric'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'date') {
    input = <input type="date" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'datetime') {
    input = <input type="datetime-local" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'email') {
    input = <input type="email" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'phone') {
    input = <input type="tel" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'textarea') {
    input = <textarea className={cls + ' inp-area'} rows={4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'select') {
    input = <Select value={value ?? ''} options={f.config?.options ?? []} onChange={onChange} />
  } else if (f.type === 'multiselect') {
    input = <MultiSelect value={value} options={f.config?.options ?? []} onChange={onChange} />
  } else {
    input = <input type="text" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  }

  return (
    <label className="field">
      <span>{f.label}{f.required && ' *'}</span>
      {input}
      {isErr && <span className="inp-err"><WarningIcon size={12} /> {errorMsg}</span>}
    </label>
  )
}
