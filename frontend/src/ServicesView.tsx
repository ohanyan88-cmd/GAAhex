import { useEffect, useState } from 'react'
import { bget, bpost, loadCustomers } from './billing'
import { Modal, confirmDialog } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from './States'
import { ArrowRightIcon, ChevronLeftIcon, InboxIcon } from './icons'

// Services UI (A14 /api/services) — list + detail with resources + lifecycle. Degrades on 404.
type Service = { id: string; customer_id?: string | null; subscription_id?: string | null; type?: string; name?: string; status?: string | null; activated_at?: string | null; created_at?: string | null }
type Resource = { id: string; kind?: string; value?: string; label?: string | null; status?: string | null; created_at?: string | null }

const STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']
const TYPES = ['internet', 'tv', 'voip', 'hosting', 'other']
const KINDS = ['ip', 'mac', 'port', 'device', 'circuit', 'other']

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase()
  const cls = s === 'ACTIVE' ? 'pill pill-success' : s === 'SUSPENDED' ? 'pill pill-danger' : s === 'TERMINATED' ? 'pill pill-muted' : 'pill'
  return status ? <span className={cls}>{status}</span> : <span>—</span>
}

export default function ServicesView({ token }: { token: string }) {
  const [list, setList] = useState<Service[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

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

  const cust = (sv: Service) => (sv.customer_id ? (names[sv.customer_id] ?? sv.customer_id.slice(0, 8)) : '—')

  if (denied) return <PermissionDenied message="You don't have permission to view services." />
  if (detailId) return <ServiceDetail token={token} id={detailId} names={names} onBack={() => { setDetailId(null); load() }} />

  return (
    <div>
      <div className="view-head"><h2>Services</h2></div>

      <div className="list-toolbar">
        <div className="bill-filter">
          <span className="muted export-label">Status</span>
          <select className="inp inp-sm" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="bill-filter">
          <span className="muted export-label">Type</span>
          <select className="inp inp-sm" aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState icon={<InboxIcon size={40} />} title="Services aren't available yet" message="Provisioned services will appear here once the service inventory is enabled." />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<InboxIcon size={40} />} title="No services" message="Nothing matches this filter." />
      )}

      {list && list.length > 0 && (
        <div className="grid-wrap"><table className="grid">
          <thead><tr><th scope="col">Service</th><th scope="col">Customer</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Activated</th><th scope="col"></th></tr></thead>
          <tbody>
            {list.map((sv) => (
              <tr key={sv.id}>
                <td>{sv.name ?? sv.id.slice(0, 8)}</td>
                <td>{cust(sv)}</td>
                <td>{sv.type ?? '—'}</td>
                <td>{statusPill(sv.status)}</td>
                <td>{fmtDate(sv.activated_at)}</td>
                <td className="row-actions"><button className="btn btn-ghost btn-sm" onClick={() => setDetailId(sv.id)}>Open <ArrowRightIcon size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
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
    const rr = await bget<Resource[]>(token, `/api/services/${id}/resources`)
    if (rr.ok && Array.isArray(rr.data)) setResources(rr.data)
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
      await bpost(token, `/api/services/${id}/resources/${rid}/release`)
      toast.success('Resource released')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const status = (sv?.status ?? '').toUpperCase()
  const cust = sv?.customer_id ? (names[sv.customer_id] ?? sv.customer_id.slice(0, 8)) : '—'

  return (
    <div>
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
            <div><span className="muted">Status</span><div>{statusPill(sv.status)}</div></div>
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
              <div className="grid-wrap"><table className="grid">
                <thead><tr><th scope="col">Kind</th><th scope="col">Value</th><th scope="col">Label</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
                <tbody>
                  {resources.map((r) => (
                    <tr key={r.id} className={(r.status ?? '').toUpperCase() === 'RELEASED' ? 'row-muted' : ''}>
                      <td>{r.kind ?? '—'}</td>
                      <td className="mono">{r.value ?? '—'}</td>
                      <td>{r.label ?? '—'}</td>
                      <td>{(r.status ?? '').toUpperCase() === 'RELEASED' ? <span className="pill pill-muted">released</span> : <span className="pill pill-success">allocated</span>}</td>
                      <td className="row-actions">{(r.status ?? '').toUpperCase() !== 'RELEASED' && <button className="btn btn-ghost btn-sm" onClick={() => release(r.id)}>Release</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
        </>
      )}

      {allocOpen && <AllocateModal token={token} serviceId={id} onClose={() => setAllocOpen(false)} onDone={() => { setAllocOpen(false); load() }} />}
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
