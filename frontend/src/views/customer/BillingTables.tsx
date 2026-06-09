import { money } from '../../lib/money'
import { EmptyState } from '../../components/States'
import { StatusPill, Button } from '../../primitives'
import { fmtDate } from '../../lib/time'
import type { Service, Invoice } from './types'
import type { Subscription } from '../../lib/billing'
import { mapCustomerStatus } from './utils'

// ─── ServicesTable ────────────────────────────────────────────────────────────

export function ServicesTable({ services, t }: {
  services: Service[]
  t: (k: string, fb?: string) => string
}) {
  if (services.length === 0) {
    return <EmptyState title={t('cust.noServices', 'No services yet.')} message={t('cust.noServices.msg', 'Activated services for this customer will be listed here.')} />
  }
  return (
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
  )
}

// ─── SubscriptionsTable ───────────────────────────────────────────────────────

export function SubscriptionsTable({ subs, t }: {
  subs: Subscription[]
  t: (k: string, fb?: string) => string
}) {
  if (subs.length === 0) {
    return <EmptyState title={t('cust.noSubs', 'No subscriptions yet.')} message={t('cust.noSubs.msg', 'Active subscriptions tied to this customer will appear here.')} />
  }
  return (
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
  )
}

// ─── InvoicesTable ────────────────────────────────────────────────────────────

export function InvoicesTable({ invoices, canEditInvoice, onOpenInvoices, onIssue, onRecordPayment, t }: {
  invoices: Invoice[]
  canEditInvoice: boolean
  onOpenInvoices?: (initialStatus?: string) => void
  onIssue: (id: string) => void
  onRecordPayment: (inv: Invoice) => void
  t: (k: string, fb?: string) => string
}) {
  if (invoices.length === 0) {
    return <EmptyState title={t('cust.noInvoices', 'No invoices yet.')} message={t('cust.noInvoices.msg', 'Invoices issued to this customer will be listed here.')} />
  }
  return (
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
                    {canEditInvoice && st === 'DRAFT' && <Button variant="primary" size="sm" onClick={() => onIssue(inv.id)}>{t('cust.issue', 'Issue')}</Button>}
                    {canEditInvoice && (st === 'ISSUED' || st === 'OVERDUE') && <Button variant="primary" size="sm" onClick={() => onRecordPayment(inv)}>{t('cust.recordPayment', 'Record payment')}</Button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
