import { EmptyState } from '../../components/States'
import {
  InfoIcon, ClockIcon, CheckIcon, MessageIcon, PaperclipIcon,
  ShieldIcon, LayersIcon, MailIcon, ActivityIcon,
  CreditCardIcon, PhoneIcon, ServerIcon, FolderIcon, WarningIcon,
} from '../../components/icons'
import { StatusPill, DetailTab } from '../../primitives'
import { fmtDate } from '../../lib/time'
import OverviewTab from '../customer-tabs/OverviewTab'
import TimelineTab from '../customer-tabs/TimelineTab'
import TasksTab from '../customer-tabs/TasksTab'
import CommentsTab from '../customer-tabs/CommentsTab'
import AttachmentsTab from '../customer-tabs/AttachmentsTab'
import ApprovalsTab from '../customer-tabs/ApprovalsTab'
import RelatedTab from '../customer-tabs/RelatedTab'
import CommunicationsTab from '../customer-tabs/CommunicationsTab'
import AuditTab from '../customer-tabs/AuditTab'
import type { TabKey, EntityRow, SlaRow, Profile } from './types'
import { mapCustomerStatus, relTime } from './utils'
import type React from 'react'

// tabIcon lives here (not utils.ts) because it returns JSX and needs a .tsx context.
export function tabIcon(k: TabKey): React.ReactNode {
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
export function CustomerTabButton({ active, label, count, icon, onClick }: {
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
export function CustomerTabBody({ tab, rows, fatal, t, customerId, profile }: {
  tab: TabKey
  rows: any[] | null | undefined
  fatal: '' | 'denied' | 'notfound' | 'error'
  t: (k: string, fb?: string) => string
  customerId: string
  profile: Profile | null
}) {
  // ── Canonical Object Detail tabs (file 10) ────────────────────────────────────
  // These nine come BEFORE the customer-specific tabs and each self-fetches.
  if (tab === 'overview')       return <OverviewTab customerId={customerId} profile={profile} />
  if (tab === 'timeline')       return <TimelineTab entity="customer" id={customerId} />
  if (tab === 'tasks')          return <TasksTab entity="customer" id={customerId} />
  if (tab === 'comments')       return <CommentsTab entity="customer" id={customerId} />
  if (tab === 'attachments')    return <AttachmentsTab entity="customer" id={customerId} />
  if (tab === 'approvals')      return <ApprovalsTab entity="customer" id={customerId} />
  if (tab === 'related')        return <RelatedTab entity="customer" id={customerId} />
  if (tab === 'communications') return <CommunicationsTab entity="customer" id={customerId} />
  if (tab === 'audit')          return <AuditTab entity="customer" id={customerId} />

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
  // Dispatch per-tab renderer.
  if (tab === 'accounts')  return <AccountsTabBody rows={rows} t={t} />
  if (tab === 'contacts')  return <ContactsTabBody rows={rows} t={t} />
  if (tab === 'sites')     return <SitesTabBody rows={rows} t={t} />
  if (tab === 'contracts') return <ContractsTabBody rows={rows} t={t} />
  return <SlasTabBody rows={rows} t={t} />
}

// ─── Tab body components ──────────────────────────────────────────────────────

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
