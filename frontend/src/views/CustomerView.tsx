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
  ClockIcon, CreditCardIcon, DownloadIcon, GearIcon,
} from '../components/icons'
import { useI18n } from '../lib/i18n'
import { usePageConfig } from '../lib/pageConfig'
import { StatusPill } from '../primitives'

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
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

export default function CustomerView({ token, customerId, onBack, configVersion = 0, canConfigure = false, onConfigure }: {
  token: string
  customerId: string
  onBack: () => void
  configVersion?: number
  canConfigure?: boolean
  onConfigure?: () => void
}) {
  const { t } = useI18n()
  // Hook called so the Configure button (via BESPOKE_PAGE_KEYS) lights up for this page.
  usePageConfig(token, 'customer', configVersion)
  const [data, setData] = useState<C360 | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState('')
  const [fatal, setFatal] = useState<null | 'denied' | 'notfound'>(null)
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null)

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
        {!data && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}

        {data && (
          <>
            {/* 360 stat widgets — outstanding / billed / paid / overdue */}
            <div className="widgets" style={{ marginBottom: 22 }}>
              <div className="widget">
                <div className="widget-label">
                  <CreditCardIcon size={12} className="widget-label-icon" />
                  {t('cust.outstanding', 'Outstanding')}
                </div>
                <div className="kpi" style={{ fontSize: 30, color: (sum.outstanding ?? 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  <span className="mono tnum">{money(sum.outstanding)}</span>
                </div>
                {(sum.overdue_count ?? 0) > 0 && (
                  <div className="kpi-sub" style={{ color: 'var(--danger)' }}>
                    {sum.overdue_count} {t('cust.overdue', 'overdue invoice(s)')}
                  </div>
                )}
              </div>

              <div className="widget">
                <div className="widget-label">{t('cust.billed', 'Total billed')}</div>
                <div className="kpi" style={{ fontSize: 30 }}>
                  <span className="mono tnum">{money(sum.total_billed)}</span>
                </div>
                {sum.invoice_count != null && (
                  <div className="kpi-sub">{sum.invoice_count} {t('cust.invoiceCount', 'invoice(s)')}</div>
                )}
              </div>

              <div className="widget">
                <div className="widget-label">{t('cust.paid', 'Total paid')}</div>
                <div className="kpi" style={{ fontSize: 30, color: 'var(--success)' }}>
                  <span className="mono tnum">{money(sum.total_paid)}</span>
                </div>
                {sum.subscription_count != null && (
                  <div className="kpi-sub">{sum.subscription_count} {t('cust.subCount', 'active subscription(s)')}</div>
                )}
              </div>

              {/* Related CRM counts in compact widget */}
              {related.filter(([, n]) => n > 0).length > 0 && (
                <div className="widget">
                  <div className="widget-label">{t('cust.related', 'Related records')}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {related.filter(([, n]) => n > 0).map(([key, n]) => (
                      <span key={key} className="pill">{key} · {n}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

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
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm">
                <DownloadIcon size={13} /> {t('cust.statement', 'Statement')}
              </button>
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
                        <th scope="col"></th>
                      </tr></thead>
                      <tbody>
                        {invoices.map((inv) => {
                          const st = (inv.status ?? '').toUpperCase()
                          return (
                            <tr key={inv.id}>
                              <td><span className="mono">{inv.number ?? inv.id.slice(0, 8)}</span></td>
                              <td>{inv.status ? <StatusPill variant={mapCustomerStatus(inv.status)} label={inv.status} size="sm" /> : <span>—</span>}</td>
                              <td className="num"><span className="mono tnum">{money(inv.total)}</span></td>
                              <td><span className="mono">{fmtDate(inv.due_at)}</span></td>
                              <td className="row-actions">
                                {st === 'DRAFT' && <button className="btn btn-primary btn-sm" onClick={() => issue(inv.id)}>{t('cust.issue', 'Issue')}</button>}
                                {(st === 'ISSUED' || st === 'OVERDUE') && <button className="btn btn-accent btn-sm" onClick={() => setPayInvoice(inv)}>{t('cust.recordPayment', 'Record payment')}</button>}
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
