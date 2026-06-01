// NocDashboardView — Tech & NOC → Tech & NOC Dashboard.
//
// Real NOC monitoring control center wired to the Phase NOC.B endpoints
// (already shipped on the backend):
//
//   GET  /api/noc/dashboard                          → OLT rollup + live techs
//   GET  /api/noc/olts                               → list of OLT records
//   GET  /api/noc/olts/{olt_record_id}/tree          → chassis → cards → ports → ONUs
//   POST /api/noc/ports/{port_id}/optical-reading    → admin; sample a port
//   POST /api/noc/onus/{onu_id}/optical-reading      → admin; sample an ONU
//   POST /api/noc/otdr   body { target_type, target_id } → admin; OTDR scan
//   GET  /api/noc/technicians?since_minutes=30       → live technician GPS
//
// Real data only — empty / 404 → friendly empty state, 403 → PermissionDenied,
// action 409 → toast.error. Skeleton tiles + loading lines while in flight.
//
// Optical threshold rule (rx_dbm):
//   < -28       → critical (red)
//   -28 … -26   → warning (amber)
//   >= -26      → normal (green)
import { useEffect, useState } from 'react'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import { StatusPill } from '../primitives'
import { EmptyState, ErrorBanner, PermissionDenied, SkeletonRows } from '../components/States'
import {
  ServerIcon, ActivityIcon, RefreshIcon, ChevronRightIcon, ChevronDownIcon,
  MapPinIcon, ZapIcon, LayersIcon, PackageIcon,
} from '../components/icons'
import { bget, bpost } from '../lib/billing'
import { toast } from '../components/Toast'
import { can, type Capabilities } from '../lib/capabilities'
import { timeAgo } from '../lib/time'

// ─── Types matching the NOC.B backend payloads ───────────────────────────────

type OltHealth = {
  total_olts: number
  chassis_active: number
  chassis_failed: number
  cards_active: number
  cards_failed: number
  ports_up: number
  ports_down: number
  ports_fault: number
  onus_active: number
  onus_los: number
  onus_offline: number
  ports_signaling_below_threshold: number
  ports_signal_unknown: number
}

type Technician = {
  technician_user_id: string
  last_lat: number | null
  last_lng: number | null
  last_recorded_at: string | null
  ping_count: number
}

type DashboardResp = { olt_health: OltHealth; technicians: Technician[] }

type OltRecord = {
  id: string
  data?: Record<string, unknown>
  status?: string | null
  name?: string
  [k: string]: unknown
}

type Onu = {
  id: string
  serial?: string | null
  customer_id?: string | null
  service_id?: string | null
  status?: string | null
  distance_m?: number | null
  last_rx_dbm?: number | null
  last_tx_dbm?: number | null
  last_polled_at?: string | null
  [k: string]: unknown
}

type Port = {
  id: string
  port_no?: number | string | null
  type?: string | null
  status?: string | null
  last_rx_dbm?: number | null
  last_tx_dbm?: number | null
  last_polled_at?: string | null
  onus?: Onu[]
  [k: string]: unknown
}

type Card = {
  id: string
  slot_no?: number | string | null
  card_type?: string | null
  status?: string | null
  ports?: Port[]
  [k: string]: unknown
}

type Chassis = {
  id: string
  name?: string | null
  status?: string | null
  cards?: Card[]
  [k: string]: unknown
}

type OltTree = {
  id: string
  name?: string | null
  chassis?: Chassis[]
  [k: string]: unknown
}

type OpticalReading = {
  rx_dbm?: number | null
  tx_dbm?: number | null
  recorded_at?: string | null
  [k: string]: unknown
}

type OtdrEvent = {
  distance_m?: number | null
  event_type?: string | null
  loss_db?: number | null
  reflectance_db?: number | null
  [k: string]: unknown
}

type OtdrResult = {
  id?: string
  target_type?: string
  target_id?: string
  result_json?: { events?: OtdrEvent[]; [k: string]: unknown }
  recorded_at?: string | null
  [k: string]: unknown
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function thresholdVariant(rx: number | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' {
  if (rx == null || Number.isNaN(rx)) return 'neutral'
  if (rx < -28) return 'critical'
  if (rx < -26) return 'degraded'
  return 'active'
}

function thresholdLabel(rx: number | null | undefined): string {
  if (rx == null || Number.isNaN(rx)) return 'unknown'
  if (rx < -28) return 'critical'
  if (rx < -26) return 'warning'
  return 'normal'
}

function statusPillVariant(status: string | null | undefined): 'active' | 'degraded' | 'critical' | 'neutral' {
  if (!status) return 'neutral'
  const s = status.toUpperCase()
  if (s === 'UP' || s === 'ACTIVE' || s === 'ONLINE') return 'active'
  if (s === 'FAULT' || s === 'DEGRADED' || s === 'LOS') return 'degraded'
  if (s === 'DOWN' || s === 'FAILED' || s === 'OFFLINE') return 'critical'
  return 'neutral'
}

function short(s: string | null | undefined, n = 8): string {
  if (!s) return '—'
  return s.length > n ? s.slice(0, n) : s
}

function oltDisplayName(o: OltRecord): string {
  const d = (o.data ?? {}) as Record<string, unknown>
  return (o.name as string) ?? (d.name as string) ?? (d.hostname as string) ?? short(o.id)
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NocDashboardView({
  token,
  capabilities,
  canConfigure,
}: {
  token: string
  capabilities: Capabilities
  canConfigure: boolean
}) {
  // ── Dashboard rollup ──
  const [health, setHealth] = useState<OltHealth | null>(null)
  const [techs, setTechs] = useState<Technician[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── OLT list + tree ──
  const [olts, setOlts] = useState<OltRecord[]>([])
  const [oltsLoading, setOltsLoading] = useState(true)
  const [oltsError, setOltsError] = useState<string | null>(null)
  const [selectedOltId, setSelectedOltId] = useState<string | null>(null)
  const [tree, setTree] = useState<OltTree | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [expandedChassis, setExpandedChassis] = useState<Set<string>>(new Set())
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const [expandedPorts, setExpandedPorts] = useState<Set<string>>(new Set())

  // ── Action results (sample readings + OTDR events keyed by target id) ──
  const [readings, setReadings] = useState<Record<string, OpticalReading>>({})
  const [otdrs, setOtdrs] = useState<Record<string, OtdrResult>>({})
  const [expandedOtdr, setExpandedOtdr] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())

  // ── Technicians refresh state ──
  const [techLoading, setTechLoading] = useState(false)

  // Permission gates
  const canViewService = can(capabilities, 'service', 'view')
  const canWrite = canConfigure

  // Load dashboard rollup + OLT list
  useEffect(() => {
    if (!canViewService) { setLoading(false); setOltsLoading(false); return }
    let alive = true

    void (async () => {
      const res = await bget<DashboardResp>(token, '/api/noc/dashboard')
      if (!alive) return
      if (res.status === 403) { setForbidden(true); setLoading(false); return }
      if (res.status === 404) { setNotFound(true); setLoading(false); return }
      if (!res.ok || !res.data) {
        setError(`Failed to load NOC dashboard (HTTP ${res.status})`)
        setLoading(false)
        return
      }
      setHealth(res.data.olt_health ?? null)
      setTechs(res.data.technicians ?? [])
      setLoading(false)
    })()

    void (async () => {
      const res = await bget<OltRecord[] | { records?: OltRecord[] }>(token, '/api/noc/olts')
      if (!alive) return
      if (res.status === 404) { setOltsLoading(false); return }
      if (!res.ok) {
        setOltsError(`Failed to load OLTs (HTTP ${res.status})`)
        setOltsLoading(false)
        return
      }
      const list = Array.isArray(res.data)
        ? res.data
        : (res.data && Array.isArray((res.data as { records?: OltRecord[] }).records))
          ? (res.data as { records: OltRecord[] }).records
          : []
      setOlts(list)
      setOltsLoading(false)
    })()

    return () => { alive = false }
  }, [token, canViewService])

  async function loadTree(oltId: string) {
    setSelectedOltId(oltId)
    setTree(null)
    setTreeError(null)
    setTreeLoading(true)
    setExpandedChassis(new Set())
    setExpandedCards(new Set())
    setExpandedPorts(new Set())
    const res = await bget<OltTree>(token, `/api/noc/olts/${oltId}/tree`)
    if (res.status === 404) { setTreeError('Tree not available for this OLT'); setTreeLoading(false); return }
    if (!res.ok || !res.data) { setTreeError(`Failed to load tree (HTTP ${res.status})`); setTreeLoading(false); return }
    setTree(res.data)
    setTreeLoading(false)
    // Auto-open chassis on first load for visibility
    const firstChassis = res.data.chassis?.[0]?.id
    if (firstChassis) setExpandedChassis(new Set([firstChassis]))
  }

  async function refreshTechs() {
    setTechLoading(true)
    const res = await bget<Technician[] | { technicians?: Technician[] }>(
      token,
      '/api/noc/technicians?since_minutes=30',
    )
    if (res.ok) {
      const list = Array.isArray(res.data)
        ? res.data
        : (res.data && Array.isArray((res.data as { technicians?: Technician[] }).technicians))
          ? (res.data as { technicians: Technician[] }).technicians
          : []
      setTechs(list)
    } else if (res.status !== 404) {
      toast.error(`Failed to refresh technicians (HTTP ${res.status})`)
    }
    setTechLoading(false)
  }

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function markBusy(key: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev)
      if (on) next.add(key); else next.delete(key)
      return next
    })
  }

  async function sample(targetKind: 'port' | 'onu', id: string) {
    const key = `sample:${targetKind}:${id}`
    markBusy(key, true)
    try {
      const reading = await bpost<OpticalReading>(token, `/api/noc/${targetKind}s/${id}/optical-reading`)
      setReadings((prev) => ({ ...prev, [`${targetKind}:${id}`]: reading }))
      toast.success(`Reading captured (rx ${reading.rx_dbm ?? '—'} dBm)`)
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 409) toast.error('Conflict — device busy. Try again shortly.')
      else toast.error(err.message || 'Sample failed')
    } finally {
      markBusy(key, false)
    }
  }

  async function runOtdr(targetType: 'port' | 'onu', id: string) {
    const key = `otdr:${targetType}:${id}`
    markBusy(key, true)
    try {
      const result = await bpost<OtdrResult>(token, '/api/noc/otdr', { target_type: targetType, target_id: id })
      const map = `${targetType}:${id}`
      setOtdrs((prev) => ({ ...prev, [map]: result }))
      setExpandedOtdr((prev) => new Set(prev).add(map))
      toast.success('OTDR scan complete')
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 409) toast.error('Conflict — scan already in progress.')
      else toast.error(err.message || 'OTDR scan failed')
    } finally {
      markBusy(key, false)
    }
  }

  // ─── KPI tiles ─────────────────────────────────────────────────────────────
  const kpis: KPISpec[] = loading
    ? [
        { label: 'OLTs',                     value: 0, loading: true },
        { label: 'Ports Up',                 value: 0, loading: true },
        { label: 'Ports Down',               value: 0, loading: true },
        { label: 'ONUs Active',              value: 0, loading: true },
        { label: 'Signals Below Threshold',  value: 0, loading: true },
      ]
    : health
      ? [
          { label: 'OLTs',                    value: health.total_olts },
          { label: 'Ports Up',                value: health.ports_up,
            subtitle: <span style={{ color: 'var(--gx-success-fg, #22c55e)' }}>healthy</span> },
          { label: 'Ports Down',              value: health.ports_down + health.ports_fault, danger: (health.ports_down + health.ports_fault) > 0 },
          { label: 'ONUs Active',             value: health.onus_active },
          { label: 'Signals Below Threshold', value: health.ports_signaling_below_threshold, warning: health.ports_signaling_below_threshold > 0 },
        ]
      : []

  // ─── Permission / error gates ──────────────────────────────────────────────
  if (forbidden || !canViewService) {
    return (
      <PageShell
        type="operations"
        breadcrumb={['Tech & NOC', 'Tech & NOC Dashboard']}
        icon={<ServerIcon size={18} />}
        title="Tech & NOC Dashboard"
        subtitle="OLT health · RADIUS sessions · technician GPS"
      >
        <PermissionDenied message="You don't have permission to view NOC monitoring." />
      </PageShell>
    )
  }

  if (notFound) {
    return (
      <PageShell
        type="operations"
        breadcrumb={['Tech & NOC', 'Tech & NOC Dashboard']}
        icon={<ServerIcon size={18} />}
        title="Tech & NOC Dashboard"
        subtitle="OLT health · RADIUS sessions · technician GPS"
      >
        <EmptyState
          icon={<ServerIcon size={36} />}
          title="NOC dashboard endpoints not yet available"
          message="The /api/noc/* endpoints are not deployed in this environment."
        />
      </PageShell>
    )
  }

  // ─── Body ──────────────────────────────────────────────────────────────────
  const body = (
    <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
      {error && <ErrorBanner message={error} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 'var(--sp-4)', alignItems: 'start' }}>
        {/* ─── Left: OLT Tree ───────────────────────────────────────── */}
        <section className="card" style={{ padding: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
            <ServerIcon size={16} />
            <span className="section-label">OLT Inventory</span>
            <span className="spacer" style={{ flex: 1 }} />
            {oltsLoading && <span className="muted" style={{ fontSize: 12 }}>Loading…</span>}
          </div>

          {oltsError && <ErrorBanner message={oltsError} />}

          {!oltsLoading && !oltsError && olts.length === 0 && (
            <EmptyState
              icon={<ServerIcon size={32} />}
              title="No OLTs deployed yet"
              message="Once OLTs are registered they will appear here with chassis, cards, ports, and ONUs."
            />
          )}

          {!oltsLoading && olts.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 220px) 1fr', gap: 'var(--sp-3)' }}>
              {/* OLT list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {olts.map((olt) => {
                  const active = selectedOltId === olt.id
                  return (
                    <button
                      key={olt.id}
                      className={'btn btn-ghost' + (active ? ' on' : '')}
                      style={{
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        padding: 'var(--sp-2) var(--sp-3)',
                        background: active ? 'var(--gx-surface-2)' : undefined,
                        border: active ? '1px solid var(--gx-border-strong)' : '1px solid var(--gx-border)',
                        borderRadius: 'var(--gx-radius-sm)',
                      }}
                      onClick={() => loadTree(olt.id)}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ServerIcon size={13} />
                        <span style={{ fontSize: 13 }}>{oltDisplayName(olt)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Tree panel */}
              <div>
                {!selectedOltId && (
                  <p className="muted" style={{ fontSize: 13, padding: 'var(--sp-3)' }}>
                    Select an OLT to view its chassis, cards, ports, and ONUs.
                  </p>
                )}
                {selectedOltId && treeLoading && <SkeletonRows rows={5} />}
                {selectedOltId && treeError && <ErrorBanner message={treeError} />}
                {selectedOltId && !treeLoading && !treeError && tree && (
                  <OltTreeView
                    tree={tree}
                    canWrite={canWrite}
                    busy={busy}
                    readings={readings}
                    otdrs={otdrs}
                    expandedChassis={expandedChassis}
                    expandedCards={expandedCards}
                    expandedPorts={expandedPorts}
                    expandedOtdr={expandedOtdr}
                    onToggleChassis={(id) => toggle(setExpandedChassis, id)}
                    onToggleCard={(id) => toggle(setExpandedCards, id)}
                    onTogglePort={(id) => toggle(setExpandedPorts, id)}
                    onToggleOtdr={(key) => toggle(setExpandedOtdr, key)}
                    onSamplePort={(id) => sample('port', id)}
                    onSampleOnu={(id) => sample('onu', id)}
                    onOtdrPort={(id) => runOtdr('port', id)}
                    onOtdrOnu={(id) => runOtdr('onu', id)}
                  />
                )}
              </div>
            </div>
          )}
        </section>

        {/* ─── Right: Technicians Live ──────────────────────────────── */}
        <section className="card" style={{ padding: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
            <ActivityIcon size={16} />
            <span className="section-label">Technicians Live</span>
            <span style={{ flex: 1 }} />
            <button
              className="btn btn-ghost btn-sm"
              onClick={refreshTechs}
              disabled={techLoading}
              title="Refresh technician GPS"
            >
              <RefreshIcon size={13} /> Refresh
            </button>
          </div>

          <div
            className="muted"
            style={{
              fontSize: 12,
              padding: 'var(--sp-2)',
              background: 'var(--gx-surface-2, rgba(255,255,255,0.03))',
              border: '1px dashed var(--gx-border)',
              borderRadius: 'var(--gx-radius-sm)',
              marginBottom: 'var(--sp-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <MapPinIcon size={13} />
            <span>Map view coming soon — showing live coordinates as list for now.</span>
          </div>

          {loading && <SkeletonRows rows={4} />}

          {!loading && techs.length === 0 && (
            <EmptyState
              icon={<ActivityIcon size={32} />}
              title="No technicians currently on shift"
              message="Technicians appear here when their app pings GPS in the last 30 minutes."
            />
          )}

          {!loading && techs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {techs.map((t) => (
                <div
                  key={t.technician_user_id}
                  className="card"
                  style={{ padding: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: 'var(--gx-success-fg, #22c55e)',
                    }} />
                    <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 13, fontWeight: 500 }}>
                      {short(t.technician_user_id, 10)}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span className="muted" style={{ fontSize: 11 }}>{timeAgo(t.last_recorded_at)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }} className="muted">
                    <MapPinIcon size={11} />
                    <span style={{ fontFamily: 'var(--gx-font-mono, monospace)' }}>
                      {t.last_lat != null && t.last_lng != null
                        ? `${t.last_lat.toFixed(5)}, ${t.last_lng.toFixed(5)}`
                        : 'no coordinates'}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span>{t.ping_count} ping{t.ping_count === 1 ? '' : 's'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ─── Legend ───────────────────────────────────────────────── */}
      <section
        className="card"
        style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
          <ZapIcon size={14} />
          <span className="section-label">Optical Signal Legend</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', fontSize: 12 }}>
          <LegendChip variant="active" label="Normal" detail="rx ≥ -26 dBm" />
          <LegendChip variant="degraded" label="Warning" detail="-28 ≤ rx < -26 dBm" />
          <LegendChip variant="critical" label="Critical" detail="rx < -28 dBm" />
          <LegendChip variant="neutral" label="Unknown" detail="no recent reading" />
        </div>
      </section>
    </div>
  )

  return (
    <PageShell
      type="operations"
      breadcrumb={['Tech & NOC', 'Tech & NOC Dashboard']}
      icon={<ServerIcon size={18} />}
      title="Tech & NOC Dashboard"
      subtitle="OLT health · RADIUS sessions · technician GPS"
      kpis={kpis.length > 0 ? kpis : undefined}
    >
      {body}
    </PageShell>
  )
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function LegendChip({ variant, label, detail }: {
  variant: 'active' | 'degraded' | 'critical' | 'neutral'
  label: string
  detail: string
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <StatusPill variant={variant} label={label} size="sm" />
      <span className="muted">{detail}</span>
    </span>
  )
}

function OpticalReadout({ rx, tx }: { rx: number | null | undefined; tx: number | null | undefined }) {
  const variant = thresholdVariant(rx)
  const tone = thresholdLabel(rx)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--gx-font-mono, monospace)' }}>
      <StatusPill variant={variant} label={`rx ${rx == null ? '—' : rx.toFixed(1)} dBm`} size="sm" />
      <span className="muted">tx {tx == null ? '—' : tx.toFixed(1)} dBm</span>
      <span className="muted">({tone})</span>
    </span>
  )
}

type TreeViewProps = {
  tree: OltTree
  canWrite: boolean
  busy: Set<string>
  readings: Record<string, OpticalReading>
  otdrs: Record<string, OtdrResult>
  expandedChassis: Set<string>
  expandedCards: Set<string>
  expandedPorts: Set<string>
  expandedOtdr: Set<string>
  onToggleChassis: (id: string) => void
  onToggleCard: (id: string) => void
  onTogglePort: (id: string) => void
  onToggleOtdr: (key: string) => void
  onSamplePort: (id: string) => void
  onSampleOnu: (id: string) => void
  onOtdrPort: (id: string) => void
  onOtdrOnu: (id: string) => void
}

function OltTreeView(p: TreeViewProps) {
  const chassis = p.tree.chassis ?? []
  if (chassis.length === 0) {
    return (
      <EmptyState
        icon={<LayersIcon size={28} />}
        title="No chassis on this OLT"
        message="This OLT has no chassis registered yet."
      />
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {chassis.map((c) => {
        const open = p.expandedChassis.has(c.id)
        const cards = c.cards ?? []
        return (
          <div key={c.id} className="card" style={{ padding: 'var(--sp-2)' }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ justifyContent: 'flex-start', width: '100%' }}
              onClick={() => p.onToggleChassis(c.id)}
            >
              {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
              <LayersIcon size={13} />
              <span style={{ fontWeight: 500 }}>{c.name ?? `Chassis ${short(c.id)}`}</span>
              <span style={{ flex: 1 }} />
              <StatusPill variant={statusPillVariant(c.status)} label={c.status ?? 'unknown'} size="sm" />
              <span className="muted" style={{ fontSize: 11 }}>{cards.length} card{cards.length === 1 ? '' : 's'}</span>
            </button>
            {open && (
              <div style={{ marginTop: 6, marginLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cards.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No cards</p>}
                {cards.map((card) => {
                  const cOpen = p.expandedCards.has(card.id)
                  const ports = card.ports ?? []
                  return (
                    <div key={card.id}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ justifyContent: 'flex-start', width: '100%' }}
                        onClick={() => p.onToggleCard(card.id)}
                      >
                        {cOpen ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
                        <PackageIcon size={12} />
                        <span>Slot {card.slot_no ?? '—'}</span>
                        <span className="muted" style={{ fontSize: 11 }}>{card.card_type ?? ''}</span>
                        <span style={{ flex: 1 }} />
                        <StatusPill variant={statusPillVariant(card.status)} label={card.status ?? 'unknown'} size="sm" />
                        <span className="muted" style={{ fontSize: 11 }}>{ports.length} port{ports.length === 1 ? '' : 's'}</span>
                      </button>
                      {cOpen && (
                        <div style={{ marginLeft: 18, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {ports.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No ports</p>}
                          {ports.map((port) => {
                            const pOpen = p.expandedPorts.has(port.id)
                            const onus = port.onus ?? []
                            const samplingKey = `sample:port:${port.id}`
                            const otdrKey = `otdr:port:${port.id}`
                            const reading = p.readings[`port:${port.id}`]
                            const otdrRes = p.otdrs[`port:${port.id}`]
                            const otdrOpen = p.expandedOtdr.has(`port:${port.id}`)
                            return (
                              <div key={port.id}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 'var(--gx-radius-sm)' }}>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => p.onTogglePort(port.id)}
                                    title="Toggle ONUs"
                                  >
                                    {pOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                                  </button>
                                  <span style={{ fontWeight: 500, fontSize: 13 }}>Port {port.port_no ?? '—'}</span>
                                  <span className="muted" style={{ fontSize: 11 }}>{port.type ?? ''}</span>
                                  <StatusPill variant={statusPillVariant(port.status)} label={port.status ?? 'unknown'} size="sm" />
                                  {port.last_polled_at && (
                                    <span className="muted" style={{ fontSize: 11 }}>polled {timeAgo(port.last_polled_at)}</span>
                                  )}
                                  <span style={{ flex: 1 }} />
                                  <span className="muted" style={{ fontSize: 11 }}>{onus.length} ONU{onus.length === 1 ? '' : 's'}</span>
                                  {p.canWrite && (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        disabled={p.busy.has(samplingKey)}
                                        onClick={() => p.onSamplePort(port.id)}
                                        title="Trigger an optical reading on this port"
                                      >
                                        {p.busy.has(samplingKey) ? '…' : 'Sample'}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        disabled={p.busy.has(otdrKey)}
                                        onClick={() => p.onOtdrPort(port.id)}
                                        title="Run an OTDR scan from this port"
                                      >
                                        {p.busy.has(otdrKey) ? '…' : 'OTDR'}
                                      </button>
                                    </>
                                  )}
                                </div>
                                {reading && (
                                  <div style={{ marginLeft: 28, padding: '2px 0' }}>
                                    <OpticalReadout rx={reading.rx_dbm} tx={reading.tx_dbm} />
                                  </div>
                                )}
                                {otdrRes && (
                                  <div style={{ marginLeft: 28 }}>
                                    <OtdrCard
                                      open={otdrOpen}
                                      onToggle={() => p.onToggleOtdr(`port:${port.id}`)}
                                      result={otdrRes}
                                    />
                                  </div>
                                )}
                                {pOpen && (
                                  <div style={{ marginLeft: 28, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {onus.length === 0 && <p className="muted" style={{ fontSize: 12 }}>No ONUs</p>}
                                    {onus.map((onu) => (
                                      <OnuRow
                                        key={onu.id}
                                        onu={onu}
                                        canWrite={p.canWrite}
                                        busy={p.busy}
                                        reading={p.readings[`onu:${onu.id}`]}
                                        otdrRes={p.otdrs[`onu:${onu.id}`]}
                                        otdrOpen={p.expandedOtdr.has(`onu:${onu.id}`)}
                                        onSample={() => p.onSampleOnu(onu.id)}
                                        onOtdr={() => p.onOtdrOnu(onu.id)}
                                        onToggleOtdr={() => p.onToggleOtdr(`onu:${onu.id}`)}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OnuRow({ onu, canWrite, busy, reading, otdrRes, otdrOpen, onSample, onOtdr, onToggleOtdr }: {
  onu: Onu
  canWrite: boolean
  busy: Set<string>
  reading: OpticalReading | undefined
  otdrRes: OtdrResult | undefined
  otdrOpen: boolean
  onSample: () => void
  onOtdr: () => void
  onToggleOtdr: () => void
}) {
  const sampleKey = `sample:onu:${onu.id}`
  const otdrKey = `otdr:onu:${onu.id}`
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px' }}>
        <span style={{ width: 12 }} />
        <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 12 }}>{short(onu.serial, 12)}</span>
        <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--gx-font-mono, monospace)' }}>cust {short(onu.customer_id, 6)}</span>
        <StatusPill variant={statusPillVariant(onu.status)} label={onu.status ?? 'unknown'} size="sm" />
        {onu.distance_m != null && (
          <span className="muted" style={{ fontSize: 11 }}>{onu.distance_m} m</span>
        )}
        <span style={{ flex: 1 }} />
        {canWrite && (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy.has(sampleKey)}
              onClick={onSample}
              title="Trigger an optical reading on this ONU"
            >
              {busy.has(sampleKey) ? '…' : 'Sample'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy.has(otdrKey)}
              onClick={onOtdr}
              title="Run an OTDR scan to this ONU"
            >
              {busy.has(otdrKey) ? '…' : 'OTDR'}
            </button>
          </>
        )}
      </div>
      {reading && (
        <div style={{ marginLeft: 18, padding: '2px 0' }}>
          <OpticalReadout rx={reading.rx_dbm} tx={reading.tx_dbm} />
        </div>
      )}
      {otdrRes && (
        <div style={{ marginLeft: 18 }}>
          <OtdrCard open={otdrOpen} onToggle={onToggleOtdr} result={otdrRes} />
        </div>
      )}
    </div>
  )
}

function OtdrCard({ open, onToggle, result }: { open: boolean; onToggle: () => void; result: OtdrResult }) {
  const events = result.result_json?.events ?? []
  return (
    <div
      className="card"
      style={{
        padding: 'var(--sp-2)',
        marginTop: 4,
        background: 'var(--gx-surface-2, rgba(255,255,255,0.03))',
      }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ justifyContent: 'flex-start', width: '100%' }}
        onClick={onToggle}
      >
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <ZapIcon size={12} />
        <span style={{ fontSize: 12, fontWeight: 500 }}>OTDR scan</span>
        <span className="muted" style={{ fontSize: 11 }}>{events.length} event{events.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        {result.recorded_at && <span className="muted" style={{ fontSize: 11 }}>{timeAgo(result.recorded_at)}</span>}
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {events.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>No events returned.</p>
          ) : (
            <table className="grid" style={{ width: '100%', fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Distance (m)</th>
                  <th>Type</th>
                  <th>Loss (dB)</th>
                  <th>Refl. (dB)</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, idx) => (
                  <tr key={idx}>
                    <td>{ev.distance_m ?? '—'}</td>
                    <td>{ev.event_type ?? '—'}</td>
                    <td>{ev.loss_db ?? '—'}</td>
                    <td>{ev.reflectance_db ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
