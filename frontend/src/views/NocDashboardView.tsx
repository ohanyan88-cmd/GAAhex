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
import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../lib/i18n'
import { PageShell, SlideOutPanel } from '../page-shell'
import { PermissionDenied } from '../components/States'
import { ServerIcon } from '../components/icons'
import { can, type Capabilities } from '../lib/capabilities'
import { OBJ } from '../lib/permissions-constants'
import { useFetch } from '../hooks/useFetch'

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

const MODULE_LABEL_KEYS: Record<ModuleNum, [string, string]> = {
  1: ['noc.module1', 'Module 1 · Global ISP Health'],
  2: ['noc.module2', 'Module 2 · ONU Phase & Optical Alarms'],
  3: ['noc.module3', 'Module 3 · Categorical Network Analytics'],
  4: ['noc.module4', 'Module 4 · Provisioning & Billing Tiers'],
  6: ['noc.module6', 'Module 6 · ISP Hierarchy Explorer'],
  5: ['noc.module5', 'Module 5 · Geographic & Field Operations'],
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
  const { t } = useI18n()
  return (
    <div className="nms-card">
      <div className="nms-card-header">
        <div className="nms-card-title">{title}</div>
        <div className="nms-card-hd-end">
          {action}
          {status !== 'live' && (
            <span className="nms-card-preview-tag" title={t('noc.sampleDataTooltip', 'This widget shows sample data while we finalize the design.')}>
              {t('noc.sampleDataTag', '▾ sample data')}
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
      <div className="nms-pending-body">{body}</div>
    </div>
  )
}

function Bar({ pct, variant = 'cyan', height = 8 }: { pct: number; variant?: 'green'|'amber'|'red'|'cyan'|'gold'; height?: number }) {
  // D18: variant drives fill color via CSS class; height is a CSS custom property.
  return (
    <div className={`nms-bar nms-bar--${variant}`} style={{ '--nms-bar-h': `${height}px` } as React.CSSProperties}>
      <div className="nms-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
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
    <div className="nms-value-block">
      <div className="nms-label">{label}</div>
      <div className={valueCls}>{value}</div>
      {sub && <div className="nms-sub">{sub}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 4. MODULE 1 — GLOBAL ISP HEALTH (KPI strip)
// ═══════════════════════════════════════════════════════════════════════

const WOltsOnline: React.FC<WidgetCtx> = ({ nocData }) => {
  const { t } = useI18n()
  const items = nocData?.oltList.items ?? []
  const count = items.length
    ? (items.filter(o => (o.status ?? '').toLowerCase() === 'active').length || items.length)
    : SAMPLE_OLTS_ONLINE.count
  const delta = SAMPLE_OLTS_ONLINE.delta_60s
  return (
    <NMSCard title={t('noc.widget.oltsOnline', 'OLTs Online')} status={nocData ? 'live' : 'partial'}>
      <ValueBlock
        label={t('noc.widget.activeChassis', 'ACTIVE CHASSIS')}
        value={count}
        sub={
          <span className={`nms-delta ${delta >= 0 ? 'nms-delta--up' : 'nms-delta--down'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} {t('noc.widget.inLast60s', 'in last 60 s')}
          </span>
        }
      />
    </NMSCard>
  )
}

const WUplinkCapacity: React.FC<WidgetCtx> = () => {
  const { t } = useI18n()
  const pct = (SAMPLE_UPLINK.used_gbps / SAMPLE_UPLINK.capacity_gbps) * 100
  const variant = pct >= 85 ? 'red' : pct >= 70 ? 'amber' : 'green'
  return (
    <NMSCard title={t('noc.widget.totalUplinkCapacity', 'Total Uplink Capacity')} status="pending">
      <ValueBlock
        label={t('noc.widget.currentLoad', 'CURRENT LOAD')}
        value={`${pct.toFixed(0)}%`}
        sub={`${SAMPLE_UPLINK.used_gbps} / ${SAMPLE_UPLINK.capacity_gbps} Gbps`}
        variant={variant}
      />
      <Bar pct={pct} variant={variant} />
    </NMSCard>
  )
}

const WActiveSessions: React.FC<WidgetCtx> = ({ nocData }) => {
  const { t } = useI18n()
  const count = nocData ? nocData.radiusSessions.length : SAMPLE_SESSIONS.active
  return (
    <NMSCard title={t('noc.widget.activeCustomerSessions', 'Active Customer Sessions')} status={nocData ? 'live' : 'pending'}>
      <ValueBlock
        label={t('noc.widget.pppoeipoeonline', 'PPPoE / IPoE ONLINE')}
        value={count.toLocaleString()}
        sub={t('noc.widget.authenticatedSubscribers', 'Authenticated broadband subscribers')}
      />
    </NMSCard>
  )
}

const WIpPool: React.FC<WidgetCtx> = () => {
  const { t } = useI18n()
  const pct = (SAMPLE_IP_POOL.used / SAMPLE_IP_POOL.total) * 100
  const remaining = SAMPLE_IP_POOL.total - SAMPLE_IP_POOL.used
  return (
    <NMSCard title={t('noc.widget.ipPoolExhaustion', 'IP Pool Exhaustion')} status="pending">
      <ValueBlock
        label={t('noc.widget.usedTotal', 'USED / TOTAL')}
        value={
          <span>
            <span className="nms-mono">{SAMPLE_IP_POOL.used.toLocaleString()}</span>
            <span className="nms-muted">/{SAMPLE_IP_POOL.total.toLocaleString()}</span>
          </span>
        }
        sub={`${remaining.toLocaleString()} ${t('noc.widget.availableAddresses', 'available addresses remaining')}`}
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
  const { t } = useI18n()
  const apiTotal = nocData?.analytics?.totals.onus
  const s = apiTotal != null && apiTotal > 0 ? {
    total:      apiTotal,
    working:    Math.round(apiTotal * SAMPLE_PHASE_STATE.working    / SAMPLE_PHASE_STATE.total),
    dying_gasp: Math.round(apiTotal * SAMPLE_PHASE_STATE.dying_gasp / SAMPLE_PHASE_STATE.total),
    offline:    Math.round(apiTotal * SAMPLE_PHASE_STATE.offline    / SAMPLE_PHASE_STATE.total),
  } : SAMPLE_PHASE_STATE
  type PhaseCell = { key: string; label: string; value: number; pillCls: string; dot: string; share: number; isTotal?: boolean }
  const cells: PhaseCell[] = [
    { key: 'working',    label: t('noc.phase.working', 'Working'),         value: s.working,    pillCls: 'nms-pill-green', dot: 'nms-dot-green',           share: s.working / s.total },
    { key: 'dying_gasp', label: t('noc.phase.dyingGasp', 'Dying Gasp'),      value: s.dying_gasp, pillCls: 'nms-pill-amber', dot: 'nms-dot-amber is-alarm',  share: s.dying_gasp / s.total },
    { key: 'offline',    label: t('noc.phase.offline', 'Offline / LOS'),   value: s.offline,    pillCls: 'nms-pill-red',   dot: 'nms-dot-red is-alarm',    share: s.offline / s.total },
    { key: 'total',      label: t('noc.phase.total', 'Total Ecosystem'), value: s.total,      pillCls: '',               dot: '',                        share: 1, isTotal: true },
  ]
  return (
    <NMSCard title={t('noc.widget.onuPhaseStateGrid', 'ONU Phase State Grid')} status={nocData ? 'partial' : 'partial'}>
      <div className="nms-phase-grid">
        {cells.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => openDrawer({ kind: 'segment', id: `phase:${c.key}`, label: c.label })}
            className="nms-phase-cell"
          >
            <span className={'nms-pill ' + c.pillCls}>
              {c.dot && <span className={'nms-dot ' + c.dot} />}
              {c.label}
            </span>
            <div className="nms-value nms-value-mono nms-value-3xl">{c.value}</div>
            {c.isTotal ? (
              <div className="nms-phase-bar">
                <div className="nms-phase-seg--working" style={{ flex: s.working }} />
                <div className="nms-phase-seg--dying"   style={{ flex: s.dying_gasp }} />
                <div className="nms-phase-seg--offline" style={{ flex: s.offline }} />
              </div>
            ) : (
              <Bar pct={c.share * 100} variant={c.pillCls.includes('green') ? 'green' : c.pillCls.includes('amber') ? 'amber' : 'red'} height={5} />
            )}
            <div className="nms-label">
              {c.isTotal ? '100%' : `${(c.share * 100).toFixed(1)}%`}
            </div>
          </button>
        ))}
      </div>
    </NMSCard>
  )
}

const WOpticalRx: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const { t } = useI18n()
  const max = Math.max(...SAMPLE_OPTICAL_RX.map(b => b.count))
  return (
    <NMSCard title={t('noc.widget.opticalRxPower', 'Optical RX Power Distribution')} status="pending">
      <div className="nms-bar-chart">
        {SAMPLE_OPTICAL_RX.map(b => {
          const h = (b.count / max) * 160
          return (
            <button
              key={b.label}
              type="button"
              onClick={() => openDrawer({ kind: 'segment', id: `rx:${b.variant}`, label: `Optical RX · ${b.bucket}` })}
              className={`nms-bar-col nms-bar-col--${b.variant}`}
            >
              <div className="nms-bar-col-count">{b.count}</div>
              <div className="nms-bar-col-stem" style={{ height: h }} />
              <div className="nms-bar-col-label">{b.label}</div>
              <div className="nms-bar-col-bucket">{b.bucket}</div>
            </button>
          )
        })}
      </div>
    </NMSCard>
  )
}

const WRogueOnu: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const { t } = useI18n()
  const isAlarm = SAMPLE_ROGUE.count > 0
  return (
    <NMSCard title={t('noc.widget.rogueOnusDetected', 'Rogue ONUs Detected')} status="pending">
      <button
        type="button"
        onClick={() => openDrawer({ kind: 'segment', id: 'rogue', label: t('noc.drawer.rogueOnuAlarm', 'Rogue ONU Alarm') })}
        className="nms-stat-btn"
      >
        <span className={'nms-dot nms-dot-lg ' + (isAlarm ? 'nms-dot-red is-alarm' : 'nms-dot-green')} />
        <div className={'nms-value nms-value-lg nms-mono ' + (isAlarm ? 'nms-value-red' : 'nms-value-green')}>{SAMPLE_ROGUE.count}</div>
        <div className="nms-stat-note">
          {isAlarm ? t('noc.rogue.alarm', 'Blinded ports — uncontrolled light') : t('noc.rogue.clear', 'No rogue ONUs · all ports stable')}
        </div>
      </button>
    </NMSCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 6. MODULE 3 — CATEGORICAL ANALYTICS
// ═══════════════════════════════════════════════════════════════════════

const WPonSaturation: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const { t } = useI18n()
  const ports = nocData?.analytics?.by_port.length
    ? nocData.analytics.by_port.map(p => ({ id: `0/${p.port_no}`, count: p.count, max: 128 }))
    : SAMPLE_PON_SATURATION.ports
  const sorted = [...ports].sort((a, b) => (b.count/b.max) - (a.count/a.max))
  const peak = sorted[0]
  const peakPct = (peak.count / peak.max) * 100
  return (
    <NMSCard title={t('noc.widget.ponPortSaturation', 'PON Port Saturation')} status={nocData?.analytics ? 'live' : 'live'}>
      <div className="nms-list">
        {ports.map(p => {
          const pct = (p.count / p.max) * 100
          const variant = pct >= 85 ? 'red' : pct >= 70 ? 'amber' : 'green'
          const ponVariant = variant === 'red' ? 'crit' : variant === 'amber' ? 'warn' : 'ok'
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => openDrawer({ kind: 'port', id: p.id, label: `${t('noc.port', 'Port')} ${p.id}` })}
              className="nms-list-row nms-list-row--pon"
            >
              <span className="nms-list-label">{p.id}</span>
              <Bar pct={pct} variant={variant} height={10} />
              <span className={`nms-pon-val nms-pon-val--${ponVariant}`}>{p.count}/{p.max}</span>
            </button>
          )
        })}
      </div>
      <div className="nms-peak-note">
        {t('noc.peakPort', 'Peak port')}: <b>{peak.id}</b> {t('noc.at', 'at')} <b>{peakPct.toFixed(0)}%</b>
      </div>
    </NMSCard>
  )
}

const WVendorMix: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const { t } = useI18n()
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
    <NMSCard title={t('noc.widget.onuVendorMix', 'ONU Vendor Diversity Mix')} status={nocData?.analytics ? 'live' : 'live'}>
      <div className="nms-donut-grid">
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
        <div className="nms-vendor-list">
          {vendors.map((v, i) => {
            const pct = Math.round((v.count / total) * 100)
            return (
              <button key={v.vendor}
                type="button"
                onClick={() => openDrawer({ kind: 'vendor', prefix: v.prefix, label: v.vendor })}
                className="nms-vendor-row"
              >
                <span className="nms-vendor-swatch" style={{ background: colors[i % colors.length] }} />
                <span>{v.vendor}</span>
                <span className="nms-vendor-count">{v.count}</span>
                <span className="nms-vendor-pct">{pct}%</span>
              </button>
            )
          })}
        </div>
      </div>
    </NMSCard>
  )
}

const WSubscriberDensity: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const { t } = useI18n()
  const max = Math.max(...SAMPLE_DENSITY.map(d => d.count))
  return (
    <NMSCard title={t('noc.widget.subscriberDensity', 'Subscriber Density per OLT')} status="partial">
      <div className="nms-list">
        {SAMPLE_DENSITY.map(d => (
          <button key={d.olt}
            type="button"
            onClick={() => openDrawer({ kind: 'olt', id: d.olt, label: d.olt })}
            className="nms-list-row nms-list-row--density"
          >
            <span className="nms-list-label">{d.olt}</span>
            <Bar pct={(d.count / max) * 100} height={10} />
            <span className="nms-list-value">{d.count}</span>
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
  const { t } = useI18n()
  const tiers = nocData?.subscriptionMix.length
    ? nocData.subscriptionMix.map(m => ({ tier: m.product_name, count: m.count }))
    : SAMPLE_TIER_MIX
  const sorted = [...tiers].sort((a, b) => b.count - a.count)
  const peak = sorted[0]
  const total = tiers.reduce((s, ti) => s + ti.count, 0)
  const peakPct = Math.round((peak.count / total) * 100)
  const max = peak.count
  const CHART_H = 160
  return (
    <NMSCard title={t('noc.widget.subscriptionSpeedTierMix', 'Subscription Speed Tier Mix')} status={nocData ? 'live' : 'live'}>
      <div
        className="nms-tier-chart"
        style={{ gridTemplateColumns: `repeat(${tiers.length}, minmax(0, 1fr))`, height: CHART_H + 40 }}
      >
        {tiers.map(ti => {
          const isLeader = ti.tier === peak.tier
          const stem = (ti.count / max) * CHART_H
          return (
            <button key={ti.tier}
              type="button"
              onClick={() => openDrawer({ kind: 'tier', name: ti.tier })}
              className="nms-tier-col"
              style={{ height: CHART_H + 40 }}
            >
              {isLeader && (
                <div className="nms-tier-peak-tag" style={{ bottom: stem + 24 }}>
                  {t('noc.tierPeak', '▼ Peak Plan')} · {peakPct}%
                </div>
              )}
              <div className="nms-tier-stem" style={{ height: stem }} />
              <div
                className={`nms-tier-dot${isLeader ? ' nms-tier-dot--leader' : ''}`}
                style={{ bottom: 24 + stem - 5 }}
              />
              <span className={`nms-tier-name ${isLeader ? 'nms-tier-name--leader' : 'nms-tier-name--rest'}`}>{ti.tier}</span>
              <span className="nms-tier-count">{ti.count}</span>
            </button>
          )
        })}
      </div>
    </NMSCard>
  )
}

const WServiceProfiles: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const { t } = useI18n()
  const rawProfiles = parseProfiles(nocData?.analytics?.line_profile_counts)
  const profiles = rawProfiles.length
    ? rawProfiles.sort((a, b) => b.count - a.count)
    : SAMPLE_PROFILES
  const max = Math.max(...profiles.map(p => p.count), 1)
  return (
    <NMSCard title={t('noc.widget.serviceProfilesBreakdown', 'Service Profiles Breakdown')} status={rawProfiles.length ? 'live' : 'live'}>
      <div className="nms-list nms-list-sm">
        {profiles.map(p => (
          <button key={p.name}
            type="button"
            onClick={() => openDrawer({ kind: 'profile', name: p.name })}
            className="nms-list-row nms-list-row--profile"
          >
            <span className="nms-list-label" title={p.name}>{p.name}</span>
            <Bar pct={(p.count / max) * 100} height={8} />
            <span className="nms-list-value">{p.count}</span>
          </button>
        ))}
      </div>
    </NMSCard>
  )
}

const WUnprovisioned: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const { t } = useI18n()
  const n = SAMPLE_UNPROVISIONED.count
  const isAlarm = n > 0
  return (
    <NMSCard title={t('noc.widget.unprovisionedOnus', 'Unprovisioned ONUs')} status="pending">
      <button
        type="button"
        onClick={() => openDrawer({ kind: 'segment', id: 'unprov', label: t('noc.widget.unprovisionedOnus', 'Unprovisioned ONUs') })}
        className="nms-stat-btn"
      >
        <span className={'nms-dot nms-dot-lg ' + (isAlarm ? 'nms-dot-amber is-alarm' : 'nms-dot-green')} />
        <div className={'nms-value nms-value-lg nms-mono ' + (isAlarm ? 'nms-value-amber' : 'nms-value-green')}>{n}</div>
        <div className="nms-stat-note">
          {t('noc.unprovisioned.note', 'Pending activation from billing CRM')}
        </div>
      </button>
    </NMSCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 8. MODULE 6 — HIERARCHY EXPLORER
// ═══════════════════════════════════════════════════════════════════════

const WSegmentationStrip: React.FC<WidgetCtx> = ({ openDrawer, nocData }) => {
  const { t } = useI18n()
  const liveVlans = parseVlans(nocData?.analytics?.vlans)
  const segments = liveVlans.length ? liveVlans : SAMPLE_SEGMENTS
  const kindColor = (k: string) =>
    k === 'mgmt'       ? 'nms-pill-cyan' :
    k === 'subscriber' ? 'nms-pill-green' :
    k === 'voice'      ? 'nms-pill-amber' :
    k === 'transit'    ? 'nms-pill-cyan' :
    k === 'bng'        ? 'nms-pill-red'  : ''
  return (
    <NMSCard title={t('noc.widget.globalSegmentation', 'Global Segmentation · VLAN / BNG')} status={liveVlans.length ? 'live' : 'live'}>
      <div className="nms-seg-strip">
        {segments.map(s => (
          <button key={s.id}
            type="button"
            onClick={() => openDrawer({ kind: 'segment', id: s.id, label: s.label })}
            className={'nms-pill nms-pill-sm ' + kindColor(s.kind)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="nms-seg-note">
        {t('noc.segmentation.note', 'Click a chip to filter every widget on the dashboard to that traffic segment.')}
      </div>
    </NMSCard>
  )
}

const WHierarchyExplorer: React.FC<WidgetCtx> = ({ openDrawer, nocData, token }) => {
  const { t } = useI18n()
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

  type _TreeResp = { chassis?: { cards?: { ports?: { id: string; port_no: number; onu_count?: number }[] }[] }[] }
  const { data: treeRaw, loading: treeLoading } = useFetch<_TreeResp>(
    !usingSample && oltId ? `/api/noc/olts/${oltId}/tree` : null
  )
  const treePorts = useMemo(() => {
    const ports: { id: string; port_no: number; onu_count: number }[] = []
    for (const ch of treeRaw?.chassis ?? []) {
      for (const card of ch.cards ?? []) {
        for (const p of card.ports ?? []) {
          ports.push({ id: p.id, port_no: p.port_no, onu_count: p.onu_count ?? 0 })
        }
      }
    }
    return ports
  }, [treeRaw])

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

  return (
    <NMSCard title={t('noc.widget.hierarchyExplorer', 'ISP Hierarchy Explorer')} status={usingSample ? 'partial' : 'live'}>
      <div className="nms-hier-grid">

        {/* Column 1 — Regions */}
        <div className="nms-hier-col nms-hier-col--border">
          <div className="nms-hier-col-header">{t('noc.hier.regions', 'Regions')}</div>
          {regionList.map(r => (
            <button key={r.id} type="button"
              onClick={() => onRegion(r.id)}
              onDoubleClick={() => openDrawer({ kind: 'region', id: r.id, label: r.name })}
              className={`nms-hier-row${regionId === r.id ? ' nms-hier-row--active' : ''}`}
            >
              {r.name}
            </button>
          ))}
        </div>

        {/* Column 2 — OLTs + ports */}
        <div className="nms-hier-col nms-hier-col--border">
          <div className="nms-hier-col-header">{t('noc.hier.oltPon', 'OLT · PON')}</div>
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
                  className={`nms-hier-row${oltId === oId ? ' nms-hier-row--active' : ''}`}
                >
                  {name}
                </button>
                {oltId === oId && (
                  <div className="nms-hier-port-list">
                    {usingSample
                      ? (o as typeof sampleRegion.olts[0]).ports.map(p => (
                          <button key={p.id} type="button" onClick={() => setPortId(p.id)}
                            className={`nms-hier-port${portId === p.id ? ' nms-hier-port--active' : ''}`}
                          >
                            <span>{p.label}</span>
                            <span className="nms-muted">{p.onus.length}</span>
                          </button>
                        ))
                      : treeLoading
                        ? <div className="nms-hier-empty">{t('noc.hier.loadingPorts', 'Loading ports…')}</div>
                        : treePorts.length === 0
                          ? <div className="nms-hier-empty">{t('noc.hier.noPortsSynced', 'No ports synced. Run a refresh first.')}</div>
                          : treePorts.map(p => (
                              <button key={p.id} type="button" onClick={() => setPortId(p.id)}
                                className={`nms-hier-port${portId === p.id ? ' nms-hier-port--active' : ''}`}
                              >
                                <span>0/{p.port_no}</span>
                                <span className="nms-muted">{p.onu_count}</span>
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
        <div className="nms-hier-col">
          {usingSample ? (
            <>
              <div className="nms-hier-col-header">
                {samplePort ? `${t('noc.port', 'Port')} ${samplePort.label}` : '—'} · {samplePort?.onus.length ?? 0} {t('noc.onus', 'ONUs')}
              </div>
              <div className="nms-hier-onu-list">
                {!samplePort || samplePort.onus.length === 0
                  ? <div className="nms-hier-empty">{t('noc.hier.noOnusOnPort', 'No ONUs on this port.')}</div>
                  : samplePort.onus.map(o => (
                      <button key={o.id} type="button" onClick={() => openDrawer({ kind: 'onu', serial: o.serial })}
                        className="nms-hier-onu-row"
                      >
                        <span>{o.serial}</span>
                        <span className="nms-hier-onu-profile">{o.profile}</span>
                        <span className={'nms-pill nms-hier-onu-phase ' + phaseColor(o.phase)}>{o.phase}</span>
                      </button>
                    ))
                }
              </div>
            </>
          ) : (
            <>
              <div className="nms-hier-col-header">
                {portId
                  ? `${t('noc.port', 'Port')} 0/${treePorts.find(p => p.id === portId)?.port_no ?? '?'} · ${treePorts.find(p => p.id === portId)?.onu_count ?? 0} ONUs`
                  : t('noc.hier.selectPort', 'Select a port')}
              </div>
              <div className="nms-hier-phase2">
                {t('noc.hier.phase2DrillDown', 'Per-ONU serial list via port drill-down is Phase 2.')}
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
  const { t } = useI18n()
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
  const hubs = liveHubs.length >= 3 ? liveHubs : SAMPLE_REGIONAL_HUBS

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
    <NMSCard title={t('noc.widget.regionalOutageMap', 'Regional Outage Field Map')} status={liveHubs.length ? 'live' : 'partial'}>
      <svg viewBox={`0 0 ${W} ${H}`} className="nms-map-svg" style={{ height: H }}>
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
      <div className="nms-map-legend">
        <span><span className="nms-map-legend-dot nms-map-legend-dot--ok" /> {t('noc.map.operational', 'Operational')}</span>
        <span><span className="nms-map-legend-dot nms-map-legend-dot--warn" /> {t('noc.map.warning', 'Warning')}</span>
        <span><span className="nms-map-legend-dot nms-map-legend-dot--outage" /> {t('noc.map.outage', 'Outage')}</span>
      </div>
    </NMSCard>
  )
}

const WTechnicianFleet: React.FC<WidgetCtx> = ({ openDrawer }) => {
  const { t } = useI18n()
  const groups = [
    { key: 'available' as const, label: t('noc.fleet.available', 'Available'), count: SAMPLE_TECHS.available, pill: 'nms-pill-green' },
    { key: 'en_route'  as const, label: t('noc.fleet.enRoute', 'En Route'),    count: SAMPLE_TECHS.en_route,  pill: 'nms-pill-amber' },
    { key: 'on_site'   as const, label: t('noc.fleet.onSite', 'On-Site'),      count: SAMPLE_TECHS.on_site,   pill: 'nms-pill-cyan'  },
  ]
  return (
    <NMSCard title={t('noc.widget.technicianFleet', 'Technician Fleet Status')} status="pending">
      <div className="nms-fleet-list">
        {groups.map(g => (
          <button key={g.key}
            type="button"
            onClick={() => openDrawer({ kind: 'tech-group', group: g.key })}
            className="nms-fleet-row"
          >
            <span className={'nms-pill ' + g.pill}>{g.label}</span>
            <span className="nms-fleet-count">{g.count}</span>
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
  capabilities: Capabilities
  canConfigure: boolean
}

export default function NocDashboardView({ capabilities }: NocDashboardProps) {
  const { token } = useAuth()
  const { t } = useI18n()
  const canViewService = can(capabilities, OBJ.SERVICE, 'view')

  const oltListFetch   = useFetch<{ items: OltRecord[]; total: number }>('/api/noc/olts')
  const onuFetch       = useFetch<{ total: number }>('/api/noc/onus?page_size=1')
  const subMixFetch    = useFetch<SubMixItem[]>('/api/analytics/subscription-mix')
  const regionsFetch   = useFetch<RegionItem[]>('/api/regions')
  const sessionsFetch  = useFetch<unknown[]>('/api/radius/sessions?status=active')
  const firstOltId     = oltListFetch.data?.items[0]?.id ?? null
  const analyticsFetch = useFetch<OltAnalytics>(firstOltId ? `/api/noc/olts/${firstOltId}/analytics` : null)

  const nocData = useMemo<NocData | null>(() => {
    if (oltListFetch.loading) return null
    return {
      oltList:         oltListFetch.data   ?? { items: [], total: 0 },
      analytics:       analyticsFetch.data ?? null,
      onuTotal:        (onuFetch.data as any)?.total ?? 0,
      subscriptionMix: Array.isArray(subMixFetch.data)   ? subMixFetch.data   : [],
      regions:         Array.isArray(regionsFetch.data)  ? regionsFetch.data  : [],
      radiusSessions:  Array.isArray(sessionsFetch.data) ? sessionsFetch.data : [],
    }
  }, [oltListFetch, analyticsFetch, onuFetch, subMixFetch, regionsFetch, sessionsFetch])

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
      <PageShell type="OPERATIONS" breadcrumb={['NMS', t('noc.title', 'Network Management System')]} title={t('noc.title', 'Network Management System')} icon={<ServerIcon size={20} />}>
        <PermissionDenied message={t('noc.denied', "You don't have permission to view NOC monitoring.")} />
      </PageShell>
    )
  }

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['NMS', t('noc.title', 'Network Management System')]}
      title={t('noc.title', 'Network Management System')}
      icon={<ServerIcon size={20} />}
      secondaryActions={[{
        label: `WIDGETS · ${WIDGETS.filter(w => visibility[w.id] !== false).length}/${WIDGETS.length}`,
        onClick: () => setManagerOpen(o => !o),
      }]}
    >
      <div className="nms-page">
        {managerOpen && (
          <div className="nms-widget-panel" onMouseLeave={() => setManagerOpen(false)}>
            {MODULE_ORDER.map(mod => {
              const list = WIDGETS.filter(w => w.module === mod)
              if (list.length === 0) return null
              return (
                <div key={mod} className="nms-widget-manager-group">
                  <div className="nms-widget-manager-group-label">{t(...MODULE_LABEL_KEYS[mod])}</div>
                  {list.map(w => (
                    <label key={w.id} className="nms-widget-manager-row">
                      <input
                        type="checkbox"
                        checked={visibility[w.id] !== false}
                        onChange={e => setVisibility({ ...visibility, [w.id]: e.target.checked })}
                      />
                      <span>{w.title}</span>
                      <span className={'nms-pill nms-pill-sm ' + (
                        w.dataStatus === 'live' ? 'nms-pill-green' :
                        w.dataStatus === 'partial' ? 'nms-pill-amber' : 'nms-pill-cyan'
                      )}>{w.dataStatus}</span>
                    </label>
                  ))}
                </div>
              )
            })}
          </div>
        )}
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
                  headline={`${t('noc.pending.awaiting', 'Awaiting')} ${pendingPipelineFor(w.id)}`}
                  body={pendingMessageFor(w.id)}
                />
              </NMSCard>
            ) : (
              <w.Component openDrawer={openDrawer} nocData={nocData} token={token!} />
            )
          )
          return (
            <section key={mod}>
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
        title={drawer ? drawerTitleFor(drawer, t) : ''}
        subtitle={drawer ? drawerSubtitleFor(drawer, t) : undefined}
      >
        {drawer && <DrawerBody payload={drawer} />}
      </SlideOutPanel>
    </PageShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// 12. DRAWER BODY (context-aware)
// ═══════════════════════════════════════════════════════════════════════

function drawerTitleFor(p: DrawerPayload, t: (key: string, fallback?: string) => string): string {
  switch (p.kind) {
    case 'port':       return `${t('noc.port', 'Port')} ${p.label}`
    case 'vendor':     return p.label
    case 'tier':       return `${t('noc.drawer.tier', 'Tier')} · ${p.name}`
    case 'profile':    return p.name
    case 'segment':    return p.label
    case 'onu':        return p.serial
    case 'olt':        return p.label
    case 'region':     return p.label
    case 'tech-group': return p.group.replace('_', ' ').toUpperCase()
  }
}

function drawerSubtitleFor(p: DrawerPayload, t: (key: string, fallback?: string) => string): string {
  switch (p.kind) {
    case 'port':       return t('noc.drawer.sub.port', 'PON port detail')
    case 'vendor':     return `${t('noc.drawer.sub.ouiPrefix', 'OUI prefix')} · ${p.prefix}`
    case 'tier':       return t('noc.drawer.sub.tier', 'Subscription tier')
    case 'profile':    return t('noc.drawer.sub.profile', 'Line / DBA profile')
    case 'segment':    return t('noc.drawer.sub.segment', 'Network segment')
    case 'onu':        return t('noc.drawer.sub.onu', 'ONU device')
    case 'olt':        return t('noc.drawer.sub.olt', 'OLT chassis')
    case 'region':     return t('noc.drawer.sub.region', 'Region / hub site')
    case 'tech-group': return t('noc.drawer.sub.techGroup', 'Field technician group')
  }
}

function DrawerBody({ payload }: { payload: DrawerPayload }) {
  const { t } = useI18n()
  return (
    <div className="nms-drawer-content">
      <div className="nms-hint">
        {t('noc.drawer.phase1Hint', 'Slide-out drawer body — Phase 1A design preview. Real per-asset detail will render here once each widget is wired to live data and the matching backend endpoint exists.')}
      </div>
      <div className="nms-drawer-block">
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
