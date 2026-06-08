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
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ShieldIcon, GearIcon } from '../components/icons'
import { BarChart3, ListChecks } from 'lucide-react'
import { bget, bpost, loadCustomers, type Invoice } from '../lib/billing'
import { money } from '../lib/money'
import { can as canDo, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { Button, DetailTab } from '../primitives'
import { PermissionDenied } from '../components/States'
import { PageShell, type KPISpec } from '../page-shell'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import type {
  Overview, TrendPoint, AgingBuckets, Fetched,
  RaFinding, RaScanRun, TabKey, FindingsState, DetailState, ActionModalState,
  FindingStatus, FindingType, FindingSeverity,
} from './ra/types'
import { OverviewTab } from './ra/OverviewTab'
import { FindingsTab } from './ra/FindingsTab'
import { FindingDrawer } from './ra/FindingDrawer'

// TB-1 — local tab button delegates to the canonical DetailTab primitive.
function RaTabButton({ active, onClick, icon, label, sub }: {
  active: boolean; onClick: () => void; icon: ReactNode; label: string; sub: string
}) {
  return (
    <DetailTab active={active} onSelect={onClick} icon={icon} subtitle={sub}>
      {label}
    </DetailTab>
  )
}

export default function RevenueAssuranceView({
  token, canConfigure = false, onConfigure, capabilities,
}: {
  token: string
  configVersion?: number
  canConfigure?: boolean
  onConfigure?: () => void
  capabilities?: Capabilities  // SM-2 — App's capabilities snapshot
}) {
  // SM-2 — receive caps via prop instead of refetching.
  const caps: Capabilities = capabilities ?? FULL_ACCESS
  const capsLoaded = capabilities !== undefined
  const [denied, setDenied] = useState(false)

  const [tab, setTab] = useState<TabKey>('overview')

  // Each widget is independently fetched + hideable.
  const [overview, setOverview] = useState<Fetched<Overview>>({ state: 'loading' })
  const [trend, setTrend] = useState<Fetched<TrendPoint[]>>({ state: 'loading' })
  const [aging, setAging] = useState<Fetched<AgingBuckets>>({ state: 'loading' })
  const [overdue, setOverdue] = useState<Fetched<Invoice[]>>({ state: 'loading' })
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})

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

  // ── Findings tab state ────────────────────────────────────────────────────────
  const [findings, setFindings] = useState<FindingsState>({ state: 'loading' })
  const [statusFilter, setStatusFilter] = useState<FindingStatus | 'all'>('open')
  const [typeFilter, setTypeFilter] = useState<FindingType | 'all'>('all')
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  const [lastScan, setLastScan] = useState<RaScanRun | null>(null)

  const [actionModal, setActionModal] = useState<ActionModalState>(null)

  // Drilldown drawer state. Detail is refetched on each open to pick up status transitions.
  const [drawerFinding, setDrawerFinding] = useState<RaFinding | null>(null)
  const [drawerDetail, setDrawerDetail] = useState<DetailState>({ state: 'loading' })
  const [customerNameCache, setCustomerNameCache] = useState<Record<string, string | null>>({})
  const [drawerCustomer, setDrawerCustomer] = useState<{ id: string; name: string | null } | null>(null)

  const canAdmin = canConfigure || canDo(caps, 'finding', 'edit')

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
    const sorted = [...items].sort((a, b) => {
      const ta = new Date(a.started_at).getTime(); const tb = new Date(b.started_at).getTime()
      return tb - ta
    })
    setLastScan(sorted[0] ?? null)
  }

  useEffect(() => {
    if (!capsLoaded || !canView) return
    if (tab !== 'findings') return
    setPage(1)
    void loadFindings()
    void loadLastScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, capsLoaded, canView, tab, statusFilter, typeFilter, severityFilter])

  const findingsList = findings.state === 'ok' ? findings.items : []
  const kpiCounts = useMemo(() => {
    const counts = { open: 0, investigating: 0, resolved: 0, false_positive: 0 }
    for (const f of findingsList) counts[f.status]++
    return counts
  }, [findingsList])

  const pageCount = Math.max(1, Math.ceil(findingsList.length / PAGE_SIZE))
  const pageRows = findingsList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  useEffect(() => { if (page > pageCount) setPage(1) }, [page, pageCount])

  // ── Action handlers ────────────────────────────────────────────────────────────
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
    if (kind === 'resolve' && !resolution.trim()) return
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
      setDrawerFinding(null)
      setDrawerDetail({ state: 'loading' })
      setDrawerCustomer(null)
      await loadFindings()
    } catch (e) {
      toast.error((e as Error).message || 'Action failed')
      setActionModal((m) => m ? { ...m, submitting: false } : m)
    }
  }

  async function openDrawer(f: RaFinding) {
    setDrawerFinding(f)
    setDrawerDetail({ state: 'loading' })
    setDrawerCustomer(null)
    const res = await bget<RaFinding>(token, `/api/revenue-assurance/findings/${f.id}`)
    if (!res.ok || !res.data || typeof res.data !== 'object') {
      setDrawerDetail({ state: 'error', message: `Could not fetch latest details (${res.status})` })
    } else {
      setDrawerDetail({ state: 'ok', value: res.data })
    }
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
  void setDenied

  // KPI visibility derived from the overview payload — hide each tile if its underlying
  // number is absent (vs. a real 0, which we do show).
  const ovOk = overview.state === 'ok' ? overview.value : null
  const showAr = ovOk && typeof ovOk.ar_outstanding === 'number'
  const showOverdue = ovOk && typeof ovOk.overdue_total === 'number'
  const showOverdueCount = ovOk && typeof ovOk.overdue_count === 'number'
  const showCollected = ovOk && typeof ovOk.collected_this_month === 'number'
  const collectedDelta = (ovOk && typeof ovOk.collected_this_month === 'number' && typeof ovOk.collected_prev_month === 'number')
    ? (ovOk.collected_this_month - ovOk.collected_prev_month)
    : null
  const collectedPct = (collectedDelta != null && ovOk?.collected_prev_month)
    ? (collectedDelta / ovOk.collected_prev_month) * 100
    : null

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
        <div
          role="tablist"
          aria-label="Revenue Assurance views"
          style={{
            display: 'flex',
            gap: 'var(--gx-space-2)',
            borderBottom: '1px solid var(--gx-border)',
            marginBottom: 'var(--gx-space-5)',
            marginTop: 'var(--gx-space-3)',
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

        {tab === 'overview' && (
          <OverviewTab
            ovOk={ovOk}
            trend={trend}
            aging={aging}
            overdue={overdue}
            customerNames={customerNames}
          />
        )}

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

        {actionModal && (
          <Modal
            open
            onClose={() => actionModal.submitting ? undefined : setActionModal(null)}
            title={actionModal.kind === 'resolve' ? 'Resolve finding' : 'Mark as false positive'}
            subtitle={actionModal.finding.summary}
            size="md"
            footer={
              <>
                <Button variant="ghost" size="md"
                  onClick={() => setActionModal(null)}
                  disabled={actionModal.submitting}>Cancel</Button>
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
            <label className="field" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-3)' }}>
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
