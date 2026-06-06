import { useEffect, useState } from 'react'
import { bget, bpost, type Subscription, type Invoice } from '../lib/billing'
import { money, toMinor } from '../lib/money'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied, NotFound } from '../components/States'
import { PageShell, type KPISpec, type StatusSummary, type StatusSummaryVariant } from '../page-shell'
import {
  ChevronLeftIcon, UsersIcon, ReceiptIcon, PhoneIcon,
  ClockIcon, CreditCardIcon, GearIcon,
  ServerIcon, FolderIcon, WarningIcon,
  InfoIcon, CheckIcon, MessageIcon, PaperclipIcon,
  ShieldIcon, LayersIcon, MailIcon, ActivityIcon,
} from '../components/icons'
import { useI18n } from '../lib/i18n'
import { usePageConfig } from '../lib/pageConfig'
import { Button, DetailTab, KPITile, StatusPill } from '../primitives'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
// Canonical Object Detail tabs (file 10 §Object Detail). These nine render BEFORE the
// CustomerView's own related-record tabs (accounts/contacts/sites/contracts/slas). Each
// component self-fetches its slice from a documented endpoint and renders its own empty
// state — see frontend/src/views/customer-tabs/.
import OverviewTab from './customer-tabs/OverviewTab'
import TimelineTab from './customer-tabs/TimelineTab'
import TasksTab from './customer-tabs/TasksTab'
import CommentsTab from './customer-tabs/CommentsTab'
import AttachmentsTab from './customer-tabs/AttachmentsTab'
import ApprovalsTab from './customer-tabs/ApprovalsTab'
import RelatedTab from './customer-tabs/RelatedTab'
import CommunicationsTab from './customer-tabs/CommunicationsTab'
import AuditTab from './customer-tabs/AuditTab'
import { fmtDate } from '../lib/time'

// CustomerView — the single-customer workspace (doc 17 "Customer 360"). One screen for an operator
// to see ONE customer's whole life: header money summary, services, subscriptions, invoices (with
// issue / record-payment affordances), related CRM records and the audit activity. Driven by the
// consolidated GET /api/customers/{id}/360 payload; the Services list falls back to /api/services
// when the 360 build doesn't carry that field yet (lanes land together). Money is luma → money().

type Profile = { id: string; status?: string | null; name?: string; title?: string; [k: string]: any }
type Service = { id: string; name?: string; type?: string; status?: string | null; activated_at?: string | null }
type Summary = {
  currency?: string
  total_billed?: number
  total_paid?: number
  outstanding?: number
  overdue_count?: number
  subscription_count?: number
  invoice_count?: number
}
type C360 = {
  profile: Profile
  subscriptions: Subscription[]
  invoices: Invoice[]
  summary: Summary
  related: Record<string, number>
  services?: Service[]
}

// Phase A.2 — per-account balance + consolidated subtree contracts. The backend serializes Decimal
// columns as STRINGS in MAJOR units (e.g. "1234.56") to preserve precision; we keep them as strings
// in state and format on render.
type Account = {
  id: string
  type?: string | null
  currency?: string | null
  billing_cycle?: string | null
  status?: string | null
  holder_party_name?: string | null
  parent_account_id?: string | null
  [k: string]: any
}
type BalanceSnapshot = {
  current_balance: string
  credit_limit: string
  available_credit: string
  balance_updated_at: string | null
}
type ConsolidatedBalance = {
  root_account_id: string
  root_balance: string
  consolidated_balance: string
  consolidated_credit_limit: string
  subtree_size: number
}

// Customer 360 inline tabs.
// File 10 (Object Detail Standard) mandates a canonical 9-tab set on every detail page
// BEFORE any object-specific tabs. The canonical nine come first, then the five
// CustomerView-specific related-record tabs round out the list.
// Tabs are lazy-loaded on first activation and cached.
type CanonicalTabKey =
  | 'overview' | 'timeline' | 'tasks' | 'comments' | 'attachments'
  | 'approvals' | 'related' | 'communications' | 'audit'
type CustomTabKey = 'accounts' | 'contacts' | 'sites' | 'contracts' | 'slas'
type TabKey = CanonicalTabKey | CustomTabKey
const CANONICAL_TAB_ORDER: CanonicalTabKey[] = [
  'overview', 'timeline', 'tasks', 'comments', 'attachments',
  'approvals', 'related', 'communications', 'audit',
]
const CUSTOM_TAB_ORDER: CustomTabKey[] = ['accounts', 'contacts', 'sites', 'contracts', 'slas']
const TAB_ORDER: TabKey[] = [...CANONICAL_TAB_ORDER, ...CUSTOM_TAB_ORDER]
// Canonical tabs self-fetch from their own components — the parent doesn't pre-load
// their data, so we only register the custom-tab keys in the legacy loader.
const CUSTOM_TAB_SET = new Set<TabKey>(CUSTOM_TAB_ORDER)

// Contact / Site / Contract are entity records: backend response is a plain list of
// { id, status, owner_node_id, data: {...} } where ref-fields land in `data`.
type EntityRow = { id: string; status?: string | null; owner_node_id?: string | null; data?: Record<string, any>; [k: string]: any }

// Helpdesk ticket shape we render in the SLAs tab (subset of helpdesk.ts `Ticket`).
type SlaRow = { id: string; subject?: string; status?: string | null; priority?: string | null; customer_id?: string | null; sla_due_at?: string | null; sla_breached?: boolean | null; created_at?: string | null }


// Relative-time formatter for balance_updated_at; mirrors HomeView's relTime() so the
// snapshot card reads consistently with the rest of the app.
function relTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (isNaN(ts)) return ''
  const d = Math.max(0, Date.now() - ts) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

// DF-6 — balance is a Decimal string in MAJOR units (֏). Canonical formatter
// in lib/money.ts; local alias keeps existing call sites unchanged.
import { moneyDecStr as moneyDecimal } from '../lib/money'

// NEGATIVE = customer owes us (red), POSITIVE = credit on account (green), zero = default.
function balanceTone(s: string | null | undefined): string {
  if (s === null || s === undefined || s === '') return 'var(--gx-text-1)'
  const n = Number(s)
  if (!isFinite(n) || n === 0) return 'var(--gx-text-1)'
  return n < 0 ? 'var(--gx-danger)' : 'var(--gx-success)'
}

// Numeric value of a Decimal-string for math (e.g. % of limit). Treat missing as 0.
function decimalNum(s: string | null | undefined): number {
  if (s === null || s === undefined || s === '') return 0
  const n = Number(s)
  return isFinite(n) ? n : 0
}

// Generic CRM/billing status → StatusPill variant. Statuses are configurable so this
// only tints the well-known verbs and falls back to `info` for everything else.
type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapCustomerStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (['ACTIVE', 'PAID', 'RESOLVED', 'WON'].includes(v)) return 'active'
  if (['OVERDUE', 'CANCELLED', 'VOID', 'CHURNED', 'LOST'].includes(v)) return 'critical'
  if (['SUSPENDED'].includes(v)) return 'degraded'
  if (['DRAFT', 'NEW', 'PROSPECT'].includes(v)) return 'neutral'
  return 'info'
}

export default function CustomerView({ token, customerId, onBack, configVersion = 0, canConfigure = false, onConfigure, capabilities = FULL_ACCESS, onOpenInvoices }: {
  token: string
  customerId: string
  onBack: () => void
  configVersion?: number
  canConfigure?: boolean
  onConfigure?: () => void
  /** Per-entity caps; Issue / Record Payment buttons gate on invoice.edit. */
  capabilities?: Capabilities
  /** Optional: jump to the Invoices list filtered by this customer's status (clickable invoice number). */
  onOpenInvoices?: (initialStatus?: string) => void
}) {
  const canEditInvoice = can(capabilities, 'invoice', 'edit')
  const { t } = useI18n()
  // Hook called so the Configure button (via BESPOKE_PAGE_KEYS) lights up for this page.
  usePageConfig(token, 'customer', configVersion)
  const [data, setData] = useState<C360 | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState('')
  const [fatal, setFatal] = useState<null | 'denied' | 'notfound'>(null)
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null)
  // Phase A.2 — Financial Summary card. Per-customer accounts via /api/accounts?customer={id};
  // per-account balance snapshot via /api/accounts/{id}/balance; consolidated subtree via
  // /api/accounts/{id}/balance/consolidated on the root account when there's a hierarchy.
  // States: undefined = not loaded yet, null = unavailable (403/404/empty), object = real data.
  const [accounts, setAccounts] = useState<Account[] | null | undefined>(undefined)
  const [balances, setBalances] = useState<Record<string, BalanceSnapshot | null>>({})
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [consolidated, setConsolidated] = useState<ConsolidatedBalance | null>(null)
  const [balanceFatal, setBalanceFatal] = useState(false)
  const [showConsolidated, setShowConsolidated] = useState(false)

  // Customer 360 inline tabs (Accounts · Contacts · Sites · Contracts · SLAs).
  // Each tab fetches its own slice lazily on first activation and caches the result.
  // tabData[tab] === undefined → not loaded yet; null → unavailable (403/404/error); array → real data.
  // tabFatal[tab] carries a non-empty string when the endpoint is denied / missing so we
  // render the right muted state without losing the count badge for tabs that did load.
  // Default tab is the first canonical tab — "Overview" per file 10.
  const [tab, setTab] = useState<TabKey>('overview')
  // Canonical tabs self-fetch (no count badge); we still keep an entry for each so the
  // Record<TabKey,...> shape is complete. They stay `undefined` forever and the
  // CustomerTabButton renders no count badge when rows is null/undefined.
  const [tabData, setTabData] = useState<Record<TabKey, any[] | null | undefined>>({
    overview: undefined, timeline: undefined, tasks: undefined, comments: undefined, attachments: undefined,
    approvals: undefined, related: undefined, communications: undefined, audit: undefined,
    accounts: undefined, contacts: undefined, sites: undefined, contracts: undefined, slas: undefined,
  })
  const [tabFatal, setTabFatal] = useState<Record<TabKey, '' | 'denied' | 'notfound' | 'error'>>({
    overview: '', timeline: '', tasks: '', comments: '', attachments: '',
    approvals: '', related: '', communications: '', audit: '',
    accounts: '', contacts: '', sites: '', contracts: '', slas: '',
  })

  async function loadAccountsAndBalances() {
    setAccounts(undefined); setBalances({}); setSelectedAccountId(null)
    setConsolidated(null); setBalanceFatal(false); setShowConsolidated(false)
    const ar = await bget<Account[]>(token, `/api/accounts?customer=${encodeURIComponent(customerId)}`)
    if (ar.status === 403 || ar.status === 404 || !ar.ok || !Array.isArray(ar.data) || ar.data.length === 0) {
      setAccounts(ar.ok && Array.isArray(ar.data) ? ar.data : null)
      return
    }
    const accts = ar.data
    setAccounts(accts)
    setSelectedAccountId(accts[0].id)
    // Parallel balance fetch — each row independent; one failure doesn't block the others.
    const results = await Promise.all(
      accts.map(async (a) => {
        const r = await bget<BalanceSnapshot>(token, `/api/accounts/${a.id}/balance`)
        if (r.ok && r.data) return [a.id, r.data] as const
        return [a.id, null] as const
      })
    )
    const map: Record<string, BalanceSnapshot | null> = {}
    let anyOk = false
    for (const [id, snap] of results) { map[id] = snap; if (snap) anyOk = true }
    setBalances(map)
    if (!anyOk) setBalanceFatal(true)
    // Consolidated: only meaningful when there's a parent/child hierarchy. Fetch against the root
    // (account with no parent) or fall back to the first account. Degrades silently on 404.
    if (accts.length > 1) {
      const root = accts.find((a) => !a.parent_account_id) ?? accts[0]
      const cr = await bget<ConsolidatedBalance>(token, `/api/accounts/${root.id}/balance/consolidated`)
      if (cr.ok && cr.data) setConsolidated(cr.data)
    }
  }

  // Lazy-load a single tab's data. Idempotent: if already loaded or in-flight, no-op.
  // Each tab maps to a best-effort endpoint; we keep the failure modes uniform so the
  // tab body can render the right muted state (denied / not-found / empty / data).
  async function loadTab(key: TabKey) {
    // Canonical Object Detail tabs self-fetch from their own components — skip them here.
    if (!CUSTOM_TAB_SET.has(key)) return
    if (tabData[key] !== undefined) return  // already loaded (or explicitly null)
    // Mark in-flight (still undefined → keep skeleton; switch to a sentinel via a no-op set)
    // We use a closure-local optimistic guard rather than another state — concurrent
    // clicks on the same tab are harmless because bget is cheap and idempotent.
    const setOne = (rows: any[] | null, why: '' | 'denied' | 'notfound' | 'error' = '') => {
      setTabData((p) => ({ ...p, [key]: rows }))
      setTabFatal((p) => ({ ...p, [key]: why }))
    }
    if (key === 'accounts') {
      // Mirror loadAccountsAndBalances: same endpoint shape, but as a flat list for the table.
      const r = await bget<Account[]>(token, `/api/accounts?customer=${encodeURIComponent(customerId)}`)
      if (r.status === 403) return setOne(null, 'denied')
      if (r.status === 404) return setOne(null, 'notfound')
      if (!r.ok || !Array.isArray(r.data)) return setOne(null, 'error')
      setOne(r.data)
      return
    }
    if (key === 'contacts' || key === 'sites' || key === 'contracts') {
      // Entity endpoints don't accept a `customer` query — they accept a GXL `filter` expression.
      // We try filter-first; if that 4xxs we fall back to fetch-all + client-side filter so the
      // tab still works on backends that haven't grown the filter clause we ask for.
      const slug = key  // /api/contacts, /api/sites, /api/contracts
      const filterExpr = encodeURIComponent(`customer == "${customerId}"`)
      let r = await bget<EntityRow[]>(token, `/api/${slug}?filter=${filterExpr}&limit=500`)
      if (r.status === 403) return setOne(null, 'denied')
      if (r.status === 404) return setOne(null, 'notfound')
      if (!r.ok || !Array.isArray(r.data)) {
        // Fall back to fetch-all and client-filter (treats a busted filter as "fetch everything").
        r = await bget<EntityRow[]>(token, `/api/${slug}?limit=500`)
        if (r.status === 403) return setOne(null, 'denied')
        if (r.status === 404) return setOne(null, 'notfound')
        if (!r.ok || !Array.isArray(r.data)) return setOne(null, 'error')
      }
      // Always client-filter as belt-and-braces; the entity `customer` ref-field stores the
      // customer record id as a string in `data.customer`. If the endpoint already filtered
      // server-side, this is a no-op pass-through.
      const rows = (r.data ?? []).filter((row) => {
        const d = row.data ?? {}
        return d.customer === customerId || d.customer_id === customerId
      })
      setOne(rows)
      return
    }
    if (key === 'slas') {
      // Helpdesk doesn't expose a customer filter — fetch and client-filter. Cap to keep this
      // bounded; the SLAs tab is meant to highlight problem tickets, not be the full list.
      const r = await bget<SlaRow[]>(token, `/api/helpdesk/tickets?limit=200`)
      if (r.status === 403) return setOne(null, 'denied')
      if (r.status === 404) return setOne(null, 'notfound')
      if (!r.ok || !Array.isArray(r.data)) return setOne(null, 'error')
      const rows = r.data.filter((t) => t.customer_id === customerId)
      setOne(rows)
      return
    }
  }

  async function load() {
    setError(''); setFatal(null); setData(null)
    const res = await bget<C360>(token, `/api/customers/${customerId}/360`)
    if (res.status === 403) { setFatal('denied'); return }
    if (res.status === 404) { setFatal('notfound'); return }
    if (!res.ok || !res.data) { setError(t('cust.loadError', 'Failed to load this customer')); return }
    const c = res.data
    setData(c)
    // Services: prefer the 360 field; fall back to the services endpoint when 360 doesn't carry it.
    if (Array.isArray(c.services)) {
      setServices(c.services)
    } else {
      const sv = await bget<Service[]>(token, `/api/services?customer=${encodeURIComponent(customerId)}`)
      setServices(sv.ok && Array.isArray(sv.data) ? sv.data : [])
    }
  }

  useEffect(() => { load() }, [token, customerId])
  // Financial summary lives off a separate endpoint family — fetch in parallel with the 360 load
  // so it doesn't block the rest of the page. Refreshes when the customer id changes.
  useEffect(() => { loadAccountsAndBalances() }, [token, customerId])
  // Tabs: reset the cache when the customer changes, then eager-load the default tab so the
  // operator sees data on first paint (the other four still wait for their first click).
  useEffect(() => {
    setTab('overview')
    setTabData({
      overview: undefined, timeline: undefined, tasks: undefined, comments: undefined, attachments: undefined,
      approvals: undefined, related: undefined, communications: undefined, audit: undefined,
      accounts: undefined, contacts: undefined, sites: undefined, contracts: undefined, slas: undefined,
    })
    setTabFatal({
      overview: '', timeline: '', tasks: '', comments: '', attachments: '',
      approvals: '', related: '', communications: '', audit: '',
      accounts: '', contacts: '', sites: '', contracts: '', slas: '',
    })
    // No eager-load: the default canonical tab (Overview) renders from the in-memory
    // /360 profile already being fetched in parallel. Custom tabs lazy-load on click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, customerId])
  // Whenever the active tab changes, ensure its data is loaded. No-op if cached.
  useEffect(() => { loadTab(tab) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab])

  async function issue(id: string) {
    try {
      await bpost(token, `/api/invoices/${id}/issue`)
      toast.success(t('cust.issued', 'Invoice issued'))
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  if (fatal === 'denied') return <PermissionDenied message={t('cust.denied', "You don't have permission to view this customer.")} />
  if (fatal === 'notfound') return <NotFound what={t('cust.what', 'customer')} message={t('cust.notFoundMsg', 'This customer may have been moved, renamed, or deleted.')} />

  const p = data?.profile
  const name = p?.name ?? p?.title ?? (p ? p.id.slice(0, 8) : '')
  const sum = data?.summary ?? {}
  const subs = data?.subscriptions ?? []
  const invoices = data?.invoices ?? []
  const related = Object.entries(data?.related ?? {})

  // Map the customer's CRM status onto the PageShell statusSummary chip variants.
  function toSummaryVariant(v: PillVariant): StatusSummaryVariant {
    if (v === 'active') return 'success'
    if (v === 'degraded') return 'warning'
    if (v === 'critical') return 'danger'
    if (v === 'info') return 'info'
    return 'neutral'
  }
  const statusSummary: StatusSummary | undefined = p?.status
    ? { label: p.status, variant: toSummaryVariant(mapCustomerStatus(p.status)) }
    : undefined

  // Subtitle: short id mono token (kept literal in subtitle since PageShell subtitle is string).
  const subtitle = p?.id ? `Customer 360 · ${p.id.slice(0, 8)}` : 'Customer 360'

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['CRM', t('nav.customers', 'Customers'), name || t('cust.title', 'Customer')]}
      icon={<UsersIcon size={18} />}
      title={name || t('cust.title', 'Customer')}
      subtitle={subtitle}
      statusSummary={statusSummary}
      secondaryActions={[
        ...(canConfigure && onConfigure ? [{ label: 'Configure', icon: <GearIcon size={13} />, onClick: onConfigure }] : []),
        { label: t('nav.customers', 'Customers'), icon: <ChevronLeftIcon size={13} />, onClick: onBack },
      ]}
    >
        {error && <ErrorBanner message={error} onRetry={load} />}
        {!data && !error && (
          <>
            {/* Per-section loading skeletons — mirrors the rendered KPI strip + cards below */}
            <div className="kpi-strip" style={{ marginBottom: 'var(--gx-space-20)' }} aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
              {[0, 1, 2].map((i) => (
                <KPITile key={i} label="" value="" size="sm" loading />
              ))}
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-7)', width: 140, margin: 'var(--gx-space-18) 0 var(--gx-space-5)' }} />
                <div className="card" style={{ padding: 'var(--gx-space-7)' }}>
                  <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '92%', marginBottom: 'var(--gx-space-4)' }} />
                  <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '80%', marginBottom: 'var(--gx-space-4)' }} />
                  <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '60%' }} />
                </div>
              </div>
            ))}
          </>
        )}

        {data && (
          <>
            {/* 360 stat KPIs — outstanding / billed / paid / related. Each clickable
                tile drills through to that customer's invoices filtered by status. */}
            <div className="kpi-strip" style={{ marginBottom: 'var(--gx-space-20)' }}>
              <KPITile
                icon={CreditCardIcon}
                label={t('cust.outstanding', 'Outstanding')}
                value={money(sum.outstanding)}
                subtitle={(sum.overdue_count ?? 0) > 0
                  ? `${sum.overdue_count} ${t('cust.overdue', 'overdue invoice(s)')}`
                  : undefined}
                size="sm"
                danger={(sum.outstanding ?? 0) > 0}
                onClick={onOpenInvoices ? () => onOpenInvoices('OVERDUE') : undefined}
                ariaLabel={`Outstanding amount. Click to see overdue invoices.`}
              />
              <KPITile
                label={t('cust.billed', 'Total billed')}
                value={money(sum.total_billed)}
                subtitle={sum.invoice_count != null
                  ? `${sum.invoice_count} ${t('cust.invoiceCount', 'invoice(s)')}`
                  : undefined}
                size="sm"
                onClick={onOpenInvoices ? () => onOpenInvoices() : undefined}
                ariaLabel={`Total billed. Click to see all invoices.`}
              />
              <KPITile
                label={t('cust.paid', 'Total paid')}
                value={money(sum.total_paid)}
                subtitle={sum.subscription_count != null
                  ? `${sum.subscription_count} ${t('cust.subCount', 'active subscription(s)')}`
                  : undefined}
                size="sm"
                onClick={onOpenInvoices ? () => onOpenInvoices('PAID') : undefined}
                ariaLabel={`Total paid. Click to see paid invoices.`}
              />
              {/* Related CRM counts — non-clickable composite (multiple kinds, not a single filter). */}
              {related.filter(([, n]) => n > 0).length > 0 && (
                <KPITile
                  label={t('cust.related', 'Related records')}
                  value=" "
                  size="sm"
                  accessory={
                    <div style={{ display: 'flex', gap: 'var(--gx-space-3)', flexWrap: 'wrap' }}>
                      {related.filter(([, n]) => n > 0).map(([key, n]) => (
                        <span key={key} className="pill">{key} · {n}</span>
                      ))}
                    </div>
                  }
                />
              )}
            </div>

            {/* Phase A.2 Financial Summary — snapshot only (no recompute; AccountsView owns that).
                Renders when at least one account+balance is resolved; degrades muted otherwise. */}
            <div className="section-head">
              <CreditCardIcon size={16} className="section-icon" />
              {t('cust.financialSummary', 'Financial summary')}
            </div>
            <FinancialSummaryCard
              accounts={accounts}
              balances={balances}
              selectedAccountId={selectedAccountId}
              setSelectedAccountId={setSelectedAccountId}
              consolidated={consolidated}
              showConsolidated={showConsolidated}
              setShowConsolidated={setShowConsolidated}
              balanceFatal={balanceFatal}
              t={t}
            />

            {/* Customer 360 inline tabs — Accounts · Contacts · Sites · Contracts · SLAs.
                Each tab lazy-loads on first activation; counts come from the loaded data.
                Tabs that haven't been visited yet show a blank badge until clicked. */}
            <div
              role="tablist"
              aria-label={t('cust.relatedTabs', 'Related records')}
              style={{
                display: 'flex',
                gap: 'var(--gx-space-2)',
                borderBottom: '1px solid var(--gx-border)',
                marginTop: 'var(--gx-space-20)',
                marginBottom: 'var(--gx-space-5)',
                paddingBottom: 0,
                overflowX: 'auto',
              }}
            >
              {TAB_ORDER.map((k) => {
                const rows = tabData[k]
                const count = Array.isArray(rows) ? rows.length : null
                return (
                  <CustomerTabButton
                    key={k}
                    active={tab === k}
                    label={tabLabel(k, t)}
                    count={count}
                    icon={tabIcon(k)}
                    onClick={() => setTab(k)}
                  />
                )
              })}
            </div>

            <div role="tabpanel" aria-label={tabLabel(tab, t)} style={{ marginBottom: 'var(--gx-space-20)' }}>
              <CustomerTabBody
                tab={tab}
                rows={tabData[tab]}
                fatal={tabFatal[tab]}
                t={t}
                token={token}
                customerId={customerId}
                profile={p ?? null}
              />
            </div>

            {/* Services */}
            <div className="section-head">
              <ClockIcon size={16} className="section-icon" />
              {t('cust.services', 'Services')}
            </div>
            {services.length === 0
              ? <EmptyState title={t('cust.noServices', 'No services yet.')} message={t('cust.noServices.msg', 'Activated services for this customer will be listed here.')} />
              : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="grid-wrap">
                    <table className="grid">
                      <thead><tr>
                        <th scope="col">{t('cust.service', 'Service')}</th>
                        <th scope="col">{t('cust.type', 'Type')}</th>
                        <th scope="col">{t('common.status', 'Status')}</th>
                        <th scope="col">{t('cust.activated', 'Activated')}</th>
                      </tr></thead>
                      <tbody>
                        {services.map((sv) => (
                          <tr key={sv.id}>
                            <td>{sv.name ?? <span className="mono">{sv.id.slice(0, 8)}</span>}</td>
                            <td>{sv.type ?? '—'}</td>
                            <td>{sv.status ? <StatusPill variant={mapCustomerStatus(sv.status)} label={sv.status} size="sm" /> : <span>—</span>}</td>
                            <td><span className="mono">{fmtDate(sv.activated_at)}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            {/* Subscriptions */}
            <div className="section-head">
              <ReceiptIcon size={16} className="section-icon" />
              {t('nav.subscriptions', 'Subscriptions')}
            </div>
            {subs.length === 0
              ? <EmptyState title={t('cust.noSubs', 'No subscriptions yet.')} message={t('cust.noSubs.msg', 'Active subscriptions tied to this customer will appear here.')} />
              : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="grid-wrap">
                    <table className="grid">
                      <thead><tr>
                        <th scope="col">{t('subs.plan', 'Plan')}</th>
                        <th scope="col" className="num">{t('subs.amount', 'Amount')}</th>
                        <th scope="col">{t('accounts.cycle', 'Cycle')}</th>
                        <th scope="col">{t('common.status', 'Status')}</th>
                      </tr></thead>
                      <tbody>
                        {subs.map((s) => (
                          <tr key={s.id}>
                            <td>{s.plan_name ?? '—'}</td>
                            <td className="num"><span className="mono tnum">{money(s.amount)}</span></td>
                            <td>{s.cycle ?? '—'}</td>
                            <td>{s.status ? <StatusPill variant={mapCustomerStatus(s.status)} label={s.status} size="sm" /> : <span>—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            {/* Invoices — with issue / record-payment affordances */}
            <div className="section-head">
              <ReceiptIcon size={16} className="section-icon" />
              {t('nav.invoices', 'Invoices')}
            </div>
            {invoices.length === 0
              ? <EmptyState title={t('cust.noInvoices', 'No invoices yet.')} message={t('cust.noInvoices.msg', 'Invoices issued to this customer will be listed here.')} />
              : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="grid-wrap">
                    <table className="grid">
                      <thead><tr>
                        <th scope="col">{t('invoices.number', 'Invoice')}</th>
                        <th scope="col">{t('common.status', 'Status')}</th>
                        <th scope="col" className="num">{t('invoices.total', 'Total')}</th>
                        <th scope="col">{t('invoices.due', 'Due')}</th>
                        <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                      </tr></thead>
                      <tbody>
                        {invoices.map((inv) => {
                          const st = (inv.status ?? '').toUpperCase()
                          const num = inv.number ?? inv.id.slice(0, 8)
                          return (
                            <tr key={inv.id}>
                              <td>
                                {onOpenInvoices
                                  ? <a className="mono" style={{ cursor: 'pointer', color: 'var(--gx-link)' }} onClick={() => onOpenInvoices(inv.status ?? undefined)}>{num}</a>
                                  : <span className="mono">{num}</span>}
                              </td>
                              <td>{inv.status ? <StatusPill variant={mapCustomerStatus(inv.status)} label={inv.status} size="sm" /> : <span>—</span>}</td>
                              <td className="num"><span className="mono tnum">{money(inv.total)}</span></td>
                              <td><span className="mono">{fmtDate(inv.due_at)}</span></td>
                              <td className="actions-col row-actions">
                                {canEditInvoice && st === 'DRAFT' && <Button variant="primary" size="sm" onClick={() => issue(inv.id)}>{t('cust.issue', 'Issue')}</Button>}
                                {canEditInvoice && (st === 'ISSUED' || st === 'OVERDUE') && <Button variant="primary" size="sm" onClick={() => setPayInvoice(inv)}>{t('cust.recordPayment', 'Record payment')}</Button>}
                              </td>
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

        {payInvoice && (
          <PaymentModal token={token} invoiceId={payInvoice.id} onClose={() => setPayInvoice(null)} onDone={() => { setPayInvoice(null); load() }} />
        )}
    </PageShell>
  )
}

// Compact record-payment modal — mirrors the InvoicesView affordance against POST .../payments.
function PaymentModal({ token, invoiceId, onClose, onDone }: { token: string; invoiceId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('card')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!amount || saving) return
    setSaving(true)
    try {
      await bpost(token, `/api/invoices/${invoiceId}/payments`, { amount: toMinor(amount), method, note: note || undefined })
      toast.success(t('cust.paymentRecorded', 'Payment recorded'))
      onDone()
    } catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('cust.recordPayment', 'Record payment')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="primary" size="md" disabled={saving || !amount} onClick={submit}>{saving ? t('common.saving', 'Saving…') : t('cust.record', 'Record')}</Button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field"><span>{t('cust.amount', 'Amount (֏)')}</span><input className="inp inp-md inp-numeric" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t('cust.amount', 'Amount (֏)')} autoFocus /></label>
        <label className="field"><span>{t('cust.method', 'Method')}</span>
          <select className="inp inp-md" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t('cust.method', 'Method')}>
            <option value="card">{t('cust.methodCard', 'Card')}</option>
            <option value="transfer">{t('cust.methodTransfer', 'Transfer')}</option>
            <option value="cash">{t('cust.methodCash', 'Cash')}</option>
          </select>
        </label>
        <label className="field"><span>{t('cust.note', 'Note')}</span><input className="inp inp-md" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common.optional', 'optional')} aria-label={t('cust.note', 'Note')} /></label>
      </div>
    </Modal>
  )
}

// Phase A.2 Financial Summary card — read-only snapshot of balance / credit limit / available
// credit / last computed. Sign convention: NEGATIVE current_balance ⇒ customer owes us (red),
// POSITIVE ⇒ credit on account (green). When the customer has multiple accounts, an account picker
// lets the operator switch; a "Consolidated subtree" toggle flips to the root-account aggregate
// (via /api/accounts/{root}/balance/consolidated). Degrades muted on 403/404 / no accounts.
function FinancialSummaryCard({
  accounts, balances, selectedAccountId, setSelectedAccountId,
  consolidated, showConsolidated, setShowConsolidated, balanceFatal, t,
}: {
  accounts: Account[] | null | undefined
  balances: Record<string, BalanceSnapshot | null>
  selectedAccountId: string | null
  setSelectedAccountId: (id: string) => void
  consolidated: ConsolidatedBalance | null
  showConsolidated: boolean
  setShowConsolidated: (v: boolean) => void
  balanceFatal: boolean
  t: (key: string, fallback?: string) => string
}) {
  // Skeleton while accounts is loading.
  if (accounts === undefined) {
    return (
      <div className="card" style={{ padding: 'var(--gx-space-7)' }} aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
        <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '40%', marginBottom: 'var(--gx-space-5)' }} />
        <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-18)', width: '60%', marginBottom: 'var(--gx-space-4)' }} />
        <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', width: '80%' }} />
      </div>
    )
  }
  // No account linked → small muted note, no card chrome.
  if (accounts === null || accounts.length === 0) {
    return <p className="muted">{t('cust.noBillingAccount', 'No billing account linked.')}</p>
  }
  // Accounts loaded but every /balance call failed (403/404) → muted unavailable state.
  if (balanceFatal && !consolidated) {
    return <p className="muted">{t('cust.balanceUnavailable', 'Financial summary unavailable.')}</p>
  }

  const selected = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0]
  const snap = balances[selected.id] ?? null

  // Consolidated mode: show subtree aggregate. available_credit is derived per the A.2 spec:
  // MIN(credit_limit, MAX(0, credit_limit + current_balance)).
  let current: string | null
  let limit: string | null
  let available: string | null
  let updatedAt: string | null
  let isConsolidated = false
  if (showConsolidated && consolidated) {
    current = consolidated.consolidated_balance
    limit = consolidated.consolidated_credit_limit
    const ln = decimalNum(limit); const cn = decimalNum(current)
    available = String(Math.min(ln, Math.max(0, ln + cn)))
    updatedAt = null
    isConsolidated = true
  } else if (snap) {
    current = snap.current_balance
    limit = snap.credit_limit
    available = snap.available_credit
    updatedAt = snap.balance_updated_at
  } else {
    // Selected account's snapshot specifically unavailable (other accounts may still have data).
    return <p className="muted">{t('cust.balanceUnavailable', 'Financial summary unavailable.')}</p>
  }

  // Pct-of-limit for the available-credit subtitle. Hide when limit is 0 / missing.
  const limitN = decimalNum(limit)
  const availN = decimalNum(available)
  const pct = limitN > 0 ? Math.round((availN / limitN) * 100) : null

  const accountLabel = (a: Account) => {
    const parts = [a.type ?? null, a.currency ?? null, a.billing_cycle ?? null].filter(Boolean).join(' · ')
    return parts || a.id.slice(0, 8)
  }

  return (
    <div className="card" style={{ padding: 'var(--gx-space-7)' }}>
      {/* Toolbar: account picker (when 2+) + consolidated toggle (when subtree data exists). */}
      {(accounts.length > 1 || consolidated) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', flexWrap: 'wrap', marginBottom: 'var(--gx-space-6)' }}>
          {accounts.length > 1 && !showConsolidated && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)' }}>
              <span>{t('cust.account', 'Account')}</span>
              <select
                className="inp inp-sm"
                value={selected.id}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                aria-label={t('cust.account', 'Account')}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{accountLabel(a)}</option>
                ))}
              </select>
            </label>
          )}
          {consolidated && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)', color: 'var(--gx-text-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showConsolidated}
                onChange={(e) => setShowConsolidated(e.target.checked)}
                aria-label={t('cust.consolidated', 'Consolidated subtree')}
              />
              <span>
                {t('cust.consolidated', 'Consolidated subtree')}
                {consolidated.subtree_size > 0 && (
                  <span className="muted" style={{ marginLeft: 'var(--gx-space-2)' }}>· {consolidated.subtree_size}</span>
                )}
              </span>
            </label>
          )}
        </div>
      )}

      {/* Three-up money summary. Grid auto-wraps on narrow viewports. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--gx-space-7)' }}>
        <div>
          <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 'var(--gx-space-2)' }}>
            {isConsolidated ? t('cust.consolidatedBalance', 'Consolidated balance') : t('cust.balance', 'Balance')}
          </div>
          <div className="mono tnum" style={{ fontSize: 'var(--gx-text-xl)', fontWeight: 'var(--gx-weight-semibold)', color: balanceTone(current) }}>
            {moneyDecimal(current)}
          </div>
          {(() => {
            const n = decimalNum(current)
            if (n === 0) return null
            return (
              <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-1)' }}>
                {n < 0 ? t('cust.owes', 'Owes') : t('cust.credit', 'Credit')}
              </div>
            )
          })()}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 'var(--gx-space-2)' }}>
            {t('cust.creditLimit', 'Credit limit')}
          </div>
          <div className="mono tnum" style={{ fontSize: 'var(--gx-text-lg)', color: 'var(--gx-text-2)' }}>
            {moneyDecimal(limit)}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 'var(--gx-space-2)' }}>
            {t('cust.availableCredit', 'Available credit')}
          </div>
          <div className="mono tnum" style={{ fontSize: 'var(--gx-text-lg)' }}>
            {moneyDecimal(available)}
          </div>
          {pct !== null && (
            <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-1)' }}>
              {pct}% {t('cust.ofLimit', 'of limit')}
            </div>
          )}
        </div>
      </div>

      {/* Last computed footer — muted, single line. Only shown for per-account snapshots; the
          consolidated endpoint doesn't carry a single updated_at. */}
      <div className="muted" style={{ fontSize: 'var(--gx-text-11)', marginTop: 'var(--gx-space-6)' }}>
        {isConsolidated
          ? t('cust.consolidatedNote', 'Aggregated across subtree accounts.')
          : updatedAt
            ? <>{t('cust.lastComputed', 'Last computed')} · {relTime(updatedAt)}</>
            : t('cust.neverComputed', 'Never computed')}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer 360 inline tabs — labels, icons, button, and body renderers.
// Styling matches PipelineView.tsx (inline button row, bottom border on active).
// ─────────────────────────────────────────────────────────────────────────────

function tabLabel(k: TabKey, t: (k: string, fb?: string) => string): string {
  switch (k) {
    // Canonical Object Detail tabs (file 10) — labels match the standard exactly.
    case 'overview':       return t('cust.tab.overview', 'Overview')
    case 'timeline':       return t('cust.tab.timeline', 'Timeline')
    case 'tasks':          return t('cust.tab.tasks', 'Tasks')
    case 'comments':       return t('cust.tab.comments', 'Comments')
    case 'attachments':    return t('cust.tab.attachments', 'Attachments')
    case 'approvals':      return t('cust.tab.approvals', 'Approvals')
    case 'related':        return t('cust.tab.related', 'Related')
    case 'communications': return t('cust.tab.communications', 'Communications')
    case 'audit':          return t('cust.tab.audit', 'Audit')
    // Customer-specific tabs (preserved, render after the canonical nine).
    case 'accounts':  return t('cust.tab.accounts', 'Accounts')
    case 'contacts':  return t('cust.tab.contacts', 'Contacts')
    case 'sites':     return t('cust.tab.sites', 'Sites')
    case 'contracts': return t('cust.tab.contracts', 'Contracts')
    case 'slas':      return t('cust.tab.slas', 'SLAs')
  }
}

function tabIcon(k: TabKey): React.ReactNode {
  switch (k) {
    case 'overview':       return <InfoIcon size={13} />
    case 'timeline':       return <ClockIcon size={13} />
    case 'tasks':          return <CheckIcon size={13} />
    case 'comments':       return <MessageIcon size={13} />
    case 'attachments':    return <PaperclipIcon size={13} />
    case 'approvals':      return <ShieldIcon size={13} />
    case 'related':        return <LayersIcon size={13} />
    case 'communications': return <MailIcon size={13} />
    case 'audit':          return <ActivityIcon size={13} />
    case 'accounts':  return <CreditCardIcon size={13} />
    case 'contacts':  return <PhoneIcon size={13} />
    case 'sites':     return <ServerIcon size={13} />
    case 'contracts': return <FolderIcon size={13} />
    case 'slas':      return <WarningIcon size={13} />
  }
}

// TB-1 — local CustomerTabButton delegates to the canonical `DetailTab`
// primitive. `count === null` (tab not yet loaded) → omit the count badge so
// "· 0" doesn't flash prematurely; DetailTab itself only renders the badge
// when count > 0, so passing `undefined` matches that contract.
function CustomerTabButton({ active, label, count, icon, onClick }: {
  active: boolean
  label: string
  count: number | null
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <DetailTab
      active={active}
      onSelect={onClick}
      icon={icon}
      count={count ?? undefined}
    >
      {label}
    </DetailTab>
  )
}

// Switchboard for the active tab's body. Loading → skeleton; fatal → muted state; data → table.
// Canonical Object Detail tabs (file 10) self-fetch from dedicated components in
// ./customer-tabs/ — they bypass the rows/fatal pipeline entirely and own their own
// loading/empty/error states.
function CustomerTabBody({ tab, rows, fatal, t, token, customerId, profile }: {
  tab: TabKey
  rows: any[] | null | undefined
  fatal: '' | 'denied' | 'notfound' | 'error'
  t: (k: string, fb?: string) => string
  token: string
  customerId: string
  profile: Profile | null
}) {
  // ── Canonical Object Detail tabs (file 10) ────────────────────────────────────
  // These nine come BEFORE the customer-specific tabs and each self-fetches.
  if (tab === 'overview')       return <OverviewTab customerId={customerId} profile={profile} />
  if (tab === 'timeline')       return <TimelineTab token={token} entity="customer" id={customerId} />
  if (tab === 'tasks')          return <TasksTab token={token} entity="customer" id={customerId} />
  if (tab === 'comments')       return <CommentsTab token={token} entity="customer" id={customerId} />
  if (tab === 'attachments')    return <AttachmentsTab token={token} entity="customer" id={customerId} />
  if (tab === 'approvals')      return <ApprovalsTab token={token} entity="customer" id={customerId} />
  if (tab === 'related')        return <RelatedTab token={token} entity="customer" id={customerId} />
  if (tab === 'communications') return <CommunicationsTab token={token} entity="customer" id={customerId} />
  if (tab === 'audit')          return <AuditTab token={token} entity="customer" id={customerId} />

  // ── Customer-specific tabs (legacy path with shared rows/fatal pipeline) ──────
  // Loading skeleton — 4 shimmering rows so the tab visually communicates "data incoming".
  if (rows === undefined) {
    return (
      <div className="card" style={{ padding: 'var(--gx-space-7)' }} aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 'var(--gx-space-4)', marginBottom: 'var(--gx-space-5)' }}>
            <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', flex: 2 }} />
            <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', flex: 1 }} />
            <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', flex: 1 }} />
            <div className="kpi-tile-skeleton" style={{ height: 'var(--gx-space-6)', flex: 1 }} />
          </div>
        ))}
      </div>
    )
  }
  // Fatal states — match the rest of the page's muted-paragraph idiom rather than full banner.
  if (rows === null) {
    if (fatal === 'denied')   return <p className="muted">{t('cust.tabDenied', 'Permission denied for this tab.')}</p>
    if (fatal === 'notfound') return <p className="muted">{t('cust.tabNotFound', 'Endpoint not yet available — coming soon.')}</p>
    return <p className="muted">{t('cust.tabError', 'Could not load this tab.')}</p>
  }
  // Dispatch per-tab renderer. Each is a small inline component to keep the file local + cohesive.
  if (tab === 'accounts')  return <AccountsTabBody rows={rows} t={t} />
  if (tab === 'contacts')  return <ContactsTabBody rows={rows} t={t} />
  if (tab === 'sites')     return <SitesTabBody rows={rows} t={t} />
  if (tab === 'contracts') return <ContractsTabBody rows={rows} t={t} />
  return <SlasTabBody rows={rows} t={t} />
}

// Accounts tab — short id, type, currency, cycle, status (no per-row balance to keep this fast;
// the Financial Summary card above already shows balance with the per-account picker).
function AccountsTabBody({ rows, t }: { rows: any[]; t: (k: string, fb?: string) => string }) {
  if (rows.length === 0) {
    return <EmptyState title={t('cust.tab.accountsEmpty', 'No billing accounts linked')} message={t('cust.tab.accountsEmpty.msg', 'Once a billing account is created for this customer, it will be listed here.')} />
  }
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">{t('cust.tab.acctId', 'Account')}</th>
            <th scope="col">{t('cust.tab.acctType', 'Type')}</th>
            <th scope="col">{t('cust.tab.acctCurrency', 'Currency')}</th>
            <th scope="col">{t('cust.tab.acctCycle', 'Billing cycle')}</th>
            <th scope="col">{t('common.status', 'Status')}</th>
          </tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td><span className="mono">{(a.id ?? '').slice(0, 8)}</span></td>
                <td>{a.type ?? '—'}</td>
                <td>{a.currency ?? '—'}</td>
                <td>{a.billing_cycle ?? '—'}</td>
                <td>{a.status ? <StatusPill variant={mapCustomerStatus(a.status)} label={a.status} size="sm" /> : <span>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Contacts tab — entity records with data.{name,role|title,email,phone,primary}.
function ContactsTabBody({ rows, t }: { rows: EntityRow[]; t: (k: string, fb?: string) => string }) {
  if (rows.length === 0) {
    return <EmptyState title={t('cust.tab.contactsEmpty', 'No contacts on file')} message={t('cust.tab.contactsEmpty.msg', 'Contact people (primary, technical, billing) for this customer will appear here.')} />
  }
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">{t('cust.tab.contactName', 'Name')}</th>
            <th scope="col">{t('cust.tab.contactRole', 'Role')}</th>
            <th scope="col">{t('cust.tab.contactEmail', 'Email')}</th>
            <th scope="col">{t('cust.tab.contactPhone', 'Phone')}</th>
            <th scope="col">{t('cust.tab.contactPrimary', 'Primary?')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const d = r.data ?? {}
              return (
                <tr key={r.id}>
                  <td>{d.name ?? <span className="mono">{(r.id ?? '').slice(0, 8)}</span>}</td>
                  <td>{d.role ?? d.title ?? '—'}</td>
                  <td>{d.email
                    ? <a href={`mailto:${d.email}`} style={{ color: 'var(--gx-link)' }}>{d.email}</a>
                    : '—'}</td>
                  <td>{d.phone
                    ? <a href={`tel:${d.phone}`} style={{ color: 'var(--gx-link)' }}>{d.phone}</a>
                    : '—'}</td>
                  <td>{d.primary === true || d.is_primary === true
                    ? <StatusPill variant="active" label={t('common.yes', 'Yes')} size="sm" />
                    : <span className="muted">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Sites tab — entity records with data.{name,address,activated_at}; site status lives on the row.
function SitesTabBody({ rows, t }: { rows: EntityRow[]; t: (k: string, fb?: string) => string }) {
  if (rows.length === 0) {
    return <EmptyState title={t('cust.tab.sitesEmpty', 'No service sites linked')} message={t('cust.tab.sitesEmpty.msg', 'Physical addresses where service is delivered will be listed here.')} />
  }
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">{t('cust.tab.siteName', 'Name')}</th>
            <th scope="col">{t('cust.tab.siteAddress', 'Address')}</th>
            <th scope="col">{t('common.status', 'Status')}</th>
            <th scope="col">{t('cust.tab.siteActivated', 'Activated')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const d = r.data ?? {}
              return (
                <tr key={r.id}>
                  <td>{d.name ?? <span className="mono">{(r.id ?? '').slice(0, 8)}</span>}</td>
                  <td>{d.address ?? '—'}</td>
                  <td>{r.status ? <StatusPill variant={mapCustomerStatus(r.status)} label={r.status} size="sm" /> : <span>—</span>}</td>
                  <td><span className="mono">{fmtDate(d.activated_at ?? d.installed_at ?? null)}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Contracts tab — entity records with data.{contract_number,start_date,end_date,tariff_plan}; status on row.
function ContractsTabBody({ rows, t }: { rows: EntityRow[]; t: (k: string, fb?: string) => string }) {
  if (rows.length === 0) {
    return <EmptyState title={t('cust.tab.contractsEmpty', 'No contracts on file')} message={t('cust.tab.contractsEmpty.msg', 'Signed contracts and tariff agreements with this customer will appear here.')} />
  }
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">{t('cust.tab.contractNum', 'Contract #')}</th>
            <th scope="col">{t('common.status', 'Status')}</th>
            <th scope="col">{t('cust.tab.contractFrom', 'Effective from')}</th>
            <th scope="col">{t('cust.tab.contractTo', 'Expires at')}</th>
            <th scope="col">{t('cust.tab.contractPlan', 'Tariff plan')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const d = r.data ?? {}
              return (
                <tr key={r.id}>
                  <td><span className="mono">{d.contract_number ?? (r.id ?? '').slice(0, 8)}</span></td>
                  <td>{r.status ? <StatusPill variant={mapCustomerStatus(r.status)} label={r.status} size="sm" /> : <span>—</span>}</td>
                  <td><span className="mono">{fmtDate(d.start_date ?? d.effective_from ?? null)}</span></td>
                  <td><span className="mono">{fmtDate(d.end_date ?? d.expires_at ?? null)}</span></td>
                  <td>{d.tariff_plan ?? d.plan ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// SLAs tab — helpdesk tickets for this customer that carry SLA fields. Breach gets a danger pill;
// due-time renders as both an absolute timestamp and a muted relative hint.
function SlasTabBody({ rows, t }: { rows: SlaRow[]; t: (k: string, fb?: string) => string }) {
  if (rows.length === 0) {
    return <EmptyState title={t('cust.tab.slasEmpty', 'No SLA-tracked tickets')} message={t('cust.tab.slasEmpty.msg', 'Open helpdesk tickets with an SLA target will show up here.')} />
  }
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="grid-wrap">
        <table className="grid">
          <thead><tr>
            <th scope="col">{t('cust.tab.slaTicket', 'Ticket')}</th>
            <th scope="col">{t('cust.tab.slaPriority', 'Priority')}</th>
            <th scope="col">{t('common.status', 'Status')}</th>
            <th scope="col">{t('cust.tab.slaDue', 'SLA due')}</th>
            <th scope="col">{t('cust.tab.slaBreach', 'Breach')}</th>
          </tr></thead>
          <tbody>
            {rows.map((tk) => (
              <tr key={tk.id}>
                <td>{tk.subject ?? <span className="mono">{(tk.id ?? '').slice(0, 8)}</span>}</td>
                <td>{tk.priority ?? '—'}</td>
                <td>{tk.status ? <StatusPill variant={mapCustomerStatus(tk.status)} label={tk.status} size="sm" /> : <span>—</span>}</td>
                <td>
                  <span className="mono">{fmtDate(tk.sla_due_at)}</span>
                  {tk.sla_due_at && (
                    <span className="muted" style={{ marginLeft: 'var(--gx-space-3)', fontSize: 'var(--gx-text-11)' }}>{relTime(tk.sla_due_at)}</span>
                  )}
                </td>
                <td>{tk.sla_breached
                  ? <StatusPill variant="critical" label={t('cust.tab.slaBreached', 'Breached')} size="sm" />
                  : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
