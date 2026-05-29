import { useEffect, useState } from 'react'
import { getEntityDef, createRecord, transitionRecord, listRecordsPaged } from '../lib/api'
import RefPicker, { refTargetKey, loadRefLabels } from '../components/RefPicker'
import { CheckIcon, ArrowRightIcon, SearchIcon, CloseIcon, WarningIcon, MessageIcon, ClockIcon, ReceiptIcon, SparkleIcon, UsersIcon, LockIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, RowsIcon, PlusIcon } from '../components/icons'
import { confirmDialog, Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import CommentsModal from '../modals/CommentsModal'
import CustomerBillingModal from '../modals/CustomerBillingModal'
import AiAssistModal from '../modals/AiAssistModal'
import { Select, MultiSelect } from '../components/Select'
import { EmptyState, PermissionDenied, NotFound, LoadingState, ErrorBanner } from '../components/States'
import ActivityTimeline from '../components/ActivityTimeline'
import { useI18n } from '../lib/i18n'
import NoAccess from '../components/NoAccess'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import ViewHead from '../components/ViewHead'

const PAGE_SIZE = 50

type Field = { key: string; label: string; type: string; required: boolean; order: number; config: any; editable?: boolean }
type Status = { key: string; label: string; order: number; is_initial: boolean }
type Transition = { from: string; to: string }
type Def = { key: string; label: string; label_plural: string; route_slug: string; fields: Field[]; statuses: Status[]; transitions: Transition[] }

// Derive generic status groups from the entity definition.
// Drafts  = the initial status (is_initial === true)
// History = terminal statuses (no outgoing transitions)
// Active  = everything else
type StatusGroups = { drafts: string[]; active: string[]; history: string[] }
function deriveStatusGroups(def: Def): StatusGroups {
  const statuses = def.statuses ?? []
  const transitions = def.transitions ?? []
  if (statuses.length === 0) return { drafts: [], active: [], history: [] }
  const outgoing = new Set(transitions.map((t) => t.from))
  const drafts: string[] = []
  const history: string[] = []
  const active: string[] = []
  for (const s of statuses) {
    if (s.is_initial) { drafts.push(s.key); continue }
    if (!outgoing.has(s.key)) { history.push(s.key); continue }
    active.push(s.key)
  }
  return { drafts, active, history }
}

type StatusTab = 'all' | 'active' | 'history' | 'drafts'
type Row = Record<string, any>
type Mode = 'idle' | 'creating' | 'editing'
type SavedView = { id: string | number; name: string; q?: string; filter?: string; sort?: string }

const BASE = 'http://127.0.0.1:8099'
const authH = (token: string) => ({ Authorization: `Bearer ${token}` })

// B25 — export format availability probe: HEAD /{slug}/export?format=X; 404 → hide that button.
// CSV is always available (no probe); XLSX + PDF are probed in parallel on slug change.
type ExportFormats = { csv: boolean; xlsx: boolean; pdf: boolean }

async function probeEntityExportFormats(token: string, slug: string): Promise<ExportFormats> {
  async function probe(format: string): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), 3000)
      const r = await fetch(`${BASE}/api/${slug}/export?format=${format}`, {
        method: 'HEAD',
        headers: authH(token),
        signal: ctrl.signal,
      })
      clearTimeout(tid)
      return r.status !== 404
    } catch {
      return true  // network error / abort → assume available; real download will surface the error
    }
  }
  const [xlsx, pdf] = await Promise.all([probe('xlsx'), probe('pdf')])
  return { csv: true, xlsx, pdf }
}

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
export default function EntityView({ token, slug, onOpenCustomer, capabilities = FULL_ACCESS, onBack }: {
  token: string
  slug: string
  onOpenCustomer?: (id: string) => void
  /** B21: per-entity capability map (from GET /api/me/capabilities). Defaults to FULL_ACCESS. */
  capabilities?: Capabilities
  /** B21: handler for "back to dashboard" in NoAccess panel. */
  onBack?: () => void
}) {
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

  // B25: export format availability (probed per slug)
  const [exportFormats, setExportFormats] = useState<ExportFormats | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)

  // B22: pagination
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState<number | null>(null)

  // Status-group tabs (generic — active for any entity with statuses)
  const [statusTab, setStatusTab] = useState<StatusTab>('all')
  // Filter by select field (e.g. request_type) and by individual status
  const [filterSelectField, setFilterSelectField] = useState<string>('')  // field key
  const [filterSelectVal, setFilterSelectVal] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')

  async function load(s: string, pageOffset = offset) {
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
      // B22: add pagination params
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(pageOffset))
      const { rows: fetched, total: tot, status } = await listRecordsPaged(token, s, params)
      if (status === 403) { setFatal('denied'); return }
      if (status >= 400 && status !== 403) throw new Error('Failed to load records')
      setRows(fetched)
      setTotal(tot)                   // null = X-Total-Count absent → hide pager
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

  function goToPage(newOffset: number) {
    setOffset(newOffset)
    load(slug, newOffset).catch((e) => setError((e as Error).message))
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
    setOffset(0); setTotal(null)
    setStatusTab('all'); setFilterSelectField(''); setFilterSelectVal(''); setFilterStatus('')
    loadViews(slug)
  }, [slug])

  // B25: probe export format availability on slug change (reset first so stale buttons don't linger)
  useEffect(() => {
    setExportFormats(null)
    let alive = true
    probeEntityExportFormats(token, slug).then((f) => { if (alive) setExportFormats(f) })
    return () => { alive = false }
  }, [slug])

  // debounce the search box (~300ms)
  useEffect(() => {
    const id = setTimeout(() => setAppliedQ(q), 300)
    return () => clearTimeout(id)
  }, [q])

  // (re)fetch records on slug / applied search / filter / sort change — always reset to page 0
  useEffect(() => {
    setOffset(0)
    load(slug, 0).catch((e) => setError((e as Error).message))
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

  if (loading && !def && !fatal) return <LoadingState />
  if (fatal === 'notfound') return <NotFound what="entity" message={`No entity matches "${slug}".`} />
  if (fatal === 'denied') {
    return (
      <div>
        <div className="view-head"><h2>{def?.label_plural ?? slug}</h2></div>
        <PermissionDenied message={t('entity.permDenied', "You don't have permission to view these records.")} />
      </div>
    )
  }
  if (!def) return <ErrorBanner message={t('entity.loadError', 'Could not load this entity.')} />

  // B21: derive per-verb capability flags from the capabilities map (full-access by default)
  const entityKey = def.key
  const canView   = can(capabilities, entityKey, 'view')
  const canCreate = can(capabilities, entityKey, 'create')
  const canEdit   = can(capabilities, entityKey, 'edit')
  const canDelete = can(capabilities, entityKey, 'delete')
  // If the user cannot view this entity at all, show NoAccess instead of the list
  if (!canView) {
    return <NoAccess what={def.label_plural} onBack={onBack} />
  }
  // Read-only mode: any mutating verb is denied
  const readOnly = !canCreate && !canEdit && !canDelete

  const cols = def.fields.filter((f) => f.type !== 'status')
  const hasWorkflow = (def.transitions ?? []).length > 0
  const nextFrom = (status: string | null) => (def.transitions ?? []).filter((t) => t.from === status).map((t) => t.to)
  const formOpen = mode !== 'idle'

  const cellValue = (c: Field, r: Row) => (c.type === 'ref' ? (refLabels[c.key]?.[r[c.key]] ?? r[c.key]) : r[c.key])

  // Derive status groups generically
  const statusGroups = deriveStatusGroups(def)
  const hasStatusTabs = (def.statuses ?? []).length > 0

  // Select fields available for filtering (type === 'select', shown in filter bar)
  const selectFields = cols.filter((f) => f.type === 'select')
  // The first select field is pre-selected in the filter bar by default (e.g. request_type)
  const activeFilterField = filterSelectField || (selectFields.length > 0 ? selectFields[0].key : '')
  const activeFilterFieldDef = selectFields.find((f) => f.key === activeFilterField)

  // client-side filter as graceful degradation: works even if the backend ignores ?q= (older build)
  const needle = appliedQ.trim().toLowerCase()
  const visibleRows = rows.filter((r) => {
    // text search
    if (needle && !(
      cols.some((c) => String(cellValue(c, r) ?? '').toLowerCase().includes(needle)) ||
      String(r.status ?? '').toLowerCase().includes(needle)
    )) return false
    // status-tab filter
    if (hasStatusTabs && statusTab !== 'all') {
      const st = r.status ?? ''
      if (statusTab === 'drafts' && !statusGroups.drafts.includes(st)) return false
      if (statusTab === 'active' && !statusGroups.active.includes(st)) return false
      if (statusTab === 'history' && !statusGroups.history.includes(st)) return false
    }
    // individual status filter
    if (filterStatus && r.status !== filterStatus) return false
    // select-field filter
    if (activeFilterField && filterSelectVal && String(r[activeFilterField] ?? '') !== filterSelectVal) return false
    return true
  })

  // Tab counts (computed from ALL rows, not visibleRows, so the counts don't react to the tab itself)
  const tabCount = (tab: StatusTab): number => {
    if (!hasStatusTabs) return rows.length
    if (tab === 'all') return rows.length
    const groups = tab === 'drafts' ? statusGroups.drafts : tab === 'active' ? statusGroups.active : statusGroups.history
    return rows.filter((r) => groups.includes(r.status ?? '')).length
  }

  function renderCell(c: Field, r: Row) {
    const v = cellValue(c, r)
    if (c.type === 'boolean') return r[c.key] ? <CheckIcon size={15} /> : ''
    if (Array.isArray(v)) return v.join(', ')
    return String(v ?? '')
  }

  // B25: blob download with Authorization header — same technique as B24 in ReportBuilderView.
  // Carries the current entity's active filter/sort/q so the export matches what's on screen.
  async function doExport(format: string) {
    setExporting(format)
    try {
      const params = new URLSearchParams({ format })
      if (appliedQ) params.set('q', appliedQ)
      if (filter) params.set('filter', filter)
      if (sort) params.set('sort', sort)
      const r = await fetch(`${BASE}/api/${slug}/export?${params.toString()}`, {
        headers: authH(token),
      })
      if (!r.ok) {
        const detail = await r.json().catch(() => null)
        throw new Error(detail?.detail || t('export.error', 'Export failed'))
      }
      const blob = await r.blob()
      const cd = r.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename="?([^";]+)"?/)
      const filename = m ? m[1] : `${slug}.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      toast.error((err as Error).message || t('export.error', 'Export failed'))
    } finally {
      setExporting(null)
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

  // B21: workflow column only appears when canEdit; adjust colSpan accordingly
  const colSpan = cols.length + 3 + (hasWorkflow && canEdit ? 1 : 0)

  // Derive a sub-headline for ViewHead: show total count when known, else record count in view
  const countLabel = total !== null
    ? `${total.toLocaleString()} ${def.label_plural.toLowerCase()}`
    : rows.length > 0
      ? `${rows.length.toLocaleString()} ${def.label_plural.toLowerCase()}`
      : def.label_plural.toLowerCase()

  return (
    <div>
      {/* ── Page header ───────────────────────────────────────────── */}
      <ViewHead
        icon={<RowsIcon size={20} />}
        title={def.label_plural}
        sub={countLabel}
        actions={
          <>
            {/* Export button (ghost, always visible in header when formats are available) */}
            {exportFormats !== null && (exportFormats.csv || exportFormats.xlsx || exportFormats.pdf) && (
              <div className="saved-views" role="group" aria-label={t('export.label', 'Export')}>
                {exportFormats.csv && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={exporting !== null}
                    onClick={() => doExport('csv')}
                    aria-label={t('export.csv', 'Export CSV')}
                  >
                    <DownloadIcon size={13} aria-hidden /> CSV
                  </button>
                )}
                {exportFormats.xlsx && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={exporting !== null}
                    onClick={() => doExport('xlsx')}
                    aria-label={t('export.xlsx', 'Export XLSX')}
                  >
                    <DownloadIcon size={13} aria-hidden /> XLSX
                  </button>
                )}
                {exportFormats.pdf && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={exporting !== null}
                    onClick={() => doExport('pdf')}
                    aria-label={t('export.pdf', 'Export PDF')}
                  >
                    <DownloadIcon size={13} aria-hidden /> PDF
                  </button>
                )}
              </div>
            )}
            {/* B21: New button — only when can create; Close button when form is open */}
            {formOpen ? (
              <button className="btn btn-ghost btn-sm" onClick={closeForm}>
                <CloseIcon size={13} aria-hidden /> {t('common.close', 'Close')}
              </button>
            ) : canCreate ? (
              <button className="btn btn-primary btn-sm" onClick={openCreate}>
                <PlusIcon size={13} aria-hidden /> {t('common.new', 'New')} {def.label}
              </button>
            ) : null}
          </>
        }
      />

      {/* B21: read-only hint */}
      {readOnly && (
        <div
          className="readonly-hint"
          role="status"
          aria-label={t('readonly.ariaLabel', 'Read-only mode')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            marginBottom: 10,
            background: 'var(--warning-soft)',
            border: '1px solid var(--warning)',
            borderRadius: 'var(--r-md)',
            color: 'var(--text-2)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          <LockIcon size={14} aria-hidden />
          <span>{t('readonly.hint', 'Read-only — you can view but not modify records here.')}</span>
        </div>
      )}

      {error && !errorField && <p className="err">{error}</p>}

      {/* ── Status-group tabs (generic — any entity with statuses) ── */}
      {hasStatusTabs && !formOpen && (
        <>
          <div className="tabs">
            {([
              ['all',     'All'],
              ['active',  'Active'],
              ['history', 'History'],
              ['drafts',  'Drafts'],
            ] as [StatusTab, string][]).map(([t, label]) => {
              const cnt = tabCount(t)
              return (
                <button
                  key={t}
                  className={'tab' + (statusTab === t ? ' on' : '')}
                  onClick={() => { setStatusTab(t); setFilterStatus('') }}
                >
                  {label}
                  <span className="tab-count">{cnt}</span>
                </button>
              )
            })}
          </div>

          {/* Filter bar: by select field and/or by individual status */}
          <div className="list-toolbar" style={{ marginBottom: 14 }}>
            {selectFields.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {selectFields.length > 1 && (
                  <select
                    className="inp inp-sm"
                    aria-label="Filter field"
                    value={activeFilterField}
                    onChange={(e) => { setFilterSelectField(e.target.value); setFilterSelectVal('') }}
                    style={{ width: 130 }}
                  >
                    {selectFields.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                )}
                {selectFields.length === 1 && (
                  <span className="muted" style={{ fontSize: 12 }}>{activeFilterFieldDef?.label ?? 'Type'}</span>
                )}
                <select
                  className="inp inp-sm"
                  aria-label={`Filter by ${activeFilterFieldDef?.label ?? 'type'}`}
                  value={filterSelectVal}
                  onChange={(e) => setFilterSelectVal(e.target.value)}
                  style={{ width: 180 }}
                >
                  <option value="">All {activeFilterFieldDef?.label ?? 'types'}</option>
                  {(activeFilterFieldDef?.config?.options ?? []).map((opt: string) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}
            {statusTab === 'all' && (def.statuses ?? []).length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>Status</span>
                <select
                  className="inp inp-sm"
                  aria-label="Filter by status"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  style={{ width: 150 }}
                >
                  <option value="">All statuses</option>
                  {(def.statuses ?? []).map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Create / edit form ────────────────────────────────────── */}
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
            <span className="spacer" />
            <button type="button" className="btn btn-ghost btn-md" onClick={closeForm}>
              {t('common.cancel', 'Cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-md">
              <CheckIcon size={14} aria-hidden />
              {mode === 'editing' ? t('common.save', 'Save changes') : t('common.create', 'Create')}
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 && !loading && !formOpen ? (
        <EmptyState
          title={`${t('common.noneYet', 'No')} ${def.label_plural.toLowerCase()} ${t('common.yet', 'yet')}`}
          message={canCreate ? t('common.createFirst', 'Create the first one to get started.') : undefined}
          action={canCreate ? (
            <button className="btn btn-primary btn-md" onClick={openCreate}>
              <PlusIcon size={13} aria-hidden /> {t('common.new', 'New')} {def.label}
            </button>
          ) : undefined}
        />
      ) : (
        <>
          {/* ── List toolbar ──────────────────────────────────────── */}
          <div className="list-toolbar">
            <div className="search search-md">
              <SearchIcon className="search-icon" size={14} aria-hidden />
              <input
                className="search-input"
                placeholder={`Search ${def.label_plural.toLowerCase()}…`}
                aria-label={`Search ${def.label_plural}`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button className="search-clear" aria-label="Clear search" onClick={() => setQ('')}>
                  <CloseIcon size={12} />
                </button>
              )}
            </div>

            {viewsAvailable && (
              <div className="saved-views">
                <span className="muted" style={{ fontSize: 12 }}>View:</span>
                <select
                  className="inp inp-sm"
                  style={{ width: 160 }}
                  aria-label="Saved views"
                  value={activeView}
                  onChange={(e) => applyView(e.target.value)}
                >
                  <option value="">All records</option>
                  {views.map((v) => (
                    <option key={String(v.id)} value={String(v.id)}>{v.name}</option>
                  ))}
                </select>
                <button className="btn btn-ghost btn-sm" onClick={saveView}>
                  Save view
                </button>
              </div>
            )}
          </div>

          {/* ── Bulk action bar ───────────────────────────────────── */}
          {selected.size > 0 && (
            <div className="bulk-bar">
              <span className="bulk-count">{selected.size} selected</span>
              {/* B21: only show transition controls if user can edit */}
              {canEdit && transitionTargets.length > 0 && (
                <span className="bulk-move">
                  <select className="inp inp-sm" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} aria-label="Move to status">
                    <option value="">Move to…</option>
                    {transitionTargets.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button className="btn btn-ghost btn-sm" disabled={!bulkTo} onClick={() => runBulk('transition', bulkTo)}>Move</button>
                </span>
              )}
              {/* B21: only show bulk delete if user can delete */}
              {canDelete && (
                <button className="btn btn-danger btn-sm" onClick={bulkDelete}>Delete selected</button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          {/* ── Records grid ──────────────────────────────────────── */}
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
                  {hasWorkflow && canEdit && <th scope="col">Move to</th>}
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id} className={selected.has(r.id) ? 'row-selected' : ''}>
                    <td className="sel-col">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} aria-label="Select row" />
                    </td>
                    {cols.map((c, ci) => (
                      <td key={c.key}>
                        {ci === 0 ? (
                          /* First data column gets the row-link + cell-meta treatment */
                          <>
                            <button
                              className="row-link"
                              onClick={() => openEdit(r)}
                              disabled={!canEdit}
                              style={canEdit ? undefined : { cursor: 'default', pointerEvents: 'none' }}
                            >
                              {renderCell(c, r) || <span className="muted">—</span>}
                            </button>
                            {/* Show second non-status field as cell-meta if it exists */}
                            {cols[1] && (
                              <div className="cell-meta">
                                {String(cellValue(cols[1], r) ?? '')}
                              </div>
                            )}
                          </>
                        ) : ci === 1 ? (
                          /* Second column is already inlined as cell-meta above — skip rendering standalone */
                          null
                        ) : (
                          renderCell(c, r)
                        )}
                      </td>
                    ))}
                    <td>
                      {r.status ? (
                        <span className={`pill ${statusPillVariant(r.status)}`}>
                          <span className="pill-dot" />
                          {r.status}
                        </span>
                      ) : ''}
                    </td>
                    {/* B21: workflow transition column only shown when canEdit */}
                    {hasWorkflow && canEdit && (
                      <td>
                        {nextFrom(r.status).map((to) => (
                          <button key={to} className="btn btn-ghost btn-sm" onClick={() => doTransition(r.id, to)}>
                            <ArrowRightIcon size={13} aria-hidden /> {to}
                          </button>
                        ))}
                      </td>
                    )}
                    <td>
                      <div className="row-actions">
                        {(def.key === 'lead' || def.key === 'customer') && (
                          <button className="iconbtn" aria-label={t('ai.title', 'AI assist')} title={t('ai.title', 'AI assist')} onClick={() => setAiRow(r)}>
                            <SparkleIcon size={14} />
                          </button>
                        )}
                        {def.key === 'customer' && onOpenCustomer && (
                          <button className="iconbtn" aria-label={t('cust.openWorkspace', 'Open workspace')} title={t('cust.openWorkspace', 'Open workspace')} onClick={() => onOpenCustomer(r.id)}>
                            <UsersIcon size={14} />
                          </button>
                        )}
                        {def.key === 'customer' && (
                          <button className="iconbtn" aria-label="Billing" title="Billing" onClick={() => setBillingRow(r)}>
                            <ReceiptIcon size={14} />
                          </button>
                        )}
                        <button className="iconbtn" aria-label="Activity" title="Activity" onClick={() => setActivityRow(r)}>
                          <ClockIcon size={14} />
                        </button>
                        <button className="iconbtn" aria-label="Comments" title="Comments" onClick={() => setCommentsRow(r)}>
                          <MessageIcon size={14} />
                        </button>
                        {/* B21: hide edit/delete when capability missing */}
                        {canEdit && (
                          <button className="iconbtn" aria-label={t('common.edit', 'Edit')} title={t('common.edit', 'Edit')} onClick={() => openEdit(r)}>
                            <ArrowRightIcon size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button className="iconbtn" style={{ color: 'var(--danger)' }} aria-label={t('common.delete', 'Delete')} title={t('common.delete', 'Delete')} onClick={() => doDelete(r)}>
                            <CloseIcon size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={colSpan}>
                      <EmptyState
                        title={needle
                          ? t('entity.noMatch', 'No records match your search')
                          : `${t('common.noneYet', 'No')} ${def.label_plural.toLowerCase()} ${t('common.yet', 'yet')}`}
                        message={!needle && canCreate ? t('common.createFirst', 'Create the first one to get started.') : undefined}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* B22: pager — only shown when X-Total-Count was returned and total > PAGE_SIZE */}
          {total !== null && total > PAGE_SIZE && (
            <div className="pager" role="navigation" aria-label={t('pager.ariaLabel', 'Page navigation')}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => goToPage(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0 || loading}
                aria-label={t('pager.prev', 'Previous page')}
              >
                <ChevronLeftIcon size={14} />
                {t('pager.prev', 'Prev')}
              </button>
              <span className="pager-info" aria-live="polite">
                {t('pager.info', '{from}–{to} / {total}')
                  .replace('{from}', String(offset + 1))
                  .replace('{to}', String(Math.min(offset + PAGE_SIZE, total)))
                  .replace('{total}', String(total))}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => goToPage(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total || loading}
                aria-label={t('pager.next', 'Next page')}
              >
                {t('pager.next', 'Next')}
                <ChevronRightIcon size={14} />
              </button>
            </div>
          )}
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

// Map a status string to a pill CSS variant.
// Well-known semantic statuses → colours; unknown → neutral pill.
function statusPillVariant(status: string): string {
  const s = status.toLowerCase()
  if (['active', 'paid', 'done', 'won', 'completed', 'resolved'].includes(s)) return 'pill-success'
  if (['suspended', 'blocked', 'warning', 'on_hold', 'on hold'].includes(s)) return 'pill-warning'
  if (['cancelled', 'canceled', 'churned', 'lost', 'void', 'failed', 'rejected'].includes(s)) return 'pill-danger'
  if (['prospect', 'pending', 'new', 'open', 'sent', 'draft', 'qualified'].includes(s)) return 'pill-primary'
  if (['in_progress', 'in progress', 'negotiation', 'processing'].includes(s)) return 'pill-accent'
  return 'pill-muted'
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
