import { useEffect, useState } from 'react'
import { getEntityDef, createRecord, transitionRecord, listRecordsPaged, uploadAttachments } from '../lib/api'
import RefPicker, { refTargetKey, loadRefLabels } from '../components/RefPicker'
import { CheckIcon, ArrowRightIcon, SearchIcon, WarningIcon, MessageIcon, ClockIcon, ReceiptIcon, SparkleIcon, UsersIcon, LockIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, RowsIcon, PlusIcon, EditIcon, GearIcon, TrashIcon, InboxIcon, UserIcon, PhoneIcon, MapIcon, GlobeIcon, BriefcaseIcon, InfoIcon, BuildingIcon, PaperclipIcon } from '../components/icons'
import RowActionsMenu, { type RowAction } from '../components/RowActionsMenu'
import { confirmDialog, Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import CommentsModal from '../modals/CommentsModal'
import CustomerBillingModal from '../modals/CustomerBillingModal'
import AiAssistModal from '../modals/AiAssistModal'
import { Select, MultiSelect } from '../components/Select'
import { EmptyState, PermissionDenied, NotFound, LoadingState, ErrorBanner } from '../components/States'
import ActivityTimeline from '../components/ActivityTimeline'
import { Spark } from '../components/charts/Spark'
import { LeadGatesStrip } from '../components/LeadGatesStrip'
import DatePicker from '../components/DatePicker'
import FileUpload from '../components/FileUpload'
import { useI18n } from '../lib/i18n'
import { buildContractHtml, contractFileName } from '../lib/contract'
import NoAccess from '../components/NoAccess'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { Button, StatusPill } from '../primitives'
import { PageShell } from '../page-shell'
import type { PageType, KPISpec, SecondaryAction } from '../page-shell'

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

// Group form fields by their config.section (preserving order) so the create/edit modal
// renders titled sections. Fields with no section fall into one leading unlabeled group —
// keeps entities that don't define sections rendering exactly as before.
function groupFieldsBySection(fields: Field[]): Array<{ section: string | null; fields: Field[] }> {
  const groups: Array<{ section: string | null; fields: Field[] }> = []
  for (const f of fields) {
    const section: string | null = f.config?.section ?? null
    let g = groups.find((x) => x.section === section)
    if (!g) { g = { section, fields: [] }; groups.push(g) }
    g.fields.push(f)
  }
  return groups
}

// A small icon for each form section header (keyword-matched, with a sensible fallback).
function sectionIcon(section: string): React.ReactNode {
  const s = section.toLowerCase()
  if (s.includes('identity') || s.includes('type') || s.includes('personal')) return <UserIcon size={14} aria-hidden />
  if (s.includes('contact')) return <PhoneIcon size={14} aria-hidden />
  if (s.includes('address')) return <MapIcon size={14} aria-hidden />
  if (s.includes('service') || s.includes('interest')) return <GlobeIcon size={14} aria-hidden />
  if (s.includes('sales')) return <BriefcaseIcon size={14} aria-hidden />
  if (s.includes('company') || s.includes('business')) return <BuildingIcon size={14} aria-hidden />
  if (s.includes('note') || s.includes('attach') || s.includes('document')) return <PaperclipIcon size={14} aria-hidden />
  return <InfoIcon size={14} aria-hidden />
}
type Mode = 'idle' | 'creating' | 'editing'
type SavedView = { id: string | number; name: string; q?: string; filter?: string; sort?: string }

import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

// ── PageShell metadata map ─────────────────────────────────────────────────
// Static breadcrumb + page-type per known slug. Custom entities fall back to
// ['Records', capitalize(slug)] / 'REGISTRY'.

type SlugMeta = { breadcrumb: string[]; type: PageType; subtitle?: string }

const SLUG_META: Record<string, SlugMeta> = {
  'leads':                { breadcrumb: ['CRM', 'Leads'],                    type: 'REGISTRY' },
  'customers':            { breadcrumb: ['CRM', 'Customers'],                type: 'REGISTRY' },
  'campaigns':            { breadcrumb: ['CRM', 'Campaigns'],                type: 'REGISTRY' },
  'users':                { breadcrumb: ['Admin Panel', 'Users'],            type: 'CONFIGURATION' },
  'roles':                { breadcrumb: ['Admin Panel', 'Roles'],            type: 'CONFIGURATION' },
  'incidents':            { breadcrumb: ['Tech & NOC', 'Incidents'],         type: 'OPERATIONS' },
  'assets':               { breadcrumb: ['Tech & NOC', 'Assets'],            type: 'OPERATIONS' },
  'expenses':             { breadcrumb: ['Enterprise', 'Finance'],           type: 'REGISTRY' },
  'employees':            { breadcrumb: ['Enterprise', 'HR'],                type: 'REGISTRY' },
  'purchase-orders':      { breadcrumb: ['Enterprise', 'Procurement'],       type: 'REGISTRY' },
  'contracts':            { breadcrumb: ['Enterprise', 'Legal'],             type: 'REGISTRY' },
  'notification-rules':   { breadcrumb: ['Admin Panel', 'Notifications'],    type: 'CONFIGURATION' },
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')
}

function pagePropsForSlug(slug: string, def: Def | null): { breadcrumb: string[]; type: PageType; title: string; subtitle: string } {
  const meta = SLUG_META[slug] ?? { breadcrumb: ['Records', capitalize(slug)], type: 'REGISTRY' as PageType }
  const title = def?.label_plural ?? capitalize(slug)
  const subtitle = meta.subtitle ?? ''
  return { breadcrumb: meta.breadcrumb, type: meta.type, title, subtitle }
}

function deriveEntityKPIs(def: Def, rows: Row[], total: number | null): KPISpec[] {
  const count = total ?? rows.length
  const kpis: KPISpec[] = [
    { label: 'Total', value: count },
  ]
  // Per-status KPIs when the entity has statuses — capped so the bar shows 4 cards
  // total (Total + 3 statuses).
  const statuses = def.statuses ?? []
  if (statuses.length > 0) {
    const shown = statuses.slice(0, 3)
    for (const s of shown) {
      const c = rows.filter((r) => r.status === s.key).length
      kpis.push({ label: s.label, value: c, muted: c === 0 })
    }
  }
  return kpis
}

// Start of the current week (Monday 00:00, local). KPIs that use this reset every
// Monday morning — they count only what happened since the most recent Monday.
function startOfWeekMonday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()            // 0=Sun … 6=Sat
  const sinceMon = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - sinceMon)
  return d
}

const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDay(d: Date): string {
  return `${_MONTHS[d.getMonth()]} ${d.getDate()}`
}

// Leads cockpit KPIs — New · Qualified · Contract Signed · Total — counted for THIS
// WEEK only (created since Monday), so the bar resets every Monday morning. Each card
// also carries a WoW (week-over-week) trend; the funnel cards show their rate vs total,
// and the Total card pins the active week's date range to its corner.
function deriveLeadsWeeklyKPIs(rows: Row[]): KPISpec[] {
  const monday = startOfWeekMonday()
  const weekStart = monday.getTime()
  const prevStart = weekStart - 7 * 86_400_000
  const weekEnd = new Date(monday)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const at = (r: Row) => Date.parse((r as { created_at?: string }).created_at ?? '')
  const thisWk = rows.filter((r) => { const t = at(r); return !Number.isNaN(t) && t >= weekStart })
  const lastWk = rows.filter((r) => { const t = at(r); return !Number.isNaN(t) && t >= prevStart && t < weekStart })
  const cnt = (set: Row[], s: string) => set.filter((r) => r.status === s).length

  // WoW: this week vs last week for the same metric. Percentage when there's a prior
  // baseline, otherwise the raw rise from zero.
  const wow = (now: number, prev: number): Partial<KPISpec> => {
    if (prev === 0) return now > 0 ? { delta: `+${now}`, deltaPositive: true, deltaBase: 'WoW' } : {}
    const pct = Math.round(((now - prev) / prev) * 100)
    return { delta: `${pct >= 0 ? '+' : ''}${pct}%`, deltaPositive: pct >= 0, deltaBase: 'WoW' }
  }
  const total = thisWk.length
  const rate = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  const newN = cnt(thisWk, 'NEW')
  const qualN = cnt(thisWk, 'QUALIFIED')
  const signN = cnt(thisWk, 'CONVERTED')

  // Per-day series (Mon→Sun of the current week) for the trend sparklines.
  const daySeries = (pred: (r: Row) => boolean): number[] => {
    const buckets = [0, 0, 0, 0, 0, 0, 0]
    rows.forEach((r) => {
      const t = at(r)
      if (Number.isNaN(t) || t < weekStart) return
      const idx = Math.floor((t - weekStart) / 86_400_000)
      if (idx >= 0 && idx < 7 && pred(r)) buckets[idx] += 1
    })
    return buckets
  }

  return [
    { label: 'New', value: newN, ...wow(newN, cnt(lastWk, 'NEW')),
      chart: <Spark values={daySeries((r) => r.status === 'NEW')} color="var(--gx-primary)" height={18} strokeWidth={1} /> },
    { label: 'Qualified', value: qualN, ...wow(qualN, cnt(lastWk, 'QUALIFIED')),
      progress: rate(qualN), progressVariant: 'gold', progressLabel: `${rate(qualN)}%` },
    { label: 'Contract Signed', value: signN, ...wow(signN, cnt(lastWk, 'CONVERTED')),
      progress: rate(signN), progressVariant: 'success', progressLabel: `${rate(signN)}%` },
    { label: 'Total', value: total, ...wow(total, lastWk.length),
      cornerNote: `${fmtDay(monday)} – ${fmtDay(weekEnd)}`,
      chart: <Spark values={daySeries(() => true)} color="var(--gx-interactive)" height={18} strokeWidth={1} /> },
  ]
}

// B25 — export format availability probe: HEAD /{slug}/export?format=X; 404 → hide that button.
// CSV is always available (no probe); XLSX is probed on slug change. (PDF removed — CSV/XLSX only.)
type ExportFormats = { csv: boolean; xlsx: boolean }

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
  const xlsx = await probe('xlsx')
  return { csv: true, xlsx }
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
export default function EntityView({ token, slug, onOpenCustomer, onOpenPipeline, capabilities = FULL_ACCESS, onBack, canConfigure = false, onConfigure }: {
  token: string
  slug: string
  onOpenCustomer?: (id: string) => void
  /** Opens the Pipeline page — drill-through from the Leads control-gate strip. */
  onOpenPipeline?: () => void
  /** B21: per-entity capability map (from GET /api/me/capabilities). Defaults to FULL_ACCESS. */
  capabilities?: Capabilities
  /** B21: handler for "back to dashboard" in NoAccess panel. */
  onBack?: () => void
  /** Gates the "Configure page" header action (opens ConfigureDrawer for this entity). */
  canConfigure?: boolean
  /** P1: opens the ConfigureDrawer for this entity (set by parent — see App.tsx). */
  onConfigure?: () => void
}) {
  const { t } = useI18n()
  const [def, setDef] = useState<Def | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [form, setForm] = useState<Record<string, any>>({})
  const [contractUrl, setContractUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  // Two-step create flow: 'pick' shows only the Type + Lead Source dropdowns, 'form' the full
  // (segment-appropriate) form. Editing goes straight to 'form'.
  const [createStep, setCreateStep] = useState<'pick' | 'form'>('pick')
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
      // Default to newest-first (most recently created on top); an explicit sort overrides.
      params.set('sort', sort || '-created_at')
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

  function clearContract() {
    setContractUrl((u) => { if (u) URL.revokeObjectURL(u); return null })
  }

  function closeForm() {
    setMode('idle'); setForm({}); setEditingId(null); setEditingStatus(null); setErrorField(null)
    clearContract()
  }

  // Generate a contract from the modal's current values; Download saves the last generated one.
  function generateContract() {
    const html = buildContractHtml(form, def?.fields ?? [])
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    setContractUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(blob) })
  }

  function downloadContract() {
    if (!contractUrl) return
    const a = document.createElement('a')
    a.href = contractUrl
    a.download = contractFileName(form)
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  function openCreate() {
    setError(''); setErrorField(null); setForm({}); setEditingId(null); setEditingStatus(null)
    clearContract()
    setCreateStep('pick')   // start at the Type + Source picker; "Next" reveals the full form
    setMode('creating')
  }

  function openEdit(row: Row) {
    if (!def) return
    setError(''); setErrorField(null)
    const f: Record<string, any> = {}
    def.fields.forEach((fld) => { if (fld.type !== 'status') f[fld.key] = row[fld.key] ?? '' })
    setForm(f)
    setEditingId(row.id)
    setEditingStatus(row.status ?? null)
    setCreateStep('form')   // editing skips the picker — the record's type is already set
    setMode('editing')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setErrorField(null)
    try {
      const payload: Record<string, unknown> = {}
      def!.fields.forEach((f) => {
        if (f.type === 'status') return            // status is lifecycle-managed, never sent here
        if (f.type === 'file') return              // files aren't JSON data — uploaded separately
        if (f.editable === false) return           // read-only fields are never submitted
        const v = form[f.key]
        if (mode === 'creating') {
          if (v !== undefined && v !== '') payload[f.key] = v
        } else {
          if (v !== undefined) payload[f.key] = v  // editing: send all (allows clearing a field)
        }
      })
      const wasEditing = mode === 'editing'
      let recordId = editingId
      if (wasEditing && editingId) await patchRecord(token, slug, editingId, payload)
      else { const created = await createRecord(token, slug, payload); recordId = created?.id ?? null }
      // Upload any files picked in `file` fields, now that the record id exists.
      if (recordId) {
        for (const ff of def!.fields.filter((f) => f.type === 'file')) {
          const picked = form[ff.key]
          if (Array.isArray(picked) && picked.length > 0) {
            await uploadAttachments(token, def!.key, recordId, picked as File[])
          }
        }
      }
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
    const fp = pagePropsForSlug(slug, def)
    return (
      <PageShell type={fp.type} breadcrumb={fp.breadcrumb} icon={<RowsIcon size={18} />} title={fp.title} subtitle={fp.subtitle}>
        <PermissionDenied message={t('entity.permDenied', "You don't have permission to view these records.")} />
      </PageShell>
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
  // Leads render a dedicated flat grid — Lead ID · Full Name · Address · Phone · Email ·
  // Stage — with no checkbox column (see the records grid below).
  const isLeads = slug === 'leads'
  const leadRef = (id: unknown) => 'LED-' + String(id).replace(/-/g, '').slice(-6).toUpperCase()
  const leadCell = (v: unknown) => (v == null || v === '' ? <span className="muted">—</span> : String(v))
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

  // Uniform status pills — pad the whole Status column to the longest status label in
  // view, so every pill in the column is the same width (sized to e.g. CONVERTED).
  const statusPillMinW = (() => {
    const n = visibleRows.reduce((m, r) => Math.max(m, String(r.status ?? '').length), 0)
    return n > 0 ? n * 9 + 34 : undefined
  })()

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

  // Header skips cols[1] (folded into cols[0] as a cell-meta subtitle) — so the body uses
  // cols.length - 1 data <td>s when there are at least 2 data fields, else cols.length.
  // The old workflow "Move to" column is gone (transitions now live in the row-actions menu),
  // so colSpan no longer needs a conditional for it.
  const dataCellCount = cols.length >= 2 ? cols.length - 1 : cols.length
  // Leads: 5 data cols (ID · Name · Address · Phone · Email) + Stage + Actions, no checkbox.
  const colSpan = isLeads ? 5 + 1 + 1 : 1 /* checkbox */ + dataCellCount + 1 /* status */ + 1 /* actions */

  // Derive a sub-headline: show total count when known, else record count in view
  const countLabel = total !== null
    ? `${total.toLocaleString()} ${def.label_plural.toLowerCase()}`
    : rows.length > 0
      ? `${rows.length.toLocaleString()} ${def.label_plural.toLowerCase()}`
      : def.label_plural.toLowerCase()

  // PageShell page props — slug-driven breadcrumb + type
  const pp = pagePropsForSlug(slug, def)

  // PageShell: primaryAction — always "New {entity}" (opens the create modal); the modal
  // carries its own close, so the header button never toggles to Close.
  const shellPrimary = canCreate
    ? { label: `${t('common.new', 'New')} ${def.label}`, icon: <PlusIcon size={13} aria-hidden />, onClick: openCreate }
    : undefined

  // PageShell: secondaryActions — one Download button (asks for format on click) + configure
  const shellSecondary: SecondaryAction[] = []
  const canExport = exportFormats !== null && (exportFormats.csv || exportFormats.xlsx)
  if (canExport) {
    const fmts: { label: string; icon?: React.ReactNode; onClick: () => void }[] = []
    if (exportFormats?.csv) fmts.push({ label: 'CSV', icon: <DownloadIcon size={14} aria-hidden />, onClick: () => doExport('csv') })
    if (exportFormats?.xlsx) fmts.push({ label: 'XLSX · Excel', icon: <DownloadIcon size={14} aria-hidden />, onClick: () => doExport('xlsx') })
    shellSecondary.push({ label: t('common.download', 'Download'), icon: <DownloadIcon size={13} aria-hidden />, disabled: exporting !== null, menu: fmts })
  }
  if (canConfigure && onConfigure) {
    shellSecondary.push({ label: t('common.configurePageTitle', 'Configure'), icon: <GearIcon size={13} />, onClick: onConfigure })
  }

  // PageShell: KPI bar. Leads get a weekly cockpit (New/Qualified/Contract Signed/Total,
  // reset every Monday); other entities get the generic total + per-status bar.
  const shellKpis = slug === 'leads' ? deriveLeadsWeeklyKPIs(rows) : deriveEntityKPIs(def, rows, total)

  return (
    <PageShell
      type={pp.type}
      icon={<RowsIcon size={18} />}
      title={pp.title}
      kpis={shellKpis}
      primaryAction={shellPrimary}
      secondaryActions={shellSecondary.length > 0 ? shellSecondary : undefined}
      filters={{ search: { value: q, onChange: setQ, placeholder: `Search ${def.label_plural.toLowerCase()}` } }}
    >

      {/* B21: read-only hint */}
      {readOnly && (
        <div
          className="readonly-hint"
          role="status"
          aria-label={t('readonly.ariaLabel', 'Read-only mode')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--gx-space-3)',
            padding: 'var(--gx-space-3) var(--gx-space-6)',
            marginBottom: 'var(--gx-space-5)',
            background: 'var(--gx-warning-soft)',
            border: '1px solid var(--gx-warning)',
            borderRadius: 'var(--gx-radius-md)',
            color: 'var(--gx-text-2)',
            fontSize: 'var(--gx-text-sm)',
          }}
        >
          <LockIcon size={14} aria-hidden />
          <span>{t('readonly.hint', 'Read-only — you can view but not modify records here.')}</span>
        </div>
      )}

      {error && !errorField && <p className="err">{error}</p>}

      {/* ── Lifecycle control-gate strip (Leads only) — the four locked control gates. ── */}
      {slug === 'leads' && !formOpen && <LeadGatesStrip rows={rows} onOpenGate={onOpenPipeline} />}

      {/* ── Status-group tabs (generic — any entity with statuses) ──
           Hidden on Leads: that strip is reserved for the control-gate spine above. */}
      {hasStatusTabs && !formOpen && slug !== 'leads' && (
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
          <div className="list-toolbar" style={{ marginBottom: 'var(--gx-space-7)' }}>
            {selectFields.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
                {selectFields.length > 1 && (
                  <select
                    className="inp inp-sm flt-field"
                    aria-label="Filter field"
                    value={activeFilterField}
                    onChange={(e) => { setFilterSelectField(e.target.value); setFilterSelectVal('') }}
                  >
                    {selectFields.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                )}
                {selectFields.length === 1 && (
                  <span className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>{activeFilterFieldDef?.label ?? 'Type'}</span>
                )}
                <select
                  className="inp inp-sm flt-value"
                  aria-label={`Filter by ${activeFilterFieldDef?.label ?? 'type'}`}
                  value={filterSelectVal}
                  onChange={(e) => setFilterSelectVal(e.target.value)}
                >
                  <option value="">All {activeFilterFieldDef?.label ?? 'types'}</option>
                  {(activeFilterFieldDef?.config?.options ?? []).map((opt: string) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}
            {statusTab === 'all' && (def.statuses ?? []).length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
                <span className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>Status</span>
                <select
                  className="inp inp-sm flt-status"
                  aria-label="Filter by status"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
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

      {/* ── Create / edit form — opens in a modal over the list ─────── */}
      {formOpen && (() => {
        const renderField = (f: Field) => (
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
        )
        // segment-gated fields show only for the chosen Type (B2C / B2B); untagged are common.
        const visible = def.fields.filter((f) => {
          const segs: string[] | undefined = f.config?.segments
          return !segs || segs.includes(form.segment)
        })
        // `header`-flagged fields (Type, Lead Source) sit in a strip at the top of the modal.
        const headerFields = visible.filter((f) => f.config?.header)
        // status is lifecycle-managed (set by workflow) — never shown as a form field
        const bodyFields = visible.filter((f) => !f.config?.header && f.type !== 'status')
        // Entities with a header field (e.g. Lead) use a two-step create: pick Type + Source
        // first, then "Next" reveals the form for the chosen Type.
        const hasPicker = def.fields.some((f) => f.config?.header)
        const inPick = mode === 'creating' && hasPicker && createStep === 'pick'
        return (
          <Modal
            open
            onClose={closeForm}
            size={inPick ? 'lg' : 'xl'}
            title={mode === 'editing'
              ? `${t('common.edit', 'Edit')} ${def.label}`
              : `${t('common.new', 'New')} ${def.label}`}
            subtitle={inPick
              ? t('form.pickType', 'Choose the type and source to continue')
              : mode === 'editing'
                ? undefined
                : t('form.fillBelow', `Fill in the information below to create a new ${def.label.toLowerCase()}`)}
          >
            {inPick ? (() => {
              const segField = headerFields.find((f) => f.key === 'segment')
              const otherHeader = headerFields.filter((f) => f.key !== 'segment')
              const opts: string[] = segField?.config?.options ?? []
              const cardMeta = (opt: string) => opt.toLowerCase().includes('business')
                ? { icon: <BuildingIcon size={20} aria-hidden />, title: 'Business', desc: 'B2B — company account' }
                : { icon: <UserIcon size={20} aria-hidden />, title: 'Individual', desc: 'B2C — home subscriber' }
              return (
                <div className="rec-form rec-form-modal">
                  <div className="rec-pick">
                    {segField && (
                      <div className="rec-pick-group">
                        <div className="rec-pick-label">{segField.label}</div>
                        <div className="rec-pick-cards">
                          {opts.map((opt) => {
                            const m = cardMeta(opt)
                            return (
                              <button type="button" key={opt}
                                className={'rec-pick-card' + (form.segment === opt ? ' on' : '')}
                                onClick={() => setForm({ ...form, segment: opt })}>
                                <span className="rec-pick-card-icon">{m.icon}</span>
                                <span className="rec-pick-card-title">{m.title}</span>
                                <span className="rec-pick-card-desc">{m.desc}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {otherHeader.length > 0 && (
                      <div className="rec-pick-row">{otherHeader.map(renderField)}</div>
                    )}
                  </div>
                  <div className="rec-form-actions">
                    <span className="spacer" />
                    <Button variant="ghost" size="md" type="button" onClick={closeForm}>
                      {t('common.cancel', 'Cancel')}
                    </Button>
                    <Button variant="primary" size="md" type="button"
                      disabled={!form.segment || !form.source}
                      onClick={() => setCreateStep('form')}>
                      {t('common.continue', 'Continue')} <ArrowRightIcon size={14} aria-hidden />
                    </Button>
                  </div>
                </div>
              )
            })() : (
              <form className="rec-form rec-form-modal" onSubmit={submit}>
                {headerFields.length > 0 && (
                  <div className="rec-form-header">{headerFields.map(renderField)}</div>
                )}
                <div className="rec-form-sections">
                  {groupFieldsBySection(bodyFields).map((g, gi) => {
                    // A section holding a wide field (notes / attachments) spans the full row;
                    // the rest pack two-up so the modal is wider but shorter. When a section
                    // carries BOTH a note and a document field, the two sit side-by-side.
                    const hasTextarea = g.fields.some((f) => f.type === 'textarea')
                    const hasFile = g.fields.some((f) => f.type === 'file')
                    const split = hasTextarea && hasFile
                    const wide = hasTextarea || hasFile
                    return g.section ? (
                      <div className={'rec-form-section' + (wide ? ' span-2' : '')} key={g.section}>
                        <div className="rec-form-section-head">
                          {sectionIcon(g.section)}
                          <span>{g.section}</span>
                        </div>
                        <div className={'rec-form-grid' + (split ? ' rec-form-grid-split' : '')}>{g.fields.map(renderField)}</div>
                        {split && (
                          <div className="rec-contract-actions">
                            <Button variant="secondary" size="sm" type="button" onClick={generateContract}>
                              <ReceiptIcon size={14} aria-hidden /> {t('contract.generate', 'Generate Contract')}
                            </Button>
                            <Button variant="ghost" size="sm" type="button" disabled={!contractUrl} onClick={downloadContract}>
                              <DownloadIcon size={14} aria-hidden /> {t('contract.download', 'Download Contract')}
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rec-form-grid rec-form-grid-bare span-2" key={`_${gi}`}>{g.fields.map(renderField)}</div>
                    )
                  })}
                </div>
                <div className="rec-form-actions">
                  {mode === 'creating' && hasPicker && (
                    <Button variant="ghost" size="md" type="button" onClick={() => setCreateStep('pick')}>
                      {t('common.back', 'Back')}
                    </Button>
                  )}
                  <span className="spacer" />
                  <Button variant="ghost" size="md" type="button" onClick={closeForm}>
                    {t('common.cancel', 'Cancel')}
                  </Button>
                  <Button variant="primary" size="md" type="submit">
                    <CheckIcon size={14} aria-hidden />
                    {mode === 'editing' ? t('common.save', 'Save changes') : t('common.create', 'Create')}
                  </Button>
                </div>
              </form>
            )}
          </Modal>
        )
      })()}

      {rows.length === 0 && !loading && !formOpen ? (
        <EmptyState
          icon={<InboxIcon size={40} />}
          title={`${t('common.noneYet', 'No')} ${def.label_plural.toLowerCase()} ${t('common.yet', 'yet')}`}
          message={canCreate ? t('common.createFirst', 'Create the first one to get started.') : undefined}
          action={canCreate ? (
            <Button variant="primary" size="md"
            onClick={openCreate}>
              <PlusIcon size={13} aria-hidden /> {t('common.new', 'New')} {def.label}
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
          {/* ── Bulk action bar (overlays toolbar when selection > 0) ── */}
          {selected.size > 0 && (
            <div className="bulkbar">
              <span style={{ fontWeight: 'var(--gx-weight-semibold)', fontSize: 'var(--gx-text-sm)' }}>{selected.size} selected</span>
              <span className="spacer" />
              {/* B21: only show transition controls if user can edit */}
              {canEdit && transitionTargets.length > 0 && (
                <>
                  <select className="inp inp-sm" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} aria-label="Move to status">
                    <option value="">Move to…</option>
                    {transitionTargets.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" disabled={!bulkTo} onClick={() => runBulk('transition', bulkTo)}>Move</Button>
                </>
              )}
              {/* B21: only show bulk delete if user can delete */}
              {canDelete && (
                <Button variant="danger" size="sm" onClick={bulkDelete}>Delete selected</Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>Cancel</Button>
            </div>
          )}

          {/* ── List toolbar (saved views; search lives in the header now) ── */}
          {viewsAvailable && (
            <div className="toolbar" style={{ padding: 'var(--gx-space-6) var(--gx-space-7)', margin: 0 }}>
              <span className="spacer" />
              <div className="saved-views" style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
                <span className="muted" style={{ fontSize: 'var(--gx-text-sm)' }}>View:</span>
                <select
                  className="inp inp-sm flt-view"
                  aria-label="Saved views"
                  value={activeView}
                  onChange={(e) => applyView(e.target.value)}
                >
                  <option value="">All records</option>
                  {views.map((v) => (
                    <option key={String(v.id)} value={String(v.id)}>{v.name}</option>
                  ))}
                </select>
                <Button variant="ghost" size="sm"
            onClick={saveView}>
                  Save view
                </Button>
              </div>
            </div>
          )}

          {/* ── Records grid ──────────────────────────────────────── */}
          <div className={'grid-wrap' + (isLeads ? ' leads-wrap' : '')}>
            <table className={'grid' + (isLeads ? ' leads-grid' : '')}>
              <thead>
                <tr>
                  {!isLeads && (
                    <th className="sel-col" scope="col">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  {isLeads ? (
                    <>
                      <th scope="col">Lead ID</th>
                      <th scope="col">Full Name</th>
                      <th scope="col">Address</th>
                      <th scope="col">Phone</th>
                      <th scope="col">Email</th>
                    </>
                  ) : (
                    /* Header skips cols[1] because the body folds it into a cell-meta subtitle
                       under cols[0], so header + body cell counts match exactly. */
                    cols.map((c, ci) => (
                      ci === 1 ? null : <th key={c.key} scope="col">{c.label}</th>
                    ))
                  )}
                  <th scope="col">{isLeads ? 'Stage' : 'Status'}</th>
                  {/* Workflow "Move to" transitions used to live in their own column with a
                      button-stack — they now collapse into the row-actions menu so they don't
                      compete with the inline icons. */}
                  <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id} className={selected.has(r.id) ? 'row-selected' : ''}>
                    {!isLeads && (
                      <td className="sel-col">
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} aria-label="Select row" />
                      </td>
                    )}
                    {isLeads ? (
                      <>
                        <td><span className="lead-id">{r.ref ? String(r.ref) : leadRef(r.id)}</span></td>
                        <td>
                          <button className="row-link" onClick={() => openEdit(r)} disabled={!canEdit}>
                            {r.name ? String(r.name) : <span className="muted">—</span>}
                          </button>
                        </td>
                        <td>{leadCell(r.address)}</td>
                        <td>{leadCell(r.phone)}</td>
                        <td>{leadCell(r.email)}</td>
                      </>
                    ) : (
                      cols.map((c, ci) => (
                        ci === 1 ? null : (
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
                            ) : (
                              renderCell(c, r)
                            )}
                          </td>
                        )
                      ))
                    )}
                    <td>
                      {r.status ? (
                        <StatusPill variant={mapEntityStatus(r.status, def)} label={r.status} size="sm" minWidth={statusPillMinW} />
                      ) : ''}
                    </td>
                    <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        {(() => {
                          // Build menu items in declared order — capability/visibility
                          // gates decide what actually appears. Workflow transitions
                          // (was its own column with a button-stack) collapse in here
                          // at the top, above a separator before delete.
                          const transitions: RowAction[] = (hasWorkflow && canEdit)
                            ? nextFrom(r.status).map((to) => ({
                                key: `tr-${to}`,
                                label: `Move to ${to}`,
                                icon: <ArrowRightIcon size={14} />,
                                onClick: () => doTransition(r.id, to),
                              }))
                            : []
                          const ai: RowAction | null = (def.key === 'lead' || def.key === 'customer')
                            ? { key: 'ai', label: t('ai.title', 'AI assist'), icon: <SparkleIcon size={14} />, onClick: () => setAiRow(r) }
                            : null
                          const open: RowAction | null = (def.key === 'customer' && onOpenCustomer)
                            ? { key: 'open', label: t('cust.openWorkspace', 'Open workspace'), icon: <UsersIcon size={14} />, onClick: () => onOpenCustomer(r.id) }
                            : null
                          const billing: RowAction | null = def.key === 'customer'
                            ? { key: 'billing', label: 'Billing', icon: <ReceiptIcon size={14} />, onClick: () => setBillingRow(r) }
                            : null
                          const activity: RowAction = { key: 'activity', label: 'Activity', icon: <ClockIcon size={14} />, onClick: () => setActivityRow(r) }
                          const comments: RowAction = { key: 'comments', label: 'Comments', icon: <MessageIcon size={14} />, onClick: () => setCommentsRow(r) }
                          const del: RowAction | null = canDelete
                            ? { key: 'delete', label: t('common.delete', 'Delete'), icon: <TrashIcon size={14} />, danger: true, onClick: () => doDelete(r) }
                            : null
                          const actions: RowAction[] = [
                            ...transitions,
                            ...(ai ? [ai] : []),
                            ...(open ? [open] : []),
                            ...(billing ? [billing] : []),
                            activity,
                            comments,
                            ...(del ? [del] : []),
                          ]
                          const primary: RowAction | undefined = canEdit
                            ? { key: 'edit', label: t('common.edit', 'Edit'), icon: <EditIcon size={14} />, onClick: () => openEdit(r) }
                            : undefined
                          return (
                            <RowActionsMenu
                              primary={primary}
                              actions={actions}
                              ariaLabel={t('common.rowActions', 'Row actions')}
                            />
                          )
                        })()}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={colSpan}>
                      <EmptyState
                        icon={needle ? <SearchIcon size={40} /> : <InboxIcon size={40} />}
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
            <div className="table-foot" role="navigation" aria-label={t('pager.ariaLabel', 'Page navigation')}>
              <span style={{ color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-sm)' }} aria-live="polite">
                {t('pager.info', '{from}–{to} / {total}')
                  .replace('{from}', String(offset + 1))
                  .replace('{to}', String(Math.min(offset + PAGE_SIZE, total)))
                  .replace('{total}', String(total))}
              </span>
              <span className="spacer" />
              <Button variant="ghost" size="sm"
            onClick={() => goToPage(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0 || loading}
                aria-label={t('pager.prev', 'Previous page')}
              >
                <ChevronLeftIcon size={13} /> {t('pager.prev', 'Prev')}
              </Button>
              <Button variant="ghost" size="sm"
            onClick={() => goToPage(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total || loading}
                aria-label={t('pager.next', 'Next page')}
              >
                {t('pager.next', 'Next')} <ChevronRightIcon size={13} />
              </Button>
            </div>
          )}
        </div>
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

    </PageShell>
  )
}

// Map a status string to a StatusPill variant. Heuristic by name; the entity definition
// (`def.transitions` / `def.statuses`) is used as a backstop so terminal statuses with no
// well-known name still pill as `neutral` (history) rather than degraded.
type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapEntityStatus(status: string, def?: Def): PillVariant {
  const s = String(status ?? '').toLowerCase().replace(/[\s-]+/g, '_')
  if (['done', 'closed', 'active', 'paid', 'resolved', 'won', 'succeeded', 'enabled', 'completed'].includes(s)) return 'active'
  if (['cancelled', 'canceled', 'void', 'expired', 'failed', 'critical', 'lost', 'error', 'disabled', 'rejected', 'churned'].includes(s)) return 'critical'
  if (['pending', 'draft', 'new', 'prospect', 'open', 'qualified', 'sent', 'issued'].includes(s)) return 'info'
  if (['suspended', 'degraded', 'past_due', 'throttled', 'on_hold', 'blocked', 'warning'].includes(s)) return 'degraded'
  if (['in_progress', 'negotiation', 'processing'].includes(s)) return 'info'
  // Backstop via config: terminal status (no outgoing transitions) → neutral, initial → info
  if (def) {
    const meta = (def.statuses ?? []).find((x) => x.key === status)
    if (meta?.is_initial) return 'info'
    const hasOutgoing = (def.transitions ?? []).some((t) => t.from === status)
    if (!hasOutgoing && meta) return 'neutral'
  }
  return 'neutral'
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
  const { lang } = useI18n()
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
    input = <DatePicker value={value ?? ''} onChange={onChange} />
  } else if (f.type === 'datetime') {
    input = <input type="datetime-local" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'email') {
    input = <input type="email" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'phone') {
    input = <input type="tel" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'file') {
    input = <FileUpload value={value} onChange={onChange} />
  } else if (f.type === 'textarea') {
    input = <textarea className={cls + ' inp-area'} rows={4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'select') {
    // Geo / multilingual options: each option carries {hy,en,ru}; show only the
    // current system language, allow a typed value if it isn't listed.
    const i18nOpts = f.config?.i18n_options as Array<Record<string, string>> | undefined
    if (i18nOpts) {
      const labels = i18nOpts.map((o) => o[lang] || o.en || '').filter(Boolean)
      input = <Select value={value ?? ''} options={labels} onChange={onChange} allowCustom={!!f.config?.allow_custom} />
    } else {
      input = <Select value={value ?? ''} options={f.config?.options ?? []} onChange={onChange} />
    }
  } else if (f.type === 'multiselect') {
    input = <MultiSelect value={value} options={f.config?.options ?? []} onChange={onChange} />
  } else {
    input = <input type="text" className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  }

  return (
    <label className={'field field-' + f.type}>
      <span>{f.label}{f.required && ' *'}</span>
      {input}
      {isErr && <span className="inp-err"><WarningIcon size={12} /> {errorMsg}</span>}
    </label>
  )
}
