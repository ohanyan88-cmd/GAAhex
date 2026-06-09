// InvoiceDetail — file 10 (Object Detail Standard) canonical 9-tab set.
// Tab order: Overview · Timeline · Tasks · Comments · Attachments · Approvals
// · Related · Communications · Audit. The Overview tab WRAPS the existing bill
// detail + lines + totals + payments + AllocationPanel content unchanged.
import { useEffect, useState, type ReactNode } from 'react'
import { bget, bpost, openDocument, type Invoice, type Payment } from '../../lib/billing'
import { money } from '../../lib/money'
import { fmtDate } from '../../lib/time'
import { Button, DetailTab } from '../../primitives'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/Toast'
import { ErrorBanner } from '../../components/States'
import {
  ReceiptIcon, ChevronLeftIcon, PrinterIcon, CreditCardIcon,
  InfoIcon, ClockIcon, CheckIcon, MessageIcon, PaperclipIcon,
  ShieldIcon, LayersIcon, MailIcon, ActivityIcon,
} from '../../components/icons'
import { PageShell, Stack, Card, SectionHeading, Inline } from '../../page-shell'
import TimelineTab from '../customer-tabs/TimelineTab'
import TasksTab from '../customer-tabs/TasksTab'
import CommentsTab from '../customer-tabs/CommentsTab'
import AttachmentsTab from '../customer-tabs/AttachmentsTab'
import ApprovalsTab from '../customer-tabs/ApprovalsTab'
import RelatedTab from '../customer-tabs/RelatedTab'
import CommunicationsTab from '../customer-tabs/CommunicationsTab'
import AuditTab from '../customer-tabs/AuditTab'
import {
  INVOICE_TAB_ORDER, invoiceTabLabel, type InvoiceTabKey,
} from './types'
import { statusPill } from './helpers'
import { PayOnlineButton } from './PayOnlineButton'
import { PaymentModal } from './PaymentModal'
import { AllocationPanel } from './AllocationPanel'

// TB-2 — local InvoiceTabButton delegates to the canonical `DetailTab`
// primitive (identical recipe across InvoicesView and AccountsView pre-dedupe).
function InvoiceTabButton({ active, label, icon, onClick }: {
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

function invoiceTabIcon(k: InvoiceTabKey): ReactNode {
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

export function InvoiceDetail({ token, id, names, canEditInvoice, canCreatePayment, canAllocatePayment, onBack }: {
  token: string
  id: string
  names: Record<string, string>
  canEditInvoice: boolean
  canCreatePayment: boolean
  canAllocatePayment: boolean
  onBack: () => void
}) {
  const [inv, setInv] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [error, setError] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  // Canonical Object Detail tab — defaults to Overview (file 10).
  const [tab, setTab] = useState<InvoiceTabKey>('overview')

  async function load() {
    setError('')
    const res = await bget<Invoice>(token, `/api/invoices/${id}`)
    if (!res.ok) { setError(res.status === 404 ? 'Invoice not found' : 'Failed to load invoice'); return }
    setInv(res.data)
    const pr = await bget<Payment[]>(token, `/api/invoices/${id}/payments`)
    if (pr.ok && Array.isArray(pr.data)) setPayments(pr.data)
  }

  useEffect(() => { load() }, [token, id])

  async function issue() {
    try {
      await bpost(token, `/api/invoices/${id}/issue`)
      toast.success('Invoice issued')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function voidInvoice() {
    if (!window.confirm('Void this invoice? This cannot be undone.')) return
    try {
      await bpost(token, `/api/invoices/${id}/void`)
      toast.success('Invoice voided')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const lines = inv?.lines ?? []
  const status = (inv?.status ?? '').toUpperCase()
  const cust = inv?.customer_id ? (names[inv.customer_id] ?? inv.customer_id.slice(0, 8)) : '—'

  return (
    <PageShell
      type="WORKSPACE"
      breadcrumb={['Billing & Revenue', 'Invoices', inv?.number ?? `Invoice ${id.slice(0, 8)}`]}
      icon={<ReceiptIcon size={18} />}
      title={inv?.number ?? `Invoice ${id.slice(0, 8)}`}
      subtitle={inv ? `Customer: ${cust}` : undefined}
      secondaryActions={[
        { label: 'Invoices', icon: <ChevronLeftIcon size={14} />, onClick: onBack },
      ]}
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!inv && !error && <p className="muted">Loading…</p>}

      {inv && (
        <>
          {/* Canonical Object Detail tabs (file 10) — render BEFORE any object-specific tabs.
              The bill detail + lines + totals + payments + AllocationPanel live in Overview. */}
          <div
            role="tablist"
            aria-label="Object Detail tabs"
            style={{
              display: 'flex',
              gap: 'var(--gx-space-2)',
              borderBottom: '1px solid var(--gx-border)',
              marginBottom: 'var(--gx-space-5)',
              overflowX: 'auto',
            }}
          >
            {INVOICE_TAB_ORDER.map((k) => (
              <InvoiceTabButton
                key={k}
                active={tab === k}
                label={invoiceTabLabel(k)}
                icon={invoiceTabIcon(k)}
                onClick={() => setTab(k)}
              />
            ))}
          </div>

          <div role="tabpanel" aria-label={invoiceTabLabel(tab)}>
            {tab === 'overview' && (
              <Stack gap="lg">
                <Card pad="md">
                  <SectionHeading
                    icon={<InfoIcon size={14} />}
                    title="Invoice summary"
                    action={
                      <Inline gap="sm" align="center">
                        {canEditInvoice && status === 'DRAFT' && (
                          <Button variant="primary" size="sm" onClick={issue}>Issue</Button>
                        )}
                        {canCreatePayment && (status === 'ISSUED' || status === 'OVERDUE') && (
                          <PayOnlineButton token={token} invoiceId={id} onDone={load} />
                        )}
                        {canCreatePayment && (status === 'ISSUED' || status === 'OVERDUE') && (
                          <Button variant="primary" size="sm" onClick={() => setPayOpen(true)}>Record payment</Button>
                        )}
                        {canEditInvoice && (status === 'ISSUED' || status === 'OVERDUE') && (
                          <Button variant="ghost" size="sm" onClick={voidInvoice}>Void</Button>
                        )}
                        <Button variant="ghost" size="sm"
            onClick={async () => {
                            const e = await openDocument(token, `/api/invoices/${id}/document`)
                            if (e) toast.error(e)
                          }}
                        >
                          <PrinterIcon size={14} /> Print / Download
                        </Button>
                      </Inline>
                    }
                  />
                  <div className="bill-meta">
                    <div><span className="muted">Customer</span><div>{cust}</div></div>
                    <div><span className="muted">Status</span><div>{statusPill(inv.status)}</div></div>
                    <div><span className="muted">Issued</span><div className="mono">{fmtDate(inv.issued_at ?? inv.created_at)}</div></div>
                    <div><span className="muted">Due</span><div className="mono">{fmtDate(inv.due_at)}</div></div>
                  </div>
                </Card>

                <Card pad="md">
                  <SectionHeading icon={<LayersIcon size={14} />} title="Line items" />
                  <table className="grid bill-lines">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="num">Qty</th>
                        <th className="num">Unit (֏)</th>
                        <th className="num">Amount (֏)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const negative = (l.line_total ?? 0) < 0
                        return (
                          <tr key={l.id ?? i}>
                            <td>{l.description ?? '—'}</td>
                            <td className="num">{l.quantity ?? 1}</td>
                            <td className={`num${negative ? ' amt-neg' : ''}`}>{money(l.unit_amount)}</td>
                            <td className={`num${negative ? ' amt-neg' : ''}`}>{money(l.line_total)}</td>
                          </tr>
                        )
                      })}
                      {lines.length === 0 && (
                        <tr><td colSpan={4} className="muted">No line items.</td></tr>
                      )}
                    </tbody>
                  </table>

                  <div className="bill-totals">
                    <div className="bill-total-row"><span>Total</span><span>{money(inv.total)}</span></div>
                    {inv.balance !== undefined && (
                      <>
                        <div className="bill-total-row"><span>Paid</span><span>{money(inv.paid_total)}</span></div>
                        <div className="bill-total-row">
                          <span>Balance due</span>
                          <span style={{ color: (inv.balance ?? 0) > 0 ? 'var(--gx-danger)' : 'var(--gx-success)' }}>
                            {money(inv.balance)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </Card>

                {payments.length > 0 && (
                  <Card pad="md">
                    <SectionHeading icon={<CreditCardIcon size={14} />} title="Payments recorded" />
                    <table className="grid">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Method</th>
                          <th className="num">Amount (֏)</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map(p => (
                          <tr key={p.id}>
                            <td className="mono">{fmtDate(p.paid_at)}</td>
                            <td style={{ textTransform: 'capitalize' }}>{p.method}</td>
                            <td className="num">{money(p.amount)}</td>
                            <td className="muted">{p.note ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                )}

                <AllocationPanel
                  token={token}
                  invoiceId={id}
                  canAllocate={canAllocatePayment}
                  onChanged={load}
                />
              </Stack>
            )}
            {/* TB-4 — invoice detail tabs now reuse the canonical `customer-tabs/*`
                components (parameterized over entity + id). The 8 Invoice*Tab
                local copies were deleted — ~250 LOC of pure copy-paste. */}
            {tab === 'timeline'       && <TimelineTab entity="invoice" id={id} />}
            {tab === 'tasks'          && <TasksTab entity="invoice" id={id} />}
            {tab === 'comments'       && <CommentsTab entity="invoice" id={id} />}
            {tab === 'attachments'    && <AttachmentsTab entity="invoice" id={id} />}
            {tab === 'approvals'      && <ApprovalsTab entity="invoice" id={id} />}
            {tab === 'related'        && <RelatedTab entity="invoice" id={id} />}
            {tab === 'communications' && <CommunicationsTab entity="invoice" id={id} />}
            {tab === 'audit'          && <AuditTab entity="invoice" id={id} />}
          </div>
        </>
      )}

      {payOpen && (
        <PaymentModal
          token={token}
          invoiceId={id}
          onClose={() => setPayOpen(false)}
          onDone={() => { setPayOpen(false); load() }}
        />
      )}
    </PageShell>
  )
}
