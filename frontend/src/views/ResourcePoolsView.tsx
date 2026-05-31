import { useEffect, useMemo, useState } from 'react'
import { bget, bpost } from '../lib/billing'
import { Modal, confirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import {
  ChevronLeftIcon, InboxIcon, ServerIcon, SearchIcon, GearIcon,
} from '../components/icons'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { t } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'

// Resource pools / IPAM (A15 /api/resource-pools) — list + detail with allocations. Degrades on 404.
// Backend serializes the live allocation tally as `allocated_count` (see respool.py _pool()).
type Pool = { id: string; name?: string; kind?: string; spec?: any; allocated_count?: number; status?: string | null; created_at?: string | null }
type Allocation = { id: string; value?: string; service_id?: string | null; status?: string | null; allocated_at?: string | null }
type Svc = { id: string; name?: string }

const KINDS = ['ipv4', 'ipv6', 'vlan', 'phone', 'other']

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
// Map only real status enums; missing status → caller renders nothing (no fake "available" default).
function mapPoolStatus(raw: string): { label: string; variant: PillVariant } | null {
  const v = raw.toUpperCase()
  if (v === 'AVAILABLE') return { label: 'available', variant: 'active' }
  if (v === 'RESERVED') return { label: 'reserved', variant: 'info' }
  if (v === 'EXHAUSTED') return { label: 'exhausted', variant: 'critical' }
  if (v === 'DISABLED') return { label: 'disabled', variant: 'neutral' }
  return null
}

function specSummary(spec: any): string {
  if (!spec || typeof spec !== 'object') return '—'
  if (spec.cidr) return String(spec.cidr)
  if (spec.from || spec.to) return `${spec.from ?? '?'}–${spec.to ?? '?'}`
  return JSON.stringify(spec)
}
function allocCount(p: Pool): string {
  const n = p.allocated_count
  return typeof n === 'number' ? String(n) : '—'
}

export default function ResourcePoolsView({ token, canConfigure = false, configVersion = 0, onConfigure }: { token: string; canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
  const cfg = usePageConfig(token, 'resource-pools', configVersion)
  const [list, setList] = useState<Pool[] | null>(null)
  const cf = useCustomFields(token, 'resource-pools', cfg.customFields, (list ?? []).map((p) => p.id))
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('ipv4')
  const [cidr, setCidr] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<Pool[]>(token, '/api/resource-pools')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError(t('pools.loadError', 'Failed to load resource pools')); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

  async function create() {
    if (!name.trim()) return
    const spec = (kind === 'ipv4' || kind === 'ipv6') ? { cidr: cidr.trim() } : (kind === 'vlan' || kind === 'phone') ? { from: from.trim(), to: to.trim() } : {}
    try {
      await bpost(token, '/api/resource-pools', { name: name.trim(), kind, spec })
      toast.success(t('pools.created', 'Pool created'))
      setCreating(false); setName(''); setKind('ipv4'); setCidr(''); setFrom(''); setTo('')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const all = list ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((p) => {
      const fields = [
        p.name ?? '',
        p.kind ?? '',
        specSummary(p.spec),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  }, [all, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (p: Pool): string | number => {
      switch (k) {
        case 'name': return p.name ?? ''
        case 'kind': return p.kind ?? ''
        case 'spec': return specSummary(p.spec)
        case 'allocations': return typeof p.allocated_count === 'number' ? p.allocated_count : -1
        case 'status': return p.status ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function colThClass(colKey: string): string { return colKey === 'allocations' ? 'num' : '' }
  function colTdClass(colKey: string): string { return colKey === 'allocations' ? 'num' : '' }

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  // KPI strip aggregates ONLY real, server-provided allocation counts. Pools without the field
  // contribute to the count of pools-of-that-kind but NOT to the allocations total.
  const byKind = useMemo(() => {
    return all.reduce<Record<string, { count: number; allocs: number; hasAllocData: boolean }>>((acc, p) => {
      const k = p.kind ?? 'other'
      if (!acc[k]) acc[k] = { count: 0, allocs: 0, hasAllocData: false }
      acc[k].count++
      if (typeof p.allocated_count === 'number') {
        acc[k].allocs += p.allocated_count
        acc[k].hasAllocData = true
      }
      return acc
    }, {})
  }, [all])

  if (denied) return <PermissionDenied message={t('pools.denied', 'Resource pools are admin-only.')} />
  if (detailId) return <PoolDetail token={token} id={detailId} onBack={() => { setDetailId(null); load() }} />

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs"><span>Inventory</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>

        <ViewHead
          icon={<ServerIcon size={18} />}
          title={cfg.title}
          sub={`${all.length} pool${all.length !== 1 ? 's' : ''}`}
          actions={!unavailable && (
            <>
              {canConfigure && onConfigure && (
                <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
                  <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
                <Plus size={14} /> {creating ? 'Close' : 'New pool'}
              </button>
            </>
          )}
        />

        {all.length > 0 && Object.keys(byKind).length > 0 && (
          <div className="kpi-strip">
            {Object.entries(byKind).map(([k, info], i) => (
              <div key={k} className={i === 0 ? 'kpi kpi--marquee' : 'kpi'}>
                <span className="klbl">{k.toUpperCase()}</span>
                <div className="kval tnum" style={{ fontSize: 24, color: i === 0 ? 'var(--gx-gold)' : undefined }}>{info.count}</div>
                {info.hasAllocData && (
                  <span className="hint" style={{ fontSize: 11 }}>{info.allocs} allocation{info.allocs !== 1 ? 's' : ''}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {creating && (
          <div className="rec-form">
            <label className="field"><span>Name *</span><input className="inp inp-md" value={name} onChange={(e) => setName(e.target.value)} placeholder="Yerevan /24" /></label>
            <label className="field"><span>Kind</span>
              <select className="inp inp-md" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
            </label>
            {(kind === 'ipv4' || kind === 'ipv6') && (
              <label className="field"><span>CIDR</span><input className="inp inp-md mono" value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="10.0.0.0/24" /></label>
            )}
            {(kind === 'vlan' || kind === 'phone') && (
              <>
                <label className="field"><span>From</span><input className="inp inp-md mono" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="100" /></label>
                <label className="field"><span>To</span><input className="inp inp-md mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="200" /></label>
              </>
            )}
            <div className="rec-form-actions"><button className="btn btn-accent btn-md" onClick={create} disabled={!name.trim()}>Create</button></div>
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <SkeletonRows />}
        {unavailable && <EmptyState icon={<InboxIcon size={40} />} title={t('pools.unavailable', "Resource pools aren't available yet")} message={t('pools.unavailableMsg', 'IPAM pools will appear here once the inventory service is enabled.')} />}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<InboxIcon size={40} />} title="No pools" message="Create a block to allocate values from." />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search pools"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <span className="spacer" />
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {cfg.columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={colThClass(c.key)}
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
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => setDetailId(p.id)}
                    >
                      {cfg.columns.map((c) => {
                        let cell: React.ReactNode
                        switch (c.key) {
                          case 'name': cell = <strong>{p.name ?? p.id.slice(0, 8)}</strong>; break
                          case 'kind': cell = <span style={{ textTransform: 'uppercase', fontSize: 11, fontWeight: 600, color: 'var(--gx-text-2)' }}>{p.kind ?? '—'}</span>; break
                          case 'spec': cell = <span className="mono" style={{ fontSize: 12, color: 'var(--gx-text-3)' }}>{specSummary(p.spec)}</span>; break
                          case 'allocations': cell = <span className="mono tnum">{allocCount(p)}</span>; break
                          case 'status': {
                            const sp = p.status ? mapPoolStatus(p.status) : null
                            cell = sp ? <StatusPill variant={sp.variant} label={sp.label} size="sm" /> : <span>—</span>
                            break
                          }
                          default: cell = '—'
                        }
                        return <td key={c.key} className={colTdClass(c.key)}>{cell}</td>
                      })}
                      {cf.cells(p.id)}
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + cfg.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching pools.
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
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft size={15} />
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map(p => (
                  <button key={p} className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
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

function PoolDetail({ token, id, onBack }: { token: string; id: string; onBack: () => void }) {
  const [pool, setPool] = useState<Pool | null>(null)
  const [allocs, setAllocs] = useState<Allocation[]>([])
  const [services, setServices] = useState<Svc[]>([])
  const [error, setError] = useState('')
  const [allocOpen, setAllocOpen] = useState(false)

  async function load() {
    setError('')
    const pr = await bget<Pool>(token, `/api/resource-pools/${id}`)
    if (!pr.ok) { setError(pr.status === 404 ? t('pools.poolNotFound', 'Pool not found') : t('pools.poolLoadError', 'Failed to load pool')); return }
    setPool(pr.data)
    const ar = await bget<Allocation[]>(token, `/api/resource-pools/${id}/allocations`)
    setAllocs(ar.ok && Array.isArray(ar.data) ? ar.data : [])
  }
  useEffect(() => { load() }, [token, id])
  useEffect(() => { bget<Svc[]>(token, '/api/services').then((r) => setServices(r.ok && Array.isArray(r.data) ? r.data : [])) }, [token])

  const svcName = (sid: string | null | undefined) => (sid ? (services.find((s) => s.id === sid)?.name ?? sid.slice(0, 8)) : '—')

  async function release(aid: string) {
    const ok = await confirmDialog({ title: 'Release value', message: 'Release this allocated value back to the pool?', confirmLabel: 'Release', danger: true })
    if (!ok) return
    try {
      // Backend exposes release as POST .../allocations/{alloc_id}/release (not DELETE).
      await bpost(token, `/api/resource-pools/${id}/allocations/${aid}/release`, {})
      toast.success(t('pools.valueReleased', 'Value released'))
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="view">
      <div className="view-inner fade">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}><ChevronLeftIcon size={14} /> Pools</button>
          <h2 style={{ margin: 0 }}>{pool?.name ?? `Pool ${id.slice(0, 8)}`}</h2>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}
        {!pool && !error && <SkeletonRows rows={3} />}

        {pool && (
          <>
            <div className="bill-meta">
              <div><span className="muted">Kind</span><div>{pool.kind ?? '—'}</div></div>
              <div><span className="muted">Spec</span><div className="mono">{specSummary(pool.spec)}</div></div>
              <div className="bill-actions"><button className="btn btn-accent btn-sm" onClick={() => setAllocOpen(true)}>+ Allocate</button></div>
            </div>

            <h3>Allocations</h3>
            {allocs.length === 0
              ? <p className="muted">Nothing allocated from this pool.</p>
              : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="grid-wrap">
                    <table className="grid">
                      <thead><tr><th scope="col">Value</th><th scope="col">Service</th><th scope="col">Status</th><th scope="col" className="actions-col"><span className="sr-only">Actions</span></th></tr></thead>
                      <tbody>
                        {allocs.map((a) => {
                          const rs = (a.status ?? '').toUpperCase()
                          return (
                            <tr key={a.id}>
                              <td className="mono">{a.value ?? '—'}</td>
                              <td style={{ fontSize: 12 }}>{svcName(a.service_id)}</td>
                              <td>{rs === 'RELEASED'
                                ? <StatusPill variant="neutral" label="released" size="sm" />
                                : <StatusPill variant="active" label="allocated" size="sm" />}
                              </td>
                              <td className="actions-col"><div className="row-actions" style={{ justifyContent: 'flex-end' }}>{rs !== 'RELEASED' && <button className="btn btn-ghost btn-sm" onClick={() => release(a.id)}>Release</button>}</div></td>
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

        {allocOpen && <AllocateModal token={token} poolId={id} services={services} onClose={() => setAllocOpen(false)} onDone={() => { setAllocOpen(false); load() }} />}
      </div>
    </div>
  )
}

function AllocateModal({ token, poolId, services, onClose, onDone }: { token: string; poolId: string; services: Svc[]; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!value.trim() || saving) return
    setSaving(true)
    try {
      // Backend route is POST .../allocate (not .../allocations).
      await bpost(token, `/api/resource-pools/${poolId}/allocate`, { value: value.trim(), service_id: serviceId || undefined })
      toast.success(t('pools.valueAllocated', 'Value allocated'))
      onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Allocate value" size="sm"
      footer={<>
        <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
        <button className="btn btn-accent btn-md" disabled={saving || !value.trim()} onClick={submit}>{saving ? 'Saving…' : 'Allocate'}</button>
      </>}>
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field"><span>Value *</span><input className="inp inp-md mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder="10.0.0.5" /></label>
        <label className="field"><span>Service</span>
          <select className="inp inp-md" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">— none —</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.id.slice(0, 8)}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  )
}
