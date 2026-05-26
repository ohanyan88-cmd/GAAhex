import { useEffect, useState } from 'react'
import { bget, bpost, bdel } from './billing'
import { Modal, confirmDialog } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from './States'
import { ArrowRightIcon, ChevronLeftIcon, InboxIcon } from './icons'
import { t } from './i18n'

// Resource pools / IPAM (A15 /api/resource-pools) — list + detail with allocations. Degrades on 404.
type Pool = { id: string; name?: string; kind?: string; spec?: any; allocation_count?: number; created_at?: string | null }
type Allocation = { id: string; value?: string; service_id?: string | null; status?: string | null; allocated_at?: string | null }
type Svc = { id: string; name?: string }

const KINDS = ['ipv4', 'ipv6', 'vlan', 'phone', 'other']

function specSummary(spec: any): string {
  if (!spec || typeof spec !== 'object') return '—'
  if (spec.cidr) return String(spec.cidr)
  if (spec.from || spec.to) return `${spec.from ?? '?'}–${spec.to ?? '?'}`
  return JSON.stringify(spec)
}
function allocCount(p: Pool): string {
  const n = p.allocation_count ?? (p as any).allocated_count ?? (p as any).allocations_count
  return typeof n === 'number' ? String(n) : '—'
}

export default function ResourcePoolsView({ token }: { token: string }) {
  const [list, setList] = useState<Pool[] | null>(null)
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

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<Pool[]>(token, '/api/resource-pools')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError(t('pools.loadError', 'Failed to load resource pools')); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])

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

  if (denied) return <PermissionDenied message={t('pools.denied', 'Resource pools are admin-only.')} />
  if (detailId) return <PoolDetail token={token} id={detailId} onBack={() => { setDetailId(null); load() }} />

  return (
    <div>
      <div className="view-head">
        <h2>Resource Pools</h2>
        {!unavailable && <button className="btn btn-primary btn-md" onClick={() => setCreating((c) => !c)}>{creating ? 'Close' : '+ New pool'}</button>}
      </div>

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
        <div className="grid-wrap"><table className="grid">
          <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Spec</th><th scope="col">Allocations</th><th scope="col"></th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.name ?? p.id.slice(0, 8)}</td>
                <td>{p.kind ?? '—'}</td>
                <td className="mono">{specSummary(p.spec)}</td>
                <td>{allocCount(p)}</td>
                <td className="row-actions"><button className="btn btn-ghost btn-sm" onClick={() => setDetailId(p.id)}>Open <ArrowRightIcon size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
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
      await bdel(token, `/api/resource-pools/${id}/allocations/${aid}`)
      toast.success(t('pools.valueReleased', 'Value released'))
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div>
      <div className="view-head">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ChevronLeftIcon size={14} /> Pools</button>
        <h2 style={{ marginLeft: 8 }}>{pool?.name ?? `Pool ${id.slice(0, 8)}`}</h2>
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
              <div className="grid-wrap"><table className="grid">
                <thead><tr><th scope="col">Value</th><th scope="col">Service</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
                <tbody>
                  {allocs.map((a) => (
                    <tr key={a.id} className={(a.status ?? '').toUpperCase() === 'RELEASED' ? 'row-muted' : ''}>
                      <td className="mono">{a.value ?? '—'}</td>
                      <td>{svcName(a.service_id)}</td>
                      <td>{(a.status ?? '').toUpperCase() === 'RELEASED' ? <span className="pill pill-muted">released</span> : <span className="pill pill-success">allocated</span>}</td>
                      <td className="row-actions">{(a.status ?? '').toUpperCase() !== 'RELEASED' && <button className="btn btn-ghost btn-sm" onClick={() => release(a.id)}>Release</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
        </>
      )}

      {allocOpen && <AllocateModal token={token} poolId={id} services={services} onClose={() => setAllocOpen(false)} onDone={() => { setAllocOpen(false); load() }} />}
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
      await bpost(token, `/api/resource-pools/${poolId}/allocations`, { value: value.trim(), service_id: serviceId || undefined })
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
