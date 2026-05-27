import { useEffect, useState } from 'react'
import { bget, bpost, type Subscription, type Invoice } from './billing'
import { money, toMinor } from './money'
import { Modal } from './Modal'
import { toast } from './Toast'
import { ErrorBanner, PermissionDenied, NotFound } from './States'
import ActivityTimeline from './ActivityTimeline'
import InteractionsView from './InteractionsView'
import ViewHead from './ViewHead'
import {
  ChevronLeftIcon, UsersIcon, ReceiptIcon, PhoneIcon,
  ClockIcon, CreditCardIcon, DownloadIcon,
} from './icons'
import { useI18n } from './i18n'

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

// status → shared .pill variant (generic; statuses are configurable so this only tints common verbs).
function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase()
  const cls = ['ACTIVE', 'PAID', 'RESOLVED', 'WON'].includes(s) ? 'pill pill-success'
    : ['OVERDUE', 'SUSPENDED', 'CANCELLED', 'VOID', 'CHURNED', 'LOST'].includes(s) ? 'pill pill-danger'
    : ['DRAFT', 'NEW', 'PROSPECT'].includes(s) ? 'pill pill-muted'
    : 'pill'
  return status ? <span className={cls}>{status}</span> : <span>—</span>
}

export default function CustomerView({ token, customerId, onBack }: {
  token: string
  customerId: string
  onBack: () => void
}) {
  const { t } = useI18n()
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
    <div>
      <ViewHead
        icon={<UsersIcon size={16} />}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {name || t('cust.title', 'Customer')}
            {p && statusPill(p.status)}
          </span>
        }
        sub={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ padding: '2px 8px', fontSize: 12 }}>
              <ChevronLeftIcon size={12} /> {t('nav.customers', 'Customers')}
            </button>
            {p?.id && <span className="mono" style={{ color: 'var(--text-3)' }}>{p.id.slice(0, 8)}</span>}
          </span>
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
                {money(sum.outstanding)}
              </div>
              {(sum.overdue_count ?? 0) > 0 && (
                <div className="kpi-sub" style={{ color: 'var(--danger)' }}>
                  {sum.overdue_count} {t('cust.overdue', 'overdue invoice(s)')}
                </div>
              )}
            </div>

            <div className="widget">
              <div className="widget-label">{t('cust.billed', 'Total billed')}</div>
              <div className="kpi" style={{ fontSize: 30 }}>{money(sum.total_billed)}</div>
              {sum.invoice_count != null && (
                <div className="kpi-sub">{sum.invoice_count} {t('cust.invoiceCount', 'invoice(s)')}</div>
              )}
            </div>

            <div className="widget">
              <div className="widget-label">{t('cust.paid', 'Total paid')}</div>
              <div className="kpi" style={{ fontSize: 30, color: 'var(--success)' }}>{money(sum.total_paid)}</div>
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
              <div className="grid-wrap"><table className="grid">
                <thead><tr>
                  <th scope="col">{t('cust.service', 'Service')}</th>
                  <th scope="col">{t('cust.type', 'Type')}</th>
                  <th scope="col">{t('common.status', 'Status')}</th>
                  <th scope="col">{t('cust.activated', 'Activated')}</th>
                </tr></thead>
                <tbody>
                  {services.map((sv) => (
                    <tr key={sv.id}>
                      <td>{sv.name ?? sv.id.slice(0, 8)}</td>
                      <td>{sv.type ?? '—'}</td>
                      <td>{statusPill(sv.status)}</td>
                      <td>{fmtDate(sv.activated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}

          {/* Subscriptions */}
          <div className="section-head">
            <ReceiptIcon size={16} className="section-icon" />
            {t('nav.subscriptions', 'Subscriptions')}
          </div>
          {subs.length === 0
            ? <p className="muted">{t('cust.noSubs', 'No subscriptions yet.')}</p>
            : (
              <div className="grid-wrap"><table className="grid">
                <thead><tr>
                  <th scope="col">{t('subs.plan', 'Plan')}</th>
                  <th scope="col">{t('subs.amount', 'Amount')}</th>
                  <th scope="col">{t('accounts.cycle', 'Cycle')}</th>
                  <th scope="col">{t('common.status', 'Status')}</th>
                </tr></thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id}><td>{s.plan_name ?? '—'}</td><td>{money(s.amount)}</td><td>{s.cycle ?? '—'}</td><td>{statusPill(s.status)}</td></tr>
                  ))}
                </tbody>
              </table></div>
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
              <div className="grid-wrap"><table className="grid">
                <thead><tr>
                  <th scope="col">{t('invoices.number', 'Invoice')}</th>
                  <th scope="col">{t('common.status', 'Status')}</th>
                  <th scope="col">{t('invoices.total', 'Total')}</th>
                  <th scope="col">{t('invoices.due', 'Due')}</th>
                  <th scope="col"></th>
                </tr></thead>
                <tbody>
                  {invoices.map((inv) => {
                    const st = (inv.status ?? '').toUpperCase()
                    return (
                      <tr key={inv.id}>
                        <td>{inv.number ?? inv.id.slice(0, 8)}</td>
                        <td>{statusPill(inv.status)}</td>
                        <td>{money(inv.total)}</td>
                        <td>{fmtDate(inv.due_at)}</td>
                        <td className="row-actions">
                          {st === 'DRAFT' && <button className="btn btn-primary btn-sm" onClick={() => issue(inv.id)}>{t('cust.issue', 'Issue')}</button>}
                          {(st === 'ISSUED' || st === 'OVERDUE') && <button className="btn btn-accent btn-sm" onClick={() => setPayInvoice(inv)}>{t('cust.recordPayment', 'Record payment')}</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table></div>
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
