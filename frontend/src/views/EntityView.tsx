import { useEffect, useState } from 'react'
import { getEntityDef, createRecord, transitionRecord, listRecordsPaged, uploadAttachments, generateContractPdf } from '../lib/api'
import RefPicker, { refTargetKey, loadRefLabels } from '../components/RefPicker'
import {
  CheckIcon, ArrowRightIcon, SearchIcon, MessageIcon, ClockIcon, ReceiptIcon,
  SparkleIcon, UsersIcon, LockIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon,
  RowsIcon, PlusIcon, EditIcon, GearIcon, TrashIcon, InboxIcon, LayersIcon, PackageIcon,
} from '../components/icons'
import RowActionsMenu, { type RowAction } from '../components/RowActionsMenu'
import { confirmDialog, Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import CommentsModal from '../modals/CommentsModal'
import CustomerBillingModal from '../modals/CustomerBillingModal'
import AiAssistModal from '../modals/AiAssistModal'
import { EmptyState, PermissionDenied, NotFound, LoadingState, ErrorBanner } from '../components/States'
import ActivityTimeline from '../components/ActivityTimeline'
import { LeadGatesStrip } from '../components/LeadGatesStrip'
import { useI18n } from '../lib/i18n'
import { buildContractHtml, contractFileName } from '../lib/contract'
import NoAccess from '../components/NoAccess'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { Button, StatusPill } from '../primitives'
import { PageShell } from '../page-shell'
import type { SecondaryAction } from '../page-shell'
import { BASE } from '../lib/config'
import { authH } from '../lib/billing'
import { useAuth } from '../context/AuthContext'
import type { Def, Row, Mode, SavedView, StatusTab, ExportFormats } from './entity/types'
import { deriveStatusGroups, pagePropsForSlug, mapEntityStatus, errFieldOf, capitalize } from './entity/types'
import { deriveEntityKPIs, deriveLeadsWeeklyKPIs } from './entity/kpis'
import { probeEntityExportFormats, patchRecord } from './entity/api'
import { EntityFormModal } from './entity/EntityFormModal'

const PAGE_SIZE = 50

// One generic component renders EVERY entity from its config — no per-entity code.
export default function EntityView({ slug, onOpenCustomer, onOpenPipeline, capabilities = FULL_ACCESS, onBack, canConfigure = false, onConfigure }: {
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
  const { token } = useAuth()
  const { t, lang } = useI18n()
  const [def, setDef] = useState<Def | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [form, setForm] = useState<Record<string, any>>({})
  const [contractUrl, setContractUrl] = useState<string | null>(null)
  const [contractPdfUrl, setContractPdfUrl] = useState<string | null>(null)
  const [contractBusy, setContractBusy] = useState(false)
  const [mode, setMode] = useState<Mode>('idle')
  // Leads page view switcher (Gev directive 2026-06-11): Table | Kanban | Cards. Leads-only; every
  // other entity keeps the table unchanged. Choice persisted.
  const [leadsView, setLeadsView] = useState<'table' | 'kanban' | 'cards'>(() => {
    try { return (localStorage.getItem('leads-view-mode') as 'table' | 'kanban' | 'cards') || 'table' }
    catch { return 'table' }
  })
  const setLeadsViewMode = (m: 'table' | 'kanban' | 'cards') => {
    setLeadsView(m)
    try { localStorage.setItem('leads-view-mode', m) } catch { /* ignore */ }
  }
  const [createStep, setCreateStep] = useState<'pick' | 'form'>('pick')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingStatus, setEditingStatus] = useState<string | null>(null)
  const [refLabels, setRefLabels] = useState<Record<string, Record<string, string>>>({})
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  const [exportFormats, setExportFormats] = useState<ExportFormats | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)

  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState<number | null>(null)

  const [statusTab, setStatusTab] = useState<StatusTab>('all')
  const [filterSelectField, setFilterSelectField] = useState<string>('')
  const [filterSelectVal, setFilterSelectVal] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')

  async function load(s: string, pageOffset = offset) {
    setLoading(true); setFatal(null)
    try {
      let d: Def
      try { d = await getEntityDef(token!, s) } catch { setFatal('notfound'); return }
      setDef(d)
      const params = new URLSearchParams()
      if (appliedQ) params.set('q', appliedQ)
      if (filter) params.set('filter', filter)
      params.set('sort', sort || '-created_at')
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(pageOffset))
      const { rows: fetched, total: tot, status } = await listRecordsPaged(token!, s, params)
      if (status === 403) { setFatal('denied'); return }
      if (status >= 400 && status !== 403) throw new Error('Failed to load records')
      setRows(fetched)
      setTotal(tot)
      setSelected(new Set())
      const maps: Record<string, Record<string, string>> = {}
      for (const f of d.fields.filter((x) => x.type === 'ref')) {
        const tk = refTargetKey(f.config)
        if (tk) maps[f.key] = await loadRefLabels(token!, tk)
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

  async function loadViews(s: string) {
    try {
      const r = await fetch(`${BASE}/api/views?entity=${encodeURIComponent(s)}`, { headers: authH(token!) })
      if (!r.ok) { setViewsAvailable(false); setViews([]); return }
      const data = await r.json()
      setViews(Array.isArray(data) ? data : [])
      setViewsAvailable(true)
    } catch {
      setViewsAvailable(false); setViews([])
    }
  }

  useEffect(() => {
    closeForm(); setError(''); setErrorField(null)
    setQ(''); setAppliedQ(''); setFilter(''); setSort(''); setActiveView('')
    setOffset(0); setTotal(null)
    setStatusTab('all'); setFilterSelectField(''); setFilterSelectVal(''); setFilterStatus('')
    loadViews(slug)
  }, [slug])

  useEffect(() => {
    setExportFormats(null)
    let alive = true
    probeEntityExportFormats(token!, slug).then((f) => { if (alive) setExportFormats(f) })
    return () => { alive = false }
  }, [slug])

  useEffect(() => {
    const id = setTimeout(() => setAppliedQ(q), 300)
    return () => clearTimeout(id)
  }, [q])

  useEffect(() => {
    setOffset(0)
    load(slug, 0).catch((e) => setError((e as Error).message))
  }, [slug, appliedQ, filter, sort])

  function clearContract() {
    setContractUrl((u) => { if (u) URL.revokeObjectURL(u); return null })
    setContractPdfUrl((u) => { if (u) URL.revokeObjectURL(u); return null })
  }

  function closeForm() {
    setMode('idle'); setForm({}); setEditingId(null); setEditingStatus(null); setErrorField(null)
    clearContract()
  }

  async function generateContract() {
    const fields = def?.fields ?? []
    const html = buildContractHtml(form, fields)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    setContractUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(blob) })
    setContractBusy(true)
    try {
      const pdf = await generateContractPdf(token!, form, fields.map((f) => ({ key: f.key, label: f.label, type: f.type })))
      setContractPdfUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(pdf) })
    } catch {
      setContractPdfUrl(null)
    } finally {
      setContractBusy(false)
    }
  }

  function _saveAs(url: string, ext: string) {
    const a = document.createElement('a')
    a.href = url
    a.download = contractFileName(form).replace(/\.html$/, ext)
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  function downloadContract() { if (contractUrl) _saveAs(contractUrl, '.html') }
  function downloadContractPdf() { if (contractPdfUrl) _saveAs(contractPdfUrl, '.pdf') }

  function openCreate() {
    setError(''); setErrorField(null); setForm({}); setEditingId(null); setEditingStatus(null)
    clearContract()
    setCreateStep('pick')
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
    setCreateStep('form')
    setMode('editing')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setErrorField(null)
    try {
      const payload: Record<string, unknown> = {}
      def!.fields.forEach((f) => {
        if (f.type === 'status') return
        if (f.type === 'file') return
        if (f.editable === false) return
        const v = form[f.key]
        if (mode === 'creating') {
          if (v !== undefined && v !== '') payload[f.key] = v
        } else {
          if (v !== undefined) payload[f.key] = v
        }
      })
      const wasEditing = mode === 'editing'
      let recordId = editingId
      if (wasEditing && editingId) await patchRecord(token!, slug, editingId, payload)
      else { const created = await createRecord(token!, slug, payload); recordId = created?.id ?? null }
      if (recordId) {
        for (const ff of def!.fields.filter((f) => f.type === 'file')) {
          const picked = form[ff.key]
          if (Array.isArray(picked) && picked.length > 0) {
            await uploadAttachments(token!, def!.key, recordId, picked as File[])
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
      await transitionRecord(token!, slug, id, to)
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
      const r = await fetch(`${BASE}/api/${slug}/${row.id}`, { method: 'DELETE', headers: authH(token!) })
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
        headers: { ...authH(token!), 'Content-Type': 'application/json' },
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

  const entityKey = def.key
  const canView   = can(capabilities, entityKey, 'view')
  const canCreate = can(capabilities, entityKey, 'create')
  const canEdit   = can(capabilities, entityKey, 'edit')
  const canDelete = can(capabilities, entityKey, 'delete')
  if (!canView) {
    return <NoAccess what={def.label_plural} onBack={onBack} />
  }
  const readOnly = !canCreate && !canEdit && !canDelete

  const cols = def.fields.filter((f) => f.type !== 'status')
  const isLeads = slug === 'leads'
  const leadRef = (id: unknown) => 'LED-' + String(id).replace(/-/g, '').slice(-6).toUpperCase()
  const leadCell = (v: unknown) => (v == null || v === '' ? <span className="muted">—</span> : String(v))
  const hasWorkflow = (def.transitions ?? []).length > 0
  const nextFrom = (status: string | null) => (def.transitions ?? []).filter((t) => t.from === status).map((t) => t.to)

  // One lead card — shared by the Cards grid and the Kanban columns (leads view switcher).
  const leadCardEV = (r: Row) => (
    <div key={r.id} className="kcard">
      <div className="mono" style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-link)', marginBottom: 'var(--gx-space-3)' }}>
        {r.ref ? String(r.ref) : leadRef(r.id)}
      </div>
      <button className="row-link" onClick={() => openEdit(r)} disabled={!canEdit}
        style={{ fontSize: 'var(--gx-text-sm)', display: 'block', textAlign: 'left', marginBottom: 'var(--gx-space-4)', ...(canEdit ? {} : { cursor: 'default', pointerEvents: 'none' }) }}>
        {r.name ? String(r.name) : '—'}
      </button>
      {(r.phone || r.email || r.address) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-3)', marginBottom: 'var(--gx-space-4)', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>
          {r.phone ? <span className="mono">{String(r.phone)}</span> : null}
          {r.email ? <span className="mono">{String(r.email)}</span> : null}
          {r.address ? <span>{String(r.address)}</span> : null}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)', flexWrap: 'wrap' }}>
        {r.status ? <StatusPill variant={mapEntityStatus(r.status, def)} label={r.status} size="sm" /> : null}
        {hasWorkflow && canEdit && nextFrom(r.status).map((to) => (
          <Button key={to} variant="ghost" size="sm" onClick={() => doTransition(r.id, to)} style={{ fontSize: 'var(--gx-text-11)' }}>
            <ArrowRightIcon size={11} />{to}
          </Button>
        ))}
      </div>
    </div>
  )
  const formOpen = mode !== 'idle'

  const cellValue = (c: typeof cols[0], r: Row) => (c.type === 'ref' ? (refLabels[c.key]?.[r[c.key]] ?? r[c.key]) : r[c.key])

  const statusGroups = deriveStatusGroups(def)
  const hasStatusTabs = (def.statuses ?? []).length > 0

  const selectFields = cols.filter((f) => f.type === 'select')
  const activeFilterField = filterSelectField || (selectFields.length > 0 ? selectFields[0].key : '')
  const activeFilterFieldDef = selectFields.find((f) => f.key === activeFilterField)

  const needle = appliedQ.trim().toLowerCase()
  const visibleRows = rows.filter((r) => {
    if (needle && !(
      cols.some((c) => String(cellValue(c, r) ?? '').toLowerCase().includes(needle)) ||
      String(r.status ?? '').toLowerCase().includes(needle)
    )) return false
    if (hasStatusTabs && statusTab !== 'all') {
      const st = r.status ?? ''
      if (statusTab === 'drafts' && !statusGroups.drafts.includes(st)) return false
      if (statusTab === 'active' && !statusGroups.active.includes(st)) return false
      if (statusTab === 'history' && !statusGroups.history.includes(st)) return false
    }
    if (filterStatus && r.status !== filterStatus) return false
    if (activeFilterField && filterSelectVal && String(r[activeFilterField] ?? '') !== filterSelectVal) return false
    return true
  })

  // Leads default (Gev 2026-06-11): all views show only the 20 most recent leads (load sorts
  // -created_at). The rest are reachable via search — which re-queries the server.
  const displayRows = (isLeads && !needle) ? visibleRows.slice(0, 20) : visibleRows

  const statusPillMinW = (() => {
    const n = visibleRows.reduce((m, r) => Math.max(m, String(r.status ?? '').length), 0)
    return n > 0 ? n * 9 + 34 : undefined
  })()

  const tabCount = (tab: StatusTab): number => {
    if (!hasStatusTabs) return rows.length
    if (tab === 'all') return rows.length
    const groups = tab === 'drafts' ? statusGroups.drafts : tab === 'active' ? statusGroups.active : statusGroups.history
    return rows.filter((r) => groups.includes(r.status ?? '')).length
  }

  function renderCell(c: typeof cols[0], r: Row) {
    const v = cellValue(c, r)
    if (c.type === 'boolean') return r[c.key] ? <CheckIcon size={15} /> : ''
    if (Array.isArray(v)) return v.join(', ')
    return String(v ?? '')
  }

  async function doExport(format: string) {
    setExporting(format)
    try {
      const params = new URLSearchParams({ format })
      params.set('lang', lang)
      if (appliedQ) params.set('q', appliedQ)
      if (filter) params.set('filter', filter)
      if (sort) params.set('sort', sort)
      const r = await fetch(`${BASE}/api/${slug}/export?${params.toString()}`, {
        headers: authH(token!),
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

  async function runBulk(action: 'delete' | 'transition', to?: string) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    try {
      const r = await fetch(`${BASE}/api/${slug}/bulk`, {
        method: 'POST',
        headers: { ...authH(token!), 'Content-Type': 'application/json' },
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

  const dataCellCount = cols.length >= 2 ? cols.length - 1 : cols.length
  const colSpan = isLeads ? 5 + 1 + 1 : 1 /* checkbox */ + dataCellCount + 1 /* status */ + 1 /* actions */

  const countLabel = total !== null
    ? `${total.toLocaleString()} ${def.label_plural.toLowerCase()}`
    : rows.length > 0
      ? `${rows.length.toLocaleString()} ${def.label_plural.toLowerCase()}`
      : def.label_plural.toLowerCase()

  const pp = pagePropsForSlug(slug, def)

  const shellPrimary = canCreate
    ? { label: `${t('common.new', 'New')} ${def.label}`, icon: <PlusIcon size={13} aria-hidden />, onClick: openCreate }
    : undefined

  const shellSecondary: SecondaryAction[] = []
  const canExport = exportFormats !== null && (exportFormats.csv || exportFormats.xlsx || exportFormats.pdf)
  if (canExport) {
    const fmts: { label: string; icon?: React.ReactNode; onClick: () => void }[] = []
    if (exportFormats?.csv) fmts.push({ label: 'CSV', icon: <DownloadIcon size={14} aria-hidden />, onClick: () => doExport('csv') })
    if (exportFormats?.xlsx) fmts.push({ label: 'XLSX · Excel', icon: <DownloadIcon size={14} aria-hidden />, onClick: () => doExport('xlsx') })
    if (exportFormats?.pdf) fmts.push({ label: 'PDF', icon: <DownloadIcon size={14} aria-hidden />, onClick: () => doExport('pdf') })
    shellSecondary.push({ label: t('common.download', 'Download'), icon: <DownloadIcon size={13} aria-hidden />, disabled: exporting !== null, menu: fmts })
  }
  if (canConfigure && onConfigure) {
    shellSecondary.push({ label: t('common.configurePageTitle', 'Configure'), icon: <GearIcon size={13} />, onClick: onConfigure })
  }

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

      {slug === 'leads' && !formOpen && <LeadGatesStrip rows={rows} onOpenGate={onOpenPipeline} />}

      {hasStatusTabs && !formOpen && slug !== 'leads' && (
        <>
          <div className="tabs">
            {([
              ['all',     'All'],
              ['active',  'Active'],
              ['history', 'History'],
              ['drafts',  'Drafts'],
            ] as [StatusTab, string][]).map(([tab, label]) => {
              const cnt = tabCount(tab)
              return (
                <button
                  key={tab}
                  className={'tab' + (statusTab === tab ? ' on' : '')}
                  onClick={() => { setStatusTab(tab); setFilterStatus('') }}
                >
                  {label}
                  <span className="tab-count">{cnt}</span>
                </button>
              )
            })}
          </div>

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

      {formOpen && (
        <EntityFormModal
          mode={mode}
          def={def}
          form={form}
          createStep={createStep}
          contractUrl={contractUrl}
          contractPdfUrl={contractPdfUrl}
          contractBusy={contractBusy}
          editingStatus={editingStatus}
          errorField={errorField}
          error={error}
          onClose={closeForm}
          onSubmit={submit}
          onFormChange={(k, v) => setForm({ ...form, [k]: v })}
          onSetCreateStep={setCreateStep}
          onGenerateContract={generateContract}
          onDownloadContract={downloadContract}
          onDownloadContractPdf={downloadContractPdf}
        />
      )}

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
        <div className={'card' + (isLeads ? ' leads-flat' : '')} style={{ overflow: 'hidden', position: 'relative' }}>
          {selected.size > 0 && (
            <div className="bulkbar">
              <span style={{ fontWeight: 'var(--gx-weight-semibold)', fontSize: 'var(--gx-text-sm)' }}>{selected.size} selected</span>
              <span className="spacer" />
              {canEdit && transitionTargets.length > 0 && (
                <>
                  <select className="inp inp-sm" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} aria-label="Move to status">
                    <option value="">Move to…</option>
                    {transitionTargets.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" disabled={!bulkTo} onClick={() => runBulk('transition', bulkTo)}>Move</Button>
                </>
              )}
              {canDelete && (
                <Button variant="danger" size="sm" onClick={bulkDelete}>Delete selected</Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>Cancel</Button>
            </div>
          )}

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

          {isLeads && (
            <div className="row" style={{ gap: 'var(--gx-space-2)', marginBottom: 'var(--gx-space-5)' }}>
              <Button variant={leadsView === 'table' ? 'primary' : 'ghost'} size="sm" style={{ minWidth: 96, justifyContent: 'center' }} onClick={() => setLeadsViewMode('table')}>
                <RowsIcon size={13} /> {t('leads.viewTable', 'Table')}
              </Button>
              <Button variant={leadsView === 'kanban' ? 'primary' : 'ghost'} size="sm" style={{ minWidth: 96, justifyContent: 'center' }} onClick={() => setLeadsViewMode('kanban')}>
                <LayersIcon size={13} /> {t('leads.viewKanban', 'Kanban')}
              </Button>
              <Button variant={leadsView === 'cards' ? 'primary' : 'ghost'} size="sm" style={{ minWidth: 96, justifyContent: 'center' }} onClick={() => setLeadsViewMode('cards')}>
                <PackageIcon size={13} /> {t('leads.viewCards', 'Cards')}
              </Button>
            </div>
          )}

          {(!isLeads || leadsView === 'table') && (
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
                    cols.map((c, ci) => (
                      ci === 1 ? null : <th key={c.key} scope="col">{c.label}</th>
                    ))
                  )}
                  <th scope="col">{isLeads ? 'Stage' : 'Status'}</th>
                  <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => (
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
                              <>
                                <button
                                  className="row-link"
                                  onClick={() => openEdit(r)}
                                  disabled={!canEdit}
                                  style={canEdit ? undefined : { cursor: 'default', pointerEvents: 'none' }}
                                >
                                  {renderCell(c, r) || <span className="muted">—</span>}
                                </button>
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
                {!loading && displayRows.length === 0 && (
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
          )}

          {isLeads && leadsView === 'kanban' && (
            <div className="kanban">
              {[...(def.statuses ?? [])].sort((a, b) => a.order - b.order).map((col) => {
                const items = displayRows.filter((r) => (r.status ?? '') === col.key)
                return (
                  <div key={col.key} className="kcol">
                    <div className="kcol-head">
                      <span style={{ fontSize: 'var(--gx-text-sm)', fontWeight: 'var(--gx-weight-semibold)' }}>{col.label}</span>
                      <span className="kcol-count">{items.length}</span>
                    </div>
                    <div className="kcol-body">
                      {items.map((r) => leadCardEV(r))}
                      {items.length === 0 && (
                        <div style={{ padding: 'var(--gx-space-5)', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-sm)', borderRadius: 'var(--gx-radius-sm)', border: '1px dashed var(--gx-border)' }}>
                          {t('leads.emptyStage', 'No leads in this stage')}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {isLeads && leadsView === 'cards' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--gx-space-5)', maxHeight: '60vh', overflowY: 'auto', paddingRight: 'var(--gx-space-2)' }}>
              {displayRows.map((r) => leadCardEV(r))}
            </div>
          )}

          {total !== null && total > PAGE_SIZE && !(isLeads && !needle) && (
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
          slug={slug}
          recordId={commentsRow.id}
          label={def.label}
          onClose={() => setCommentsRow(null)}
        />
      )}

      {activityRow && (
        <Modal open onClose={() => setActivityRow(null)} title={`Activity · ${def.label}`} size="md">
          <ActivityTimeline entity={slug} record={activityRow.id} />
        </Modal>
      )}

      {billingRow && (
        <CustomerBillingModal
          customerId={billingRow.id}
          customerLabel={billingRow.name ?? billingRow.title ?? String(billingRow.id).slice(0, 8)}
          onClose={() => setBillingRow(null)}
        />
      )}

      {aiRow && (
        <AiAssistModal
          entityKey={def.key}
          recordId={aiRow.id}
          label={aiRow.name ?? aiRow.title ?? aiRow.subject ?? String(aiRow.id).slice(0, 8)}
          onClose={() => setAiRow(null)}
        />
      )}

    </PageShell>
  )
}
