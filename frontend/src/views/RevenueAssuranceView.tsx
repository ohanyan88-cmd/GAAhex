// RevenueAssuranceView — Wave A §3 dashboard for revenue leakage / collections health.
//
// Two tabs:
//   1. Overview — original dashboard (KPI strip + revenue-trend chart + AR aging + overdue table).
//   2. Findings — Phase B.3 worklist over /api/revenue-assurance/* (scan runs, findings triage).
//
// Doctrine: every value is fetched from a real backend endpoint. If a fetch fails or returns
// nothing meaningful, the widget hides itself entirely — no dashes, no placeholders, no toast-only
// banners. Hide-if-missing per CLAUDE_CODE_ALL_PAGES_PROMPTS.md rule 3.
//
// Endpoints used:
//   GET  /api/analytics/revenue-trend?months=6   — main chart (collected vs invoiced)
//   GET  /api/analytics/overview                 — KPIs (AR outstanding, overdue, collections this/prev month)
//   GET  /api/analytics/ar-aging                 — secondary widget (aging buckets)
//   GET  /api/invoices?status=OVERDUE            — overdue attention table
//   POST /api/revenue-assurance/scan             — kick off a new scan (admin-gated)
//   GET  /api/revenue-assurance/findings         — paginated findings list (analytics.view)
//   POST /api/revenue-assurance/findings/{id}/ack
//   POST /api/revenue-assurance/findings/{id}/resolve
//   POST /api/revenue-assurance/findings/{id}/mark-false-positive (admin)
//   GET  /api/revenue-assurance/scans            — newest scan run (for "Last scan" line)
//
// Permissions: gated on `invoice.view` (the data layer all four overview widgets live on).
// The Findings tab additionally treats backend 403 as PermissionDenied and 404 as "not available".
import { useEffect, useMemo, useState } from 'react'
import { ShieldIcon, GearIcon, ReceiptIcon, SearchIcon } from '../components/icons'
import {
  Banknote, AlertTriangle, TrendingUp, BarChart3,
  ListChecks, Play, RefreshCw, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { bget, bpost, loadCustomers, type Invoice } from '../lib/billing'
import { money } from '../lib/money'
import { fetchCapabilities, can as canDo, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { LineChart } from '../components/charts/LineChart'
import { StatusPill, KPITile } from '../primitives'
import { PermissionDenied, EmptyState, ErrorBanner } from '../components/States'
import { PageShell, type KPISpec } from '../page-shell'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { timeAgo } from '../lib/time'

// ── Types ────────────────────────────────────────────────────────────────────
type Overview = {
  mrr?: number
  active_subscriptions?: number
  ar_outstanding?: number
  overdue_total?: number
  overdue_count?: number
  collected_this_month?: number
  collected_prev_month?: number
  [k: string]: any
}

type TrendPoint = { month: string; collected: number; invoiced: number }
type AgingBuckets = { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number }

// Per-widget fetch state machine. 'hide' is silent — the widget is omitted, not greyed out.
type Fetched<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'hide' }

// ── Phase B.3 types ─────────────────────────────────────────────────────────
type FindingType = 'unbilled_service' | 'uninvoiced_subscription' | 'orphan_invoice'
type FindingSeverity = 'low' | 'medium' | 'high' | 'critical'
type FindingStatus = 'open' | 'investigating' | 'resolved' | 'false_positive'

interface RaFinding {
  id: string
  tenant_id: string
  finding_type: FindingType
  severity: FindingSeverity
  entity_type: 'service' | 'subscription' | 'invoice'
  entity_id: string
  summary: string
  detail_json: Record<string, any>
  detected_at: string
  status: FindingStatus
  ack_at: string | null
  ack_by: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution: string | null
  scan_run_id: string | null
}

interface RaScanRun {
  id: string
  tenant_id: string
  started_at: string
  completed_at: string | null
  status: 'running' | 'success' | 'failed'
  findings_count: number
  error_message: string | null
  triggered_by: string | null
}

type TabKey = 'overview' | 'findings'

const FINDING_TYPE_LABEL: Record<FindingType, string> = {
  unbilled_service: 'Unbilled Service',
  uninvoiced_subscription: 'Uninvoiced Sub',
  orphan_invoice: 'Orphan Invoice',
}

const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  false_positive: 'False positive',
}

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

function statusToPill(s: FindingStatus): PillVariant {
  switch (s) {
    case 'open':           return 'critical'
    case 'investigating':  return 'degraded'
    case 'resolved':       return 'active'
    case 'false_positive': return 'neutral'
  }
}

function severityToPill(sev: FindingSeverity): PillVariant {
  switch (sev) {
    case 'critical': return 'critical'
    case 'high':     return 'degraded'
    case 'medium':   return 'info'
    case 'low':      return 'neutral'
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// ── View ─────────────────────────────────────────────────────────────────────
export default function RevenueAssuranceView({
  token, canConfigure = false, onConfigure,
}: {
  token: string
  configVersion?: number
  canConfigure?: boolean
  onConfigure?: () => void
}) {
  const [caps, setCaps] = useState<Capabilities>(FULL_ACCESS)
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [denied, setDenied] = useState(false)

  // Tab state — Overview (default) wraps the original dashboard; Findings is the B.3 worklist.
  const [tab, setTab] = useState<TabKey>('overview')

  // Each widget is independently fetched + hideable.
  const [overview, setOverview] = useState<Fetched<Overview>>({ state: 'loading' })
  const [trend, setTrend] = useState<Fetched<TrendPoint[]>>({ state: 'loading' })
  const [aging, setAging] = useState<Fetched<AgingBuckets>>({ state: 'loading' })
  const [overdue, setOverdue] = useState<Fetched<Invoice[]>>({ state: 'loading' })
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})

  // Permissions — capability check is async, so we wait before showing data widgets to avoid
  // briefly flashing values the role can't actually access.
  useEffect(() => {
    let alive = true
    fetchCapabilities(token).then((c) => {
      if (!alive) return
      setCaps(c); setCapsLoaded(true)
    }).catch(() => { if (alive) setCapsLoaded(true) })
    return () => { alive = false }
  }, [token])

  const canView = canDo(caps, 'invoice', 'view')

  // Trend — main chart. Hide on any failure (including a 0-bucket response).
  useEffect(() => {
    if (!capsLoaded || !canView) return
    let alive = true
    bget<any[]>(token, '/api/analytics/revenue-trend?months=6').then((res) => {
      if (!alive) return
      if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
        if (res.status === 403) console.warn('[revenue-assurance] trend 403 (analytics.view denied)')
        else if (!res.ok) console.error('[revenue-assurance] trend fetch failed', res.status)
        setTrend({ state: 'hide' }); return
      }
      const data: TrendPoint[] = res.data.map((d: any) => ({
        month: String(d.month ?? ''),
        collected: Number(d.collected) || 0,
        invoiced: Number(d.invoiced) || 0,
      }))
      setTrend({ state: 'ok', value: data })
    }).catch((e) => { console.error('[revenue-assurance] trend:', e); if (alive) setTrend({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, capsLoaded, canView])

  // Overview — KPI strip source.
  useEffect(() => {
    if (!capsLoaded || !canView) return
    let alive = true
    bget<Overview>(token, '/api/analytics/overview').then((res) => {
      if (!alive) return
      if (!res.ok || !res.data || typeof res.data !== 'object') {
        if (!res.ok) console.error('[revenue-assurance] overview fetch failed', res.status)
        setOverview({ state: 'hide' }); return
      }
      setOverview({ state: 'ok', value: res.data })
    }).catch((e) => { console.error('[revenue-assurance] overview:', e); if (alive) setOverview({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, capsLoaded, canView])

  // AR aging — secondary widget alongside the trend chart.
  useEffect(() => {
    if (!capsLoaded || !canView) return
    let alive = true
    bget<any>(token, '/api/analytics/ar-aging').then((res) => {
      if (!alive) return
      if (!res.ok || !res.data || typeof res.data !== 'object') {
        if (!res.ok) console.error('[revenue-assurance] aging fetch failed', res.status)
        setAging({ state: 'hide' }); return
      }
      const d = res.data
      const buckets: AgingBuckets = {
        current: Number(d.current) || 0,
        d1_30: Number(d.d1_30) || 0,
        d31_60: Number(d.d31_60) || 0,
        d61_90: Number(d.d61_90) || 0,
        d90_plus: Number(d.d90_plus) || 0,
      }
      const sum = buckets.current + buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90_plus
      if (sum === 0) { setAging({ state: 'hide' }); return }
      setAging({ state: 'ok', value: buckets })
    }).catch((e) => { console.error('[revenue-assurance] aging:', e); if (alive) setAging({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, capsLoaded, canView])

  // Overdue invoices — "Needs attention" table.
  useEffect(() => {
    if (!capsLoaded || !canView) return
    let alive = true
    Promise.all([
      bget<Invoice[]>(token, '/api/invoices?status=OVERDUE'),
      loadCustomers(token),
    ]).then(([res, names]) => {
      if (!alive) return
      setCustomerNames(names)
      if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
        if (!res.ok) console.error('[revenue-assurance] overdue fetch failed', res.status)
        setOverdue({ state: 'hide' }); return
      }
      // Top 8 highest-balance overdue invoices.
      const sorted = [...res.data].sort((a, b) => (b.balance ?? b.total ?? 0) - (a.balance ?? a.total ?? 0))
      setOverdue({ state: 'ok', value: sorted.slice(0, 8) })
    }).catch((e) => { console.error('[revenue-assurance] overdue:', e); if (alive) setOverdue({ state: 'hide' }) })
    return () => { alive = false }
  }, [token, capsLoaded, canView])

  // ── Findings tab state (FindingsState is declared below near the FindingsTab subcomponent) ──
  const [findings, setFindings] = useState<FindingsState>({ state: 'loading' })
  const [statusFilter, setStatusFilter] = useState<FindingStatus | 'all'>('open')
  const [typeFilter, setTypeFilter] = useState<FindingType | 'all'>('all')
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  // Last successful scan run (newest first), for the "Last scan: …" line.
  const [lastScan, setLastScan] = useState<RaScanRun | null>(null)

  // Resolve / FP modal state — null when closed.
  const [actionModal, setActionModal] = useState<
    | { kind: 'resolve' | 'false_positive'; finding: RaFinding; resolution: string; submitting: boolean }
    | null
  >(null)

  // Drilldown drawer state — holds the currently-open finding plus a per-id fetch state.
  // The detail endpoint returns the full row (same shape as list, but always fresh from DB),
  // so we re-fetch on open to pick up status transitions made by other operators.
  type DetailState =
    | { state: 'loading' }
    | { state: 'ok'; value: RaFinding }
    | { state: 'error'; message: string }
  const [drawerFinding, setDrawerFinding] = useState<RaFinding | null>(null)
  const [drawerDetail, setDrawerDetail] = useState<DetailState>({ state: 'loading' })
  // Cache customer names so re-opening the same row doesn't refetch. Keyed by customer_id (uuid).
  const [customerNameCache, setCustomerNameCache] = useState<Record<string, string | null>>({})
  // null = not yet looked up; '' = lookup completed but no name (we'll just show uuid)
  const [drawerCustomer, setDrawerCustomer] = useState<{ id: string; name: string | null } | null>(null)

  // Capability test for admin actions (Run Scan / mark FP). Backend enforces; this gates the UI.
  const canAdmin = canConfigure || canDo(caps, 'finding', 'edit')

  // Build the findings query string from filters. Status='all' omits the param so the backend
  // returns every status; finding_type and severity follow the same pattern.
  function buildFindingsQuery(): string {
    const qs: string[] = ['page=1', 'page_size=200']
    if (statusFilter !== 'all') qs.push(`status=${encodeURIComponent(statusFilter)}`)
    if (typeFilter !== 'all') qs.push(`finding_type=${encodeURIComponent(typeFilter)}`)
    if (severityFilter !== 'all') qs.push(`severity=${encodeURIComponent(severityFilter)}`)
    return qs.join('&')
  }

  async function loadFindings() {
    setFindings({ state: 'loading' })
    const res = await bget<any>(token, `/api/revenue-assurance/findings?${buildFindingsQuery()}`)
    if (res.status === 403) { setFindings({ state: 'denied' }); return }
    if (res.status === 404) { setFindings({ state: 'unavailable' }); return }
    if (!res.ok) {
      setFindings({ state: 'error', message: `Failed to load findings (${res.status})` })
      return
    }
    // Tolerant shape — backend may return either an array or { items: [...] } pagination envelope.
    const raw = res.data
    const items: RaFinding[] = Array.isArray(raw)
      ? raw as RaFinding[]
      : Array.isArray(raw?.items)
        ? raw.items as RaFinding[]
        : Array.isArray(raw?.results)
          ? raw.results as RaFinding[]
          : []
    if (items.length === 0) { setFindings({ state: 'empty' }); return }
    setFindings({ state: 'ok', items })
  }

  async function loadLastScan() {
    const res = await bget<any>(token, '/api/revenue-assurance/scans?page=1')
    if (!res.ok) { setLastScan(null); return }
    const raw = res.data
    const items: RaScanRun[] = Array.isArray(raw)
      ? raw as RaScanRun[]
      : Array.isArray(raw?.items)
        ? raw.items as RaScanRun[]
        : Array.isArray(raw?.results)
          ? raw.results as RaScanRun[]
          : []
    if (items.length === 0) { setLastScan(null); return }
    // Newest first per API contract — but defend against ordering surprises.
    const sorted = [...items].sort((a, b) => {
      const ta = new Date(a.started_at).getTime(); const tb = new Date(b.started_at).getTime()
      return tb - ta
    })
    setLastScan(sorted[0] ?? null)
  }

  // Initial + filter-driven fetch when the Findings tab becomes (or stays) active.
  useEffect(() => {
    if (!capsLoaded || !canView) return
    if (tab !== 'findings') return
    setPage(1)
    void loadFindings()
    void loadLastScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, capsLoaded, canView, tab, statusFilter, typeFilter, severityFilter])

  // Derived KPI counts — always from the loaded list (status filter may scope these to the
  // currently filtered view, which is the intentional behavior: the KPI strip reflects what
  // the user is looking at).
  const findingsList = findings.state === 'ok' ? findings.items : []
  const kpiCounts = useMemo(() => {
    const counts = { open: 0, investigating: 0, resolved: 0, false_positive: 0 }
    for (const f of findingsList) counts[f.status]++
    return counts
  }, [findingsList])

  const pageCount = Math.max(1, Math.ceil(findingsList.length / PAGE_SIZE))
  const pageRows = findingsList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  useEffect(() => { if (page > pageCount) setPage(1) }, [page, pageCount])

  // ── Action handlers ────────────────────────────────────────────────────────
  async function runScan() {
    try {
      const run = await bpost<RaScanRun>(token, '/api/revenue-assurance/scan', {})
      const id = run?.id ? String(run.id).slice(0, 8) : 'unknown'
      const count = typeof run?.findings_count === 'number' ? run.findings_count : null
      toast.success(count != null
        ? `Scan ${id} started · ${count} finding${count === 1 ? '' : 's'}`
        : `Scan ${id} started`)
      await loadFindings()
      await loadLastScan()
    } catch (e) {
      toast.error((e as Error).message || 'Scan failed')
    }
  }

  async function ackFinding(f: RaFinding) {
    try {
      await bpost(token, `/api/revenue-assurance/findings/${f.id}/ack`, {})
      toast.success('Acknowledged')
      await loadFindings()
    } catch (e) {
      toast.error((e as Error).message || 'Failed to acknowledge')
    }
  }

  function openResolve(f: RaFinding) {
    setActionModal({ kind: 'resolve', finding: f, resolution: '', submitting: false })
  }
  function openMarkFP(f: RaFinding) {
    setActionModal({ kind: 'false_positive', finding: f, resolution: '', submitting: false })
  }

  async function submitActionModal() {
    if (!actionModal) return
    const { kind, finding, resolution } = actionModal
    if (kind === 'resolve' && !resolution.trim()) return // resolution required
    setActionModal({ ...actionModal, submitting: true })
    try {
      if (kind === 'resolve') {
        await bpost(token, `/api/revenue-assurance/findings/${finding.id}/resolve`, { resolution: resolution.trim() })
        toast.success('Finding resolved')
      } else {
        const body = resolution.trim() ? { resolution: resolution.trim() } : {}
        await bpost(token, `/api/revenue-assurance/findings/${finding.id}/mark-false-positive`, body)
        toast.success('Marked false positive')
      }
      setActionModal(null)
      // Close the drilldown drawer too (action centralized through it would otherwise
      // leave it open showing stale status — reload happens regardless via loadFindings).
      setDrawerFinding(null)
      setDrawerDetail({ state: 'loading' })
      setDrawerCustomer(null)
      await loadFindings()
    } catch (e) {
      toast.error((e as Error).message || 'Action failed')
      setActionModal((m) => m ? { ...m, submitting: false } : m)
    }
  }

  // Drilldown drawer: open on row click, fetch fresh detail + (optional) customer name.
  async function openDrawer(f: RaFinding) {
    setDrawerFinding(f)
    setDrawerDetail({ state: 'loading' })
    setDrawerCustomer(null)
    // Detail fetch — keep the seed finding visible (from the list) while the fresh row loads.
    const res = await bget<RaFinding>(token, `/api/revenue-assurance/findings/${f.id}`)
    if (!res.ok || !res.data || typeof res.data !== 'object') {
      // Fall back to the list row — the list row IS the same shape, just possibly stale.
      // We still show the drawer; the detail-state stays 'error' so a small note appears.
      setDrawerDetail({ state: 'error', message: `Could not fetch latest details (${res.status})` })
    } else {
      setDrawerDetail({ state: 'ok', value: res.data })
    }
    // Customer lookup — only if detail_json carries a customer_id.
    const fresh = res.ok && res.data ? res.data : f
    const cid = fresh.detail_json?.customer_id
    if (cid && typeof cid === 'string') {
      if (cid in customerNameCache) {
        setDrawerCustomer({ id: cid, name: customerNameCache[cid] })
      } else {
        const cres = await bget<any>(token, `/api/customers/${cid}`)
        let name: string | null = null
        if (cres.ok && cres.data && typeof cres.data === 'object') {
          name = cres.data.name ?? cres.data.title ?? cres.data.display_name ?? null
        }
        // Cache even on 404/403 (as null) so we don't refetch a known-missing customer.
        setCustomerNameCache((m) => ({ ...m, [cid]: name }))
        setDrawerCustomer({ id: cid, name })
      }
    }
  }

  function closeDrawer() {
    setDrawerFinding(null)
    setDrawerDetail({ state: 'loading' })
    setDrawerCustomer(null)
  }

  // Drawer-action wrappers: same backend calls, but close the drawer on completion.
  async function drawerAck() {
    const target = drawerDetail.state === 'ok' ? drawerDetail.value : drawerFinding
    if (!target) return
    await ackFinding(target)
    closeDrawer()
  }

  if (capsLoaded && !canView) {
    return <PermissionDenied message="You don't have permission to view revenue assurance." />
  }
  if (denied) return <PermissionDenied />
  // silence unused setter warning (kept for symmetry with other views' deny path)
  void setDenied

  // KPI visibility derived from the overview payload — hide each tile if its underlying number
  // is absent (vs. a real 0, which we show).
  const ovOk = overview.state === 'ok' ? overview.value : null
  const showAr = ovOk && typeof ovOk.ar_outstanding === 'number'
  const showOverdue = ovOk && typeof ovOk.overdue_total === 'number'
  const showOverdueCount = ovOk && typeof ovOk.overdue_count === 'number'
  const showCollected = ovOk && typeof ovOk.collected_this_month === 'number'

  // Collections delta — only meaningful if both this/prev are present.
  const collectedDelta = (ovOk && typeof ovOk.collected_this_month === 'number' && typeof ovOk.collected_prev_month === 'number')
    ? (ovOk.collected_this_month - ovOk.collected_prev_month)
    : null
  const collectedPct = (collectedDelta != null && ovOk?.collected_prev_month)
    ? (collectedDelta / ovOk.collected_prev_month) * 100
    : null

  // Build KPI specs from real overview data (hide tiles where data is absent)
  const kpis: KPISpec[] = [
    ...(showCollected ? [{
      label: 'Collected this month',
      value: money(ovOk!.collected_this_month!),
      delta: collectedDelta != null
        ? (collectedPct != null
            ? `${Math.abs(collectedPct).toFixed(0)}% vs prev`
            : `${money(Math.abs(collectedDelta))} vs prev`)
        : undefined,
      deltaPositive: collectedDelta != null ? collectedDelta >= 0 : undefined,
    }] : []),
    ...(showAr ? [{ label: 'AR outstanding', value: money(ovOk!.ar_outstanding!) }] : []),
    ...(showOverdue ? [{ label: 'Overdue value', value: money(ovOk!.overdue_total!), danger: true }] : []),
    ...(showOverdueCount ? [{ label: 'Overdue invoices', value: (ovOk!.overdue_count!).toLocaleString() }] : []),
  ]

  return (
    <PageShell
      type="ANALYTICS"
      breadcrumb={['Billing & Revenue', 'Revenue Assurance']}
      icon={<ShieldIcon size={18} />}
      title="Revenue Assurance"
      subtitle="Service ↔ Subscription ↔ Invoice leakage detection"
      kpis={kpis}
      secondaryActions={canConfigure && onConfigure ? [
        { label: 'Configure', icon: <GearIcon size={13} />, onClick: onConfigure },
      ] : undefined}
    >
        {/* Tab strip — PipelineView pattern (button row, bottom border on active). */}
        <div
          role="tablist"
          aria-label="Revenue Assurance views"
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--gx-border, #e2e8f0)',
            marginBottom: 16,
            marginTop: 8,
            paddingBottom: 0,
          }}
        >
          <RaTabButton
            active={tab === 'overview'}
            onClick={() => setTab('overview')}
            icon={<BarChart3 size={14} />}
            label="Overview"
            sub="KPIs · trend · aging · overdue"
          />
          <RaTabButton
            active={tab === 'findings'}
            onClick={() => setTab('findings')}
            icon={<ListChecks size={14} />}
            label="Findings"
            sub="Triage revenue leakage signals"
          />
        </div>

        {tab === 'overview' && kpis.length > 0 && (
          <div className="kpi-strip">
            {showCollected && (
              <KPITile
                label="Collected this month"
                icon={Banknote}
                value={money(ovOk!.collected_this_month!)}
                size="sm"
                delta={collectedDelta != null
                  ? (collectedPct != null
                      ? `${Math.abs(collectedPct).toFixed(0)}% vs prev`
                      : `${money(Math.abs(collectedDelta))} vs prev`)
                  : undefined}
                deltaPositive={collectedDelta != null ? collectedDelta >= 0 : undefined}
              />
            )}
            {showAr && (
              <KPITile
                label="AR outstanding"
                icon={TrendingUp}
                value={money(ovOk!.ar_outstanding!)}
                size="sm"
              />
            )}
            {showOverdue && (
              <KPITile
                label="Overdue value"
                icon={AlertTriangle}
                value={money(ovOk!.overdue_total!)}
                size="sm"
                danger
              />
            )}
            {showOverdueCount && (
              <KPITile
                label="Overdue invoices"
                icon={ReceiptIcon}
                value={(ovOk!.overdue_count!).toLocaleString()}
                size="sm"
              />
            )}
          </div>
        )}

        {/* Two-column body: main chart left, AR aging right. Hide each independently. */}
        {tab === 'overview' && (trend.state !== 'hide' || aging.state !== 'hide') && (
          <div className="cols">
            {trend.state !== 'hide' && (
              <div className="card">
                <div className="card-head">
                  <BarChart3 size={16} style={{ color: 'var(--gx-text-3)' }} />
                  <h3>Revenue trend</h3>
                  <span className="spacer" />
                  <span className="pill pill-neutral">6 mo</span>
                </div>
                <div className="card-pad">
                  {trend.state === 'loading' && <p className="muted">Loading…</p>}
                  {trend.state === 'ok' && (
                    <LineChart
                      series={[
                        { label: 'Collected', values: trend.value.map(b => b.collected), color: 'var(--viz-1)', fillUnder: true },
                        { label: 'Invoiced',  values: trend.value.map(b => b.invoiced),  color: 'var(--viz-2)' },
                      ]}
                    />
                  )}
                </div>
              </div>
            )}

            {aging.state !== 'hide' && (
              <div className="card">
                <div className="card-head">
                  <AlertTriangle size={16} style={{ color: 'var(--gx-text-3)' }} />
                  <h3>AR aging</h3>
                </div>
                <div className="card-pad">
                  {aging.state === 'loading' && <p className="muted">Loading…</p>}
                  {aging.state === 'ok' && <AgingBars buckets={aging.value} />}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Needs-attention table: overdue invoices, sorted by balance. */}
        {tab === 'overview' && overdue.state !== 'hide' && (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <AlertTriangle size={16} style={{ color: 'var(--gx-text-3)' }} />
              <h3>Overdue invoices — needs attention</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              {overdue.state === 'loading' && <p className="muted" style={{ padding: 18 }}>Loading…</p>}
              {overdue.state === 'ok' && (
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Customer</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th className="num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.value.map((inv) => {
                      const cust = inv.customer_id
                        ? (customerNames[inv.customer_id] ?? inv.customer_id.slice(0, 8))
                        : '—'
                      const bal = inv.balance ?? inv.total ?? 0
                      return (
                        <tr key={inv.id}>
                          <td><span className="mono">{inv.number ?? inv.id.slice(0, 8)}</span></td>
                          <td>{cust}</td>
                          <td>{fmtDate(inv.due_at)}</td>
                          <td><StatusPill variant="critical" label={inv.status ?? 'OVERDUE'} size="sm" /></td>
                          <td className="num"><span className="mono tnum">{money(bal)}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Findings tab ──────────────────────────────────────────────── */}
        {tab === 'findings' && (
          <FindingsTab
            state={findings}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            typeFilter={typeFilter}
            onTypeFilter={setTypeFilter}
            severityFilter={severityFilter}
            onSeverityFilter={setSeverityFilter}
            canAdmin={canAdmin}
            onRunScan={runScan}
            lastScan={lastScan}
            kpiCounts={kpiCounts}
            pageRows={pageRows}
            page={page}
            pageCount={pageCount}
            onPage={setPage}
            totalRows={findingsList.length}
            pageSize={PAGE_SIZE}
            onRetry={loadFindings}
            onAck={ackFinding}
            onOpenResolve={openResolve}
            onOpenMarkFP={openMarkFP}
            onOpenDrawer={openDrawer}
          />
        )}

        {/* Resolve / mark-FP modal — used by the Findings tab actions. */}
        {actionModal && (
          <Modal
            open
            onClose={() => actionModal.submitting ? undefined : setActionModal(null)}
            title={actionModal.kind === 'resolve' ? 'Resolve finding' : 'Mark as false positive'}
            subtitle={actionModal.finding.summary}
            size="md"
            footer={
              <>
                <button
                  className="btn btn-ghost btn-md"
                  onClick={() => setActionModal(null)}
                  disabled={actionModal.submitting}
                >Cancel</button>
                <button
                  className={'btn btn-md ' + (actionModal.kind === 'resolve' ? 'btn-primary' : 'btn-secondary')}
                  onClick={submitActionModal}
                  disabled={
                    actionModal.submitting ||
                    (actionModal.kind === 'resolve' && !actionModal.resolution.trim())
                  }
                >
                  {actionModal.submitting
                    ? 'Submitting…'
                    : (actionModal.kind === 'resolve' ? 'Resolve' : 'Mark false positive')}
                </button>
              </>
            }
          >
            <label className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>
                Resolution{actionModal.kind === 'resolve' ? ' *' : ' (optional)'}
              </span>
              <textarea
                className="inp inp-md"
                rows={4}
                value={actionModal.resolution}
                onChange={(e) => setActionModal({ ...actionModal, resolution: e.target.value })}
                placeholder={
                  actionModal.kind === 'resolve'
                    ? 'Describe how this finding was resolved (e.g. issued invoice INV-1234)'
                    : 'Optional context for why this is a false positive'
                }
              />
            </label>
          </Modal>
        )}

        {/* Drilldown drawer — opens on row click in the Findings table. */}
        {drawerFinding && (
          <FindingDrawer
            seed={drawerFinding}
            detail={drawerDetail}
            customer={drawerCustomer}
            canAdmin={canAdmin}
            onClose={closeDrawer}
            onAck={drawerAck}
            onOpenResolve={(f) => openResolve(f)}
            onOpenMarkFP={(f) => openMarkFP(f)}
          />
        )}
    </PageShell>
  )
}

// ── Subcomponents ────────────────────────────────────────────────────────────
// Note: the previous inline KpiTile was deleted in the KPI design-system sweep.
// This view now uses the shared `<KPITile>` primitive imported above.

// Tab button — kit pattern from PipelineView (label + sub line, bottom border on active).
function RaTabButton({ active, onClick, icon, label, sub }: {
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

// ── Findings tab ─────────────────────────────────────────────────────────────
type FindingsState =
  | { state: 'loading' }
  | { state: 'ok'; items: RaFinding[] }
  | { state: 'empty' }
  | { state: 'denied' }
  | { state: 'unavailable' }
  | { state: 'error'; message: string }

function FindingsTab(props: {
  state: FindingsState
  statusFilter: FindingStatus | 'all'
  onStatusFilter: (s: FindingStatus | 'all') => void
  typeFilter: FindingType | 'all'
  onTypeFilter: (t: FindingType | 'all') => void
  severityFilter: FindingSeverity | 'all'
  onSeverityFilter: (s: FindingSeverity | 'all') => void
  canAdmin: boolean
  onRunScan: () => void
  lastScan: RaScanRun | null
  kpiCounts: { open: number; investigating: number; resolved: number; false_positive: number }
  pageRows: RaFinding[]
  page: number
  pageCount: number
  onPage: (p: number) => void
  totalRows: number
  pageSize: number
  onRetry: () => void
  onAck: (f: RaFinding) => void
  onOpenResolve: (f: RaFinding) => void
  onOpenMarkFP: (f: RaFinding) => void
  onOpenDrawer: (f: RaFinding) => void
}) {
  const {
    state, statusFilter, onStatusFilter, typeFilter, onTypeFilter,
    severityFilter, onSeverityFilter, canAdmin, onRunScan, lastScan,
    kpiCounts, pageRows, page, pageCount, onPage, totalRows, pageSize,
    onRetry, onAck, onOpenResolve, onOpenMarkFP, onOpenDrawer,
  } = props

  if (state.state === 'denied') {
    return <PermissionDenied message="You don't have permission to view revenue assurance findings." />
  }

  if (state.state === 'unavailable') {
    return (
      <EmptyState
        icon={<ListChecks size={40} />}
        title="Revenue Assurance endpoints not yet available"
        message="The findings worklist will appear once the Phase B.3 backend is live."
      />
    )
  }

  return (
    <div>
      {/* Header row: filters + Run Scan + Last scan stamp */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={(v) => onStatusFilter(v as FindingStatus | 'all')}
            options={[
              ['all', 'All statuses'],
              ['open', 'Open'],
              ['investigating', 'Investigating'],
              ['resolved', 'Resolved'],
              ['false_positive', 'False positive'],
            ]}
          />
          <FilterSelect
            label="Type"
            value={typeFilter}
            onChange={(v) => onTypeFilter(v as FindingType | 'all')}
            options={[
              ['all', 'All types'],
              ['unbilled_service', FINDING_TYPE_LABEL.unbilled_service],
              ['uninvoiced_subscription', FINDING_TYPE_LABEL.uninvoiced_subscription],
              ['orphan_invoice', FINDING_TYPE_LABEL.orphan_invoice],
            ]}
          />
          <FilterSelect
            label="Severity"
            value={severityFilter}
            onChange={(v) => onSeverityFilter(v as FindingSeverity | 'all')}
            options={[
              ['all', 'All severities'],
              ['critical', 'Critical'],
              ['high', 'High'],
              ['medium', 'Medium'],
              ['low', 'Low'],
            ]}
          />
        </div>

        <span style={{ flex: 1 }} />

        {lastScan && (
          <span style={{ fontSize: 12, color: 'var(--gx-text-3, #64748b)' }}>
            Last scan: <strong style={{ color: 'var(--gx-text-2, #475569)' }} title={lastScan.started_at}>
              {timeAgo(lastScan.started_at) || 'just now'}
            </strong>
            {' '}· {lastScan.findings_count} finding{lastScan.findings_count === 1 ? '' : 's'}
          </span>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={onRetry}
          title="Reload findings"
        >
          <RefreshCw size={13} /> Refresh
        </button>
        {canAdmin && (
          <button
            className="btn btn-primary btn-sm"
            onClick={onRunScan}
            title="Start a new scan run"
          >
            <Play size={13} /> Run Scan
          </button>
        )}
      </div>

      {/* KPI strip — derived client-side from loaded list */}
      {state.state === 'ok' && (
        <div className="kpi-strip" style={{ marginBottom: 16 }}>
          <KPITile
            label="Open"
            value={kpiCounts.open}
            size="sm"
            danger={kpiCounts.open > 0}
          />
          <KPITile
            label="Investigating"
            value={kpiCounts.investigating}
            size="sm"
            warning={kpiCounts.investigating > 0}
          />
          <KPITile
            label="Resolved"
            value={kpiCounts.resolved}
            size="sm"
          />
          <KPITile
            label="False positives"
            value={kpiCounts.false_positive}
            size="sm"
            muted
          />
        </div>
      )}

      {/* Body — loading / error / empty / table */}
      {state.state === 'loading' && (
        <p className="muted" style={{ padding: 18 }}>Loading findings…</p>
      )}

      {state.state === 'error' && (
        <ErrorBanner message={state.message} onRetry={onRetry} />
      )}

      {state.state === 'empty' && (
        <EmptyState
          icon={<SearchIcon size={40} />}
          title="No findings to triage."
          message={lastScan
            ? `Last scan ${timeAgo(lastScan.started_at) || 'just now'}.`
            : 'Run a scan to detect revenue leakage.'}
          action={canAdmin ? (
            <button className="btn btn-primary btn-sm" onClick={onRunScan}>
              <Play size={13} /> Run Scan
            </button>
          ) : undefined}
        />
      )}

      {state.state === 'ok' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Detected</th>
                  <th scope="col">Type</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Summary</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((f) => {
                  const actionable = f.status === 'open' || f.status === 'investigating'
                  return (
                    <tr
                      key={f.id}
                      onClick={() => onOpenDrawer(f)}
                      style={{ cursor: 'pointer' }}
                      title="View finding details"
                    >
                      <td>
                        <span title={f.detected_at} style={{ color: 'var(--gx-text-2)' }}>
                          {timeAgo(f.detected_at) || '—'}
                        </span>
                      </td>
                      <td>
                        <TypeChip type={f.finding_type} severity={f.severity} />
                      </td>
                      <td>
                        <StatusPill
                          variant={severityToPill(f.severity)}
                          label={f.severity}
                          size="sm"
                        />
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--gx-text-3)', textTransform: 'uppercase' }}>
                            {f.entity_type}
                          </span>
                          <span className="mono" style={{ fontSize: 12 }}>
                            {f.entity_id ? f.entity_id.slice(0, 8) : '—'}
                          </span>
                        </span>
                      </td>
                      <td style={{ maxWidth: 360 }}>
                        <span style={{
                          display: 'inline-block', maxWidth: '100%',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          verticalAlign: 'bottom',
                        }} title={f.summary}>
                          {f.summary}
                        </span>
                      </td>
                      <td>
                        <StatusPill
                          variant={statusToPill(f.status)}
                          label={STATUS_LABEL[f.status]}
                          size="sm"
                        />
                      </td>
                      <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {actionable && f.status === 'open' && (
                            <button className="btn btn-ghost btn-sm" onClick={() => onAck(f)}>Ack</button>
                          )}
                          {actionable && (
                            <button className="btn btn-ghost btn-sm" onClick={() => onOpenResolve(f)}>Resolve</button>
                          )}
                          {actionable && canAdmin && (
                            <button className="btn btn-ghost btn-sm" onClick={() => onOpenMarkFP(f)}>False positive</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                      No findings on this page.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="table-foot">
            <span className="hint">
              {totalRows === 0
                ? '0 findings'
                : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalRows)} of ${totalRows}`}
            </span>
            <span className="spacer" />
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                disabled={page <= 1}
                onClick={() => onPage(Math.max(1, page - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map((p) => (
                <button
                  key={p}
                  className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')}
                  onClick={() => onPage(p)}
                >{p}</button>
              ))}
              <button
                className="btn btn-ghost btn-sm btn-icon"
                disabled={page >= pageCount}
                onClick={() => onPage(Math.min(pageCount, page + 1))}
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

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

// Compact type chip with a tinted background driven by severity bucket.
function TypeChip({ type, severity }: { type: FindingType; severity: FindingSeverity }) {
  const tone = severity === 'critical' || severity === 'high'
    ? { bg: 'rgba(239, 68, 68, 0.10)', fg: 'var(--gx-danger, #dc2626)' }
    : severity === 'medium'
      ? { bg: 'rgba(245, 158, 11, 0.10)', fg: 'var(--gx-warning, #d97706)' }
      : { bg: 'var(--gx-bg-2, #f1f5f9)', fg: 'var(--gx-text-2, #475569)' }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      background: tone.bg,
      color: tone.fg,
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      {FINDING_TYPE_LABEL[type]}
    </span>
  )
}

// AR aging bars — same visual idiom as AnalyticsView.Aging, but driven by the typed buckets shape.
function AgingBars({ buckets }: { buckets: AgingBuckets }) {
  const rows: { label: string; amount: number; danger?: boolean }[] = [
    { label: 'Current', amount: buckets.current },
    { label: '1–30 days', amount: buckets.d1_30 },
    { label: '31–60 days', amount: buckets.d31_60 },
    { label: '61–90 days', amount: buckets.d61_90 },
    { label: '90+ days', amount: buckets.d90_plus, danger: true },
  ]
  const max = rows.reduce((m, r) => Math.max(m, r.amount), 0)
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div key={i} className="bar-row">
          <span className="bar-label">{r.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: (max > 0 ? (r.amount / max) * 100 : 0) + '%',
                ...(r.danger ? { background: 'var(--gx-danger)' } : null),
              }}
            />
          </div>
          <span className="bar-val">{money(r.amount)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Drilldown drawer ─────────────────────────────────────────────────────────
// Opens when a row in the Findings table is clicked. Surfaces:
//   • header: type label + severity pill + detected_at relative
//   • summary text
//   • entity context (entity_type/uuid + optional customer name + decoded detail_json fields)
//   • status flow (open → investigating → resolved/false_positive)
//   • ack + resolution blocks (when present)
//   • centralized action buttons (Ack / Resolve / Mark FP) gated by canAdmin
//
// The drawer reuses the SAME backend endpoints as the per-row buttons (ack/resolve/mark-FP)
// — the row-resolution/false-positive flow goes through the existing actionModal so the user
// gets the resolution textarea modal on top of the drawer, which keeps the drawer state
// intact until success (the parent closes the drawer on submit success).
function FindingDrawer(props: {
  seed: RaFinding                                            // the row that was clicked (immediate paint)
  detail:                                                     // fresh fetch state for /findings/{id}
    | { state: 'loading' }
    | { state: 'ok'; value: RaFinding }
    | { state: 'error'; message: string }
  customer: { id: string; name: string | null } | null       // resolved customer (null until lookup done)
  canAdmin: boolean
  onClose: () => void
  onAck: () => void
  onOpenResolve: (f: RaFinding) => void
  onOpenMarkFP: (f: RaFinding) => void
}) {
  const { seed, detail, customer, canAdmin, onClose, onAck, onOpenResolve, onOpenMarkFP } = props
  // Prefer the fresh-fetched row; fall back to the clicked row while loading or on detail error.
  const f: RaFinding = detail.state === 'ok' ? detail.value : seed
  const actionable = f.status === 'open' || f.status === 'investigating'

  return (
    <Modal
      open
      onClose={onClose}
      title={FINDING_TYPE_LABEL[f.finding_type] ?? f.finding_type}
      subtitle={f.id ? f.id : undefined}
      size="lg"
      hero={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <StatusPill variant={severityToPill(f.severity)} label={f.severity} size="sm" />
          <StatusPill variant={statusToPill(f.status)} label={STATUS_LABEL[f.status]} size="sm" />
          <span style={{ fontSize: 12, color: 'var(--gx-text-3, #64748b)' }} title={f.detected_at}>
            Detected {timeAgo(f.detected_at) || fmtDate(f.detected_at)}
          </span>
          {detail.state === 'loading' && (
            <span style={{ fontSize: 11, color: 'var(--gx-text-3)', marginLeft: 'auto' }}>Refreshing…</span>
          )}
          {detail.state === 'error' && (
            <span style={{ fontSize: 11, color: 'var(--gx-warning, #d97706)', marginLeft: 'auto' }} title={detail.message}>
              Using cached row
            </span>
          )}
        </div>
      }
      footer={
        <>
          {canAdmin && actionable && f.status === 'open' && (
            <button className="btn btn-ghost btn-md" onClick={onAck}>Acknowledge</button>
          )}
          {canAdmin && actionable && (
            <button className="btn btn-secondary btn-md" onClick={() => onOpenMarkFP(f)}>Mark False Positive…</button>
          )}
          {canAdmin && actionable && (
            <button className="btn btn-primary btn-md" onClick={() => onOpenResolve(f)}>Resolve…</button>
          )}
          <button className="btn btn-ghost btn-md" onClick={onClose}>Close</button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Summary text */}
        <section>
          <div style={drawerSectionTitleStyle}>Summary</div>
          <p style={{ margin: 0, color: 'var(--gx-text-1, #0f172a)', fontSize: 13, lineHeight: 1.5 }}>
            {f.summary || <span style={{ color: 'var(--gx-text-3)' }}>No summary recorded.</span>}
          </p>
        </section>

        {/* Entity context card */}
        <section style={drawerCardStyle}>
          <div style={drawerSectionTitleStyle}>Entity context</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <div>
              <span style={drawerLabelStyle}>Entity</span>
              <span style={{ fontSize: 11, color: 'var(--gx-text-3)', textTransform: 'uppercase', marginRight: 6 }}>
                {f.entity_type}
              </span>
              <span className="mono" style={{ fontSize: 12 }} title={f.entity_id}>
                {f.entity_id ? f.entity_id.slice(0, 8) : '—'}
              </span>
            </div>

            {customer && (
              <div>
                <span style={drawerLabelStyle}>Customer</span>
                {customer.name
                  ? <span style={{ color: 'var(--gx-text-1)' }}>{customer.name}</span>
                  : <span className="mono" style={{ fontSize: 12 }} title={customer.id}>{customer.id.slice(0, 8)}</span>}
              </div>
            )}

            <DetailJsonFields detail={f.detail_json} />
          </div>
        </section>

        {/* Status flow card */}
        <section style={drawerCardStyle}>
          <div style={drawerSectionTitleStyle}>Status flow</div>
          <StatusFlow current={f.status} />
        </section>

        {/* Acknowledgement block */}
        {f.ack_at && (
          <section style={drawerCardStyle}>
            <div style={drawerSectionTitleStyle}>Acknowledged</div>
            <div style={{ fontSize: 13, color: 'var(--gx-text-2)' }}>
              {f.ack_by && (
                <>
                  <span className="mono" style={{ fontSize: 12 }} title={f.ack_by}>{f.ack_by.slice(0, 8)}</span>
                  <span> · </span>
                </>
              )}
              <span title={f.ack_at}>{timeAgo(f.ack_at) || fmtDate(f.ack_at)}</span>
            </div>
          </section>
        )}

        {/* Resolution block */}
        {(f.status === 'resolved' || f.status === 'false_positive' || f.resolved_at) && (
          <section style={drawerCardStyle}>
            <div style={drawerSectionTitleStyle}>
              {f.status === 'false_positive' ? 'Marked false positive' : 'Resolved'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--gx-text-2)' }}>
              {f.resolved_by && (
                <>
                  <span className="mono" style={{ fontSize: 12 }} title={f.resolved_by}>{f.resolved_by.slice(0, 8)}</span>
                  <span> · </span>
                </>
              )}
              {f.resolved_at && <span title={f.resolved_at}>{timeAgo(f.resolved_at) || fmtDate(f.resolved_at)}</span>}
              {f.resolution && (
                <p style={{ marginTop: 8, marginBottom: 0, color: 'var(--gx-text-1)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {f.resolution}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}

const drawerSectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: 'var(--gx-text-3, #64748b)',
  marginBottom: 8,
}

const drawerCardStyle: React.CSSProperties = {
  padding: 12,
  background: 'var(--gx-surface-2, #f8fafc)',
  border: '1px solid var(--gx-border-subtle, #e2e8f0)',
  borderRadius: 8,
}

const drawerLabelStyle: React.CSSProperties = {
  display: 'inline-block',
  minWidth: 84,
  fontSize: 11,
  color: 'var(--gx-text-3, #64748b)',
  fontWeight: 500,
}

// Decode the known detail_json fields nicely; fall back to formatted JSON for the rest.
function DetailJsonFields({ detail }: { detail: Record<string, any> | null | undefined }) {
  if (!detail || typeof detail !== 'object' || Object.keys(detail).length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--gx-text-3)' }}>No additional context.</div>
    )
  }
  // Known keys we render nicely; everything else goes into the catch-all <pre>.
  const KNOWN = new Set(['customer_id', 'gap_days', 'activated_at', 'cycle_start', 'cycle_end'])
  const rest: Record<string, any> = {}
  for (const [k, v] of Object.entries(detail)) {
    if (!KNOWN.has(k)) rest[k] = v
  }
  const gap = typeof detail.gap_days === 'number' ? detail.gap_days : null
  const activatedAt = typeof detail.activated_at === 'string' ? detail.activated_at : null
  const cycleStart = typeof detail.cycle_start === 'string' ? detail.cycle_start : null
  const cycleEnd = typeof detail.cycle_end === 'string' ? detail.cycle_end : null
  const hasCycle = !!(cycleStart || cycleEnd)
  const restHasContent = Object.keys(rest).length > 0

  return (
    <>
      {gap != null && (
        <div>
          <span style={drawerLabelStyle}>Gap</span>
          <span>Service has been active {gap} day{gap === 1 ? '' : 's'} without billing</span>
        </div>
      )}
      {activatedAt && (
        <div>
          <span style={drawerLabelStyle}>Activated</span>
          <span title={activatedAt}>
            {timeAgo(activatedAt) || fmtDate(activatedAt)}
            <span style={{ marginLeft: 8, color: 'var(--gx-text-3)', fontSize: 11 }}>{activatedAt}</span>
          </span>
        </div>
      )}
      {hasCycle && (
        <div>
          <span style={drawerLabelStyle}>Cycle</span>
          <span>
            {cycleStart ? fmtDate(cycleStart) : '?'} → {cycleEnd ? fmtDate(cycleEnd) : '?'}
          </span>
        </div>
      )}
      {restHasContent && (
        <div>
          <div style={{ ...drawerLabelStyle, marginBottom: 4 }}>Other</div>
          <pre style={{
            margin: 0,
            padding: 8,
            background: 'var(--gx-surface-1, #ffffff)',
            border: '1px solid var(--gx-border-subtle, #e2e8f0)',
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--gx-text-2)',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>{JSON.stringify(rest, null, 2)}</pre>
        </div>
      )}
    </>
  )
}

// Visual status flow: open → investigating → resolved (or → false_positive).
// The terminal state replaces "Resolved" when status is false_positive.
function StatusFlow({ current }: { current: FindingStatus }) {
  const steps: { key: FindingStatus; label: string }[] = current === 'false_positive'
    ? [
        { key: 'open', label: 'Open' },
        { key: 'investigating', label: 'Investigating' },
        { key: 'false_positive', label: 'False positive' },
      ]
    : [
        { key: 'open', label: 'Open' },
        { key: 'investigating', label: 'Investigating' },
        { key: 'resolved', label: 'Resolved' },
      ]
  // Steps prior to (and including) `current` are highlighted.
  const order = { open: 0, investigating: 1, resolved: 2, false_positive: 2 } as const
  const currentIdx = order[current]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {steps.map((s, i) => {
        const reached = order[s.key] <= currentIdx
        const isCurrent = s.key === current
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: isCurrent ? 600 : 500,
              background: isCurrent
                ? (s.key === 'resolved'
                    ? 'rgba(16, 185, 129, 0.12)'
                    : s.key === 'false_positive'
                      ? 'rgba(100, 116, 139, 0.12)'
                      : s.key === 'investigating'
                        ? 'rgba(245, 158, 11, 0.12)'
                        : 'rgba(239, 68, 68, 0.12)')
                : reached ? 'var(--gx-surface-1, #ffffff)' : 'transparent',
              color: isCurrent
                ? (s.key === 'resolved'
                    ? 'var(--gx-success, #059669)'
                    : s.key === 'false_positive'
                      ? 'var(--gx-text-2, #475569)'
                      : s.key === 'investigating'
                        ? 'var(--gx-warning, #d97706)'
                        : 'var(--gx-danger, #dc2626)')
                : reached ? 'var(--gx-text-2)' : 'var(--gx-text-3)',
              border: '1px solid ' + (isCurrent
                ? 'transparent'
                : reached ? 'var(--gx-border-subtle, #e2e8f0)' : 'var(--gx-border-subtle, #e2e8f0)'),
            }}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span style={{
                width: 18,
                height: 1,
                background: 'var(--gx-border, #e2e8f0)',
                display: 'inline-block',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}
