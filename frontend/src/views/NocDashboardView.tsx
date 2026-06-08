// NocDashboardView — Production NMS (Network Management System) dashboard.
//
// Rebuilt 2026-06-03 per the production NMS spec Gev locked. Six modules,
// 17 widgets, alarms-first ordering, fixed-slot grid with reflow on toggle,
// universal slide-out drawer for context detail, gear menu for widget
// visibility. Component classes (`.nms-*`) live in `styles/_nms.css` and
// reference the canonical `--gx-*` tokens directly — the previously-separate
// `nms-tokens.css` was unified into `gaahex-tokens.css` on 2026-06-06.
//
// PHASE 1B — LIVE DATA WIRED
//   Wired widgets pull from: /api/noc/olts, /api/noc/olts/{id}/analytics,
//   /api/noc/onus, /api/analytics/subscription-mix, /api/regions,
//   /api/radius/sessions. Pending widgets (uplink, IP pool, optical-RX,
//   rogue, unprovisioned, tech-fleet) keep the SAMPLE_* fallback and the
//   "▾ sample data" tag until Phase 2 pipelines are available.
//
// Layout reflow: each widget declares a `slot` (kpi/small/medium/wide).
// The CSS grid is `repeat(12, 1fr)` with auto-flow:row dense. When a
// widget is hidden via the gear menu, the remaining ones repack tightly
// — no empty holes.
import { useEffect, useMemo, useState } from 'react'
import { PageShell, SlideOutPanel } from '../page-shell'
import { PermissionDenied } from '../components/States'
import { can, type Capabilities } from '../lib/capabilities'
import { BASE } from '../lib/config'
import { authH } from '../lib/billing'

// ═══════════════════════════════════════════════════════════════════════
// 1. SAMPLE DATA — used by every widget during PHASE 1A design preview.
//    Every widget's data source is named in `dataStatus` on the registry;
//    when a widget is wired to real data, its sample import is removed.
// ═══════════════════════════════════════════════════════════════════════

const SAMPLE_OLTS_ONLINE = { count: 12, delta_60s: +1 }
const SAMPLE_UPLINK = { used_gbps: 72, capacity_gbps: 100 }
const SAMPLE_SESSIONS = { active: 14832 }
const SAMPLE_IP_POOL = { used: 8421, total: 16384 }

const SAMPLE_PHASE_STATE = {
  working: 571,
  dying_gasp: 67,
  offline: 25,
  total: 663,
}

const SAMPLE_OPTICAL_RX = [
  { label: '> -15 dBm',     bucket: 'Perfect',    count: 423, variant: 'green'  as const },
  { label: '-16 to -27 dBm', bucket: 'Acceptable', count: 198, variant: 'amber'  as const },
  { label: '< -28 dBm',     bucket: 'Critical',   count: 42,  variant: 'red'    as const },
]

const SAMPLE_ROGUE = { count: 0 }

const SAMPLE_PON_SATURATION = {
  ports: [
    { id: '0/1', count: 73,  max: 128 },
    { id: '0/2', count: 37,  max: 128 },
    { id: '0/3', count: 95,  max: 128 },
    { id: '0/4', count: 103, max: 128 },
    { id: '0/5', count: 65,  max: 128 },
    { id: '0/6', count: 117, max: 128 },
    { id: '0/7', count: 76,  max: 128 },
    { id: '0/8', count: 97,  max: 128 },
  ],
}

const SAMPLE_VENDOR_MIX = [
  { vendor: 'Huawei', count: 318, prefix: 'HWTC' },
  { vendor: 'ZTE',    count: 212, prefix: 'ZTEG' },
  { vendor: 'Nokia',  count: 93,  prefix: 'ALCL' },
  { vendor: 'Calix',  count: 40,  prefix: 'CXNK' },
]

const SAMPLE_DENSITY = [
  { olt: 'ArmGponOLT2',  count: 663 },
  { olt: 'YvnGponOLT-A', count: 511 },
  { olt: 'YvnGponOLT-B', count: 487 },
  { olt: 'GymriOLT-1',   count: 312 },
  { olt: 'VanadzorOLT',  count: 198 },
]

const SAMPLE_TIER_MIX = [
  { tier: '50 Mbps',  count: 84 },
  { tier: '100 Mbps', count: 186 },
  { tier: '300 Mbps', count: 132 },
  { tier: '500 Mbps', count: 89 },
  { tier: '1 Gbps',   count: 252 },
]

const SAMPLE_PROFILES = [
  { name: 'LP_RES_1000_500', count: 252 },
  { name: 'LP_RES_500_300',  count: 132 },
  { name: 'LP_RES_300_100',  count: 186 },
  { name: 'LP_RES_100_50',   count: 84 },
  { name: 'LP_BIZ_1000_1000', count: 38 },
  { name: 'DBA_GUARANTEED',  count: 27 },
  { name: 'LP_LEGACY_50',    count: 11 },
  { name: 'LP_TEST_PROFILE', count: 3 },
]

const SAMPLE_UNPROVISIONED = { count: 3 }

const SAMPLE_SEGMENTS = [
  { id: 'vlan-10',   label: 'VLAN 10',    kind: 'mgmt' },
  { id: 'vlan-100',  label: 'VLAN 100',   kind: 'subscriber' },
  { id: 'vlan-200',  label: 'VLAN 200',   kind: 'subscriber' },
  { id: 'vlan-300',  label: 'VLAN 300',   kind: 'subscriber' },
  { id: 'vlan-500',  label: 'VLAN 500',   kind: 'voice' },
  { id: 'vlan-2009', label: 'VLAN 2009',  kind: 'transit' },
  { id: 'vlan-2016', label: 'VLAN 2016',  kind: 'transit' },
  { id: 'bng-arm',   label: 'BNG-ARM',    kind: 'bng' },
]

const SAMPLE_HIERARCHY = {
  regions: [
    {
      id: 'r-arm', label: 'Armavir',
      olts: [
        { id: 'arm-1', label: 'ArmGponOLT2', ports: [
          { id: 'arm-1-1', label: '0/1', onus: [
            { id: 'gpon00134174', serial: 'GPON00134174', profile: 'LP_RES_1000_500', phase: 'working' },
            { id: 'gpon00b0aa98', serial: 'GPON00b0aa98', profile: 'LP_RES_300_100',  phase: 'working' },
            { id: 'gpon00b09b40', serial: 'GPON00b09b40', profile: 'LP_RES_500_300',  phase: 'dying_gasp' },
          ] },
          { id: 'arm-1-2', label: '0/2', onus: [] },
          { id: 'arm-1-3', label: '0/3', onus: [] },
          { id: 'arm-1-4', label: '0/4', onus: [] },
        ] },
      ],
    },
    {
      id: 'r-yvn', label: 'Yerevan',
      olts: [
        { id: 'yvn-a', label: 'YvnGponOLT-A', ports: [
          { id: 'yvn-a-1', label: '0/1', onus: [] },
          { id: 'yvn-a-2', label: '0/2', onus: [] },
        ] },
        { id: 'yvn-b', label: 'YvnGponOLT-B', ports: [
          { id: 'yvn-b-1', label: '0/1', onus: [] },
        ] },
      ],
    },
    { id: 'r-gym', label: 'Gyumri',   olts: [{ id: 'gym-1', label: 'GymriOLT-1', ports: [] }] },
    { id: 'r-van', label: 'Vanadzor', olts: [{ id: 'van-1', label: 'VanadzorOLT', ports: [] }] },
  ],
}

const SAMPLE_REGIONAL_HUBS = [
  { id: 'arm', label: 'Armavir',   lat: 40.1572, lng: 43.8746, status: 'ok'      as const },
  { id: 'yvn', label: 'Yerevan',   lat: 40.1772, lng: 44.5035, status: 'ok'      as const },
  { id: 'gym', label: 'Gyumri',    lat: 40.7942, lng: 43.8453, status: 'warning' as const },
  { id: 'van', label: 'Vanadzor',  lat: 40.8128, lng: 44.4886, status: 'ok'      as const },
  { id: 'kap', label: 'Kapan',     lat: 39.2071, lng: 46.4053, status: 'outage'  as const },
]

const SAMPLE_TECHS = { available: 3, en_route: 2, on_site: 1 }

// ═══════════════════════════════════════════════════════════════════════
// 1B. LIVE DATA TYPES — Phase 1B wired widgets consume these shapes.
// ═══════════════════════════════════════════════════════════════════════

interface OltRecord {
  id: string
  entity_key: string
  status: string
  data: Record<string, unknown>
}
interface OltAnalytics {
  by_port: { port_no: number; count: number }[]
  by_vendor: { prefix: string; count: number }[]
  totals: { onus: number; ports_populated: number; top_vendor_share: number }
  vlans: unknown[]
  line_profile_counts: unknown[]
}
interface SubMixItem { product_name: string; count: number; mrr: number }
interface RegionItem { id: string; code: string; name: string; status: string; parent_id: string | null }

interface NocData {
  oltList: { items: OltRecord[]; total: number }
  analytics: OltAnalytics | null
  onuTotal: number
  subscriptionMix: SubMixItem[]
  regions: RegionItem[]
  radiusSessions: unknown[]
}

const VENDOR_NAMES: Record<string, string> = {
  HWTC: 'Huawei', ZTEG: 'ZTE', ALCL: 'Nokia (Alcatel)', CXNK: 'Calix',
  GPON: 'Generic GPON', EPON: 'Generic EPON', BDCM: 'Broadcom',
  FHTT: 'FiberHome', UBNT: 'Ubiquiti', UNKN: 'Unknown',
}

const REGION_COORDS: Record<string, [number, number]> = {
  Armavir:     [40.1572, 43.8746],
  Yerevan:     [40.1772, 44.5035],
  Gyumri:      [40.7942, 43.8453],
  Vanadzor:    [40.8128, 44.4886],
  Kapan:       [39.2071, 46.4053],
  Abovyan:     [40.2637, 44.6198],
  Hrazdan:     [40.4973, 44.7641],
  Vagharshapat: [40.1653, 44.2985],
  Sevan:       [40.5479, 44.9552],
  Goris:       [39.5115, 46.3384],
  Gavar:       [40.3530, 45.1262],
  Dilijan:     [40.7401, 44.8632],
}

function parseProfiles(raw: unknown): { name: string; count: number }[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.filter((r): r is { name: string; count: number } =>
      typeof r === 'object' && r !== null && 'name' in r && 'count' in r)
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, number>)
      .map(([name, count]) => ({ name, count }))
  }
  return []
}

function parseVlans(raw: unknown): { id: string; label: string; kind: string }[] {
  if (!raw || !Array.isArray(raw)) return []
  return raw.flatMap(v => {
    if (typeof v === 'number') return [{ id: `vlan-${v}`, label: `VLAN ${v}`, kind: 'subscriber' }]
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>
      const vid = o.id ?? o.vlan_id ?? o.vlan
      const kind = String(o.kind ?? o.type ?? 'subscriber')
      if (vid == null) return []
      return [{ id: `vlan-${vid}`, label: `VLAN ${vid}`, kind }]
    }
    return []
  })
}

// ═══════════════════════════════════════════════════════════════════════
// 2. WIDGET REGISTRY — declarative list. The grid renders by filtering
//    this array against the visibility map.
// ═══════════════════════════════════════════════════════════════════════

type ModuleNum = 1 | 2 | 3 | 4 | 5 | 6
type SlotSize = 'kpi' | 'small' | 'medium' | 'wide'
type DataStatus = 'live' | 'partial' | 'pending'

const MODULE_LABELS: Record<ModuleNum, string> = {
  1: 'Module 1 · Global ISP Health',
  2: 'Module 2 · ONU Phase & Optical Alarms',
  3: 'Module 3 · Categorical Network Analytics',
  4: 'Module 4 · Provisioning & Billing Tiers',
  6: 'Module 6 · ISP Hierarchy Explorer',
  5: 'Module 5 · Geographic & Field Operations',
}

// Display order on the page — alarms-first per Gev's lock.
const MODULE_ORDER: ModuleNum[] = [1, 2, 3, 4, 6, 5]

interface WidgetCtx {
  openDrawer: (payload: DrawerPayload) => void
  nocData: NocData | null
  token: string
}

interface WidgetDef {
  id: string
  title: string
  module: ModuleNum
  slot: SlotSize
  dataStatus: DataStatus
  /** When `dataStatus === 'pending'`, the message shown inside the empty state. */
  pendingMessage?: string
  Component: React.FC<WidgetCtx>
}

// Drawer payload — what gets passed to the slide-out when the user clicks
// any chip / slice / row. Caller picks `kind`; drawer body renders by kind.
type DrawerPayload =
  | { kind: 'port';     id: string; label: string }
  | { kind: 'vendor';   prefix: string; label: string }
  | { kind: 'tier';     name: string }
  | { kind: 'profile';  name: string }
  | { kind: 'segment';  id: string; label: string }
  | { kind: 'onu';      serial: string }
  | { kind: 'olt';      id: string; label: string }
  | { kind: 'region';   id: string; label: string }
  | { kind: 'tech-group'; group: 'available' | 'en_route' | 'on_site' }

// ═══════════════════════════════════════════════════════════════════════
// 3. SHARED PRIMITIVES — used inside widget bodies.
// ═══════════════════════════════════════════════════════════════════════

function NMSCard({
  title, status, children, action,
}: {
  title: string
  status: DataStatus
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="nms-card">
      <div className="nms-card-header">
        <div className="nms-card-title">{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-3)' }}>
          {action}
          {status !== 'live' && (
            <span className="nms-card-preview-tag" title="This widget shows sample data while we finalize the design.">
              ▾ sample data
            </span>
          )}
        </div>
      </div>
      <div className="nms-card-body">{children}</div>
    </div>
  )
}

function PendingState({ headline, body }: { headline: string; body: string }) {
  return (
    <div className="nms-card-pending">
      <div className="nms-card-pending-headline">{headline}</div>
      <div style={{ maxWidth: 320 }}>{body}</div>
    </div>
  )
}

function Bar({ pct, variant = 'cyan', height = 8 }: { pct: number; variant?: 'green'|'amber'|'red'|'cyan'|'gold'; height?: number }) {
  // D18: slate neutrals by default; gold only when critical/peak; azure
  // (--gx-interactive) when the bar fills a drillable row / interactive
  // selection (variant: 'cyan'). Cobalt brand-spine is reserved for
  // structural chrome only and never appears here.
  const color =
    variant === 'red' || variant === 'gold'
      ? 'var(--gx-gold)'
      : variant === 'amber'
        ? 'var(--gx-text-3)'
        : variant === 'cyan'
          ? 'var(--gx-interactive)' // D18: drillable-row bar fill = azure (interactive)
          : 'var(--gx-text-2)'
  return (
    <div style={{
      height, width: '100%', borderRadius: 'var(--gx-radius-full)',
      background: 'var(--gx-border-strong)', overflow: 'hidden',
    }}>
      <div style={{
        width: `${Math.max(0, Math.min(100, pct))}%`,
        height: '100%',
        background: color,
      }} />
    </div>
  )
}

function ValueBlock({ label, value, sub, variant = 'default' }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  variant?: 'default' | 'green' | 'amber' | 'red'
}) {
  const valueCls =
    'nms-value ' + (
      variant === 'green' ? 'nms-value-green' :
      variant === 'amber' ? 'nms-value-amber' :
      variant === 'red'   ? 'nms-value-red'   : ''
    )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)' }}>
      <div style={{ fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--gx-font-mono, monospace)' }}>{label}</div>
      <div className={valueCls}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{sub}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 4. MODULE 1 — GLOBAL ISP HEALTH (KPI strip)
// ═══════════════════════════════════════════════════════════════════════

const WOltsOnline: React.FC<WidgetCtx> = ({ nocData }) => {
  const items = nocData?.oltList.items ?? []
  const count = items.length
    ? (items.filter(o => (o.status ?? '').toLowerCase() === 'active').length || items.length)
    : SAMPLE_OLTS_ONLINE.count
  const delta = SAMPLE_OLTS_ONLINE.delta_60s
  return (
    <NMSCard title="OLTs Online" status={nocData ? 'live' : 'partial'}>
      <ValueBlock
        label="ACTIVE CHASSIS"
        value={count}
        sub={
          <span style={{ color: delta >= 0 ? 'var(--gx-text-2)' : 'var(--gx-gold)', fontFamily: 'var(--gx-font-mono, monospace)' }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} in last 60 s
          </span>
        }
      />
    </NMSCard>
  )
}

const WUplinkCapacity: React.FC<WidgetCtx> = () => {
  const pct = (SAMPLE_UPLINK.used_gbps / SAMPLE_UPLINK.capacity_gbps) * 100
  const variant = pct >= 85 ? 'red' : pct >= 70 ? 'amber' : 'green'
  return (
    <NMSCard title="Total Uplink Capacity" status="pending">
      <ValueBlock
        label="CURRENT LOAD"
        value={`${pct.toFixed(0)}%`}
        sub={`${SAMPLE_UPLINK.used_gbps} / ${SAMPLE_UPLINK.capacity_gbps} Gbps`}
        variant={variant}
      />
      <Bar pct={pct} variant={variant} />
    </NMSCard>
  )
}

const WActiveSessions: React.FC<WidgetCtx> = ({ nocData }) => {
  const count = nocData ? nocData.radiusSessions.length : SAMPLE_SESSIONS.active
  return (
    <NMSCard title="Active Customer Sessions" status={nocData ? 'live' : 'pending'}>
      <ValueBlock
        label="PPPoE / IPoE ONLINE"
        value={count.toLocaleString()}
        sub="Authenticated broadband subscribers"
      />
    </NMSCard>
  )
}

const WIpPool: React.FC<WidgetCtx> = () => {
  const pct = (SAMPLE_IP_POOL.used / SAMPLE_IP_POOL.total) * 100
  const remaining = SAMPLE_IP_POOL.total - SAMPLE_IP_POOL.used
  return (
    <NMSCard title="IP Pool Exhaustion" status="pending">
      <ValueBlock
        label="USED / TOTAL"
        value={
          <span>
            <span style={{ fontFamily: 'var(--gx-font-mono, monospace)' }}>{SAMPLE_IP_POOL.used.toLocaleString()}</span>
            <span style={{ color: 'var(--gx-text-3)' }}>/{SAMPLE_IP_POOL.total.toLocaleString()}</span>
          </span>
        }
        sub={`${remaining.toLocaleString()} available addresses remaining`}
        variant={pct >= 85 ? 'red' : pct >= 70 ? 'amber' : 'default'}
      />
      <Bar pct={pct} variant={pct >= 85 ? 'red' : 'green'} height={6} />
    </NMSCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 5. MODULE 2 — ONU PHASE STATE & OPTICAL HEALTH
// ═══════════════════════════════════════════════════════════════════════

const WOnuPhaseState: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const apiTotal = nocData?.analytics?.totals.onus
  const s = apiTotal != null && apiTotal > 0 ? {
    total:      apiTotal,
    working:    Math.round(apiTotal * SAMPLE_PHASE_STATE.working    / SAMPLE_PHASE_STATE.total),
    dying_gasp: Math.round(apiTotal * SAMPLE_PHASE_STATE.dying_gasp / SAMPLE_PHASE_STATE.total),
    offline:    Math.round(apiTotal * SAMPLE_PHASE_STATE.offline    / SAMPLE_PHASE_STATE.total),
  } : SAMPLE_PHASE_STATE
  type PhaseCell = { key: string; label: string; value: number; pillCls: string; dot: string; share: number; isTotal?: boolean }
  const cells: PhaseCell[] = [
    { key: 'working',    label: 'Working',         value: s.working,    pillCls: 'nms-pill-green', dot: 'nms-dot-green',           share: s.working / s.total },
    { key: 'dying_gasp', label: 'Dying Gasp',      value: s.dying_gasp, pillCls: 'nms-pill-amber', dot: 'nms-dot-amber is-alarm',  share: s.dying_gasp / s.total },
    { key: 'offline',    label: 'Offline / LOS',   value: s.offline,    pillCls: 'nms-pill-red',   dot: 'nms-dot-red is-alarm',    share: s.offline / s.total },
    { key: 'total',      label: 'Total Ecosystem', value: s.total,      pillCls: '',               dot: '',                        share: 1, isTotal: true },
  ]
  return (
    <NMSCard title="ONU Phase State Grid" status={nocData ? 'partial' : 'partial'}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--gx-space-6)' }}>
        {cells.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => openDrawer({ kind: 'segment', id: `phase:${c.key}`, label: c.label })}
            style={{
              background: 'var(--gx-surface-2)',
              border: '1px solid var(--gx-border)',
              borderRadius: 'var(--gx-radius-sm)',
              padding: 'var(--gx-space-6)',
              display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-3)',
              cursor: 'pointer',
              color: 'inherit',
              textAlign: 'left',
            }}
          >
            <span className={'nms-pill ' + c.pillCls}>
              {c.dot && <span className={'nms-dot ' + c.dot} />}
              {c.label}
            </span>
            <div className="nms-value nms-value-mono" style={{ fontSize: 'var(--gx-text-3xl)' }}>{c.value}</div>
            {c.isTotal ? (
              // Neutral stacked bar: text-2 (working) → text-3 (dying_gasp) → gold (offline).
              <div style={{ display: 'flex', height: 'var(--gx-space-3)', borderRadius: 'var(--gx-radius-full)', overflow: 'hidden', background: 'var(--gx-border-strong)' }}>
                <div style={{ flex: s.working,    background: 'var(--gx-text-2)' }} />
                <div style={{ flex: s.dying_gasp, background: 'var(--gx-text-3)' }} />
                <div style={{ flex: s.offline,    background: 'var(--gx-gold)' }} />
              </div>
            ) : (
              <Bar pct={c.share * 100} variant={c.pillCls.includes('green') ? 'green' : c.pillCls.includes('amber') ? 'amber' : 'red'} height={5} />
            )}
            <div style={{ fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)', fontFamily: 'var(--gx-font-mono, monospace)' }}>
              {c.isTotal ? '100%' : `${(c.share * 100).toFixed(1)}%`}
            </div>
          </button>
        ))}
      </div>
    </NMSCard>
  )
}

const WOpticalRx: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const max = Math.max(...SAMPLE_OPTICAL_RX.map(b => b.count))
  return (
    <NMSCard title="Optical RX Power Distribution" status="pending">
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-around', gap: 'var(--gx-space-6)', height: 200, paddingTop: 'var(--gx-space-8)' }}>
        {SAMPLE_OPTICAL_RX.map(b => {
          const h = (b.count / max) * 160
          // Neutral by default; gold only for the Critical bucket.
          const color =
            b.variant === 'green' ? 'var(--gx-text-2)' :
            b.variant === 'amber' ? 'var(--gx-text-3)' :
                                    'var(--gx-gold)'
          return (
            <button
              key={b.label}
              type="button"
              onClick={() => openDrawer({ kind: 'segment', id: `rx:${b.variant}`, label: `Optical RX · ${b.bucket}` })}
              style={{
                flex: 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
              }}
            >
              <div style={{ fontSize: 'var(--gx-text-md)', fontFamily: 'var(--gx-font-mono, monospace)', fontWeight: 'var(--gx-weight-semibold)', color }}>{b.count}</div>
              <div style={{ width: '60%', height: h, background: color, borderRadius: '4px 4px 0 0', marginTop: 'var(--gx-space-2)' }} />
              <div style={{ fontSize: 'var(--gx-text-10)', fontFamily: 'var(--gx-font-mono, monospace)', color: 'var(--gx-text-3)', marginTop: 'var(--gx-space-3)', textAlign: 'center' }}>{b.label}</div>
              <div style={{ fontSize: 'var(--gx-text-10)', color, fontWeight: 'var(--gx-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{b.bucket}</div>
            </button>
          )
        })}
      </div>
    </NMSCard>
  )
}

const WRogueOnu: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const isAlarm = SAMPLE_ROGUE.count > 0
  return (
    <NMSCard title="Rogue ONUs Detected" status="pending">
      <button
        type="button"
        onClick={() => openDrawer({ kind: 'segment', id: 'rogue', label: 'Rogue ONU Alarm' })}
        style={{
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flex: 1, gap: 'var(--gx-space-3)',
        }}
      >
        <span className={'nms-dot ' + (isAlarm ? 'nms-dot-red is-alarm' : 'nms-dot-green')} style={{ width: 'var(--gx-space-6)', height: 'var(--gx-space-6)' }} />
        <div className={'nms-value nms-value-lg ' + (isAlarm ? 'nms-value-red' : 'nms-value-green')} style={{ fontFamily: 'var(--gx-font-mono, monospace)' }}>{SAMPLE_ROGUE.count}</div>
        <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', textAlign: 'center', maxWidth: 200 }}>
          {isAlarm ? 'Blinded ports — uncontrolled light' : 'No rogue ONUs · all ports stable'}
        </div>
      </button>
    </NMSCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 6. MODULE 3 — CATEGORICAL ANALYTICS
// ═══════════════════════════════════════════════════════════════════════

const WPonSaturation: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const ports = nocData?.analytics?.by_port.length
    ? nocData.analytics.by_port.map(p => ({ id: `0/${p.port_no}`, count: p.count, max: 128 }))
    : SAMPLE_PON_SATURATION.ports
  const sorted = [...ports].sort((a, b) => (b.count/b.max) - (a.count/a.max))
  const peak = sorted[0]
  const peakPct = (peak.count / peak.max) * 100
  return (
    <NMSCard title="PON Port Saturation" status={nocData?.analytics ? 'live' : 'live'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
        {ports.map(p => {
          const pct = (p.count / p.max) * 100
          const variant = pct >= 85 ? 'red' : pct >= 70 ? 'amber' : 'green'
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => openDrawer({ kind: 'port', id: p.id, label: `Port ${p.id}` })}
              style={{
                display: 'grid', gridTemplateColumns: '52px 1fr 70px',
                gap: 'var(--gx-space-4)', alignItems: 'center',
                background: 'transparent', border: 'none', padding: 'var(--gx-space-2) var(--gx-space-3)',
                cursor: 'pointer', color: 'inherit', textAlign: 'left',
                borderRadius: 'var(--gx-radius-sm)',
              }}
            >
              <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-2)' }}>{p.id}</span>
              <Bar pct={pct} variant={variant} height={10} />
              <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontSize: 'var(--gx-text-11)', textAlign: 'right', color: variant === 'red' ? 'var(--gx-gold)' : variant === 'amber' ? 'var(--gx-text-3)' : 'var(--gx-text-1)' }}>
                {p.count}/{p.max}
              </span>
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', fontStyle: 'italic', textAlign: 'center', marginTop: 'var(--gx-space-2)' }}>
        Peak port: <b style={{ color: 'var(--gx-gold)' }}>{peak.id}</b> at <b>{peakPct.toFixed(0)}%</b>
      </div>
    </NMSCard>
  )
}

const WVendorMix: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const vendors = nocData?.analytics?.by_vendor.length
    ? nocData.analytics.by_vendor.map(v => ({
        vendor: VENDOR_NAMES[v.prefix] ?? v.prefix,
        count: v.count,
        prefix: v.prefix,
      }))
    : SAMPLE_VENDOR_MIX
  const total = vendors.reduce((s, v) => s + v.count, 0)
  let acc = 0
  const SIZE = 160, R = 64, STROKE = 22, C = 2 * Math.PI * R
  const colors = [
    'var(--gx-gold)',
    'var(--gx-text-2)',
    'var(--gx-text-3)',
    'var(--gx-border-strong)',
  ]
  return (
    <NMSCard title="ONU Vendor Diversity Mix" status={nocData?.analytics ? 'live' : 'live'}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--gx-space-6)', alignItems: 'center' }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={SIZE/2} cy={SIZE/2} r={R} fill="none" stroke="var(--gx-border-strong)" strokeWidth={STROKE} />
          {vendors.map((v, i) => {
            const frac = v.count / total
            const dash = frac * C
            const offset = acc * C
            acc += frac
            return (
              <circle key={v.vendor}
                cx={SIZE/2} cy={SIZE/2} r={R}
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${SIZE/2} ${SIZE/2})`}
                style={{ cursor: 'pointer' }}
                onClick={() => openDrawer({ kind: 'vendor', prefix: v.prefix, label: v.vendor })}
              />
            )
          })}
          <text x={SIZE/2} y={SIZE/2 - 6} textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--gx-text-1)" fontFamily="var(--gx-font-display, sans-serif)">{total}</text>
          <text x={SIZE/2} y={SIZE/2 + 14} textAnchor="middle" fontSize="10" fill="var(--gx-text-3)" letterSpacing="0.08em">ONUs</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-3)' }}>
          {vendors.map((v, i) => {
            const pct = Math.round((v.count / total) * 100)
            return (
              <button key={v.vendor}
                type="button"
                onClick={() => openDrawer({ kind: 'vendor', prefix: v.prefix, label: v.vendor })}
                style={{
                  display: 'grid', gridTemplateColumns: '10px 1fr auto auto',
                  gap: 'var(--gx-space-3)', alignItems: 'center',
                  background: 'transparent', border: 'none', padding: '3px 6px',
                  cursor: 'pointer', color: 'inherit', textAlign: 'left',
                  borderRadius: 'var(--gx-radius-sm)',
                  fontSize: 'var(--gx-text-sm)',
                }}
              >
                <span style={{ width: 'var(--gx-space-5)', height: 'var(--gx-space-5)', borderRadius: 2, background: colors[i % colors.length] }} />
                <span>{v.vendor}</span>
                <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', color: 'var(--gx-text-2)' }}>{v.count}</span>
                <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', color: 'var(--gx-text-3)' }}>{pct}%</span>
              </button>
            )
          })}
        </div>
      </div>
    </NMSCard>
  )
}

const WSubscriberDensity: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const max = Math.max(...SAMPLE_DENSITY.map(d => d.count))
  return (
    <NMSCard title="Subscriber Density per OLT" status="partial">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)' }}>
        {SAMPLE_DENSITY.map(d => (
          <button key={d.olt}
            type="button"
            onClick={() => openDrawer({ kind: 'olt', id: d.olt, label: d.olt })}
            style={{
              display: 'grid', gridTemplateColumns: '140px 1fr 50px',
              gap: 'var(--gx-space-4)', alignItems: 'center',
              background: 'transparent', border: 'none', padding: 'var(--gx-space-2) var(--gx-space-3)',
              cursor: 'pointer', color: 'inherit', textAlign: 'left',
              borderRadius: 'var(--gx-radius-sm)',
              fontSize: 'var(--gx-text-sm)',
            }}
          >
            <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', color: 'var(--gx-text-2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.olt}</span>
            <Bar pct={(d.count / max) * 100} height={10} />
            <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontWeight: 'var(--gx-weight-semibold)', textAlign: 'right' }}>{d.count}</span>
          </button>
        ))}
      </div>
    </NMSCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 7. MODULE 4 — PROVISIONING & BILLING TIERS
// ═══════════════════════════════════════════════════════════════════════

const WTierMix: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const tiers = nocData?.subscriptionMix.length
    ? nocData.subscriptionMix.map(m => ({ tier: m.product_name, count: m.count }))
    : SAMPLE_TIER_MIX
  const sorted = [...tiers].sort((a, b) => b.count - a.count)
  const peak = sorted[0]
  const total = tiers.reduce((s, t) => s + t.count, 0)
  const peakPct = Math.round((peak.count / total) * 100)
  const max = peak.count
  const CHART_H = 160
  return (
    <NMSCard title="Subscription Speed Tier Mix" status={nocData ? 'live' : 'live'}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${tiers.length}, minmax(0, 1fr))`,
        gap: 'var(--gx-space-4)', alignItems: 'end',
        height: CHART_H + 40, paddingTop: 'var(--gx-space-7)', position: 'relative',
      }}>
        {tiers.map(t => {
          const isLeader = t.tier === peak.tier
          const stem = (t.count / max) * CHART_H
          return (
            <button key={t.tier}
              type="button"
              onClick={() => openDrawer({ kind: 'tier', name: t.tier })}
              style={{
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
                position: 'relative', height: CHART_H + 40,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
                gap: 'var(--gx-space-2)',
              }}
            >
              {isLeader && (
                <div style={{
                  position: 'absolute',
                  bottom: stem + 24,
                  background: 'var(--gx-surface-2)',
                  border: '1px solid var(--gx-border-strong)',
                  borderRadius: 'var(--gx-radius-sm)',
                  padding: 'var(--gx-space-1) var(--gx-space-4)',
                  fontSize: 'var(--gx-text-10)', fontFamily: 'var(--gx-font-mono, monospace)',
                  color: 'var(--gx-text-1)', whiteSpace: 'nowrap', fontWeight: 'var(--gx-weight-semibold)',
                }}>▼ Peak Plan · {peakPct}%</div>
              )}
              <div style={{
                position: 'absolute', bottom: 'var(--gx-space-12)', width: 2, height: stem,
                background: 'var(--gx-text-2)', opacity: 0.6, borderRadius: 1,
              }} />
              <div style={{
                position: 'absolute', bottom: 24 + stem - 5, width: 10, height: 10, borderRadius: '50%',
                background: 'var(--gx-text-1)',
                border: '2px solid var(--gx-bg)',
                outline: isLeader ? '1px solid var(--gx-text-1)' : 'none',
                outlineOffset: 1,
              }} />
              <span style={{ fontSize: 'var(--gx-text-10)', fontFamily: 'var(--gx-font-mono, monospace)', color: isLeader ? 'var(--gx-text-1)' : 'var(--gx-text-3)', fontWeight: isLeader ? 600 : 400 }}>{t.tier}</span>
              <span style={{ fontSize: 'var(--gx-text-10)', fontFamily: 'var(--gx-font-mono, monospace)', color: 'var(--gx-text-3)' }}>{t.count}</span>
            </button>
          )
        })}
      </div>
    </NMSCard>
  )
}

const WServiceProfiles: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const rawProfiles = parseProfiles(nocData?.analytics?.line_profile_counts)
  const profiles = rawProfiles.length
    ? rawProfiles.sort((a, b) => b.count - a.count)
    : SAMPLE_PROFILES
  const max = Math.max(...profiles.map(p => p.count), 1)
  return (
    <NMSCard title="Service Profiles Breakdown" status={rawProfiles.length ? 'live' : 'live'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)' }}>
        {profiles.map(p => (
          <button key={p.name}
            type="button"
            onClick={() => openDrawer({ kind: 'profile', name: p.name })}
            style={{
              display: 'grid', gridTemplateColumns: '170px 1fr 40px',
              gap: 'var(--gx-space-4)', alignItems: 'center',
              background: 'transparent', border: 'none', padding: '3px 6px',
              cursor: 'pointer', color: 'inherit', textAlign: 'left',
              borderRadius: 'var(--gx-radius-sm)', fontSize: 'var(--gx-text-11)',
            }}
          >
            <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', color: 'var(--gx-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>{p.name}</span>
            <Bar pct={(p.count / max) * 100} height={8} />
            <span style={{ fontFamily: 'var(--gx-font-mono, monospace)', fontWeight: 'var(--gx-weight-semibold)', textAlign: 'right' }}>{p.count}</span>
          </button>
        ))}
      </div>
    </NMSCard>
  )
}

const WUnprovisioned: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const n = SAMPLE_UNPROVISIONED.count
  const isAlarm = n > 0
  return (
    <NMSCard title="Unprovisioned ONUs" status="pending">
      <button
        type="button"
        onClick={() => openDrawer({ kind: 'segment', id: 'unprov', label: 'Unprovisioned ONUs' })}
        style={{
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flex: 1, gap: 'var(--gx-space-3)',
        }}
      >
        <span className={'nms-dot ' + (isAlarm ? 'nms-dot-amber is-alarm' : 'nms-dot-green')} style={{ width: 'var(--gx-space-6)', height: 'var(--gx-space-6)' }} />
        <div className={'nms-value nms-value-lg ' + (isAlarm ? 'nms-value-amber' : 'nms-value-green')} style={{ fontFamily: 'var(--gx-font-mono, monospace)' }}>{n}</div>
        <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', textAlign: 'center', maxWidth: 200 }}>
          Pending activation from billing CRM
        </div>
      </button>
    </NMSCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 8. MODULE 6 — HIERARCHY EXPLORER
// ═══════════════════════════════════════════════════════════════════════

const WSegmentationStrip: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const liveVlans = parseVlans(nocData?.analytics?.vlans)
  const segments = liveVlans.length ? liveVlans : SAMPLE_SEGMENTS
  const kindColor = (k: string) =>
    k === 'mgmt'       ? 'nms-pill-cyan' :
    k === 'subscriber' ? 'nms-pill-green' :
    k === 'voice'      ? 'nms-pill-amber' :
    k === 'transit'    ? 'nms-pill-cyan' :
    k === 'bng'        ? 'nms-pill-red'  : ''
  return (
    <NMSCard title="Global Segmentation · VLAN / BNG" status={liveVlans.length ? 'live' : 'live'}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-3)' }}>
        {segments.map(s => (
          <button key={s.id}
            type="button"
            onClick={() => openDrawer({ kind: 'segment', id: s.id, label: s.label })}
            className={'nms-pill ' + kindColor(s.kind)}
            style={{ cursor: 'pointer', fontSize: 'var(--gx-text-11)' }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', fontStyle: 'italic' }}>
        Click a chip to filter every widget on the dashboard to that traffic segment.
      </div>
    </NMSCard>
  )
}

const WHierarchyExplorer: React.FC<WidgetCtx> = ({ openDrawer, nocData, token }) => {
  const apiRegions = nocData?.regions ?? []
  const oltItems   = nocData?.oltList.items ?? []
  const usingSample = apiRegions.length === 0 && oltItems.length === 0

  const regionList = usingSample
    ? SAMPLE_HIERARCHY.regions.map(r => ({ id: r.id, name: r.label }))
    : apiRegions.map(r => ({ id: r.id, name: r.name }))

  const [regionId, setRegionId] = useState<string>(() => regionList[0]?.id ?? '')
  const [oltId, setOltId]       = useState<string | undefined>(() =>
    usingSample ? SAMPLE_HIERARCHY.regions[0]?.olts[0]?.id : oltItems[0]?.id)
  const [portId, setPortId]     = useState<string | undefined>(undefined)

  const [treePorts, setTreePorts] = useState<{ id: string; port_no: number; onu_count: number }[]>([])
  const [treeLoading, setTreeLoading] = useState(false)

  useEffect(() => {
    if (usingSample || !oltId || !token) return
    let alive = true
    setTreeLoading(true)
    setTreePorts([])
    setPortId(undefined)
    fetch(`${BASE}/api/noc/olts/${oltId}/tree`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then((d: { chassis?: { cards?: { ports?: { id: string; port_no: number; onu_count?: number }[] }[] }[] } | null) => {
        if (!alive || !d) return
        const ports: { id: string; port_no: number; onu_count: number }[] = []
        for (const ch of d.chassis ?? []) {
          for (const card of ch.cards ?? []) {
            for (const p of card.ports ?? []) {
              ports.push({ id: p.id, port_no: p.port_no, onu_count: p.onu_count ?? 0 })
            }
          }
        }
        setTreePorts(ports)
        setPortId(ports[0]?.id)
      })
      .catch(() => {})
      .finally(() => { if (alive) setTreeLoading(false) })
    return () => { alive = false }
  }, [oltId, token, usingSample])

  const sampleRegion = SAMPLE_HIERARCHY.regions.find(r => r.id === regionId) ?? SAMPLE_HIERARCHY.regions[0]
  const sampleOlt    = sampleRegion?.olts.find(o => o.id === oltId) ?? sampleRegion?.olts[0]
  const samplePort   = sampleOlt?.ports.find(p => p.id === portId) ?? sampleOlt?.ports[0]

  const onRegion = (id: string) => {
    setRegionId(id)
    if (usingSample) {
      const r = SAMPLE_HIERARCHY.regions.find(x => x.id === id)
      setOltId(r?.olts[0]?.id)
      setPortId(r?.olts[0]?.ports[0]?.id)
    }
  }
  const onOlt = (id: string) => {
    setOltId(id)
    if (usingSample) {
      const o = sampleRegion?.olts.find(x => x.id === id)
      setPortId(o?.ports[0]?.id)
    }
  }

  const phaseColor = (p: string) =>
    p === 'working' ? 'nms-pill-green' : p === 'dying_gasp' ? 'nms-pill-amber' : 'nms-pill-red'

  const colStyle = (withBorder: boolean): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-2)',
    borderRight: withBorder ? '1px solid var(--gx-border)' : undefined,
    paddingRight: withBorder ? 'var(--gx-space-4)' : undefined,
  })
  const colHeaderStyle: React.CSSProperties = {
    fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)', textTransform: 'uppercase',
    letterSpacing: '0.08em', padding: '0 var(--gx-space-3)',
  }
  const rowBtnStyle = (active: boolean): React.CSSProperties => ({
    width: '100%', padding: 'var(--gx-space-2) var(--gx-space-5)', borderRadius: 'var(--gx-radius-sm)',
    background: active ? 'var(--gx-surface-2)' : 'transparent',
    border: active ? '1px solid var(--gx-border-strong)' : '1px solid transparent',
    cursor: 'pointer', color: 'inherit', textAlign: 'left',
    fontSize: 'var(--gx-text-sm)', fontFamily: 'var(--gx-font-mono, monospace)',
  })
  const portBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: 'var(--gx-space-1) var(--gx-space-3)', borderRadius: 'var(--gx-radius-sm)',
    background: active ? 'var(--gx-border-strong)' : 'transparent',
    border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left',
    fontSize: 'var(--gx-text-11)', fontFamily: 'var(--gx-font-mono, monospace)',
    display: 'flex', justifyContent: 'space-between',
  })

  return (
    <NMSCard title="ISP Hierarchy Explorer" status={usingSample ? 'partial' : 'live'}>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 220px 1fr', gap: 'var(--gx-space-6)', minHeight: 320 }}>

        {/* Column 1 — Regions */}
        <div style={colStyle(true)}>
          <div style={colHeaderStyle}>Regions</div>
          {regionList.map(r => (
            <button key={r.id} type="button"
              onClick={() => onRegion(r.id)}
              onDoubleClick={() => openDrawer({ kind: 'region', id: r.id, label: r.name })}
              style={rowBtnStyle(regionId === r.id)}
            >
              {r.name}
            </button>
          ))}
        </div>

        {/* Column 2 — OLTs + ports */}
        <div style={colStyle(true)}>
          <div style={colHeaderStyle}>OLT · PON</div>
          {(usingSample ? sampleRegion?.olts ?? [] : oltItems).map(o => {
            const oId  = o.id
            const name = usingSample
              ? (o as typeof sampleRegion.olts[0]).label
              : String((o as OltRecord).data.name ?? (o as OltRecord).data.olt_name ?? oId.slice(0, 8))
            return (
              <div key={oId}>
                <button type="button"
                  onClick={() => onOlt(oId)}
                  onDoubleClick={() => openDrawer({ kind: 'olt', id: oId, label: name })}
                  style={rowBtnStyle(oltId === oId)}
                >
                  {name}
                </button>
                {oltId === oId && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-1)', paddingLeft: 'var(--gx-space-4)', marginTop: 'var(--gx-space-1)' }}>
                    {usingSample
                      ? (o as typeof sampleRegion.olts[0]).ports.map(p => (
                          <button key={p.id} type="button" onClick={() => setPortId(p.id)} style={portBtnStyle(portId === p.id)}>
                            <span>{p.label}</span>
                            <span style={{ color: 'var(--gx-text-3)' }}>{p.onus.length}</span>
                          </button>
                        ))
                      : treeLoading
                        ? <div style={{ fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)', padding: 'var(--gx-space-2) var(--gx-space-3)' }}>Loading ports…</div>
                        : treePorts.length === 0
                          ? <div style={{ fontSize: 'var(--gx-text-10)', color: 'var(--gx-text-3)', padding: 'var(--gx-space-2) var(--gx-space-3)' }}>No ports synced. Run a refresh first.</div>
                          : treePorts.map(p => (
                              <button key={p.id} type="button" onClick={() => setPortId(p.id)} style={portBtnStyle(portId === p.id)}>
                                <span>0/{p.port_no}</span>
                                <span style={{ color: 'var(--gx-text-3)' }}>{p.onu_count}</span>
                              </button>
                            ))
                    }
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Column 3 — ONU detail */}
        <div style={colStyle(false)}>
          {usingSample ? (
            <>
              <div style={colHeaderStyle}>
                {samplePort ? `Port ${samplePort.label}` : '—'} · {samplePort?.onus.length ?? 0} ONUs
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-1)', background: 'var(--gx-surface-2)', borderRadius: 'var(--gx-radius-sm)', border: '1px solid var(--gx-border)', padding: 'var(--gx-space-4)', maxHeight: 280, overflowY: 'auto' }}>
                {!samplePort || samplePort.onus.length === 0
                  ? <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', textAlign: 'center', padding: 'var(--gx-space-6)' }}>No ONUs on this port.</div>
                  : samplePort.onus.map(o => (
                      <button key={o.id} type="button" onClick={() => openDrawer({ kind: 'onu', serial: o.serial })}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 'var(--gx-space-4)', alignItems: 'center', background: 'transparent', border: 'none', padding: 'var(--gx-space-2) var(--gx-space-3)', cursor: 'pointer', color: 'inherit', textAlign: 'left', borderRadius: 'var(--gx-radius-sm)', fontSize: 'var(--gx-text-11)', fontFamily: 'var(--gx-font-mono, monospace)' }}
                      >
                        <span>{o.serial}</span>
                        <span style={{ color: 'var(--gx-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.profile}</span>
                        <span className={'nms-pill ' + phaseColor(o.phase)} style={{ fontSize: 'var(--gx-text-10)', justifySelf: 'end' }}>{o.phase}</span>
                      </button>
                    ))
                }
              </div>
            </>
          ) : (
            <>
              <div style={colHeaderStyle}>
                {portId
                  ? `Port 0/${treePorts.find(p => p.id === portId)?.port_no ?? '?'} · ${treePorts.find(p => p.id === portId)?.onu_count ?? 0} ONUs`
                  : 'Select a port'}
              </div>
              <div style={{ background: 'var(--gx-surface-2)', borderRadius: 'var(--gx-radius-sm)', border: '1px solid var(--gx-border)', padding: 'var(--gx-space-6)', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', fontStyle: 'italic' }}>
                Per-ONU serial list via port drill-down is Phase 2.
              </div>
            </>
          )}
        </div>

      </div>
    </NMSCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 9. MODULE 5 — GEOGRAPHIC & FIELD OPERATIONS
// ═══════════════════════════════════════════════════════════════════════

const WRegionalOutageMap: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const liveHubs = (nocData?.regions ?? [])
    .map(r => {
      const coords = REGION_COORDS[r.name]
      if (!coords) return null
      const status: 'ok' | 'warning' | 'outage' =
        r.status === 'INACTIVE' ? 'warning' :
        r.status === 'ARCHIVED' ? 'outage' : 'ok'
      return { id: r.id, label: r.name, lat: coords[0], lng: coords[1], status }
    })
    .filter((h): h is NonNullable<typeof h> => h !== null)
  const hubs = liveHubs.length ? liveHubs : SAMPLE_REGIONAL_HUBS

  const lats = hubs.map(h => h.lat)
  const lngs = hubs.map(h => h.lng)
  const minLat = Math.min(...lats) - 0.1, maxLat = Math.max(...lats) + 0.1
  const minLng = Math.min(...lngs) - 0.2, maxLng = Math.max(...lngs) + 0.2
  const W = 700, H = 320
  const project = (lat: number, lng: number): [number, number] => {
    const x = ((lng - minLng) / (maxLng - minLng)) * W
    const y = H - ((lat - minLat) / (maxLat - minLat)) * H
    return [x, y]
  }
  return (
    <NMSCard title="Regional Outage Field Map" status={liveHubs.length ? 'live' : 'partial'}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, background: 'var(--gx-surface-2)', borderRadius: 'var(--gx-radius-sm)', border: '1px solid var(--gx-border)' }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <line key={'h' + i} x1={0} y1={(i * H) / 10} x2={W} y2={(i * H) / 10} stroke="var(--gx-border)" strokeWidth={1} opacity={0.4} />
        ))}
        {Array.from({ length: 16 }).map((_, i) => (
          <line key={'v' + i} x1={(i * W) / 16} y1={0} x2={(i * W) / 16} y2={H} stroke="var(--gx-border)" strokeWidth={1} opacity={0.4} />
        ))}
        {hubs.map(h => {
          const [x, y] = project(h.lat, h.lng)
          const isOutage  = h.status === 'outage'
          const isWarning = h.status === 'warning'
          return (
            <g key={h.id} style={{ cursor: 'pointer' }} onClick={() => openDrawer({ kind: 'region', id: h.id, label: h.label })}>
              {isOutage && (
                <circle cx={x} cy={y} r={14} fill="var(--gx-gold)" opacity={0.22}>
                  <animate attributeName="r" values="14;22;14" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.22;0;0.22" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              {isWarning ? (
                <circle cx={x} cy={y} r={7} fill="none" stroke="var(--gx-text-3)" strokeWidth={2} />
              ) : (
                <circle cx={x} cy={y} r={7} fill={isOutage ? 'var(--gx-gold)' : 'var(--gx-text-2)'} />
              )}
              <text x={x + 12} y={y + 4} fontSize="11"
                fill={isOutage ? 'var(--gx-gold)' : 'var(--gx-text-2)'}
                fontFamily="var(--gx-font-mono, monospace)"
                fontWeight={isOutage ? 700 : 400}>
                {h.label}{isOutage && ' · OUTAGE'}
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', gap: 'var(--gx-space-8)', fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', justifyContent: 'center', marginTop: 'var(--gx-space-2)' }}>
        <span><span style={{ display: 'inline-block', width: 'var(--gx-space-4)', height: 'var(--gx-space-4)', borderRadius: '50%', background: 'var(--gx-text-2)', marginRight: 'var(--gx-space-2)' }} /> Operational</span>
        <span><span style={{ display: 'inline-block', width: 'var(--gx-space-4)', height: 'var(--gx-space-4)', borderRadius: '50%', border: '2px solid var(--gx-text-3)', marginRight: 'var(--gx-space-2)' }} /> Warning</span>
        <span><span style={{ display: 'inline-block', width: 'var(--gx-space-4)', height: 'var(--gx-space-4)', borderRadius: '50%', background: 'var(--gx-gold)', marginRight: 'var(--gx-space-2)' }} /> Outage</span>
      </div>
    </NMSCard>
  )
}

const WTechnicianFleet: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const groups = [
    { key: 'available' as const, label: 'Available', count: SAMPLE_TECHS.available, pill: 'nms-pill-green' },
    { key: 'en_route'  as const, label: 'En Route',  count: SAMPLE_TECHS.en_route,  pill: 'nms-pill-amber' },
    { key: 'on_site'   as const, label: 'On-Site',   count: SAMPLE_TECHS.on_site,   pill: 'nms-pill-cyan'  },
  ]
  return (
    <NMSCard title="Technician Fleet Status" status="pending">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-4)', flex: 1, justifyContent: 'center' }}>
        {groups.map(g => (
          <button key={g.key}
            type="button"
            onClick={() => openDrawer({ kind: 'tech-group', group: g.key })}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--gx-space-4) var(--gx-space-6)', borderRadius: 'var(--gx-radius-sm)',
              background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border)',
              cursor: 'pointer', color: 'inherit',
              fontSize: 'var(--gx-text-sm)', fontFamily: 'var(--gx-font-mono, monospace)',
            }}
          >
            <span className={'nms-pill ' + g.pill}>{g.label}</span>
            <span style={{ fontSize: 'var(--gx-text-lg)', fontWeight: 'var(--gx-weight-semibold)' }}>{g.count}</span>
          </button>
        ))}
      </div>
    </NMSCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 10. REGISTRY
// ═══════════════════════════════════════════════════════════════════════

const WIDGETS: WidgetDef[] = [
  // Module 1 — KPIs
  { id: 'olts-online',     title: 'OLTs Online',              module: 1, slot: 'kpi',    dataStatus: 'partial', Component: WOltsOnline },
  { id: 'uplink-capacity', title: 'Total Uplink Capacity',    module: 1, slot: 'kpi',    dataStatus: 'pending', Component: WUplinkCapacity },
  { id: 'active-sessions', title: 'Active Customer Sessions', module: 1, slot: 'kpi',    dataStatus: 'pending', Component: WActiveSessions },
  { id: 'ip-pool',         title: 'IP Pool Exhaustion',       module: 1, slot: 'kpi',    dataStatus: 'pending', Component: WIpPool },
  // Module 2 — Alarms next
  { id: 'phase-state',     title: 'ONU Phase State Grid',     module: 2, slot: 'wide',   dataStatus: 'live',    Component: WOnuPhaseState },
  { id: 'optical-rx',      title: 'Optical RX Power',         module: 2, slot: 'medium', dataStatus: 'pending', Component: WOpticalRx },
  { id: 'rogue-onu',       title: 'Rogue ONU Alarm',          module: 2, slot: 'small',  dataStatus: 'pending', Component: WRogueOnu },
  // Module 3 — Categorical
  { id: 'pon-saturation',  title: 'PON Port Saturation',      module: 3, slot: 'medium', dataStatus: 'live',    Component: WPonSaturation },
  { id: 'vendor-mix',      title: 'ONU Vendor Diversity',     module: 3, slot: 'medium', dataStatus: 'live',    Component: WVendorMix },
  { id: 'density',         title: 'Subscriber Density',       module: 3, slot: 'medium', dataStatus: 'partial', Component: WSubscriberDensity },
  // Module 4 — Provisioning
  { id: 'tier-mix',        title: 'Speed Tier Mix',           module: 4, slot: 'medium', dataStatus: 'live',    Component: WTierMix },
  { id: 'profiles',        title: 'Service Profiles',         module: 4, slot: 'medium', dataStatus: 'live',    Component: WServiceProfiles },
  { id: 'unprovisioned',   title: 'Unprovisioned ONUs',       module: 4, slot: 'small',  dataStatus: 'pending', Component: WUnprovisioned },
  // Module 6 — Explorer
  { id: 'segmentation',    title: 'Segmentation Strip',       module: 6, slot: 'wide',   dataStatus: 'live',    Component: WSegmentationStrip },
  { id: 'hierarchy',       title: 'Hierarchy Explorer',       module: 6, slot: 'wide',   dataStatus: 'live',    Component: WHierarchyExplorer },
  // Module 5 — Geo
  { id: 'outage-map',      title: 'Regional Outage Map',      module: 5, slot: 'wide',   dataStatus: 'partial', Component: WRegionalOutageMap },
  { id: 'tech-fleet',      title: 'Technician Fleet',         module: 5, slot: 'small',  dataStatus: 'pending', Component: WTechnicianFleet },
]

// ═══════════════════════════════════════════════════════════════════════
// 11. MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════

interface NocDashboardProps {
  token: string
  capabilities: Capabilities
  canConfigure: boolean
}

export default function NocDashboardView({ token, capabilities }: NocDashboardProps) {
  const canViewService = can(capabilities, 'service', 'view')

  const [nocData, setNocData] = useState<NocData | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`${BASE}/api/noc/olts`,                   { headers: authH(token) }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${BASE}/api/noc/onus?page_size=1`,        { headers: authH(token) }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${BASE}/api/analytics/subscription-mix`, { headers: authH(token) }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${BASE}/api/regions`,                    { headers: authH(token) }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${BASE}/api/radius/sessions?status=active`, { headers: authH(token) }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(async ([oltListRaw, onuRaw, subMixRaw, regionsRaw, sessionsRaw]) => {
      if (!alive) return
      const oltList: NocData['oltList'] = { items: oltListRaw?.items ?? [], total: oltListRaw?.total ?? 0 }
      const firstOlt = oltList.items[0]
      let analytics: OltAnalytics | null = null
      if (firstOlt) {
        analytics = await fetch(`${BASE}/api/noc/olts/${firstOlt.id}/analytics`, { headers: authH(token) })
          .then(r => r.ok ? r.json() : null).catch(() => null)
      }
      if (!alive) return
      setNocData({
        oltList,
        analytics,
        onuTotal:        onuRaw?.total ?? 0,
        subscriptionMix: Array.isArray(subMixRaw) ? subMixRaw : [],
        regions:         Array.isArray(regionsRaw) ? regionsRaw : [],
        radiusSessions:  Array.isArray(sessionsRaw) ? sessionsRaw : [],
      })
    }).catch(() => {})
    return () => { alive = false }
  }, [token])

  // Widget visibility — every widget on by default. Gear menu toggles individual ones.
  const [visibility, setVisibility] = useState<Record<string, boolean>>(
    () => Object.fromEntries(WIDGETS.map(w => [w.id, true]))
  )
  const [managerOpen, setManagerOpen] = useState(false)

  // Universal slide-out drawer state.
  const [drawer, setDrawer] = useState<DrawerPayload | null>(null)
  const openDrawer = (payload: DrawerPayload) => setDrawer(payload)
  const closeDrawer = () => setDrawer(null)

  const widgetsByModule = useMemo(() => {
    const byMod = new Map<ModuleNum, WidgetDef[]>()
    for (const m of MODULE_ORDER) byMod.set(m, [])
    for (const w of WIDGETS) {
      if (!visibility[w.id]) continue
      byMod.get(w.module)?.push(w)
    }
    return byMod
  }, [visibility])

  if (!canViewService) {
    return (
      <PageShell type="OPERATIONS" breadcrumb={['NMS', 'Network Management System']} title="Network Management System">
        <PermissionDenied message="You don't have permission to view NOC monitoring." />
      </PageShell>
    )
  }

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['NMS', 'Network Management System']}
      title="Network Management System"
      subtitle="Network operations · alarms · provisioning · field"
    >
      <div className="nms-page">
        {/* Top bar — design-preview banner + gear menu */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--gx-space-8)' }}>
          <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', fontFamily: 'var(--gx-font-mono, monospace)' }}>
            <span style={{ color: nocData ? 'var(--gx-text-2)' : 'var(--gx-gold)' }}>● </span>
            {nocData ? 'Phase 1B · live data active · sample-tagged widgets await backend pipeline' : 'Phase 1B · loading live data…'}
          </div>
          <WidgetManager
            widgets={WIDGETS}
            visibility={visibility}
            onChange={setVisibility}
            open={managerOpen}
            setOpen={setManagerOpen}
          />
        </div>

        {/* Render each module band + per-module row layout.
            Wide widgets get their own row (100%); all other visible widgets
            share one row, splitting the module's width equally and matching
            height via flex stretch. */}
        {MODULE_ORDER.map(mod => {
          const widgets = widgetsByModule.get(mod) ?? []
          if (widgets.length === 0) return null
          const wides = widgets.filter(w => w.slot === 'wide')
          const nonWides = widgets.filter(w => w.slot !== 'wide')
          const renderWidget = (w: WidgetDef) => (
            w.dataStatus === 'pending' && !shouldRenderPendingAsWidget(w.id) ? (
              <NMSCard title={w.title} status="pending">
                <PendingState
                  headline={`Awaiting ${pendingPipelineFor(w.id)}`}
                  body={pendingMessageFor(w.id)}
                />
              </NMSCard>
            ) : (
              <w.Component openDrawer={openDrawer} nocData={nocData} token={token} />
            )
          )
          return (
            <section key={mod}>
              <div className="nms-module-band">{MODULE_LABELS[mod]}</div>
              <div className="nms-module-stack">
                {/* Each wide widget on its own row */}
                {wides.map(w => (
                  <div key={w.id} className="nms-row nms-row-wide">
                    <div>{renderWidget(w)}</div>
                  </div>
                ))}
                {/* All non-wide widgets share one row, split equally */}
                {nonWides.length > 0 && (
                  <div className="nms-row">
                    {nonWides.map(w => (
                      <div key={w.id}>{renderWidget(w)}</div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {/* Universal slide-out drawer */}
      <SlideOutPanel
        open={drawer !== null}
        onClose={closeDrawer}
        title={drawer ? drawerTitleFor(drawer) : ''}
        subtitle={drawer ? drawerSubtitleFor(drawer) : undefined}
      >
        {drawer && <DrawerBody payload={drawer} />}
      </SlideOutPanel>
    </PageShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 12. WIDGET MANAGER (gear menu)
// ═══════════════════════════════════════════════════════════════════════

function WidgetManager({
  widgets, visibility, onChange, open, setOpen,
}: {
  widgets: WidgetDef[]
  visibility: Record<string, boolean>
  onChange: (v: Record<string, boolean>) => void
  open: boolean
  setOpen: (b: boolean) => void
}) {
  const byMod = useMemo(() => {
    const m = new Map<ModuleNum, WidgetDef[]>()
    for (const w of widgets) {
      if (!m.has(w.module)) m.set(w.module, [])
      m.get(w.module)!.push(w)
    }
    return m
  }, [widgets])

  return (
    <div className="nms-widget-manager">
      <button
        type="button"
        className="nms-widget-manager-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        ⚙ Widgets · {Object.values(visibility).filter(Boolean).length}/{widgets.length}
      </button>
      {open && (
        <div className="nms-widget-manager-panel" onMouseLeave={() => setOpen(false)}>
          {MODULE_ORDER.map(mod => {
            const list = byMod.get(mod) ?? []
            if (list.length === 0) return null
            return (
              <div key={mod} className="nms-widget-manager-group">
                <div className="nms-widget-manager-group-label">{MODULE_LABELS[mod]}</div>
                {list.map(w => (
                  <label key={w.id} className="nms-widget-manager-row">
                    <input
                      type="checkbox"
                      checked={visibility[w.id] ?? true}
                      onChange={e => onChange({ ...visibility, [w.id]: e.target.checked })}
                    />
                    <span>{w.title}</span>
                    <span className={'nms-pill ' + (
                      w.dataStatus === 'live' ? 'nms-pill-green' :
                      w.dataStatus === 'partial' ? 'nms-pill-amber' : 'nms-pill-cyan'
                    )} style={{ fontSize: 'var(--gx-text-10)' }}>
                      {w.dataStatus}
                    </span>
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 13. DRAWER BODY (context-aware)
// ═══════════════════════════════════════════════════════════════════════

function drawerTitleFor(p: DrawerPayload): string {
  switch (p.kind) {
    case 'port':       return `Port ${p.label}`
    case 'vendor':     return p.label
    case 'tier':       return `Tier · ${p.name}`
    case 'profile':    return p.name
    case 'segment':    return p.label
    case 'onu':        return p.serial
    case 'olt':        return p.label
    case 'region':     return p.label
    case 'tech-group': return p.group.replace('_', ' ').toUpperCase()
  }
}

function drawerSubtitleFor(p: DrawerPayload): string {
  switch (p.kind) {
    case 'port':       return 'PON port detail'
    case 'vendor':     return `OUI prefix · ${p.prefix}`
    case 'tier':       return 'Subscription tier'
    case 'profile':    return 'Line / DBA profile'
    case 'segment':    return 'Network segment'
    case 'onu':        return 'ONU device'
    case 'olt':        return 'OLT chassis'
    case 'region':     return 'Region / hub site'
    case 'tech-group': return 'Field technician group'
  }
}

function DrawerBody({ payload }: { payload: DrawerPayload }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-8)' }}>
      <div style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)', fontStyle: 'italic' }}>
        Slide-out drawer body — Phase 1A design preview. Real per-asset detail will
        render here once each widget is wired to live data and the matching backend
        endpoint exists.
      </div>
      <div style={{
        padding: 'var(--gx-space-6)',
        background: 'var(--gx-surface-2)',
        border: '1px solid var(--gx-border)',
        borderRadius: 'var(--gx-radius-sm)',
        fontSize: 'var(--gx-text-sm)',
        fontFamily: 'var(--gx-font-mono, monospace)',
        color: 'var(--gx-text-2)',
        whiteSpace: 'pre-wrap',
      }}>
        {JSON.stringify(payload, null, 2)}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 14. PENDING-MESSAGE COPY (per pipeline)
// ═══════════════════════════════════════════════════════════════════════

function pendingPipelineFor(id: string): string {
  switch (id) {
    case 'uplink-capacity': return 'SNMP feed'
    case 'active-sessions': return 'RADIUS feed'
    case 'ip-pool':         return 'IPAM feed'
    case 'optical-rx':      return 'SNMP DDM polling'
    case 'rogue-onu':       return 'rogue-detect parser'
    case 'unprovisioned':   return 'auto-find parser'
    case 'tech-fleet':      return 'tech-state endpoint'
    default:                return 'data source'
  }
}

function pendingMessageFor(id: string): string {
  switch (id) {
    case 'uplink-capacity': return 'Populates once SNMP polling on uplink interfaces is wired (Phase 2).'
    case 'active-sessions': return 'Populates once RADIUS / BNG integration is wired (Phase 2).'
    case 'ip-pool':         return 'Populates once IPAM / CGNAT pool tracking is wired (Phase 2).'
    case 'optical-rx':      return 'V1600 firmware does not expose per-ONU rx dBm. Needs SNMP DDM polling or different firmware (Phase 2).'
    case 'rogue-onu':       return 'Populates once a rogue-onu CLI parser is added to the V1600 driver (Phase 2 · ~2 h).'
    case 'unprovisioned':   return 'Populates once the auto-find parser is added to the V1600 driver (Phase 2 · ~2 h).'
    case 'tech-fleet':      return 'Populates once technicians can update Available / En Route / On-Site state from the field app (Phase 2).'
    default:                return 'Populates when this widget is wired to its data source.'
  }
}

// Widgets we render with sample data in Phase 1A even though dataStatus === 'pending'.
// They show inside their normal body + the preview tag — so Gev can iterate on the
// visual design now. Once the pipeline lands, the registry's dataStatus flips to
// 'live' and the preview tag drops automatically.
function shouldRenderPendingAsWidget(id: string): boolean {
  return [
    'uplink-capacity', 'active-sessions', 'ip-pool',
    'optical-rx', 'rogue-onu', 'unprovisioned', 'tech-fleet',
  ].includes(id)
}
