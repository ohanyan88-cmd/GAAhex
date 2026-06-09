import { useEffect, useState } from 'react'
import { bget, bpost, loadCustomers, type Invoice } from '../lib/billing'
import { money } from '../lib/money'
import { Button } from '../primitives'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner } from '../components/States'
import { ReceiptIcon, ArrowRightIcon, SearchIcon } from '../components/icons'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'
import { PageShell, type KPISpec } from '../page-shell'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { OBJ } from '../lib/permissions-constants'
import { INVOICE_OUTSTANDING } from '../lib/status-constants'
import { PayOnlineButton } from './invoices/PayOnlineButton'
import { InvoiceDetail } from './invoices/InvoiceDetail'
import { COL_CLASS, colTdClass, colTdStyle } from './invoices/types'
import { renderInvoiceCell } from './invoices/helpers'

export default function InvoicesView({
  canConfigure = false, configVersion = 0, initialStatus, capabilities = FULL_ACCESS,
}: {
  canConfigure?: boolean
  configVersion?: number
  /** Home-page / Customer 360 deep link: pre-filter the list by this status when set. */
  initialStatus?: string
  /** Per-entity caps; mutation buttons (Issue / Void / Pay / Record) gate on these. */
  capabilities?: Capabilities
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const cfg = usePageConfig(token!, 'invoices', configVersion)
  const [list, setList] = useState<Invoice[] | null>(null)
  const cf = useCustomFields('invoices', cfg.customFields, (list ?? []).map((inv) => inv.id))
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState(initialStatus ?? '')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [cycleNA, setCycleNA] = useState(false)
  const [cycleBusy, setCycleBusy] = useState(false)

  // Permission gates (rule 6) — backend re-checks too, this just hides buttons the user can't use.
  const canEditInvoice = can(capabilities, OBJ.INVOICE, 'edit')
  const canCreatePayment = can(capabilities, OBJ.PAYMENT, 'create')
  // Allocate is admin-gated server-side — front-end mirrors with payment.edit, or canConfigure as fallback.
  const canAllocatePayment = can(capabilities, OBJ.PAYMENT, 'edit') || canConfigure

  // When the parent flips the deep-link status (e.g. switching customers in 360), re-sync the filter.
  useEffect(() => { setStatus(initialStatus ?? '') }, [initialStatus])

  async function load() {
    setError(''); setUnavailable(false); setList(null)
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    const qs = p.toString()
    const res = await bget<Invoice[]>(token!, `/api/invoices${qs ? `?${qs}` : ''}`)
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (!res.ok) { setError('Failed to load invoices'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
    setNames(await loadCustomers(token!))
  }

  useEffect(() => { load() }, [token, status])

  async function runDunning() {
    try {
      await bpost(token!, '/api/invoices/run-dunning')
      toast.success(t('invoices.dunning.done', 'Dunning run complete'))
      await load()
    } catch (e) {
      const err = e as Error & { status?: number }
      toast.error(err.status === 404 ? t('invoices.dunning.na', "Dunning isn't available yet") : err.message)
    }
  }

  async function runCycle() {
    if (cycleBusy) return
    setCycleBusy(true)
    try {
      const r = await bpost<{ generated?: number; skipped?: number }>(token!, '/api/billing/run-cycle')
      const msg = t('billing.cycleResult', 'Billing cycle: {generated} generated, {skipped} skipped')
        .replace('{generated}', String(r?.generated ?? 0)).replace('{skipped}', String(r?.skipped ?? 0))
      toast.success(msg)
      await load()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 404) { setCycleNA(true); toast.error(t('billing.cycleNA', "Billing cycle isn't available yet")) }
      else toast.error(err.message)
    } finally { setCycleBusy(false) }
  }

  const cust = (inv: Invoice) => (inv.customer_id ? (names[inv.customer_id] ?? inv.customer_id.slice(0, 8)) : '—')

  // Counts + KPI aggregates (computed from loaded list — no extra API)
  const all = list ?? []
  const countFor = (s: string) => all.filter(i => (i.status ?? '').toUpperCase() === s).length
  const totalBilled = all.reduce((a, i) => a + (i.total ?? 0), 0)
  const outstanding = all.filter(i => INVOICE_OUTSTANDING.includes((i.status ?? '').toUpperCase() as any)).reduce((a, i) => a + (i.total ?? 0), 0)
  const paidCount = countFor('PAID')
  const overdueCount = countFor('OVERDUE')

  const kpis: KPISpec[] = all.length > 0 ? [
    { label: t('invoices.kpi.totalBilled', 'Total billed'), value: `֏${(totalBilled / 100000).toFixed(1)}k`, subtitle: `${all.length} invoice${all.length !== 1 ? 's' : ''}`, onClick: () => setStatus('') },
    { label: t('invoices.kpi.outstanding', 'Outstanding'), value: `֏${(outstanding / 100000).toFixed(1)}k`, subtitle: `${countFor('ISSUED')} issued · ${overdueCount} overdue`, warning: outstanding > 0, onClick: () => setStatus('ISSUED') },
    { label: t('invoices.kpi.paid', 'Paid'), value: paidCount, subtitle: `of ${all.length} invoices`, onClick: () => setStatus('PAID') },
    ...(overdueCount > 0 ? [{ label: t('invoices.kpi.overdue', 'Overdue'), value: overdueCount, subtitle: t('invoices.kpi.overdue.sub', 'action required'), danger: true, onClick: () => setStatus('OVERDUE') }] : []),
  ] : []

  const TAB_DEFS: Array<[string, string]> = [
    ['', t('common.all', 'All')],
    ['DRAFT', t('invoices.tab.draft', 'Draft')],
    ['ISSUED', t('invoices.tab.issued', 'Issued')],
    ['PAID', t('invoices.tab.paid', 'Paid')],
    ['OVERDUE', t('invoices.tab.overdue', 'Overdue')],
    ['VOID', t('invoices.tab.void', 'Void')],
  ]

  if (detailId) return (
    <InvoiceDetail
      token={token!}
      id={detailId}
      names={names}
      canEditInvoice={canEditInvoice}
      canCreatePayment={canCreatePayment}
      canAllocatePayment={canAllocatePayment}
      onBack={() => { setDetailId(null); load() }}
    />
  )

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={[t('nav.billingRevenue', 'Billing & Revenue'), cfg.title]}
      icon={<ReceiptIcon size={18} />}
      title={cfg.title}
      subtitle={t('invoices.subtitle', 'Immutable billing ledger')}
      kpis={kpis}
      secondaryActions={[
        ...(canEditInvoice ? [{ label: t('invoices.action.runDunning', 'Run dunning'), onClick: runDunning }] : []),
        ...(canConfigure && canEditInvoice && !cycleNA ? [{
          label: cycleBusy ? t('billing.running', 'Running…') : t('billing.runCycle', 'Run billing cycle'),
          onClick: runCycle,
          disabled: cycleBusy,
        }] : []),
      ]}
    >
      <div className="tabs">
        {TAB_DEFS.map(([val, label]) => {
          const count = val === '' ? all.length : countFor(val)
          return (
            <button
              key={val}
              className={'tab' + (status === val ? ' on' : '')}
              onClick={() => setStatus(val)}
            >
              {label} <span className="tab-count">{count}</span>
            </button>
          )
        })}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}
      {unavailable && <EmptyState icon={<ReceiptIcon size={40} />} title={t('invoices.unavailable.title', "Billing isn't available yet")} message={t('invoices.unavailable.msg', 'Invoices will appear here once the billing service is enabled.')} />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<ReceiptIcon size={40} />} title={t('invoices.empty.title', 'No invoices')} message={t('invoices.empty.msg', 'No invoices match this filter.')} />
      )}

      {list && list.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {cfg.columns.map((c) => <th key={c.key} scope="col" className={COL_CLASS[c.key] ?? ''}>{c.label}</th>)}
                  {cf.headers()}
                  <th scope="col" className="actions-col"><span className="sr-only">{t('common.actions', 'Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((inv) => (
                  <tr key={inv.id}>
                    {cfg.columns.map((c) => (
                      <td key={c.key} className={colTdClass(c.key)} style={colTdStyle(c.key)}>
                        {renderInvoiceCell(c.key, inv, cust)}
                      </td>
                    ))}
                    {cf.cells(inv.id)}
                    <td className="actions-col">
                      <div className="row-actions">
                        {canCreatePayment && (inv.status === 'ISSUED' || inv.status === 'OVERDUE') && (
                          <PayOnlineButton token={token!} invoiceId={inv.id} onDone={load} />
                        )}
                        <button className="iconbtn" title={t('common.open', 'Open')} onClick={() => setDetailId(inv.id)}>
                          <ArrowRightIcon size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={cfg.columns.length + 1 + cfg.customFields.length} style={{ padding: 0 }}>
                      <EmptyState
                        icon={<SearchIcon size={34} />}
                        title={t('invoices.empty.noMatch', 'No matching invoices')}
                        message={t('invoices.empty.noMatch.msg', 'Try a different status tab.')}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageShell>
  )
}
