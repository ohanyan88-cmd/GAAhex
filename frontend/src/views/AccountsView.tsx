import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { bget, bpost, type Subscription, type Invoice, type Party } from '../lib/billing'
import { money } from '../lib/money'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  ChevronLeftIcon, BuildingIcon,
  SearchIcon, GearIcon,
  InfoIcon, ClockIcon, CheckIcon, MessageIcon, PaperclipIcon,
  ShieldIcon, LayersIcon, MailIcon, ActivityIcon, ReceiptIcon,
} from '../components/icons'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
  RefreshCw,
} from 'lucide-react'
import { useI18n } from '../lib/i18n'
import { PageShell, Stack, Card, SectionHeading, type KPISpec } from '../page-shell'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { Button, DetailTab, Pagination, StatusPill} from '../primitives'  // TB-2 — DetailTab is the canonical tab primitive
// TB-4 — canonical Object Detail tab bodies parameterized over (entity, id).
// Replaces 8 AccountXxxTab local copies (~300 LOC of duplication).
import TimelineTab from './customer-tabs/TimelineTab'
import TasksTab from './customer-tabs/TasksTab'
import CommentsTab from './customer-tabs/CommentsTab'
import AttachmentsTab from './customer-tabs/AttachmentsTab'
import ApprovalsTab from './customer-tabs/ApprovalsTab'
import RelatedTab from './customer-tabs/RelatedTab'
import CommunicationsTab from './customer-tabs/CommunicationsTab'
import AuditTab from './customer-tabs/AuditTab'

// Accounts UI (A17 /api/accounts) — the money/billing layer on a Party. Stage 1 may be dormant
// (no data) — that's fine; degrades to empty states, and 404 to "not available yet".
type Account = {
  id: string
  type?: string                  // residential | business | wholesale
  holder_party_id?: string | null
  holder_party_name?: string | null
  currency?: string
  billing_cycle?: string
  status?: string | null
  created_at?: string | null
  subscriptions?: Subscription[]
  invoices?: Invoice[]
}

const TYPES = ['residential', 'business', 'wholesale']
const CYCLES = ['monthly', 'yearly']

// Phase A.2 — balance + hierarchy contracts. The backend serializes Decimal columns as STRINGS
// (e.g. "1234.56") to preserve precision; we keep them as strings in state and format on render.
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
// Sentinel for per-row balance state: undefined = not fetched yet, null = fetched but unavailable
// (403/404 on this account), object = real snapshot.
type BalanceCell = BalanceSnapshot | null

// DF-6 — balance is a Decimal string in MAJOR units (֏). Canonical formatter
// in lib/money.ts; local alias keeps existing call sites unchanged.
import { moneyDecStr as moneyDecimal } from '../lib/money'

// Balance sign tone: NEGATIVE = customer owes us (red), POSITIVE = credit on account (green),
// zero = default. Returns an inline style snippet to keep the column tnum + right-aligned.
function balanceTone(s: string | null | undefined): string {
  if (s === null || s === undefined || s === '') return 'var(--gx-text-1)'
  const n = Number(s)
  if (!isFinite(n) || n === 0) return 'var(--gx-text-1)'
  return n < 0 ? 'var(--gx-danger)' : 'var(--gx-success)'
}

// Numeric value of a Decimal-string for sorting. Treat missing as 0 so sort is stable.
function decimalNum(s: string | null | undefined): number {
  if (s === null || s === undefined || s === '') return 0
  const n = Number(s)
  return isFinite(n) ? n : 0
}

// Account status → StatusPill primitive variant (configurable statuses tolerated).
type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapAccountStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'ACTIVE') return 'active'
  if (v === 'SUSPENDED') return 'degraded'
  if (v === 'CLOSED' || v === 'INACTIVE') return 'neutral'
  if (v === 'PENDING' || v === 'DRAFT') return 'info'
  return 'info'
}

// Sub/invoice statuses appear in the detail panel — keep the broader mapping for those.
function mapBillingStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (['ACTIVE', 'PAID'].includes(v)) return 'active'
  if (['SUSPENDED', 'OVERDUE'].includes(v)) return 'critical'
  if (['VOID', 'CANCELLED', 'CLOSED'].includes(v)) return 'neutral'
  if (['DRAFT'].includes(v)) return 'neutral'
  return 'info'
}

export default function AccountsView({ token, canConfigure = false, configVersion = 0, onConfigure }: { token: string; canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
  const { t } = useI18n()
  const cfg = usePageConfig(token, 'accounts', configVersion)
  const [list, setList] = useState<Account[] | null>(null)
  const cf = useCustomFields(token, 'accounts', cfg.customFields, (list ?? []).map((a) => a.id))
  const [parties, setParties] = useState<Party[]>([])
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [holder, setHolder] = useState('')
  const [type, setType] = useState('residential')
  const [currency, setCurrency] = useState('AMD')
  const [cycle, setCycle] = useState('monthly')

  // Toolbar / table interaction state.
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  // Phase A.2 — per-account balance snapshots (Decimal strings). Keyed by account.id.
  // `balanceApiDown` flips to true on the FIRST 404 from /balance to avoid hammering the API for
  // every row when the endpoint isn't deployed; existing list still renders, cells degrade to '—'.
  const [balances, setBalances] = useState<Record<string, BalanceCell>>({})
  const [balanceApiDown, setBalanceApiDown] = useState(false)
  const [recomputing, setRecomputing] = useState<Record<string, boolean>>({})
  // Admin gate for the recompute action. `can(capabilities, 'account', 'edit')` is the spec's
  // preferred check, but AccountsView isn't given the capabilities map (one-file scope rule), so
  // we fall back to the `canConfigure` prop the parent already wires in — superadmin in practice.
  const canRecompute = canConfigure

  // Fetch a single account's balance snapshot. 403/404 on this row → store `null` and degrade to
  // '—' in the cells; a global 404 (endpoint missing) flips `balanceApiDown` once and stops further
  // attempts. Other errors are swallowed (cell shows '—' until next refresh).
  async function fetchBalance(accountId: string, opts?: { silent?: boolean }): Promise<BalanceCell> {
    if (balanceApiDown) return null
    const res = await bget<BalanceSnapshot>(token, `/api/accounts/${accountId}/balance`)
    if (res.status === 404 && !opts?.silent) {
      // First 404 ⇒ feature unavailable. Toast once and stop further fetches.
      setBalanceApiDown((prev) => {
        if (!prev) toast.info(t('accounts.balanceUnavailable', 'Account balance API unavailable — falling back to basic listing'))
        return true
      })
      return null
    }
    if (res.status === 403 || res.status === 404) return null
    if (!res.ok || !res.data) return null
    return res.data
  }

  // Bulk-fetch all visible accounts' balances in parallel after the list loads. Each row's cell is
  // independent — one failure doesn't block the others.
  async function loadAllBalances(rows: Account[]) {
    if (balanceApiDown || rows.length === 0) return
    const results = await Promise.all(
      rows.map(async (a) => [a.id, await fetchBalance(a.id)] as const)
    )
    setBalances((prev) => {
      const next = { ...prev }
      for (const [id, snap] of results) next[id] = snap
      return next
    })
  }

  async function refreshOneBalance(accountId: string) {
    const snap = await fetchBalance(accountId, { silent: true })
    setBalances((prev) => ({ ...prev, [accountId]: snap }))
  }

  async function recompute(accountId: string) {
    if (recomputing[accountId]) return
    setRecomputing((m) => ({ ...m, [accountId]: true }))
    try {
      const snap = await bpost<BalanceSnapshot>(token, `/api/accounts/${accountId}/recompute-balance`)
      // Trust the response body to avoid a second round-trip, but fall back to a refetch if shape
      // is unexpected (defensive — the endpoint contract is documented but admin-only).
      if (snap && typeof snap === 'object' && 'current_balance' in snap) {
        setBalances((prev) => ({ ...prev, [accountId]: snap }))
      } else {
        await refreshOneBalance(accountId)
      }
      toast.success(t('accounts.balanceRecomputed', 'Balance recomputed'))
    } catch (e) {
      toast.error((e as Error).message || t('accounts.recomputeFailed', 'Recompute failed'))
    } finally {
      setRecomputing((m) => {
        const next = { ...m }; delete next[accountId]; return next
      })
    }
  }

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<Account[]>(token, '/api/accounts')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError(t('accounts.loadError', 'Failed to load accounts')); setList([]); return }
    const rows = Array.isArray(res.data) ? res.data : []
    setList(rows)
    setBalances({})            // wipe stale snapshots before refetch
    loadAllBalances(rows)      // fire-and-forget; cells render '—' until each resolves
  }

  useEffect(() => { load() }, [token])
  useEffect(() => { bget<Party[]>(token, '/api/parties').then((r) => setParties(r.ok && Array.isArray(r.data) ? r.data : [])) }, [token])
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

  const holderName = (a: Account) => a.holder_party_name ?? (a.holder_party_id ? (parties.find((p) => p.id === a.holder_party_id)?.name ?? a.holder_party_id.slice(0, 8)) : '—')

  async function create() {
    if (!holder) return
    try {
      await bpost(token, '/api/accounts', { holder_party_id: holder, type, currency, billing_cycle: cycle })
      toast.success(t('accounts.created', 'Account created'))
      setCreating(false); setHolder(''); setType('residential'); setCurrency('AMD'); setCycle('monthly')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  if (denied) return <PermissionDenied message={t('accounts.denied', "You don't have permission to view accounts.")} />
  if (detailId) return <AccountDetail token={token} id={detailId} parties={parties} canRecompute={canRecompute} onBack={() => { setDetailId(null); load() }} />

  const all = list ?? []
  const activeCount = all.filter(a => (a.status ?? '').toUpperCase() === 'ACTIVE').length
  const businessCount = all.filter(a => (a.type ?? '').toLowerCase() === 'business').length
  const residentialCount = all.filter(a => (a.type ?? '').toLowerCase() === 'residential').length

  const kpis: KPISpec[] = all.length > 0 ? [
    { label: 'Accounts', value: all.length, subtitle: `${activeCount} active`, onClick: () => setQuery('') },
    { label: 'Business', value: businessCount, subtitle: 'billable', onClick: () => setQuery('business') },
    { label: 'Residential', value: residentialCount, subtitle: 'consumer', onClick: () => setQuery('residential') },
  ] : []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((a) => {
      const fields = [
        a.id ?? '',
        holderName(a),
        a.type ?? '',
        a.currency ?? '',
        a.billing_cycle ?? '',
        a.status ?? '',
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, parties])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    // Numeric sort for balance columns (Decimal strings); string sort for everything else.
    if (k === 'balance' || k === 'credit_limit' || k === 'available') {
      const getNum = (a: Account): number => {
        const snap = balances[a.id]
        if (!snap) return 0
        if (k === 'balance') return decimalNum(snap.current_balance)
        if (k === 'credit_limit') return decimalNum(snap.credit_limit)
        return decimalNum(snap.available_credit)
      }
      return [...filtered].sort((a, b) => (getNum(a) - getNum(b)) * dir)
    }
    const get = (a: Account): string => {
      switch (k) {
        case 'type': return a.type ?? ''
        case 'holder': return holderName(a)
        case 'currency': return a.currency ?? ''
        case 'cycle': return a.billing_cycle ?? ''
        case 'status': return a.status ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => String(get(a)).localeCompare(String(get(b))) * dir)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, parties, balances])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  function renderCell(colKey: string, a: Account) {
    switch (colKey) {
      case 'type': return a.type ?? '—'
      case 'holder': return holderName(a)
      case 'currency': return <span className="mono">{a.currency ?? '—'}</span>
      case 'cycle': return a.billing_cycle ?? '—'
      case 'status': return a.status
        ? <StatusPill variant={mapAccountStatus(a.status)} label={a.status} size="sm" />
        : <span>—</span>
      default: return '—'
    }
  }

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Billing & Revenue', cfg.title]}
      icon={<BuildingIcon size={18} />}
      title={cfg.title}
      subtitle="Multi-tenant B2B parent-child accounting"
      kpis={kpis}
      primaryAction={!unavailable ? {
        label: creating ? t('common.close', 'Close') : t('accounts.new', 'New account'),
        icon: <Plus size={14} />,
        onClick: () => setCreating((c) => !c),
      } : undefined}
      secondaryActions={canConfigure && onConfigure ? [
        { label: 'Configure', icon: <GearIcon size={13} />, onClick: onConfigure },
      ] : undefined}
    >
        {creating && (
          <div className="rec-form">
            <label className="field"><span>{t('accounts.holder', 'Holder party')} *</span>
              <select className="inp inp-md" value={holder} onChange={(e) => setHolder(e.target.value)}>
                <option value="">{t('common.pick', '— pick —')}</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</option>)}
              </select>
            </label>
            <label className="field"><span>{t('accounts.type', 'Type')}</span>
              <select className="inp inp-md" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            </label>
            <label className="field"><span>{t('accounts.currency', 'Currency')}</span><input className="inp inp-md" value={currency} onChange={(e) => setCurrency(e.target.value)} /></label>
            <label className="field"><span>{t('accounts.cycle', 'Billing cycle')}</span>
              <select className="inp inp-md" value={cycle} onChange={(e) => setCycle(e.target.value)}>{CYCLES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            </label>
            <div className="rec-form-actions"><Button variant="gold" size="md" onClick={create} disabled={!holder}>{t('common.create', 'Create')}</Button></div>
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}
        {unavailable && <EmptyState icon={<BuildingIcon size={40} />} title={t('accounts.unavailable', "Accounts aren't available yet")} message={t('accounts.unavailableMsg', 'The accounts layer will appear here once enabled.')} />}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<BuildingIcon size={40} />} title={t('accounts.empty', 'No accounts')} message={t('accounts.emptyMsg', 'Create an account against a party to start billing it.')} />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {cfg.columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        onClick={() => toggleSort(c.key)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {c.label}
                          {sortKey === c.key
                            // D18: active sort indicator = azure (interactive cue)
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-interactive)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-interactive)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => setDetailId(a.id)}
                    >
                      {cfg.columns.map((c) => (
                        <td key={c.key}>{renderCell(c.key, a)}</td>
                      ))}
                      {cf.cells(a.id)}
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + cfg.customFields.length} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                        No matching accounts.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={sorted.length}
              onChange={setPage}
            />
          </div>
        )}
    </PageShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AccountDetail — file 10 (Object Detail Standard) canonical 9-tab set.
// Tab order is fixed: Overview · Timeline · Tasks · Comments · Attachments ·
// Approvals · Related · Communications · Audit. Each tab lazy-loads its slice
// on first activation; the Overview tab WRAPS the previously-shown bill-meta +
// subscriptions + invoices content unchanged (no restructure).
// ─────────────────────────────────────────────────────────────────────────────
type AccountTabKey =
  | 'overview' | 'timeline' | 'tasks' | 'comments' | 'attachments'
  | 'approvals' | 'related' | 'communications' | 'audit'
const ACCOUNT_TAB_ORDER: AccountTabKey[] = [
  'overview', 'timeline', 'tasks', 'comments', 'attachments',
  'approvals', 'related', 'communications', 'audit',
]

function accountTabLabel(k: AccountTabKey, t: (k: string, fb?: string) => string): string {
  switch (k) {
    case 'overview':       return t('acct.tab.overview', 'Overview')
    case 'timeline':       return t('acct.tab.timeline', 'Timeline')
    case 'tasks':          return t('acct.tab.tasks', 'Tasks')
    case 'comments':       return t('acct.tab.comments', 'Comments')
    case 'attachments':    return t('acct.tab.attachments', 'Attachments')
    case 'approvals':      return t('acct.tab.approvals', 'Approvals')
    case 'related':        return t('acct.tab.related', 'Related')
    case 'communications': return t('acct.tab.communications', 'Communications')
    case 'audit':          return t('acct.tab.audit', 'Audit')
  }
}

function accountTabIcon(k: AccountTabKey): ReactNode {
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
  }
}

// TB-2 — local AccountTabButton was identical to InvoiceTabButton. Both now
// use the canonical `DetailTab` primitive from `../primitives/DetailTab`
// (imported below). Wrap the tab strip with `<DetailTabList>` to inherit
// WCAG-conformant arrow-key navigation (TB-3).
function AccountTabButton({ active, label, icon, onClick }: {
  active: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <DetailTab active={active} onSelect={onClick} icon={icon}>
      {label}
    </DetailTab>
  )
}

function AccountDetail({ token, id, parties, onBack }: { token: string; id: string; parties: Party[]; canRecompute: boolean; onBack: () => void }) {
  const { t } = useI18n()
  const [acct, setAcct] = useState<Account | null>(null)
  const [error, setError] = useState('')
  // Canonical Object Detail tab — defaults to Overview (file 10).
  const [tab, setTab] = useState<AccountTabKey>('overview')

  async function load() {
    setError('')
    const res = await bget<Account>(token, `/api/accounts/${id}`)
    if (!res.ok) { setError(res.status === 404 ? t('accounts.notFound', 'Account not found') : t('accounts.loadError', 'Failed to load account')); return }
    setAcct(res.data)
  }
  useEffect(() => { load() }, [token, id])

  const subs = acct?.subscriptions ?? []
  const invoices = acct?.invoices ?? []
  const holderName = acct?.holder_party_name ?? (acct?.holder_party_id ? (parties.find((p) => p.id === acct.holder_party_id)?.name ?? acct.holder_party_id.slice(0, 8)) : '—')

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Billing', 'Accounts', holderName]}
      icon={<BuildingIcon size={18} />}
      title={holderName}
      subtitle={acct?.id ? acct.id.slice(0, 8) : undefined}
      secondaryActions={[
        { label: t('nav.accounts', 'Accounts'), icon: <ChevronLeftIcon size={13} />, onClick: onBack },
      ]}
    >
        {error && <ErrorBanner message={error} onRetry={load} />}
        {!acct && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}

        {acct && (
          <>
            {/* Canonical Object Detail tabs (file 10) — render BEFORE any object-specific tabs.
                The bill-meta + subs + invoices content lives inside the Overview tab. */}
            <div
              role="tablist"
              aria-label={t('acct.standardTabs', 'Object Detail tabs')}
              style={{
                display: 'flex',
                gap: 'var(--gx-space-2)',
                borderBottom: '1px solid var(--gx-border)',
                marginBottom: 'var(--gx-space-5)',
                overflowX: 'auto',
              }}
            >
              {ACCOUNT_TAB_ORDER.map((k) => (
                <AccountTabButton
                  key={k}
                  active={tab === k}
                  label={accountTabLabel(k, t)}
                  icon={accountTabIcon(k)}
                  onClick={() => setTab(k)}
                />
              ))}
            </div>

            <div role="tabpanel" aria-label={accountTabLabel(tab, t)}>
              {tab === 'overview' && (
                <Stack gap="lg">
                  <Card pad="md">
                    <SectionHeading icon={<InfoIcon size={14} />} title={t('accounts.summary', 'Summary')} />
                    <div className="bill-meta">
                      <div><span className="muted">{t('accounts.type', 'Type')}</span><div>{acct.type ?? '—'}</div></div>
                      <div><span className="muted">{t('accounts.currency', 'Currency')}</span><div className="mono">{acct.currency ?? '—'}</div></div>
                      <div><span className="muted">{t('accounts.cycle', 'Cycle')}</span><div>{acct.billing_cycle ?? '—'}</div></div>
                      <div><span className="muted">{t('common.status', 'Status')}</span>
                        <div>{acct.status ? <StatusPill variant={mapAccountStatus(acct.status)} label={acct.status} size="sm" /> : <span>—</span>}</div>
                      </div>
                    </div>
                  </Card>

                  <Card pad="md">
                    <SectionHeading icon={<LayersIcon size={14} />} title={t('nav.subscriptions', 'Subscriptions')} />
                    {subs.length === 0
                      ? <EmptyState title={t('accounts.noSubs', 'No subscriptions on this account yet.')} message={t('accounts.noSubs.msg', 'Active subscriptions will appear here once a plan is assigned.')} />
                      : (
                        <div className="grid-wrap">
                          <table className="grid">
                            <thead><tr>
                              <th scope="col">{t('subs.plan', 'Plan')}</th>
                              <th scope="col" className="num">{t('subs.amount', 'Amount')}</th>
                              <th scope="col">{t('accounts.cycle', 'Cycle')}</th>
                              <th scope="col">{t('common.status', 'Status')}</th>
                            </tr></thead>
                            <tbody>
                              {subs.map((sx) => (
                                <tr key={sx.id}>
                                  <td>{sx.plan_name ?? '—'}</td>
                                  <td className="num"><span className="mono tnum">{money(sx.amount)}</span></td>
                                  <td>{sx.cycle ?? '—'}</td>
                                  <td>{sx.status ? <StatusPill variant={mapBillingStatus(sx.status)} label={sx.status} size="sm" /> : <span>—</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                  </Card>

                  <Card pad="md">
                    <SectionHeading icon={<ReceiptIcon size={14} />} title={t('nav.invoices', 'Invoices')} />
                    {invoices.length === 0
                      ? <EmptyState title={t('accounts.noInvoices', 'No invoices on this account yet.')} message={t('accounts.noInvoices.msg', 'Issued invoices will show up here once billing cycles run.')} />
                      : (
                        <div className="grid-wrap">
                          <table className="grid">
                            <thead><tr>
                              <th scope="col">{t('invoices.number', 'Invoice')}</th>
                              <th scope="col">{t('common.status', 'Status')}</th>
                              <th scope="col" className="num">{t('invoices.total', 'Total')}</th>
                            </tr></thead>
                            <tbody>
                              {invoices.map((inv) => (
                                <tr key={inv.id}>
                                  <td><span className="mono">{inv.number ?? inv.id.slice(0, 8)}</span></td>
                                  <td>{inv.status ? <StatusPill variant={mapBillingStatus(inv.status)} label={inv.status} size="sm" /> : <span>—</span>}</td>
                                  <td className="num"><span className="mono tnum">{money(inv.total)}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                  </Card>
                </Stack>
              )}
              {/* TB-4 — account detail tabs reuse the canonical
                  `customer-tabs/*` components. The 8 Account*Tab locals
                  below were deleted (~300 LOC of pure copy-paste). */}
              {tab === 'timeline'       && <TimelineTab token={token} entity="account" id={id} />}
              {tab === 'tasks'          && <TasksTab token={token} entity="account" id={id} />}
              {tab === 'comments'       && <CommentsTab token={token} entity="account" id={id} />}
              {tab === 'attachments'    && <AttachmentsTab token={token} entity="account" id={id} />}
              {tab === 'approvals'      && <ApprovalsTab token={token} entity="account" id={id} />}
              {tab === 'related'        && <RelatedTab token={token} entity="account" id={id} />}
              {tab === 'communications' && <CommunicationsTab token={token} entity="account" id={id} />}
              {tab === 'audit'          && <AuditTab token={token} entity="account" id={id} />}
            </div>
          </>
        )}
    </PageShell>
  )
}

// TB-4 — Account* tab body functions REMOVED.
// Were ~300 LOC of pure copy-paste from the customer-tabs originals; the
// switchboard above now uses the canonical components directly with
// entity="account" id={id}.
