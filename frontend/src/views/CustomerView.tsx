import { useEffect, useState } from 'react'
import { bget, bpost, type Invoice } from '../lib/billing'
import { ENTITY_RECORDS, CUSTOMER_TICKETS } from '../lib/pagination'
import { toast } from '../components/Toast'
import { ErrorBanner, PermissionDenied, NotFound } from '../components/States'
import { PageShell, type StatusSummary, type StatusSummaryVariant } from '../page-shell'
import {
  ChevronLeftIcon, UsersIcon, ReceiptIcon,
  ClockIcon, CreditCardIcon, GearIcon,
} from '../components/icons'
import { useI18n } from '../lib/i18n'
import { usePageConfig } from '../lib/pageConfig'
import { KPITile } from '../primitives'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { OBJ } from '../lib/permissions-constants'
import { money } from '../lib/money'
import { useAuth } from '../context/AuthContext'

import {
  type C360, type Service, type Account, type BalanceSnapshot,
  type ConsolidatedBalance, type TabKey,
  TAB_ORDER, CUSTOM_TAB_SET,
} from './customer/types'
import { mapCustomerStatus, tabLabel } from './customer/utils'
import { FinancialSummaryCard } from './customer/FinancialSummaryCard'
import { PaymentModal } from './customer/PaymentModal'
import { CustomerTabButton, CustomerTabBody, tabIcon } from './customer/TabComponents'
import { ServicesTable, SubscriptionsTable, InvoicesTable } from './customer/BillingTables'

// CustomerView — the single-customer workspace (doc 17 "Customer 360"). One screen for an operator
// to see ONE customer's whole life: header money summary, services, subscriptions, invoices (with
// issue / record-payment affordances), related CRM records and the audit activity. Driven by the
// consolidated GET /api/customers/{id}/360 payload; the Services list falls back to /api/services
// when the 360 build doesn't carry that field yet (lanes land together). Money is luma → money().

export default function CustomerView({ customerId, onBack, configVersion = 0, canConfigure = false, onConfigure, capabilities = FULL_ACCESS, onOpenInvoices }: {
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
  const { token } = useAuth()
  const canEditInvoice = can(capabilities, OBJ.INVOICE, 'edit')
  const { t } = useI18n()
  // Hook called so the Configure button (via BESPOKE_PAGE_KEYS) lights up for this page.
  usePageConfig(token!, 'customer', configVersion)
  const [data, setData] = useState<C360 | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState('')
  const [fatal, setFatal] = useState<null | 'denied' | 'notfound'>(null)
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null)
  // Phase A.2 — Financial Summary card. Per-customer accounts via /api/accounts?customer={id};
  // per-account balance snapshot via /api/accounts/{id}/balance; consolidated subtree via
  // /api/accounts/{id}/balance/consolidated on the root account when there's a hierarchy.
  const [accounts, setAccounts] = useState<Account[] | null | undefined>(undefined)
  const [balances, setBalances] = useState<Record<string, BalanceSnapshot | null>>({})
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [consolidated, setConsolidated] = useState<ConsolidatedBalance | null>(null)
  const [balanceFatal, setBalanceFatal] = useState(false)
  const [showConsolidated, setShowConsolidated] = useState(false)

  // Customer 360 inline tabs — default is first canonical tab ("Overview" per file 10).
  // tabData[tab] === undefined → not loaded; null → error/denied; array → data.
  const [tab, setTab] = useState<TabKey>('overview')
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
    const ar = await bget<Account[]>(token!, `/api/accounts?customer=${encodeURIComponent(customerId)}`)
    if (ar.status === 403 || ar.status === 404 || !ar.ok || !Array.isArray(ar.data) || ar.data.length === 0) {
      setAccounts(ar.ok && Array.isArray(ar.data) ? ar.data : null); return
    }
    const accts = ar.data
    setAccounts(accts); setSelectedAccountId(accts[0].id)
    const results = await Promise.all(
      accts.map(async (a) => {
        const r = await bget<BalanceSnapshot>(token!, `/api/accounts/${a.id}/balance`)
        return [a.id, r.ok && r.data ? r.data : null] as const
      })
    )
    const map: Record<string, BalanceSnapshot | null> = {}
    let anyOk = false
    for (const [id, snap] of results) { map[id] = snap; if (snap) anyOk = true }
    setBalances(map)
    if (!anyOk) setBalanceFatal(true)
    if (accts.length > 1) {
      const root = accts.find((a) => !a.parent_account_id) ?? accts[0]
      const cr = await bget<ConsolidatedBalance>(token!, `/api/accounts/${root.id}/balance/consolidated`)
      if (cr.ok && cr.data) setConsolidated(cr.data)
    }
  }

  async function loadTab(key: TabKey) {
    if (!CUSTOM_TAB_SET.has(key)) return
    if (tabData[key] !== undefined) return
    const setOne = (rows: any[] | null, why: '' | 'denied' | 'notfound' | 'error' = '') => {
      setTabData((p) => ({ ...p, [key]: rows }))
      setTabFatal((p) => ({ ...p, [key]: why }))
    }
    if (key === 'accounts') {
      const r = await bget<Account[]>(token!, `/api/accounts?customer=${encodeURIComponent(customerId)}`)
      if (r.status === 403) return setOne(null, 'denied')
      if (r.status === 404) return setOne(null, 'notfound')
      if (!r.ok || !Array.isArray(r.data)) return setOne(null, 'error')
      return setOne(r.data)
    }
    if (key === 'contacts' || key === 'sites' || key === 'contracts') {
      const slug = key
      const filterExpr = encodeURIComponent(`customer == "${customerId}"`)
      let r = await bget<any[]>(token!, `/api/${slug}?filter=${filterExpr}&limit=${ENTITY_RECORDS}`)
      if (r.status === 403) return setOne(null, 'denied')
      if (r.status === 404) return setOne(null, 'notfound')
      if (!r.ok || !Array.isArray(r.data)) {
        r = await bget<any[]>(token!, `/api/${slug}?limit=${ENTITY_RECORDS}`)
        if (r.status === 403) return setOne(null, 'denied')
        if (r.status === 404) return setOne(null, 'notfound')
        if (!r.ok || !Array.isArray(r.data)) return setOne(null, 'error')
      }
      const rows = (r.data ?? []).filter((row) => {
        const d = row.data ?? {}
        return d.customer === customerId || d.customer_id === customerId
      })
      return setOne(rows)
    }
    if (key === 'slas') {
      const r = await bget<any[]>(token!, `/api/helpdesk/tickets?limit=${CUSTOMER_TICKETS}`)
      if (r.status === 403) return setOne(null, 'denied')
      if (r.status === 404) return setOne(null, 'notfound')
      if (!r.ok || !Array.isArray(r.data)) return setOne(null, 'error')
      return setOne(r.data.filter((tk) => tk.customer_id === customerId))
    }
  }

  async function load() {
    setError(''); setFatal(null); setData(null)
    const res = await bget<C360>(token!, `/api/customers/${customerId}/360`)
    if (res.status === 403) { setFatal('denied'); return }
    if (res.status === 404) { setFatal('notfound'); return }
    if (!res.ok || !res.data) { setError(t('cust.loadError', 'Failed to load this customer')); return }
    const c = res.data
    setData(c)
    if (Array.isArray(c.services)) {
      setServices(c.services)
    } else {
      const sv = await bget<Service[]>(token!, `/api/services?customer=${encodeURIComponent(customerId)}`)
      setServices(sv.ok && Array.isArray(sv.data) ? sv.data : [])
    }
  }

  async function issue(id: string) {
    try {
      await bpost(token!, `/api/invoices/${id}/issue`)
      toast.success(t('cust.issued', 'Invoice issued'))
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  useEffect(() => { load() }, [token, customerId])
  useEffect(() => { loadAccountsAndBalances() }, [token, customerId])
  useEffect(() => {
    setTab('overview')
    const blank: any[] | null | undefined = undefined
    setTabData({ overview: blank, timeline: blank, tasks: blank, comments: blank, attachments: blank, approvals: blank, related: blank, communications: blank, audit: blank, accounts: blank, contacts: blank, sites: blank, contracts: blank, slas: blank })
    setTabFatal({ overview: '', timeline: '', tasks: '', comments: '', attachments: '', approvals: '', related: '', communications: '', audit: '', accounts: '', contacts: '', sites: '', contracts: '', slas: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, customerId])
  useEffect(() => { loadTab(tab) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab])

  if (fatal === 'denied') return <PermissionDenied message={t('cust.denied', "You don't have permission to view this customer.")} />
  if (fatal === 'notfound') return <NotFound what={t('cust.what', 'customer')} message={t('cust.notFoundMsg', 'This customer may have been moved, renamed, or deleted.')} />

  const p = data?.profile
  const name = p?.name ?? p?.title ?? (p ? p.id.slice(0, 8) : '')
  const sum = data?.summary ?? {}
  const subs = data?.subscriptions ?? []
  const invoices = data?.invoices ?? []
  const related = Object.entries(data?.related ?? {})

  function toSummaryVariant(v: ReturnType<typeof mapCustomerStatus>): StatusSummaryVariant {
    if (v === 'active') return 'success'
    if (v === 'degraded') return 'warning'
    if (v === 'critical') return 'danger'
    if (v === 'info') return 'info'
    return 'neutral'
  }
  const statusSummary: StatusSummary | undefined = p?.status
    ? { label: p.status, variant: toSummaryVariant(mapCustomerStatus(p.status)) }
    : undefined
  const subtitle = p?.id ? `${t('cust.subtitle', 'Customer 360')} · ${p.id.slice(0, 8)}` : t('cust.subtitle', 'Customer 360')

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['CRM', t('nav.customers', 'Customers'), name || t('cust.title', 'Customer')]}
      icon={<UsersIcon size={18} />}
      title={name || t('cust.title', 'Customer')}
      subtitle={subtitle}
      statusSummary={statusSummary}
      secondaryActions={[
        ...(canConfigure && onConfigure ? [{ label: t('common.configure', 'Configure'), icon: <GearIcon size={13} />, onClick: onConfigure }] : []),
        { label: t('nav.customers', 'Customers'), icon: <ChevronLeftIcon size={13} />, onClick: onBack },
      ]}
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && (
        <>
          <div className="kpi-strip" style={{ marginBottom: 'var(--gx-space-20)' }} aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
            {[0, 1, 2].map((i) => <KPITile key={i} label="" value="" size="sm" loading />)}
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
          {/* 360 stat KPIs */}
          <div className="kpi-strip" style={{ marginBottom: 'var(--gx-space-20)' }}>
            <KPITile icon={CreditCardIcon} label={t('cust.outstanding', 'Outstanding')} value={money(sum.outstanding)}
              subtitle={(sum.overdue_count ?? 0) > 0 ? `${sum.overdue_count} ${t('cust.overdue', 'overdue invoice(s)')}` : undefined}
              size="sm" danger={(sum.outstanding ?? 0) > 0}
              onClick={onOpenInvoices ? () => onOpenInvoices('OVERDUE') : undefined}
              ariaLabel={t('cust.outstandingAria', 'Outstanding amount. Click to see overdue invoices.')} />
            <KPITile label={t('cust.billed', 'Total billed')} value={money(sum.total_billed)}
              subtitle={sum.invoice_count != null ? `${sum.invoice_count} ${t('cust.invoiceCount', 'invoice(s)')}` : undefined}
              size="sm" onClick={onOpenInvoices ? () => onOpenInvoices() : undefined}
              ariaLabel={t('cust.billedAria', 'Total billed. Click to see all invoices.')} />
            <KPITile label={t('cust.paid', 'Total paid')} value={money(sum.total_paid)}
              subtitle={sum.subscription_count != null ? `${sum.subscription_count} ${t('cust.subCount', 'active subscription(s)')}` : undefined}
              size="sm" onClick={onOpenInvoices ? () => onOpenInvoices('PAID') : undefined}
              ariaLabel={t('cust.paidAria', 'Total paid. Click to see paid invoices.')} />
            {related.filter(([, n]) => n > 0).length > 0 && (
              <KPITile label={t('cust.related', 'Related records')} value=" " size="sm"
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

          {/* Financial Summary (Phase A.2) */}
          <div className="section-head"><CreditCardIcon size={16} className="section-icon" />{t('cust.financialSummary', 'Financial summary')}</div>
          <FinancialSummaryCard
            accounts={accounts} balances={balances} selectedAccountId={selectedAccountId}
            setSelectedAccountId={setSelectedAccountId} consolidated={consolidated}
            showConsolidated={showConsolidated} setShowConsolidated={setShowConsolidated}
            balanceFatal={balanceFatal} t={t}
          />

          {/* Related-record tabs */}
          <div role="tablist" aria-label={t('cust.relatedTabs', 'Related records')}
            style={{ display: 'flex', gap: 'var(--gx-space-2)', borderBottom: '1px solid var(--gx-border)', marginTop: 'var(--gx-space-20)', marginBottom: 'var(--gx-space-5)', paddingBottom: 0, overflowX: 'auto' }}>
            {TAB_ORDER.map((k) => {
              const rows = tabData[k]
              return (
                <CustomerTabButton key={k} active={tab === k} label={tabLabel(k, t)}
                  count={Array.isArray(rows) ? rows.length : null} icon={tabIcon(k)} onClick={() => setTab(k)} />
              )
            })}
          </div>
          <div role="tabpanel" aria-label={tabLabel(tab, t)} style={{ marginBottom: 'var(--gx-space-20)' }}>
            <CustomerTabBody tab={tab} rows={tabData[tab]} fatal={tabFatal[tab]} t={t} customerId={customerId} profile={p ?? null} />
          </div>

          {/* Services */}
          <div className="section-head"><ClockIcon size={16} className="section-icon" />{t('cust.services', 'Services')}</div>
          <ServicesTable services={services} t={t} />

          {/* Subscriptions */}
          <div className="section-head"><ReceiptIcon size={16} className="section-icon" />{t('nav.subscriptions', 'Subscriptions')}</div>
          <SubscriptionsTable subs={subs} t={t} />

          {/* Invoices */}
          <div className="section-head"><ReceiptIcon size={16} className="section-icon" />{t('nav.invoices', 'Invoices')}</div>
          <InvoicesTable invoices={invoices} canEditInvoice={canEditInvoice} onOpenInvoices={onOpenInvoices}
            onIssue={issue} onRecordPayment={setPayInvoice} t={t} />
        </>
      )}

      {payInvoice && (
        <PaymentModal token={token!} invoiceId={payInvoice.id} onClose={() => setPayInvoice(null)} onDone={() => { setPayInvoice(null); load() }} />
      )}
    </PageShell>
  )
}
