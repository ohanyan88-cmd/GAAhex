import { useEffect, useState } from 'react'
import {
  listQueues, createQueue, listTickets, createTicket,
  assignTicket, resolveTicket, reopenTicket, closeTicket, deleteTicket, getTicket,
  type Queue, type Ticket, type TicketFilters, type TicketPriority, type TicketStatus,
} from './helpdesk'
import { loadCustomers } from './billing'
import UserPicker from './UserPicker'
import ViewHead from './ViewHead'
import { Modal } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import { InboxIcon, ArrowRightIcon } from './icons'
import { Plus, Check, X as XIcon, UserPlus } from 'lucide-react'
import { usePageConfig } from './pageConfig'
import { useCustomFields } from './CustomCells'
import { Button, StatusPill, Input, FormField, DataTableCell } from './primitives'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

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
  return <StatusPill variant={variant} label={priority} size="sm" />
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
  const label = s === 'in_progress' ? 'In Progress' : status
  return <StatusPill variant={variant} label={label} size="sm" />
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

export default function HelpdeskView({ token, canConfigure = false, configVersion = 0 }: { token: string; canConfigure?: boolean; configVersion?: number }) {
  const cfg = usePageConfig(token, 'helpdesk', configVersion)
  const [queues, setQueues] = useState<Queue[]>([])
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const cf = useCustomFields(token, 'helpdesk', cfg.customFields, (tickets ?? []).map((t) => t.id))
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [queueFilter, setQueueFilter] = useState('')
  const [mineOnly, setMineOnly] = useState(false)

  // UI state
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
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

    const filters: TicketFilters = { status: statusFilter, mine: mineOnly }
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
  }

  useEffect(() => { loadQueues() }, [token])
  useEffect(() => { loadData() }, [token, statusFilter, queueFilter, mineOnly, selectedQueue])

  if (unavailable) {
    return (
      <div>
        <ViewHead icon={<InboxIcon size={20} />} title={cfg.title} />
        <EmptyState
          icon={<InboxIcon size={40} />}
          title="Helpdesk isn't available yet"
          message="Ticket support will appear here once the helpdesk service is enabled."
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 0, flex: 1 }}>
      {/* Left rail — queues */}
      <aside style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', paddingRight: 0 }}>
        <div style={{ padding: '14px 12px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 'var(--gx-text-11)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 'var(--gx-tracking-wider)', color: 'var(--text-3)' }}>Queues</span>
            {canConfigure && (
              <Button variant="ghost" size="sm" leftIcon={Plus} onClick={() => setCreateQueueOpen(true)}>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Create queue</span>
              </Button>
            )}
          </div>
          <button
            className={'nav' + (!selectedQueue ? ' on' : '')}
            style={{ width: '100%', textAlign: 'left', borderRadius: 6, padding: '5px 8px', marginBottom: 2 }}
            onClick={() => { setSelectedQueue(null); setQueueFilter('') }}
          >
            All tickets
          </button>
          {queues.map((q) => (
            <button
              key={q.id}
              className={'nav' + (selectedQueue === q.id ? ' on' : '')}
              style={{ width: '100%', textAlign: 'left', borderRadius: 6, padding: '5px 8px', marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => setSelectedQueue(q.id)}
              title={q.description ?? undefined}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.name}</span>
              {queueCounts[q.id] != null && (
                <span className="pill pill-muted" style={{ marginLeft: 4, fontSize: 10, padding: '1px 6px' }}>{queueCounts[q.id]}</span>
              )}
            </button>
          ))}
          {queues.length === 0 && <p className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>No queues yet.</p>}
        </div>
      </aside>

      {/* Main area */}
      <div style={{ flex: 1, minWidth: 0, padding: '0 0 0 0' }}>
        <ViewHead
          icon={<InboxIcon size={20} />}
          title={cfg.title}
          sub={selectedQueue ? queues.find((q) => q.id === selectedQueue)?.name : undefined}
          actions={
            <Button variant="primary" size="sm" leftIcon={Plus} onClick={() => setCreateOpen(true)}>
              New ticket
            </Button>
          }
        />

        {/* Filters bar */}
        <div className="list-toolbar">
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            My tickets
          </label>
        </div>

        {/* Content */}
        <div style={{ padding: '0 var(--pad) var(--pad) var(--pad)' }}>
          {error && <ErrorBanner message={error} onRetry={loadData} />}
          {tickets === null && !error && <p className="muted">Loading…</p>}
          {tickets && tickets.length === 0 && !error && (
            <EmptyState
              icon={<InboxIcon size={40} />}
              title="No tickets yet"
              message="Create a ticket or adjust your filters."
              action={<Button variant="primary" size="sm" leftIcon={Plus} onClick={() => setCreateOpen(true)}>New ticket</Button>}
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
                    <th scope="col"></th>
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
                        if (col.key === 'assignee') return <DataTableCell key={col.key} variant="id">{t.assigned_agent_id ? t.assigned_agent_id.slice(0, 8) : '—'}</DataTableCell>
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

      {/* Ticket detail modal */}
      {detailId && (
        <TicketDetailModal
          token={token}
          id={detailId}
          queues={queues}
          names={names}
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
    </div>
  )
}

// ── Ticket Detail Modal ───────────────────────────────────────────────────────

function TicketDetailModal({
  token, id, queues, names, onClose,
}: {
  token: string
  id: string
  queues: Queue[]
  names: Record<string, string>
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
  const canResolve = status === 'open' || status === 'in_progress' || status === 'pending'
  const canReopen = status === 'resolved' || status === 'closed'
  const canClose = status !== 'closed'
  const queueName = ticket?.queue_id ? (queues.find((q) => q.id === ticket.queue_id)?.name ?? ticket.queue_id.slice(0, 8)) : '—'
  const custName = ticket?.customer_id ? (names[ticket.customer_id] ?? ticket.customer_id.slice(0, 8)) : '—'

  return (
    <Modal
      open
      onClose={onClose}
      title={ticket ? ticket.subject : 'Ticket'}
      size="lg"
      footer={
        <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!ticket && !error && <p className="muted">Loading…</p>}

      {ticket && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Meta grid */}
          <div className="bill-meta">
            <div><span className="muted">Customer</span><div>{custName}</div></div>
            <div><span className="muted">Priority</span><div>{priorityPill(ticket.priority)}</div></div>
            <div><span className="muted">Status</span><div>{statusPill(ticket.status)}</div></div>
            <div><span className="muted">Queue</span><div>{queueName}</div></div>
            <div><span className="muted">SLA due</span><div>{fmtDate(ticket.sla_due_at)}</div></div>
            <div><span className="muted">Created</span><div>{fmtDate(ticket.created_at)}</div></div>
          </div>

          {/* Body */}
          {ticket.body && (
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Description</div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{ticket.body}</p>
            </div>
          )}

          {/* Assign — UserPicker is a SHARED <select> component (out of scope to reskin); wrapped in a
              FormField primitive for the label, with the Assign action as a <Button>. */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <FormField label="Assignee" htmlFor="hd-assignee">
                <UserPicker
                  token={token}
                  value={agentId}
                  onChange={setAgentId}
                  className="inp inp-sm"
                  aria-label="Agent to assign"
                />
              </FormField>
            </div>
            <Button variant="primary" size="sm" leftIcon={UserPlus} disabled={busy || !agentId.trim()} onClick={handleAssign}>
              Assign
            </Button>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--gx-space-4)', flexWrap: 'wrap' }}>
            {canResolve && (
              <Button variant="primary" size="sm" leftIcon={Check} disabled={busy} onClick={() => handleAction('resolve')}>
                Resolve
              </Button>
            )}
            {canReopen && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleAction('reopen')}>
                Reopen
              </Button>
            )}
            {canClose && (
              <Button variant="ghost" size="sm" leftIcon={XIcon} disabled={busy} onClick={() => handleAction('close')}>
                Close
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
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
            {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
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
