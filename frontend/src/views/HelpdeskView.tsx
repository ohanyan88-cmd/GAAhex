import { useEffect, useState } from 'react'
import {
  listQueues, createQueue, listTickets, createTicket,
  assignTicket, resolveTicket, reopenTicket, closeTicket, getTicket,
  type Queue, type Ticket, type TicketFilters, type TicketPriority, type TicketStatus,
} from '../lib/helpdesk'
import { loadCustomers } from '../lib/billing'
import { listUsers, type User } from '../lib/users'
import UserPicker, { resolveUserDisplay } from '../components/UserPicker'
import { Modal } from '../components/Modal'
import RecordDrawer, { type RecordDrawerField } from '../components/RecordDrawer'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, SkeletonRows } from '../components/States'
import { InboxIcon, ArrowRightIcon } from '../components/icons'
import { Plus, Check, X as XIcon, UserPlus, RotateCcw } from 'lucide-react'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { Button, StatusPill, Input, FormField, DataTableCell } from '../primitives'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { humanizeStatus } from '../lib/humanize'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'

// ── Helpers ───────────────────────────────────────────────────────────────────

// DF-4/5 — the local `fmtDate` here was a date+time formatter (used
// `toLocaleString`, not `toLocaleDateString`). Renamed and delegated to the
// canonical `fmtDateTime` to match its actual behavior.
import { fmtDateTime as fmtDate } from '../lib/time'

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// Priority → StatusPill variant. Mapping (real values: low | normal | high | urgent):
//   urgent → critical · high → degraded · normal → info · low → neutral
type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

function priorityPill(priority: string | null | undefined) {
  if (!priority) return <span className="muted">—</span>
  const p = priority.toLowerCase()
  const variant: PillVariant = p === 'urgent' ? 'critical'
    : p === 'high' ? 'degraded'
    : p === 'low' ? 'neutral'
    : 'info'
  return <StatusPill variant={variant} label={humanizeStatus(priority)} size="sm" />
}

// Status → StatusPill variant. Mapping (real values: open | in_progress | pending | resolved | closed):
//   open → info · in_progress → active · pending → degraded · resolved → neutral · closed → neutral
function statusPill(status: string | null | undefined) {
  if (!status) return <span className="muted">—</span>
  const s = status.toLowerCase()
  const variant: PillVariant = s === 'in_progress' ? 'active'
    : s === 'pending' ? 'degraded'
    : s === 'resolved' || s === 'closed' ? 'neutral'
    : 'info'
  return <StatusPill variant={variant} label={humanizeStatus(status)} size="sm" />
}

// SLA badge per spec:
//   sla_breached → critical · due within 1h → degraded · no sla_due_at → em-dash (muted) · otherwise → muted date
function SlaBadge({ ticket }: { ticket: Ticket }) {
  if (!ticket.sla_due_at) return <span className="muted">—</span>
  if (ticket.sla_breached) {
    return <span title={fmtDate(ticket.sla_due_at)}><StatusPill variant="critical" label="Breached" size="sm" /></span>
  }
  const dueMs = new Date(ticket.sla_due_at).getTime()
  const nowMs = Date.now()
  const hourMs = 60 * 60 * 1000
  if (dueMs - nowMs <= hourMs && dueMs > nowMs) {
    return <span title={fmtDate(ticket.sla_due_at)}><StatusPill variant="degraded" label="Due soon" size="sm" /></span>
  }
  return <span className="muted" title={fmtDate(ticket.sla_due_at)}>{fmtDateShort(ticket.sla_due_at)}</span>
}

const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
]

const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent']

// ── Main view ─────────────────────────────────────────────────────────────────

export default function HelpdeskView({
  token, canConfigure = false, configVersion = 0, capabilities = FULL_ACCESS,
  initialStatus, initialOpenTicketId, openTicketId,
}: {
  token: string
  canConfigure?: boolean
  configVersion?: number
  capabilities?: Capabilities
  /** Home-page deep link: page mounts with this status preselected in the filter.
   * Backend enums are uppercase (OPEN, IN_PROGRESS, ...); we normalize to uppercase
   * for the API call. The pill mapper lowercases for display. */
  initialStatus?: string
  /** Home-page deep link: open the ticket detail modal for this ticket on mount.
   * `openTicketId` is the canonical name used by DashboardView; `initialOpenTicketId`
   * is accepted as an alias for backward compatibility. */
  openTicketId?: string
  initialOpenTicketId?: string
}) {
  const cfg = usePageConfig(token, 'helpdesk', configVersion)
  const canCreateTicket = can(capabilities, 'helpdesk_ticket', 'create')
  const canEditTicket = can(capabilities, 'helpdesk_ticket', 'edit')

  const [queues, setQueues] = useState<Queue[]>([])
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const cf = useCustomFields(token, 'helpdesk', cfg.customFields, (tickets ?? []).map((t) => t.id))
  const [names, setNames] = useState<Record<string, string>>({})
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  // Filters — store the UI/display form (lowercase); API call uppercases it.
  const [statusFilter, setStatusFilter] = useState((initialStatus ?? '').toLowerCase())
  const [queueFilter, setQueueFilter] = useState('')
  const [mineOnly, setMineOnly] = useState(false)

  // UI state — `openTicketId` is the canonical prop name; fall back to alias.
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(openTicketId ?? initialOpenTicketId ?? null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createQueueOpen, setCreateQueueOpen] = useState(false)

  // Ticket counts per queue (derived from loaded tickets for sidebar)
  const [queueCounts, setQueueCounts] = useState<Record<string, number>>({})

  async function loadQueues() {
    const res = await listQueues(token)
    if (res.ok && Array.isArray(res.data)) setQueues(res.data)
  }

  async function loadData() {
    setError('')
    setUnavailable(false)
    setTickets(null)

    // Backend stores statuses uppercase (OPEN, IN_PROGRESS, ...) — uppercase before send.
    const filters: TicketFilters = {
      status: statusFilter ? statusFilter.toUpperCase() : '',
      mine: mineOnly,
    }
    // Use selectedQueue if sidebar was clicked, otherwise the dropdown filter
    const effectiveQueue = selectedQueue ?? queueFilter
    if (effectiveQueue) filters.queue = effectiveQueue

    const res = await listTickets(token, filters)
    if (res.status === 404) { setUnavailable(true); setTickets([]); return }
    if (!res.ok) { setError('Failed to load tickets'); setTickets([]); return }
    const list = Array.isArray(res.data) ? res.data : []
    setTickets(list)

    // Recompute counts across ALL tickets for the queue rail (load without filters)
    const allRes = await listTickets(token, {})
    if (allRes.ok && Array.isArray(allRes.data)) {
      const counts: Record<string, number> = {}
      for (const t of allRes.data) {
        if (t.queue_id) counts[t.queue_id] = (counts[t.queue_id] ?? 0) + 1
      }
      setQueueCounts(counts)
    }

    setNames(await loadCustomers(token))
    // Load users for the assignee column — real names rather than UUID slices.
    const usersRes = await listUsers(token)
    if (usersRes.ok && Array.isArray(usersRes.data)) setUsers(usersRes.data)
  }

  useEffect(() => { loadQueues() }, [token])
  useEffect(() => { loadData() }, [token, statusFilter, queueFilter, mineOnly, selectedQueue])

  // Derive KPIs from loaded tickets
  const allTickets = tickets ?? []
  const kpis: KPISpec[] = tickets !== null ? [
    { label: 'Open',        value: allTickets.filter(t => (t.status ?? '').toUpperCase() === 'OPEN').length },
    { label: 'Assigned',    value: allTickets.filter(t => t.assigned_agent_id != null).length },
    { label: 'In Progress', value: allTickets.filter(t => (t.status ?? '').toUpperCase() === 'IN_PROGRESS').length },
    { label: 'Escalated',   value: allTickets.filter(t => (t.status ?? '').toUpperCase() === 'ESCALATED').length, warning: true },
    { label: 'Resolved',    value: allTickets.filter(t => (t.status ?? '').toUpperCase() === 'RESOLVED').length },
  ] : []

  if (unavailable) {
    return (
      <PageShell
        type="OPERATIONS"
        breadcrumb={['Tech & NOC', 'Support Tickets']}
        icon={<InboxIcon size={18} />}
        title="Support Tickets"
        subtitle="Helpdesk queue · SLA tracking"
      >
        <EmptyState
          icon={<InboxIcon size={40} />}
          title="Helpdesk isn't available yet"
          message="Ticket support will appear here once the helpdesk service is enabled."
        />
      </PageShell>
    )
  }

  return (
    <PageShell
      type="OPERATIONS"
      breadcrumb={['Tech & NOC', 'Support Tickets']}
      icon={<InboxIcon size={18} />}
      title="Support Tickets"
      subtitle="Helpdesk queue · SLA tracking"
      kpis={kpis.length > 0 ? kpis : undefined}
      primaryAction={canCreateTicket ? { label: 'New ticket', onClick: () => setCreateOpen(true) } : undefined}
    >

      <div className="hd-shell">
        {/* Left rail — queues (carded) */}
        <aside className="card hd-rail" aria-label="Helpdesk queues">
          <div className="hd-rail-head">
            <span className="hd-rail-label">Queues</span>
            {canConfigure && (
              <Button variant="ghost" size="sm" leftIcon={Plus} onClick={() => setCreateQueueOpen(true)} aria-label="Create queue">
                <span className="sr-only">Create queue</span>
              </Button>
            )}
          </div>
          <div className="hd-rail-list">
            <button
              className={'hd-rail-item' + (!selectedQueue ? ' on' : '')}
              onClick={() => { setSelectedQueue(null); setQueueFilter('') }}
            >
              <span className="hd-rail-name">All tickets</span>
            </button>
            {queues.map((q) => (
              <button
                key={q.id}
                className={'hd-rail-item' + (selectedQueue === q.id ? ' on' : '')}
                onClick={() => setSelectedQueue(q.id)}
                title={q.description ?? undefined}
              >
                <span className="hd-rail-name">{q.name}</span>
                {queueCounts[q.id] != null && (
                  <span className="pill pill-muted hd-rail-count">{queueCounts[q.id]}</span>
                )}
              </button>
            ))}
            {queues.length === 0 && <p className="muted hd-rail-empty">No queues yet.</p>}
          </div>
        </aside>

        {/* Main column — filters + ticket list (carded) */}
        <div className="hd-main">
          <div className="card hd-card">
            <div className="list-toolbar hd-toolbar">
              <div className="bill-filter">
                <span className="muted export-label">Status</span>
                <select className="inp inp-sm" aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              {!selectedQueue && queues.length > 0 && (
                <div className="bill-filter">
                  <span className="muted export-label">Queue</span>
                  <select className="inp inp-sm" aria-label="Filter by queue" value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)}>
                    <option value="">All</option>
                    {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                  </select>
                </div>
              )}
              <label className="hd-mine">
                <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                My tickets
              </label>
            </div>

            {error && <ErrorBanner message={error} onRetry={loadData} />}
            {tickets === null && !error && (
              <div className="hd-skel-pad">
                <SkeletonRows rows={6} />
              </div>
            )}
            {tickets && tickets.length === 0 && !error && (
              <EmptyState
                icon={<InboxIcon size={40} />}
                title="No tickets yet"
                message="Create a ticket or adjust your filters."
                action={canCreateTicket ? (
                  <Button variant="primary" size="sm" leftIcon={Plus} onClick={() => setCreateOpen(true)}>New ticket</Button>
                ) : undefined}
              />
            )}

            {tickets && tickets.length > 0 && (
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      {cfg.columns.map((col) => (
                        <th key={col.key} scope="col">{col.label}</th>
                      ))}
                      {cf.headers()}
                      <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      // NOTE: kept as a plain row (not <DataTableRow>) because the click guard below —
                      // ignore clicks that land on an inline-edit custom-field cell (td[role="button"]) —
                      // needs the click event, which DataTableRow's onClick() signature doesn't expose.
                      <tr key={t.id} className="row-link" onClick={(e) => { if (!(e.target as Element).closest('td[role="button"]')) setDetailId(t.id) }} style={{ cursor: 'pointer' }}>
                        {cfg.columns.map((col) => {
                          if (col.key === 'subject') return <DataTableCell key={col.key} variant="default" width="260px"><span style={{ fontWeight: 'var(--gx-weight-semibold)' }}>{t.subject}</span></DataTableCell>
                          if (col.key === 'customer') return <DataTableCell key={col.key} variant="mono">{t.customer_id ? (names[t.customer_id] ?? t.customer_id.slice(0, 8)) : '—'}</DataTableCell>
                          if (col.key === 'priority') return <DataTableCell key={col.key} variant="default">{priorityPill(t.priority)}</DataTableCell>
                          if (col.key === 'status') return <DataTableCell key={col.key} variant="default">{statusPill(t.status)}</DataTableCell>
                          if (col.key === 'assignee') return <DataTableCell key={col.key} variant="default">{resolveUserDisplay(t.assigned_agent_id, users)}</DataTableCell>
                          if (col.key === 'sla') return <DataTableCell key={col.key} variant="default"><SlaBadge ticket={t} /></DataTableCell>
                          return null
                        })}
                        {cf.cells(t.id)}
                        <DataTableCell variant="muted" align="right" width="32px">
                          <ArrowRightIcon size={14} />
                        </DataTableCell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ticket detail modal */}
      {detailId && (
        <TicketDetailModal
          token={token}
          id={detailId}
          queues={queues}
          names={names}
          users={users}
          canEdit={canEditTicket}
          onClose={() => { setDetailId(null); loadData() }}
        />
      )}

      {/* Create ticket modal */}
      {createOpen && (
        <CreateTicketModal
          token={token}
          queues={queues}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); loadData() }}
        />
      )}

      {/* Create queue modal */}
      {createQueueOpen && canConfigure && (
        <CreateQueueModal
          token={token}
          onClose={() => setCreateQueueOpen(false)}
          onDone={() => { setCreateQueueOpen(false); loadQueues() }}
        />
      )}
    </PageShell>
  )
}

// ── Ticket Detail Drawer ──────────────────────────────────────────────────────
//
// Migrated to RecordDrawer (kit slide-over pattern). The detail panel now:
//   - Slides in from the right at 520px (kit `.gx-drawer` width)
//   - Hero header: ticket subject + TKT/<id> + status pill
//   - `.kv` two-column grid for Customer / Priority / Queue / Assignee / SLA / Created
//   - ONE ✕ in the header (RecordDrawer renders it)
//   - ONE action row in the drawer header: Resolve · Reopen · Close · Assign
//
// Replaces the previous Modal size="lg" implementation that rendered full-bleed
// with content cramped to the left and a redundant footer "Close" button.

function TicketDetailModal({
  token, id, queues, names, users, canEdit, onClose,
}: {
  token: string
  id: string
  queues: Queue[]
  names: Record<string, string>
  users: User[]
  canEdit: boolean
  onClose: () => void
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [error, setError] = useState('')
  const [agentId, setAgentId] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setError('')
    const res = await getTicket(token, id)
    if (!res.ok) { setError(res.status === 404 ? 'Ticket not found' : 'Failed to load ticket'); return }
    setTicket(res.data)
    setAgentId(res.data?.assigned_agent_id ?? '')
  }

  useEffect(() => { load() }, [token, id])

  async function handleAssign() {
    if (!agentId.trim() || busy) return
    setBusy(true)
    try {
      await assignTicket(token, id, agentId.trim())
      toast.success('Ticket assigned')
      await load()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  async function handleAction(action: 'resolve' | 'reopen' | 'close') {
    if (busy) return
    setBusy(true)
    try {
      if (action === 'resolve') await resolveTicket(token, id)
      else if (action === 'reopen') await reopenTicket(token, id)
      else await closeTicket(token, id)
      toast.success(`Ticket ${action}d`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  const status = (ticket?.status ?? '').toLowerCase() as TicketStatus | ''
  const canResolve = canEdit && (status === 'open' || status === 'in_progress' || status === 'pending')
  const canReopen = canEdit && (status === 'resolved' || status === 'closed')
  const canClose = canEdit && status !== '' && status !== 'closed'
  const queueName = ticket?.queue_id ? (queues.find((q) => q.id === ticket.queue_id)?.name ?? ticket.queue_id.slice(0, 8)) : '—'
  const custName = ticket?.customer_id ? (names[ticket.customer_id] ?? ticket.customer_id.slice(0, 8)) : '—'
  const assigneeName = resolveUserDisplay(ticket?.assigned_agent_id, users)

  // Map ticket status → RecordDrawer status pill variant.
  function drawerStatus(s: string | null | undefined) {
    if (!s) return undefined
    const k = s.toLowerCase()
    const variant: 'active' | 'degraded' | 'critical' | 'neutral' | 'info' =
      k === 'in_progress' ? 'active'
      : k === 'pending' ? 'degraded'
      : k === 'resolved' || k === 'closed' ? 'neutral'
      : 'info'
    return { label: humanizeStatus(s), variant }
  }

  const fields: RecordDrawerField[] = ticket ? [
    { key: 'customer', label: 'Customer', value: custName },
    { key: 'priority', label: 'Priority', value: priorityPill(ticket.priority) },
    { key: 'queue', label: 'Queue', value: queueName },
    { key: 'assignee', label: 'Assignee', value: assigneeName },
    { key: 'sla', label: 'SLA due', value: fmtDate(ticket.sla_due_at) },
    { key: 'created', label: 'Created', value: fmtDate(ticket.created_at) },
    ...(ticket.body ? [{
      key: 'description',
      label: 'Description',
      value: <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{ticket.body}</span>,
    }] : []),
    ...(canEdit ? [{
      key: 'reassign',
      label: 'Re-assign',
      value: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
          <UserPicker
            token={token}
            value={agentId}
            onChange={setAgentId}
            className="inp inp-sm"
            aria-label="Agent to assign"
          />
          <Button variant="primary" size="sm" leftIcon={UserPlus} disabled={busy || !agentId.trim()} onClick={handleAssign}>
            Assign
          </Button>
        </div>
      ),
    }] : []),
  ] : []

  return (
    <>
      <RecordDrawer
        open
        onClose={onClose}
        entityKey="TKT"
        id={ticket ? ticket.id.slice(0, 8) : id.slice(0, 8)}
        title={ticket ? ticket.subject : 'Loading ticket…'}
        subtitle={ticket && ticket.customer_id ? custName : undefined}
        status={drawerStatus(ticket?.status)}
        fields={fields}
        footer={
          canEdit && ticket ? (
            <>
              {canClose && (
                <Button variant="ghost" size="sm" leftIcon={XIcon} disabled={busy} onClick={() => handleAction('close')}>
                  Close ticket
                </Button>
              )}
              {canReopen && (
                <Button variant="secondary" size="sm" leftIcon={RotateCcw} disabled={busy} onClick={() => handleAction('reopen')}>
                  Reopen
                </Button>
              )}
              {canResolve && (
                <Button variant="primary" size="sm" leftIcon={Check} disabled={busy} onClick={() => handleAction('resolve')}>
                  Resolve
                </Button>
              )}
            </>
          ) : null
        }
      />
      {error && (
        <div style={{ position: 'fixed', top: 'var(--gx-space-8)', left: 'var(--gx-space-8)', zIndex: 9999, maxWidth: 320 }}>
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}
    </>
  )
}

// ── Create Ticket Modal ───────────────────────────────────────────────────────

function CreateTicketModal({
  token, queues, onClose, onDone,
}: {
  token: string
  queues: Queue[]
  onClose: () => void
  onDone: () => void
}) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<TicketPriority | ''>('')
  const [queueId, setQueueId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!subject.trim() || saving) return
    setSaving(true)
    try {
      await createTicket(token, {
        subject: subject.trim(),
        body: body.trim() || undefined,
        priority: (priority as TicketPriority) || undefined,
        queue_id: queueId || undefined,
        customer_id: customerId.trim() || undefined,
      })
      toast.success('Ticket created')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New ticket"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" loading={saving} disabled={saving || !subject.trim()} onClick={submit}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-8)' }}>
        <FormField label="Subject" required htmlFor="hd-create-subject">
          <Input
            id="hd-create-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What's the issue?"
          />
        </FormField>
        {/* textarea has no primitive yet — kept as the themed .inp control inside the FormField label. */}
        <FormField label="Description" htmlFor="hd-create-body">
          <textarea
            id="hd-create-body"
            className="inp inp-md"
            rows={4}
            style={{ resize: 'vertical' }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Optional details…"
          />
        </FormField>
        {/* select has no primitive yet — kept as the themed .inp control inside the FormField label. */}
        <FormField label="Priority" htmlFor="hd-create-priority">
          <select id="hd-create-priority" className="inp inp-md" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority | '')}>
            <option value="">Default</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{humanizeStatus(p)}</option>)}
          </select>
        </FormField>
        <FormField label="Queue" htmlFor="hd-create-queue">
          <select id="hd-create-queue" className="inp inp-md" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
            <option value="">None</option>
            {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
        </FormField>
        <FormField label="Customer ID" htmlFor="hd-create-customer">
          <Input
            id="hd-create-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="optional"
          />
        </FormField>
      </div>
    </Modal>
  )
}

// ── Create Queue Modal ────────────────────────────────────────────────────────

function CreateQueueModal({
  token, onClose, onDone,
}: {
  token: string
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [slaMins, setSlaMins] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await createQueue(token, {
        name: name.trim(),
        description: description.trim() || undefined,
        default_sla_minutes: slaMins ? parseInt(slaMins, 10) : undefined,
      })
      toast.success('Queue created')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Create queue"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" loading={saving} disabled={saving || !name.trim()} onClick={submit}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-8)' }}>
        <FormField label="Name" required htmlFor="hd-queue-name">
          <Input
            id="hd-queue-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Billing Support"
          />
        </FormField>
        <FormField label="Description" htmlFor="hd-queue-desc">
          <Input
            id="hd-queue-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="optional"
          />
        </FormField>
        <FormField label="Default SLA (minutes)" htmlFor="hd-queue-sla">
          <Input
            id="hd-queue-sla"
            type="number"
            variant="numeric"
            value={slaMins}
            onChange={(e) => setSlaMins(e.target.value)}
            placeholder="e.g. 480 (8 hours)"
          />
        </FormField>
      </div>
    </Modal>
  )
}
