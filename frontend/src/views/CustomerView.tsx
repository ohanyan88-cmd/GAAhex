import { useEffect, useState } from 'react'
import { bget, bpost, type Subscription, type Invoice } from '../lib/billing'
import { money, toMinor } from '../lib/money'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { ErrorBanner, PermissionDenied, NotFound } from '../components/States'
import ActivityTimeline from '../components/ActivityTimeline'
import InteractionsView from './InteractionsView'
import ViewHead from '../components/ViewHead'
import {
  ChevronLeftIcon, UsersIcon, ReceiptIcon, PhoneIcon,
  ClockIcon, CreditCardIcon, GearIcon,
} from '../components/icons'
import { useI18n } from '../lib/i18n'
import { usePageConfig } from '../lib/pageConfig'
import { StatusPill, KPITile } from '../primitives'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

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

// Balance is delivered as a Decimal string in MAJOR units (֏), not luma. lib/money.money() expects
// integer luma, so we format here. Hide-if-missing: return em-dash for null/blank.
function moneyDecimal(s: string | null | undefined): string {
  if (s === null || s === undefined || s === '') return '—'
  const n = Number(s)
  if (!isFinite(n)) return '—'
  const fmt = n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${fmt} ֏`
}

// NEGATIVE = customer owes us (red), POSITIVE = credit on account (green), zero = default.
function balanceTone(s: string | null | undefined): string {
  if (s === null || s === undefined || s === '') return 'var(--gx-text-1)'
  const n = Number(s)
  if (!isFinite(n) || n === 0) return 'var(--gx-text-1)'
  return n < 0 ? 'var(--gx-danger, #d6336c)' : 'var(--gx-success, #2f9e44)'
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

  return (
    <div className="view-inner fade">
        <div className="crumbs">
          <span>CRM</span><span className="sep">/</span>
          <a onClick={onBack} style={{ cursor: 'pointer' }}>{t('nav.customers', 'Customers')}</a>
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>{name || t('cust.title', 'Customer')}</span>
        </div>

        <ViewHead
          icon={<UsersIcon size={18} />}
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              {name || t('cust.title', 'Customer')}
              {p?.status && <StatusPill variant={mapCustomerStatus(p.status)} label={p.status} size="sm" />}
            </span>
          }
          sub={
            p?.id ? <span className="mono" style={{ color: 'var(--gx-text-3)' }}>{p.id.slice(0, 8)}</span> : undefined
          }
          actions={
            <>
              {canConfigure && onConfigure && (
                <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
                  <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={onBack}>
                <ChevronLeftIcon size={13} /> {t('nav.customers', 'Customers')}
              </button>
            </>
          }
        />

        {error && <ErrorBanner message={error} onRetry={load} />}
        {!data && !error && (
          <>
            {/* Per-section loading skeletons — mirrors the rendered KPI strip + cards below */}
            <div className="kpi-strip" style={{ marginBottom: 22 }} aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
              {[0, 1, 2].map((i) => (
                <KPITile key={i} label="" value="" size="sm" loading />
              ))}
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <div className="kpi-tile-skeleton" style={{ height: 14, width: 140, margin: '18px 0 10px' }} />
                <div className="card" style={{ padding: 14 }}>
                  <div className="kpi-tile-skeleton" style={{ height: 12, width: '92%', marginBottom: 8 }} />
                  <div className="kpi-tile-skeleton" style={{ height: 12, width: '80%', marginBottom: 8 }} />
                  <div className="kpi-tile-skeleton" style={{ height: 12, width: '60%' }} />
                </div>
              </div>
            ))}
          </>
        )}

        {data && (
          <>
            {/* 360 stat KPIs — outstanding / billed / paid / related. Each clickable
                tile drills through to that customer's invoices filtered by status. */}
            <div className="kpi-strip" style={{ marginBottom: 22 }}>
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
                premium
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
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

            {/* Services */}
            <div className="section-head">
              <ClockIcon size={16} className="section-icon" />
              {t('cust.services', 'Services')}
            </div>
            {services.length === 0
              ? <p className="muted">{t('cust.noServices', 'No services yet.')}</p>
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
              ? <p className="muted">{t('cust.noSubs', 'No subscriptions yet.')}</p>
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
              ? <p className="muted">{t('cust.noInvoices', 'No invoices yet.')}</p>
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
                                {canEditInvoice && st === 'DRAFT' && <button className="btn btn-primary btn-sm" onClick={() => issue(inv.id)}>{t('cust.issue', 'Issue')}</button>}
                                {canEditInvoice && (st === 'ISSUED' || st === 'OVERDUE') && <button className="btn btn-accent btn-sm" onClick={() => setPayInvoice(inv)}>{t('cust.recordPayment', 'Record payment')}</button>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            {/* Interactions — customer touchpoints (calls, emails, notes, etc.) */}
            <div className="section-head">
              <PhoneIcon size={16} className="section-icon" />
              {t('nav.interactions', 'Interactions')}
              <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· {t('common.embedded', 'embedded view')}</span>
            </div>
            <InteractionsView token={token} customerId={customerId} embedded />

            {/* Activity — reuse the shared record timeline (degrades on its own) */}
            <div className="section-head">
              <ClockIcon size={16} className="section-icon" />
              {t('nav.activity', 'Activity timeline')}
            </div>
            <div className="widget">
              <ActivityTimeline token={token} record={customerId} />
            </div>
          </>
        )}

        {payInvoice && (
          <PaymentModal token={token} invoiceId={payInvoice.id} onClose={() => setPayInvoice(null)} onDone={() => { setPayInvoice(null); load() }} />
        )}
    </div>
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
          <button className="btn btn-ghost btn-md" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
          <button className="btn btn-accent btn-md" disabled={saving || !amount} onClick={submit}>{saving ? t('common.saving', 'Saving…') : t('cust.record', 'Record')}</button>
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
      <div className="card" style={{ padding: 14 }} aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
        <div className="kpi-tile-skeleton" style={{ height: 12, width: '40%', marginBottom: 10 }} />
        <div className="kpi-tile-skeleton" style={{ height: 18, width: '60%', marginBottom: 8 }} />
        <div className="kpi-tile-skeleton" style={{ height: 12, width: '80%' }} />
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
    <div className="card" style={{ padding: 14 }}>
      {/* Toolbar: account picker (when 2+) + consolidated toggle (when subtree data exists). */}
      {(accounts.length > 1 || consolidated) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {accounts.length > 1 && !showConsolidated && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gx-text-2)' }}>
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
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gx-text-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showConsolidated}
                onChange={(e) => setShowConsolidated(e.target.checked)}
                aria-label={t('cust.consolidated', 'Consolidated subtree')}
              />
              <span>
                {t('cust.consolidated', 'Consolidated subtree')}
                {consolidated.subtree_size > 0 && (
                  <span className="muted" style={{ marginLeft: 4 }}>· {consolidated.subtree_size}</span>
                )}
              </span>
            </label>
          )}
        </div>
      )}

      {/* Three-up money summary. Grid auto-wraps on narrow viewports. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            {isConsolidated ? t('cust.consolidatedBalance', 'Consolidated balance') : t('cust.balance', 'Balance')}
          </div>
          <div className="mono tnum" style={{ fontSize: 20, fontWeight: 600, color: balanceTone(current) }}>
            {moneyDecimal(current)}
          </div>
          {(() => {
            const n = decimalNum(current)
            if (n === 0) return null
            return (
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {n < 0 ? t('cust.owes', 'Owes') : t('cust.credit', 'Credit')}
              </div>
            )
          })()}
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            {t('cust.creditLimit', 'Credit limit')}
          </div>
          <div className="mono tnum" style={{ fontSize: 16, color: 'var(--gx-text-2)' }}>
            {moneyDecimal(limit)}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
            {t('cust.availableCredit', 'Available credit')}
          </div>
          <div className="mono tnum" style={{ fontSize: 16 }}>
            {moneyDecimal(available)}
          </div>
          {pct !== null && (
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              {pct}% {t('cust.ofLimit', 'of limit')}
            </div>
          )}
        </div>
      </div>

      {/* Last computed footer — muted, single line. Only shown for per-account snapshots; the
          consolidated endpoint doesn't carry a single updated_at. */}
      <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
        {isConsolidated
          ? t('cust.consolidatedNote', 'Aggregated across subtree accounts.')
          : updatedAt
            ? <>{t('cust.lastComputed', 'Last computed')} · {relTime(updatedAt)}</>
            : t('cust.neverComputed', 'Never computed')}
      </div>
    </div>
  )
}
