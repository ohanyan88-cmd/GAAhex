// NetworkInventoryView — NMS → Network & Stock Inventory.
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
import { useAuth } from '../context/AuthContext'
import { PageShell, type KPISpec } from '../page-shell'
import { confirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { PermissionDenied } from '../components/States'
import type { LoadState } from '../primitives'
import {
  PackageIcon, ServerIcon, GlobeIcon, ActivityIcon, SendHorizontalIcon,
} from '../components/icons'
import { bpost, bpatch } from '../lib/billing'
import { can as canDo, FULL_ACCESS, type Capabilities } from '../lib/capabilities'

import type { TabKey, FiberRoute, IpamAssignment, RadiusSession, Broadcast } from './network/types'
import { fetchList } from './network/helpers'
import { NiTab } from './network/shared'
import { FiberTab, FiberCreateModal, FiberDetailDrawer } from './network/FiberTab'
import { IpamTab } from './network/IpamTab'
import { RadiusTab } from './network/RadiusTab'
import { BroadcastTab, BroadcastCreateModal } from './network/BroadcastTab'

// ── View ─────────────────────────────────────────────────────────────────────
interface NetworkInventoryViewProps {
  canConfigure?: boolean
  capabilities?: Capabilities
}

export default function NetworkInventoryView({ canConfigure = false, capabilities }: NetworkInventoryViewProps) {
  const { token } = useAuth()
  // SM-2 — capabilities flow as a prop from App.tsx. The previous fallback fetch is
  // gone; App is the single source. Until App finishes its initial fetch the prop
  // is undefined and we default-open via FULL_ACCESS so first-paint isn't blank.
  const caps: Capabilities = capabilities ?? FULL_ACCESS
  const capsLoaded = capabilities !== undefined

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
    await fetchList<FiberRoute>(token!, `/api/fiber-routes${qs}`, setFiber)
  }, [token, capsLoaded, canView, fiberStatus])

  const loadIpam = useCallback(async () => {
    if (!capsLoaded || !canView) return
    const params: string[] = []
    params.push(`status=${ipamStatus}`)
    if (ipamDebounced.trim()) params.push(`address=${encodeURIComponent(ipamDebounced.trim())}`)
    await fetchList<IpamAssignment>(token!, `/api/ipam/assignments?${params.join('&')}`, setIpam)
  }, [token, capsLoaded, canView, ipamStatus, ipamDebounced])

  const loadRadius = useCallback(async () => {
    if (!capsLoaded || !canView) return
    const params: string[] = []
    if (radiusStatus !== 'all') params.push(`status=${radiusStatus}`)
    if (radiusDebounced.trim()) params.push(`username=${encodeURIComponent(radiusDebounced.trim())}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    await fetchList<RadiusSession>(token!, `/api/radius/sessions${qs}`, setRadius)
  }, [token, capsLoaded, canView, radiusStatus, radiusDebounced])

  const loadBroadcasts = useCallback(async () => {
    if (!capsLoaded || !canView) return
    const qs = bcastStatus !== 'all' ? `?status=${encodeURIComponent(bcastStatus)}` : ''
    await fetchList<Broadcast>(token!, `/api/broadcasts${qs}`, setBcast)
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
      await bpost(token!, '/api/ipam/release', { assignment_id: a.id })
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
      await bpatch(token!, `/api/radius/sessions/${s.id}/stop`, { acct_stop: new Date().toISOString() })
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
      await bpost(token!, `/api/broadcasts/${b.id}/send`, {})
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
          gap: 'var(--gx-space-2)',
          borderBottom: '1px solid var(--gx-border)',
          marginBottom: 'var(--gx-space-5)',
          marginTop: 'var(--gx-space-3)',
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
          onClose={() => setFiberCreating(false)}
          onCreated={() => { setFiberCreating(false); void loadFiber() }}
        />
      )}
      {openFiberId && (
        <FiberDetailDrawer
          id={openFiberId}
          onClose={() => setOpenFiberId(null)}
        />
      )}
      {bcastCreating && (
        <BroadcastCreateModal
          onClose={() => setBcastCreating(false)}
          onCreated={() => { setBcastCreating(false); void loadBroadcasts() }}
        />
      )}
    </PageShell>
  )
}
