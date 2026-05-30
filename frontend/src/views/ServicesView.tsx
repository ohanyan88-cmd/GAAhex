import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, bdel, loadCustomers } from '../lib/billing'
import { Modal, confirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  ChevronLeftIcon, InboxIcon, SearchIcon, DownloadIcon, PlusIcon,
} from '../components/icons'
import {
  Wand2, Download, Plus, Filter, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'

// Services UI (A14 /api/services) — list + detail with resources + lifecycle. Degrades on 404.
type Service = { id: string; customer_id?: string | null; subscription_id?: string | null; type?: string; name?: string; status?: string | null; activated_at?: string | null; created_at?: string | null; resources?: Resource[] }
type Resource = { id: string; kind?: string; value?: string; label?: string | null; status?: string | null; created_at?: string | null }

const STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']
const TYPES = ['internet', 'tv', 'voip', 'hosting', 'other']
const KINDS = ['ip', 'mac', 'port', 'device', 'circuit', 'other']

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapServiceStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'ACTIVE') return 'active'
  if (v === 'SUSPENDED') return 'degraded'
  if (v === 'TERMINATED') return 'critical'
  if (v === 'PENDING') return 'info'
  return 'neutral'
}

function MoreVerticalIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </svg>
  )
}

function renderCell(colKey: string, sv: Service, cust: (sv: Service) => string) {
  switch (colKey) {
    case 'name': return <span className="mono">{sv.name ?? sv.id.slice(0, 8)}</span>
    case 'customer': return cust(sv)
    case 'type': return <span style={{ color: 'var(--gx-text-2)', textTransform: 'capitalize' }}>{sv.type ?? '—'}</span>
    case 'status': return sv.status
      ? <StatusPill variant={mapServiceStatus(sv.status)} label={sv.status} size="sm" />
      : <span>—</span>
    case 'activated': return <span className="mono">{fmtDate(sv.activated_at)}</span>
    default: return '—'
  }
}

export default function ServicesView({ token, canConfigure = false, configVersion = 0, onGoStudio }: { token: string; canConfigure?: boolean; configVersion?: number; onGoStudio?: () => void }) {
  const [list, setList] = useState<Service[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const page = usePageConfig(token, 'services', configVersion)
  const cf = useCustomFields(token, 'services', page.customFields, (list ?? []).map((sv) => sv.id))

  // Interaction state for reskin.
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pg, setPg] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    if (type) p.set('type', type)
    const qs = p.toString()
    const res = await bget<Service[]>(token, `/api/services${qs ? `?${qs}` : ''}`)
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError('Failed to load services'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
    setNames(await loadCustomers(token))
  }

  useEffect(() => { load() }, [token, status, type])
  useEffect(() => { setPg(1); setSelected(new Set()) }, [status, type, query, sortKey, sortDir])

  const cust = (sv: Service) => (sv.customer_id ? (names[sv.customer_id] ?? sv.customer_id.slice(0, 8)) : '—')

  const all = list ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((sv) => {
      const fields = [
        sv.name ?? '',
        cust(sv),
        sv.type ?? '',
        sv.status ?? '',
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, names])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (sv: Service): string | number => {
      switch (k) {
        case 'name': return sv.name ?? sv.id
        case 'customer': return cust(sv)
        case 'type': return sv.type ?? ''
        case 'status': return sv.status ?? ''
        case 'activated': return sv.activated_at ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, names])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE)
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }
  function toggleRow(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function togglePageAll() {
    setSelected((s) => {
      const n = new Set(s)
      if (allOnPageSelected) pageRows.forEach((r) => n.delete(r.id))
      else pageRows.forEach((r) => n.add(r.id))
      return n
    })
  }

  const activeCount = all.filter(s => (s.status ?? '').toUpperCase() === 'ACTIVE').length
  const suspendedCount = all.filter(s => (s.status ?? '').toUpperCase() === 'SUSPENDED').length
  const terminatedCount = all.filter(s => (s.status ?? '').toUpperCase() === 'TERMINATED').length

  if (denied) return <PermissionDenied message="You don't have permission to view services." />
  if (detailId) return <ServiceDetail token={token} id={detailId} names={names} onBack={() => { setDetailId(null); load() }} />

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs"><span>Billing</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{page.title}</span></div>

        <ViewHead
          icon={<InboxIcon size={18} />}
          title={page.title}
          sub={`${all.length} service${all.length !== 1 ? 's' : ''} · provisioned inventory · lifecycle engine`}
          actions={
            <>
              {canConfigure && onGoStudio && (
                <button className="btn btn-ghost btn-sm" onClick={onGoStudio} title="Every screen is config — edit this one in Studio">
                  <Wand2 size={14} style={{ color: 'var(--gx-gold)' }} /> Configure page
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => toast.success(`Export queued for ${sorted.length} service(s)`)}>
                <Download size={14} /> Export
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => toast.info('New service — wiring TBD')}>
                <Plus size={14} /> New service
              </button>
            </>
          }
        />

        {all.length > 0 && (
          <div className="kpi-strip">
            <div className="kpi">
              <span className="klbl">Total</span>
              <div className="kval tnum" style={{ fontSize: 24 }}>{all.length}</div>
              <span className="hint" style={{ fontSize: 11 }}>{activeCount} active</span>
            </div>
            <div className="kpi kpi--marquee">
              <span className="klbl">Active</span>
              <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-gold)' }}>{activeCount}</div>
              <span className="hint" style={{ fontSize: 11 }}>delivering</span>
            </div>
            {suspendedCount > 0 && (
              <div className="kpi">
                <span className="klbl">Suspended</span>
                <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-warning-fg)' }}>{suspendedCount}</div>
                <span className="hint" style={{ fontSize: 11 }}>action required</span>
              </div>
            )}
            {terminatedCount > 0 && (
              <div className="kpi">
                <span className="klbl">Terminated</span>
                <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-danger-fg)' }}>{terminatedCount}</div>
                <span className="hint" style={{ fontSize: 11 }}>closed</span>
              </div>
            )}
          </div>
        )}

        <div className="tabs">
          <button className={'tab' + (status === '' ? ' on' : '')} onClick={() => setStatus('')}>
            All <span className="tab-count">{all.length}</span>
          </button>
          {STATUSES.map((s) => (
            <button key={s} className={'tab' + (status === s ? ' on' : '')} onClick={() => setStatus(s)}>
              {s.charAt(0) + s.slice(1).toLowerCase()} <span className="tab-count">{all.filter(x => (x.status ?? '').toUpperCase() === s).length}</span>
            </button>
          ))}
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <p className="muted">Loading…</p>}
        {unavailable && <EmptyState icon={<InboxIcon size={40} />} title="Services aren't available yet" message="Provisioned services will appear here once the service inventory is enabled." />}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<InboxIcon size={40} />} title="No services" message="Nothing matches this filter." />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {selected.size > 0 && (
              <div className="bulkbar">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{selected.size} selected</span>
                <span className="spacer" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { console.log('[services] bulk export', Array.from(selected)); toast.success(`Export queued for ${selected.size} service(s)`) }}
                >
                  <DownloadIcon size={13} /> Export
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Cancel</button>
              </div>
            )}

            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search services"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => toast.info('Filter builder — configure in Studio')}>
                <Filter size={14} /> Filter
              </button>
              <select className="inp inp-sm" aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)} style={{ marginLeft: 8 }}>
                <option value="">All types</option>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="spacer" />
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input type="checkbox" checked={allOnPageSelected} onChange={togglePageAll} aria-label="Select all rows on this page" />
                    </th>
                    {page.columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        onClick={() => toggleSort(c.key)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {c.label}
                          {sortKey === c.key
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-primary)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-primary)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((sv) => (
                    <tr
                      key={sv.id}
                      className={selected.has(sv.id) ? 'sel' : ''}
                      onClick={() => setDetailId(sv.id)}
                    >
                      <td onClick={(e) => { e.stopPropagation(); toggleRow(sv.id) }} style={{ cursor: 'default' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(sv.id)}
                          onChange={() => toggleRow(sv.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select service ${sv.name ?? sv.id.slice(0, 8)}`}
                        />
                      </td>
                      {page.columns.map((c) => <td key={c.key}>{renderCell(c.key, sv, cust)}</td>)}
                      {cf.cells(sv.id)}
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 32 }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="iconbtn"
                            aria-label="Row menu"
                            title="Row actions"
                            onClick={(e) => { e.stopPropagation(); console.log('[services] row menu', sv.id) }}
                          >
                            <MoreVerticalIcon size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={page.columns.length + 2 + page.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching services.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span className="hint">
                {sorted.length === 0
                  ? '0 records'
                  : `Showing ${(pg - 1) * PAGE_SIZE + 1}–${Math.min(pg * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm btn-icon" disabled={pg <= 1} onClick={() => setPg(p => Math.max(1, p - 1))}>
                  <ChevronLeft size={15} />
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map(p => (
                  <button key={p} className={'btn btn-sm btn-icon ' + (p === pg ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPg(p)}>{p}</button>
                ))}
                <button className="btn btn-ghost btn-sm btn-icon" disabled={pg >= pageCount} onClick={() => setPg(p => Math.min(pageCount, p + 1))}>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ServiceDetail({ token, id, names, onBack }: { token: string; id: string; names: Record<string, string>; onBack: () => void }) {
  const [sv, setSv] = useState<Service | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [error, setError] = useState('')
  const [allocOpen, setAllocOpen] = useState(false)

  async function load() {
    setError('')
    const res = await bget<Service>(token, `/api/services/${id}`)
    if (!res.ok) { setError(res.status === 404 ? 'Service not found' : 'Failed to load service'); return }
    setSv(res.data)
    setResources(res.data?.resources ?? [])
  }
  useEffect(() => { load() }, [token, id])

  async function lifecycle(verb: 'activate' | 'suspend' | 'terminate') {
    if (verb === 'terminate') {
      const ok = await confirmDialog({ title: 'Terminate service', message: 'Terminate this service? This stops delivery.', confirmLabel: 'Terminate', danger: true })
      if (!ok) return
    }
    try {
      await bpost(token, `/api/services/${id}/${verb}`)
      toast.success(`Service ${verb}d`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function release(rid: string) {
    try {
      await bdel(token, `/api/services/${id}/resources/${rid}`)
      toast.success('Resource released')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const status = (sv?.status ?? '').toUpperCase()
  const cust = sv?.customer_id ? (names[sv.customer_id] ?? sv.customer_id.slice(0, 8)) : '—'

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="view-head">
          <button className="btn btn-ghost btn-sm" onClick={onBack}><ChevronLeftIcon size={14} /> Services</button>
          <h2 style={{ marginLeft: 8 }}>{sv?.name ?? `Service ${id.slice(0, 8)}`}</h2>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}
        {!sv && !error && <p className="muted">Loading…</p>}

        {sv && (
          <>
            <div className="bill-meta">
              <div><span className="muted">Customer</span><div>{cust}</div></div>
              <div><span className="muted">Type</span><div>{sv.type ?? '—'}</div></div>
              <div><span className="muted">Status</span><div>{sv.status ? <StatusPill variant={mapServiceStatus(sv.status)} label={sv.status} size="sm" /> : '—'}</div></div>
              <div><span className="muted">Activated</span><div>{fmtDate(sv.activated_at)}</div></div>
              <div className="bill-actions">
                {(status === 'PENDING' || status === 'SUSPENDED') && <button className="btn btn-primary btn-sm" onClick={() => lifecycle('activate')}>Activate</button>}
                {status === 'ACTIVE' && <button className="btn btn-ghost btn-sm" onClick={() => lifecycle('suspend')}>Suspend</button>}
                {status !== 'TERMINATED' && <button className="btn btn-danger btn-sm" onClick={() => lifecycle('terminate')}>Terminate</button>}
              </div>
            </div>

            <div className="bill-section-head">
              <h3>Resources</h3>
              {status !== 'TERMINATED' && <button className="btn btn-ghost btn-sm" onClick={() => setAllocOpen(true)}>+ Allocate</button>}
            </div>
            {resources.length === 0
              ? <p className="muted">No resources allocated.</p>
              : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="grid-wrap">
                    <table className="grid">
                      <thead><tr><th scope="col">Kind</th><th scope="col">Value</th><th scope="col">Label</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
                      <tbody>
                        {resources.map((r) => {
                          const rs = (r.status ?? '').toUpperCase()
                          return (
                            <tr key={r.id}>
                              <td>{r.kind ?? '—'}</td>
                              <td className="mono">{r.value ?? '—'}</td>
                              <td>{r.label ?? '—'}</td>
                              <td>{rs === 'RELEASED'
                                ? <StatusPill variant="neutral" label="released" size="sm" />
                                : <StatusPill variant="active" label="allocated" size="sm" />}
                              </td>
                              <td><div className="row-actions" style={{ justifyContent: 'flex-end' }}>{rs !== 'RELEASED' && <button className="btn btn-ghost btn-sm" onClick={() => release(r.id)}>Release</button>}</div></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
          </>
        )}

        {allocOpen && <AllocateModal token={token} serviceId={id} onClose={() => setAllocOpen(false)} onDone={() => { setAllocOpen(false); load() }} />}
      </div>
    </div>
  )
}

function AllocateModal({ token, serviceId, onClose, onDone }: { token: string; serviceId: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('ip')
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!value.trim() || saving) return
    setSaving(true)
    try {
      await bpost(token, `/api/services/${serviceId}/resources`, { kind, value: value.trim(), label: label.trim() || undefined })
      toast.success('Resource allocated')
      onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Allocate resource" size="sm"
      footer={<>
        <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
        <button className="btn btn-accent btn-md" disabled={saving || !value.trim()} onClick={submit}>{saving ? 'Saving…' : 'Allocate'}</button>
      </>}>
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field"><span>Kind</span>
          <select className="inp inp-md" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        </label>
        <label className="field"><span>Value *</span><input className="inp inp-md mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder="10.0.0.5" /></label>
        <label className="field"><span>Label</span><input className="inp inp-md" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" /></label>
      </div>
    </Modal>
  )
}
