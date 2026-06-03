// NetworkInventoryView — Tech & NOC → Network & Stock Inventory.
//
// Consumes the Phase NOC.C backend surface:
//   GET    /api/fiber-routes?status=&page=
//   GET    /api/fiber-routes/{id}
//   GET    /api/fiber-routes/{id}/outage-paths
//   POST   /api/fiber-routes               (admin)
//   GET    /api/ipam/assignments?address=&service_id=&status=&page=
//   POST   /api/ipam/release               (admin)
//   GET    /api/radius/sessions?status=&username=&service_id=&page=
//   PATCH  /api/radius/sessions/{id}/stop  (admin)
//   GET    /api/broadcasts?incident_id=&status=&page=
//   POST   /api/broadcasts                 (admin)
//   POST   /api/broadcasts/{id}/send       (admin)
//
// Doctrine: real data only. Empty fetch → friendly empty state. 404 across the board → endpoints
// not yet live. 403 → PermissionDenied. 409 → toast. No mock/placeholder rows ever.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageShell, type KPISpec } from '../page-shell'
import { Modal, confirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import { StatusPill, KPITile } from '../primitives'
import {
  PackageIcon, ServerIcon, PlusIcon, RefreshIcon, GlobeIcon, ActivityIcon,
  SendHorizontalIcon, CloseIcon, SearchIcon,
} from '../components/icons'
import { bget, bpost, bpatch } from '../lib/billing'
import { timeAgo } from '../lib/time'
import { can as canDo, FULL_ACCESS, fetchCapabilities, type Capabilities } from '../lib/capabilities'

// ── Types ────────────────────────────────────────────────────────────────────
type FiberStatus = 'PLANNED' | 'CONSTRUCTION' | 'ACTIVE' | 'DECOMMISSIONED' | string
interface FiberRoute {
  id: string
  name?: string | null
  geo_path?: string | null         // WKT
  capacity_gbps?: number | null
  origin_pop?: string | null
  destination_pop?: string | null
  status?: FiberStatus | null
  created_at?: string | null
  [k: string]: any
}
interface OutagePath { id: string; outage_id?: string; status?: string; affected_at?: string | null; [k: string]: any }

type IpamFamily = 'ipv4' | 'ipv6' | string
type IpamStatus = 'active' | 'released' | string
interface IpamAssignment {
  id: string
  address?: string | null
  family?: IpamFamily | null
  status?: IpamStatus | null
  service_id?: string | null
  mac?: string | null
  assigned_at?: string | null
  lease_expires_at?: string | null
  pool_allocation_id?: string | null
  [k: string]: any
}

type RadiusStatus = 'active' | 'stopped' | string
interface RadiusSession {
  id: string
  username?: string | null
  session_id?: string | null
  nas_ip?: string | null
  framed_ip?: string | null
  acct_start?: string | null
  acct_stop?: string | null
  status?: RadiusStatus | null
  octets_in?: number | null
  octets_out?: number | null
  service_id?: string | null
  [k: string]: any
}

type BroadcastChannel = 'sms' | 'email' | 'voice' | 'push' | string
type BroadcastStatus = 'draft' | 'sending' | 'complete' | 'failed' | string
interface Broadcast {
  id: string
  channel?: BroadcastChannel | null
  template_id?: string | null
  recipient_count?: number | null
  sent_count?: number | null
  failed_count?: number | null
  status?: BroadcastStatus | null
  incident_record_id?: string | null
  audience_filter_json?: any
  created_at?: string | null
  [k: string]: any
}

type LoadState<T> =
  | { state: 'loading' }
  | { state: 'ok'; items: T[] }
  | { state: 'empty' }
  | { state: 'denied' }
  | { state: 'unavailable' }
  | { state: 'error'; message: string }

type TabKey = 'fiber' | 'ipam' | 'radius' | 'broadcasts'

// ── Helpers ─────────────────────────────────────────────────────────────────
function fiberStatusVariant(s: string | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  const v = (s ?? '').toUpperCase()
  if (v === 'ACTIVE' || v === 'LIVE') return 'active'
  if (v === 'CONSTRUCTION') return 'info'
  if (v === 'PLANNED') return 'neutral'
  if (v === 'DECOMMISSIONED') return 'critical'
  return 'neutral'
}

function broadcastStatusVariant(s: string | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  const v = (s ?? '').toLowerCase()
  if (v === 'complete') return 'active'
  if (v === 'sending') return 'info'
  if (v === 'failed') return 'critical'
  if (v === 'draft') return 'neutral'
  return 'neutral'
}

function ipamStatusVariant(s: string | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  const v = (s ?? '').toLowerCase()
  if (v === 'active') return 'active'
  if (v === 'released') return 'neutral'
  return 'neutral'
}

function radiusStatusVariant(s: string | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' {
  const v = (s ?? '').toLowerCase()
  if (v === 'active') return 'active'
  if (v === 'stopped') return 'neutral'
  return 'neutral'
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return '—'
  const v = Number(n)
  if (v === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log10(Math.abs(v)) / 3))
  const scaled = v / Math.pow(1000, i)
  return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[i]}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// Tolerant list extractor — backend may return `[…]` or `{ items:[…] }` or `{ results:[…] }`.
function asList<T>(raw: any): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (Array.isArray(raw?.items)) return raw.items as T[]
  if (Array.isArray(raw?.results)) return raw.results as T[]
  return []
}

// 403 / 404 / error funnel reused by every tab loader. Mutates the supplied setter.
async function fetchList<T>(token: string, path: string, set: (s: LoadState<T>) => void): Promise<void> {
  set({ state: 'loading' })
  const res = await bget<any>(token, path)
  if (res.status === 403) { set({ state: 'denied' }); return }
  if (res.status === 404) { set({ state: 'unavailable' }); return }
  if (!res.ok)            { set({ state: 'error', message: `Failed to load (${res.status})` }); return }
  const items = asList<T>(res.data)
  if (items.length === 0) { set({ state: 'empty' }); return }
  set({ state: 'ok', items })
}

// ── View ─────────────────────────────────────────────────────────────────────
interface NetworkInventoryViewProps {
  token: string
  canConfigure?: boolean
  capabilities?: Capabilities
}

export default function NetworkInventoryView({ token, canConfigure = false, capabilities }: NetworkInventoryViewProps) {
  // Fall back to fetching caps if parent didn't pass any; default-open until known.
  const [caps, setCaps] = useState<Capabilities>(capabilities ?? FULL_ACCESS)
  const [capsLoaded, setCapsLoaded] = useState<boolean>(!!capabilities)
  useEffect(() => {
    if (capabilities) { setCaps(capabilities); setCapsLoaded(true); return }
    let alive = true
    fetchCapabilities(token).then((c) => { if (alive) { setCaps(c); setCapsLoaded(true) } })
    return () => { alive = false }
  }, [token, capabilities])

  const canView = canDo(caps, 'service', 'view')

  const [tab, setTab] = useState<TabKey>('fiber')

  // ── Fiber routes state ──
  const [fiber, setFiber] = useState<LoadState<FiberRoute>>({ state: 'loading' })
  const [fiberStatus, setFiberStatus] = useState<string>('all')
  const [fiberCreating, setFiberCreating] = useState(false)
  const [openFiberId, setOpenFiberId] = useState<string | null>(null)

  // ── IPAM state ──
  const [ipam, setIpam] = useState<LoadState<IpamAssignment>>({ state: 'loading' })
  const [ipamStatus, setIpamStatus] = useState<'active' | 'all'>('active')
  const [ipamQuery, setIpamQuery] = useState('')
  const [ipamDebounced, setIpamDebounced] = useState('')

  // ── RADIUS state ──
  const [radius, setRadius] = useState<LoadState<RadiusSession>>({ state: 'loading' })
  const [radiusStatus, setRadiusStatus] = useState<'active' | 'stopped' | 'all'>('active')
  const [radiusQuery, setRadiusQuery] = useState('')
  const [radiusDebounced, setRadiusDebounced] = useState('')

  // ── Broadcasts state ──
  const [bcast, setBcast] = useState<LoadState<Broadcast>>({ state: 'loading' })
  const [bcastStatus, setBcastStatus] = useState<string>('all')
  const [bcastCreating, setBcastCreating] = useState(false)

  // ── Loaders ──
  const loadFiber = useCallback(async () => {
    if (!capsLoaded || !canView) return
    const qs = fiberStatus !== 'all' ? `?status=${encodeURIComponent(fiberStatus)}` : ''
    await fetchList<FiberRoute>(token, `/api/fiber-routes${qs}`, setFiber)
  }, [token, capsLoaded, canView, fiberStatus])

  const loadIpam = useCallback(async () => {
    if (!capsLoaded || !canView) return
    const params: string[] = []
    params.push(`status=${ipamStatus}`)
    if (ipamDebounced.trim()) params.push(`address=${encodeURIComponent(ipamDebounced.trim())}`)
    await fetchList<IpamAssignment>(token, `/api/ipam/assignments?${params.join('&')}`, setIpam)
  }, [token, capsLoaded, canView, ipamStatus, ipamDebounced])

  const loadRadius = useCallback(async () => {
    if (!capsLoaded || !canView) return
    const params: string[] = []
    if (radiusStatus !== 'all') params.push(`status=${radiusStatus}`)
    if (radiusDebounced.trim()) params.push(`username=${encodeURIComponent(radiusDebounced.trim())}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    await fetchList<RadiusSession>(token, `/api/radius/sessions${qs}`, setRadius)
  }, [token, capsLoaded, canView, radiusStatus, radiusDebounced])

  const loadBroadcasts = useCallback(async () => {
    if (!capsLoaded || !canView) return
    const qs = bcastStatus !== 'all' ? `?status=${encodeURIComponent(bcastStatus)}` : ''
    await fetchList<Broadcast>(token, `/api/broadcasts${qs}`, setBcast)
  }, [token, capsLoaded, canView, bcastStatus])

  // Tab-scoped initial / filter fetches.
  useEffect(() => { if (tab === 'fiber')      void loadFiber()      }, [tab, loadFiber])
  useEffect(() => { if (tab === 'ipam')       void loadIpam()       }, [tab, loadIpam])
  useEffect(() => { if (tab === 'radius')     void loadRadius()     }, [tab, loadRadius])
  useEffect(() => { if (tab === 'broadcasts') void loadBroadcasts() }, [tab, loadBroadcasts])

  // Debounce text search inputs (250ms).
  useEffect(() => { const id = setTimeout(() => setIpamDebounced(ipamQuery), 250); return () => clearTimeout(id) }, [ipamQuery])
  useEffect(() => { const id = setTimeout(() => setRadiusDebounced(radiusQuery), 250); return () => clearTimeout(id) }, [radiusQuery])

  // ── Action handlers ──
  async function releaseIpam(a: IpamAssignment) {
    const ok = await confirmDialog({
      title: 'Release IP assignment',
      message: `Release ${a.address ?? a.id.slice(0, 8)}? The address returns to the pool.`,
      confirmLabel: 'Release',
      danger: true,
    })
    if (!ok) return
    try {
      await bpost(token, '/api/ipam/release', { assignment_id: a.id })
      toast.success('Assignment released')
      await loadIpam()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 409) toast.error(err.message || 'Conflict — cannot release')
      else toast.error(err.message || 'Failed to release')
    }
  }

  async function stopSession(s: RadiusSession) {
    const ok = await confirmDialog({
      title: 'Stop RADIUS session',
      message: `Force-stop session for ${s.username ?? s.id.slice(0, 8)}?`,
      confirmLabel: 'Stop',
      danger: true,
    })
    if (!ok) return
    try {
      await bpatch(token, `/api/radius/sessions/${s.id}/stop`, { acct_stop: new Date().toISOString() })
      toast.success('Session stopped')
      await loadRadius()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 409) toast.error(err.message || 'Conflict — already stopped')
      else toast.error(err.message || 'Failed to stop session')
    }
  }

  async function sendBroadcast(b: Broadcast) {
    try {
      await bpost(token, `/api/broadcasts/${b.id}/send`, {})
      toast.success('Broadcast sent')
      await loadBroadcasts()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 409) toast.error(err.message || 'Conflict — broadcast not in draft')
      else toast.error(err.message || 'Failed to send broadcast')
    }
  }

  // ── KPI strip (Zone B) — RADIUS counts ──
  const kpis: KPISpec[] | undefined = useMemo(() => {
    if (tab !== 'radius' || radius.state !== 'ok') return undefined
    const items = radius.items
    const active = items.filter((s) => (s.status ?? '').toLowerCase() === 'active').length
    // "Started today" — count rows with acct_start on the current calendar day.
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const startedToday = items.filter((s) => {
      if (!s.acct_start) return false
      const t = new Date(s.acct_start).getTime()
      return !isNaN(t) && t >= today.getTime()
    }).length
    return [
      { label: 'Active sessions', value: active },
      { label: 'Started today',   value: startedToday },
      { label: 'Total (page)',    value: items.length, muted: true },
    ]
  }, [tab, radius])

  // ── Permission gate (after caps load) ──
  if (capsLoaded && !canView) {
    return <PermissionDenied message="You don't have permission to view network inventory." />
  }

  return (
    <PageShell
      type="OPERATIONS"
      breadcrumb={['Tech & NOC', 'Network & Stock Inventory']}
      icon={<PackageIcon size={18} />}
      title="Network & Stock Inventory"
      subtitle="Fiber routes · IPAM · RADIUS sessions · broadcasts"
      kpis={kpis}
    >
      {/* Tab strip — same kit pattern as PipelineView / RevenueAssuranceView. */}
      <div
        role="tablist"
        aria-label="Inventory views"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--gx-border, #e2e8f0)',
          marginBottom: 16,
          marginTop: 8,
          paddingBottom: 0,
        }}
      >
        <NiTab active={tab === 'fiber'}      onClick={() => setTab('fiber')}      icon={<GlobeIcon size={14} />}           label="Fiber Routes"   sub="PostGIS-backed inventory" />
        <NiTab active={tab === 'ipam'}       onClick={() => setTab('ipam')}       icon={<ServerIcon size={14} />}          label="IPAM"            sub="Per-address assignments" />
        <NiTab active={tab === 'radius'}     onClick={() => setTab('radius')}     icon={<ActivityIcon size={14} />}        label="RADIUS Sessions" sub="Live AAA sessions" />
        <NiTab active={tab === 'broadcasts'} onClick={() => setTab('broadcasts')} icon={<SendHorizontalIcon size={14} />}  label="Mass Broadcasts" sub="Incident notifications" />
      </div>

      {tab === 'fiber' && (
        <FiberTab
          state={fiber}
          status={fiberStatus}
          onStatus={setFiberStatus}
          canAdmin={canConfigure}
          onNew={() => setFiberCreating(true)}
          onReload={loadFiber}
          onOpen={(id) => setOpenFiberId(id)}
        />
      )}

      {tab === 'ipam' && (
        <IpamTab
          state={ipam}
          status={ipamStatus}
          onStatus={setIpamStatus}
          query={ipamQuery}
          onQuery={setIpamQuery}
          canAdmin={canConfigure}
          onRelease={releaseIpam}
          onReload={loadIpam}
        />
      )}

      {tab === 'radius' && (
        <RadiusTab
          state={radius}
          status={radiusStatus}
          onStatus={setRadiusStatus}
          query={radiusQuery}
          onQuery={setRadiusQuery}
          canAdmin={canConfigure}
          onStop={stopSession}
          onReload={loadRadius}
        />
      )}

      {tab === 'broadcasts' && (
        <BroadcastTab
          state={bcast}
          status={bcastStatus}
          onStatus={setBcastStatus}
          canAdmin={canConfigure}
          onNew={() => setBcastCreating(true)}
          onSend={sendBroadcast}
          onReload={loadBroadcasts}
        />
      )}

      {/* Modals */}
      {fiberCreating && (
        <FiberCreateModal
          token={token}
          onClose={() => setFiberCreating(false)}
          onCreated={() => { setFiberCreating(false); void loadFiber() }}
        />
      )}
      {openFiberId && (
        <FiberDetailDrawer
          token={token}
          id={openFiberId}
          onClose={() => setOpenFiberId(null)}
        />
      )}
      {bcastCreating && (
        <BroadcastCreateModal
          token={token}
          onClose={() => setBcastCreating(false)}
          onCreated={() => { setBcastCreating(false); void loadBroadcasts() }}
        />
      )}
    </PageShell>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Tab button — kit pattern (label + sub line, bottom border on active).
function NiTab({ active, onClick, icon, label, sub }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub: string
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        gap: 2,
        padding: '10px 16px',
        background: 'transparent',
        border: 'none',
        // D18: active tab underline = azure (interactive selection)
        borderBottom: active ? '2px solid var(--gx-interactive, #2563eb)' : '2px solid transparent',
        color: active ? 'var(--gx-text-1, #0f172a)' : 'var(--gx-text-3, #64748b)',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon}{label}</span>
      <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--gx-text-3, #94a3b8)' }}>{sub}</span>
    </button>
  )
}

// Filter select chrome — matches the FilterSelect pattern from RevenueAssuranceView.
function FilterSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string][]
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gx-text-3, #64748b)' }}>
      <span>{label}</span>
      <select
        className="inp inp-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: 12 }}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

// Common toolbar row above each tab's table — filters / search / refresh / primary.
function TabToolbar({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>{left}</div>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  )
}

// Re-usable render for the {loading | denied | unavailable | empty | error} states.
function LoadShell<T>({ state, emptyTitle, emptyMessage, onRetry, children }: {
  state: LoadState<T>
  emptyTitle: string
  emptyMessage: string
  onRetry: () => void
  children: (items: T[]) => React.ReactNode
}) {
  if (state.state === 'loading')      return <SkeletonRows rows={5} />
  if (state.state === 'denied')       return <PermissionDenied />
  if (state.state === 'unavailable')  return <EmptyState icon={<PackageIcon size={36} />} title="NOC inventory endpoints not yet available" message="This page will populate once Phase NOC.C ships." />
  if (state.state === 'error')        return <ErrorBanner message={state.message} onRetry={onRetry} />
  if (state.state === 'empty')        return <EmptyState icon={<SearchIcon size={36} />} title={emptyTitle} message={emptyMessage} />
  return <>{children(state.items)}</>
}

// ─── Tab 1: Fiber Routes ─────────────────────────────────────────────────────
function FiberTab({ state, status, onStatus, canAdmin, onNew, onReload, onOpen }: {
  state: LoadState<FiberRoute>
  status: string
  onStatus: (s: string) => void
  canAdmin: boolean
  onNew: () => void
  onReload: () => void
  onOpen: (id: string) => void
}) {
  return (
    <div>
      <TabToolbar
        left={
          <FilterSelect
            label="Status"
            value={status}
            onChange={onStatus}
            options={[
              ['all',            'All statuses'],
              ['PLANNED',        'Planned'],
              ['CONSTRUCTION',   'Construction'],
              ['ACTIVE',         'Active'],
              ['DECOMMISSIONED', 'Decommissioned'],
            ]}
          />
        }
        right={
          <>
            <button className="btn btn-ghost btn-sm" onClick={onReload}>
              <RefreshIcon size={13} /> Refresh
            </button>
            {canAdmin && (
              <button className="btn btn-primary btn-sm" onClick={onNew}>
                <PlusIcon size={13} /> New Fiber Route
              </button>
            )}
          </>
        }
      />

      <LoadShell
        state={state}
        emptyTitle="No fiber routes match this filter"
        emptyMessage="Try a different status, or add one with New Fiber Route."
        onRetry={onReload}
      >
        {(items) => (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Origin → Destination</th>
                    <th className="num">Capacity (Gbps)</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr
                      key={r.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onOpen(r.id)}
                    >
                      <td style={{ fontWeight: 500 }}>{r.name ?? r.id.slice(0, 8)}</td>
                      <td>
                        <span style={{ color: 'var(--gx-text-2, #475569)' }}>
                          {r.origin_pop ?? '—'}
                        </span>
                        <span style={{ margin: '0 6px', color: 'var(--gx-text-3, #94a3b8)' }}>→</span>
                        <span style={{ color: 'var(--gx-text-2, #475569)' }}>
                          {r.destination_pop ?? '—'}
                        </span>
                      </td>
                      <td className="num">
                        <span className="mono tnum">{r.capacity_gbps != null ? r.capacity_gbps : '—'}</span>
                      </td>
                      <td>
                        <StatusPill variant={fiberStatusVariant(r.status)} label={r.status ?? '—'} size="sm" />
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        <span title={r.created_at ?? undefined}>{timeAgo(r.created_at ?? null) || fmtDate(r.created_at)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </LoadShell>
    </div>
  )
}

function FiberCreateModal({ token, onClose, onCreated }: {
  token: string; onClose: () => void; onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [originPop, setOriginPop] = useState('')
  const [destPop, setDestPop] = useState('')
  const [capacity, setCapacity] = useState('')
  const [status, setStatus] = useState('PLANNED')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!name.trim()) { toast.error('Name is required'); return }
    setSubmitting(true)
    try {
      const body: Record<string, any> = { name: name.trim(), status }
      if (originPop.trim())   body.origin_pop = originPop.trim()
      if (destPop.trim())     body.destination_pop = destPop.trim()
      if (capacity.trim()) {
        const n = Number(capacity)
        if (isNaN(n)) { toast.error('Capacity must be a number'); setSubmitting(false); return }
        body.capacity_gbps = n
      }
      await bpost(token, '/api/fiber-routes', body)
      toast.success('Fiber route created')
      onCreated()
    } catch (e) {
      toast.error((e as Error).message || 'Failed to create route')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => submitting ? undefined : onClose()}
      title="New Fiber Route"
      size="md"
      footer={
        <>
          <button className="btn btn-ghost btn-md" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary btn-md" onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? 'Creating…' : 'Create route'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Name *">
          <input className="inp inp-md" value={name} onChange={(e) => setName(e.target.value)} placeholder="Yerevan ↔ Gyumri trunk" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Origin POP">
            <input className="inp inp-md" value={originPop} onChange={(e) => setOriginPop(e.target.value)} placeholder="POP code or name" />
          </Field>
          <Field label="Destination POP">
            <input className="inp inp-md" value={destPop} onChange={(e) => setDestPop(e.target.value)} placeholder="POP code or name" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Capacity (Gbps)">
            <input className="inp inp-md" type="number" min="0" step="0.1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 100" />
          </Field>
          <Field label="Status">
            <select className="inp inp-md" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PLANNED">Planned</option>
              <option value="CONSTRUCTION">Construction</option>
              <option value="ACTIVE">Active</option>
              <option value="DECOMMISSIONED">Decommissioned</option>
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function FiberDetailDrawer({ token, id, onClose }: {
  token: string; id: string; onClose: () => void
}) {
  const [route, setRoute] = useState<FiberRoute | null>(null)
  const [outages, setOutages] = useState<OutagePath[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [outagesUnavailable, setOutagesUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null); setOutagesUnavailable(false)
    Promise.all([
      bget<FiberRoute>(token, `/api/fiber-routes/${id}`),
      bget<any>(token, `/api/fiber-routes/${id}/outage-paths`),
    ]).then(([r, o]) => {
      if (!alive) return
      if (!r.ok) { setError(`Failed to load route (${r.status})`); setLoading(false); return }
      setRoute(r.data)
      if (o.status === 404)      setOutagesUnavailable(true)
      else if (!o.ok)            setOutages([])
      else                       setOutages(asList<OutagePath>(o.data))
      setLoading(false)
    }).catch((e) => { if (alive) { setError((e as Error).message); setLoading(false) } })
    return () => { alive = false }
  }, [token, id])

  return (
    <Modal
      open
      onClose={onClose}
      title={route?.name ?? 'Fiber route'}
      subtitle={route ? `${route.origin_pop ?? '—'} → ${route.destination_pop ?? '—'}` : id}
      size="lg"
    >
      {loading && <SkeletonRows rows={4} />}
      {error && <ErrorBanner message={error} />}
      {route && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section>
            <SectionLabel>Details</SectionLabel>
            <KvGrid rows={[
              ['Status',     route.status ? <StatusPill variant={fiberStatusVariant(route.status)} label={route.status} size="sm" /> : '—'],
              ['Capacity',   route.capacity_gbps != null ? `${route.capacity_gbps} Gbps` : '—'],
              ['Origin',     route.origin_pop ?? '—'],
              ['Destination', route.destination_pop ?? '—'],
              ['Created',    fmtDate(route.created_at)],
            ]} />
          </section>

          <section>
            <SectionLabel>Geo path (WKT)</SectionLabel>
            {route.geo_path
              ? <pre style={{
                  margin: 0, padding: 12,
                  background: 'var(--gx-bg-2, #f8fafc)',
                  border: '1px solid var(--gx-border-subtle, #e2e8f0)',
                  borderRadius: 8,
                  fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'var(--gx-text-2, #475569)',
                }}>{route.geo_path}</pre>
              : <p className="muted" style={{ margin: 0, fontSize: 12 }}>No geo path recorded.</p>
            }
          </section>

          <section>
            <SectionLabel>Linked outage paths</SectionLabel>
            {outagesUnavailable && (
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Outage-path endpoint not available.</p>
            )}
            {!outagesUnavailable && outages && outages.length === 0 && (
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>No active outages on this route.</p>
            )}
            {!outagesUnavailable && outages && outages.length > 0 && (
              <table className="grid" style={{ width: '100%' }}>
                <thead><tr><th>Outage</th><th>Status</th><th>Affected</th></tr></thead>
                <tbody>
                  {outages.map((o) => (
                    <tr key={o.id}>
                      <td><span className="mono">{(o.outage_id ?? o.id).slice(0, 8)}</span></td>
                      <td>{o.status ?? '—'}</td>
                      <td><span title={o.affected_at ?? undefined}>{timeAgo(o.affected_at ?? null) || '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

// ─── Tab 2: IPAM Assignments ─────────────────────────────────────────────────
function IpamTab({ state, status, onStatus, query, onQuery, canAdmin, onRelease, onReload }: {
  state: LoadState<IpamAssignment>
  status: 'active' | 'all'
  onStatus: (s: 'active' | 'all') => void
  query: string
  onQuery: (q: string) => void
  canAdmin: boolean
  onRelease: (a: IpamAssignment) => void
  onReload: () => void
}) {
  return (
    <div>
      <TabToolbar
        left={
          <>
            <FilterSelect
              label="Status"
              value={status}
              onChange={(v) => onStatus(v as 'active' | 'all')}
              options={[['active', 'Active'], ['all', 'All']]}
            />
            <input
              className="inp inp-sm"
              type="search"
              placeholder="Search by address…"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              style={{ minWidth: 240 }}
            />
          </>
        }
        right={
          <button className="btn btn-ghost btn-sm" onClick={onReload}>
            <RefreshIcon size={13} /> Refresh
          </button>
        }
      />

      <LoadShell
        state={state}
        emptyTitle="No IP assignments to show"
        emptyMessage="IP assignment happens during service provisioning. Empty here means no active leases match the current filter."
        onRetry={onReload}
      >
        {(items) => (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Family</th>
                    <th>Status</th>
                    <th>Service</th>
                    <th>MAC</th>
                    <th>Assigned</th>
                    <th>Lease expires</th>
                    <th className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => {
                    const isActive = (a.status ?? '').toLowerCase() === 'active'
                    return (
                      <tr key={a.id}>
                        <td><span className="mono" style={{ fontSize: 12 }}>{a.address ?? '—'}</span></td>
                        <td>{a.family ?? '—'}</td>
                        <td>
                          <StatusPill variant={ipamStatusVariant(a.status)} label={a.status ?? '—'} size="sm" />
                        </td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{a.service_id ? a.service_id.slice(0, 8) : '—'}</span></td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{a.mac ?? '—'}</span></td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          <span title={a.assigned_at ?? undefined}>{timeAgo(a.assigned_at ?? null) || '—'}</span>
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          <span title={a.lease_expires_at ?? undefined}>{fmtDate(a.lease_expires_at)}</span>
                        </td>
                        <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {canAdmin && isActive && (
                              <button className="btn btn-ghost btn-sm" onClick={() => onRelease(a)}>Release</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </LoadShell>
    </div>
  )
}

// ─── Tab 3: RADIUS Sessions ──────────────────────────────────────────────────
function RadiusTab({ state, status, onStatus, query, onQuery, canAdmin, onStop, onReload }: {
  state: LoadState<RadiusSession>
  status: 'active' | 'stopped' | 'all'
  onStatus: (s: 'active' | 'stopped' | 'all') => void
  query: string
  onQuery: (q: string) => void
  canAdmin: boolean
  onStop: (s: RadiusSession) => void
  onReload: () => void
}) {
  return (
    <div>
      <TabToolbar
        left={
          <>
            <FilterSelect
              label="Status"
              value={status}
              onChange={(v) => onStatus(v as 'active' | 'stopped' | 'all')}
              options={[['active', 'Active'], ['stopped', 'Stopped'], ['all', 'All']]}
            />
            <input
              className="inp inp-sm"
              type="search"
              placeholder="Search by username…"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              style={{ minWidth: 240 }}
            />
          </>
        }
        right={
          <button className="btn btn-ghost btn-sm" onClick={onReload}>
            <RefreshIcon size={13} /> Refresh
          </button>
        }
      />

      {/* Tab-local KPI tiles — Zone B handles the page-level strip when the loader settles,
          but render an inline mini-strip too so admins see counts before they scroll. */}
      {state.state === 'ok' && (
        <div className="kpi-strip" style={{ marginBottom: 16 }}>
          <KPITile label="Active sessions" value={state.items.filter((s) => (s.status ?? '').toLowerCase() === 'active').length} size="sm" />
          <KPITile
            label="Started today"
            value={(() => {
              const today = new Date(); today.setHours(0, 0, 0, 0)
              return state.items.filter((s) => {
                if (!s.acct_start) return false
                const t = new Date(s.acct_start).getTime()
                return !isNaN(t) && t >= today.getTime()
              }).length
            })()}
            size="sm"
          />
        </div>
      )}

      <LoadShell
        state={state}
        emptyTitle="No RADIUS sessions match this filter"
        emptyMessage="No sessions are currently in this state. Try widening the filter or refresh."
        onRetry={onReload}
      >
        {(items) => (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Session ID</th>
                    <th>NAS IP</th>
                    <th>Framed IP</th>
                    <th>Started</th>
                    <th>Status</th>
                    <th className="num">Octets In</th>
                    <th className="num">Octets Out</th>
                    <th className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => {
                    const isActive = (s.status ?? '').toLowerCase() === 'active'
                    return (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 500 }}>{s.username ?? '—'}</td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{(s.session_id ?? s.id).slice(0, 12)}</span></td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{s.nas_ip ?? '—'}</span></td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{s.framed_ip ?? '—'}</span></td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          <span title={s.acct_start ?? undefined}>{timeAgo(s.acct_start ?? null) || '—'}</span>
                        </td>
                        <td>
                          <StatusPill variant={radiusStatusVariant(s.status)} label={s.status ?? '—'} size="sm" />
                        </td>
                        <td className="num"><span className="mono tnum">{formatBytes(s.octets_in)}</span></td>
                        <td className="num"><span className="mono tnum">{formatBytes(s.octets_out)}</span></td>
                        <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {canAdmin && isActive && (
                              <button className="btn btn-ghost btn-sm" onClick={() => onStop(s)}>Stop</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </LoadShell>
    </div>
  )
}

// ─── Tab 4: Mass Broadcasts ──────────────────────────────────────────────────
function BroadcastTab({ state, status, onStatus, canAdmin, onNew, onSend, onReload }: {
  state: LoadState<Broadcast>
  status: string
  onStatus: (s: string) => void
  canAdmin: boolean
  onNew: () => void
  onSend: (b: Broadcast) => void
  onReload: () => void
}) {
  return (
    <div>
      <TabToolbar
        left={
          <FilterSelect
            label="Status"
            value={status}
            onChange={onStatus}
            options={[
              ['all',      'All statuses'],
              ['draft',    'Draft'],
              ['sending',  'Sending'],
              ['complete', 'Complete'],
              ['failed',   'Failed'],
            ]}
          />
        }
        right={
          <>
            <button className="btn btn-ghost btn-sm" onClick={onReload}>
              <RefreshIcon size={13} /> Refresh
            </button>
            {canAdmin && (
              <button className="btn btn-primary btn-sm" onClick={onNew}>
                <PlusIcon size={13} /> New Broadcast
              </button>
            )}
          </>
        }
      />

      <LoadShell
        state={state}
        emptyTitle="No broadcasts to show"
        emptyMessage="Mass broadcasts created from incidents will appear here."
        onRetry={onReload}
      >
        {(items) => (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Template</th>
                    <th className="num">Recipients</th>
                    <th className="num">Sent</th>
                    <th className="num">Failed</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => {
                    const isDraft = (b.status ?? '').toLowerCase() === 'draft'
                    return (
                      <tr key={b.id}>
                        <td style={{ fontWeight: 500 }}>{b.channel ?? '—'}</td>
                        <td><span className="mono" style={{ fontSize: 12 }}>{b.template_id ? b.template_id.slice(0, 12) : '—'}</span></td>
                        <td className="num"><span className="mono tnum">{b.recipient_count ?? '—'}</span></td>
                        <td className="num"><span className="mono tnum">{b.sent_count ?? '—'}</span></td>
                        <td className="num"><span className="mono tnum">{b.failed_count ?? '—'}</span></td>
                        <td>
                          <StatusPill variant={broadcastStatusVariant(b.status)} label={b.status ?? '—'} size="sm" />
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          <span title={b.created_at ?? undefined}>{timeAgo(b.created_at ?? null) || fmtDate(b.created_at)}</span>
                        </td>
                        <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {canAdmin && isDraft && (
                              <button className="btn btn-ghost btn-sm" onClick={() => onSend(b)}>Send</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </LoadShell>
    </div>
  )
}

function BroadcastCreateModal({ token, onClose, onCreated }: {
  token: string; onClose: () => void; onCreated: () => void
}) {
  const [channel, setChannel] = useState<BroadcastChannel>('sms')
  const [templateId, setTemplateId] = useState('')
  const [audienceJson, setAudienceJson] = useState('{}')
  const [incidentId, setIncidentId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    try {
      // Parse the audience filter as JSON; reject invalid input rather than silently sending garbage.
      let audience: any = {}
      const txt = audienceJson.trim()
      if (txt) {
        try { audience = JSON.parse(txt) }
        catch { toast.error('Audience filter must be valid JSON'); setSubmitting(false); return }
      }
      const body: Record<string, any> = {
        channel,
        audience_filter_json: audience,
      }
      if (templateId.trim())  body.template_id = templateId.trim()
      if (incidentId.trim())  body.incident_record_id = incidentId.trim()
      await bpost(token, '/api/broadcasts', body)
      toast.success('Broadcast drafted')
      onCreated()
    } catch (e) {
      toast.error((e as Error).message || 'Failed to create broadcast')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => submitting ? undefined : onClose()}
      title="New Broadcast"
      size="md"
      footer={
        <>
          <button className="btn btn-ghost btn-md" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary btn-md" onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create draft'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Channel *">
          <select className="inp inp-md" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
            <option value="voice">Voice</option>
            <option value="push">Push</option>
          </select>
        </Field>
        <Field label="Template ID">
          <input className="inp inp-md" value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="template UUID or key" />
        </Field>
        <Field label="Incident record ID (optional)">
          <input className="inp inp-md" value={incidentId} onChange={(e) => setIncidentId(e.target.value)} placeholder="incident UUID" />
        </Field>
        <Field label="Audience filter (JSON)">
          <textarea
            className="inp inp-md"
            rows={5}
            value={audienceJson}
            onChange={(e) => setAudienceJson(e.target.value)}
            placeholder='{ "region": "Yerevan", "service_status": "ACTIVE" }'
            style={{
              fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
              fontSize: 12,
            }}
          />
        </Field>
      </div>
    </Modal>
  )
}

// ── Small layout helpers (local to this view) ────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--gx-text-2, #475569)' }}>{label}</span>
      {children}
    </label>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
      color: 'var(--gx-text-3, #64748b)', letterSpacing: '0.06em',
      marginBottom: 8,
    }}>{children}</div>
  )
}

function KvGrid({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 8, columnGap: 16 }}>
      {rows.map(([k, v], i) => (
        <span key={i} style={{ display: 'contents' }}>
          <span style={{ fontSize: 12, color: 'var(--gx-text-3, #64748b)' }}>{k}</span>
          <span style={{ fontSize: 13, color: 'var(--gx-text-2, #475569)' }}>{v}</span>
        </span>
      ))}
    </div>
  )
}

// Silence "imported but only referenced via JSX" for icons used solely inside conditional branches.
void CloseIcon
