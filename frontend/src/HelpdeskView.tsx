import { useEffect, useState } from 'react'
import {
  listQueues, createQueue, listTickets, createTicket,
  assignTicket, resolveTicket, reopenTicket, closeTicket, deleteTicket, getTicket,
  type Queue, type Ticket, type TicketFilters, type TicketPriority, type TicketStatus,
} from './helpdesk'
import { loadCustomers } from './billing'
import { Modal } from './Modal'
import { toast } from './Toast'
import { EmptyState, ErrorBanner } from './States'
import { InboxIcon, PlusIcon, ClockIcon, CheckIcon, CloseIcon, ArrowRightIcon } from './icons'

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

// Priority pill: urgent=danger, high=warning, normal=default, low=muted
function priorityPill(priority: string | null | undefined) {
  const p = (priority ?? '').toLowerCase()
  const cls = p === 'urgent' ? 'pill pill-danger'
    : p === 'high' ? 'pill pill-warning'
    : p === 'low' ? 'pill pill-muted'
    : 'pill'
  return priority ? <span className={cls}>{priority}</span> : <span className="muted">—</span>
}

// Status pill
function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toLowerCase()
  const cls = s === 'resolved' ? 'pill pill-success'
    : s === 'closed' ? 'pill pill-muted'
    : s === 'open' ? 'pill pill-info'
    : s === 'in_progress' ? 'pill'
    : s === 'pending' ? 'pill pill-warning'
    : 'pill'
  const label = s === 'in_progress' ? 'In Progress' : (status ?? '—')
  return status
    ? <span className={cls}>{label}</span>
    : <span className="muted">—</span>
}

// SLA badge per spec:
//   sla_breached → pill-danger
//   due within 1h → pill-warning
//   no sla_due_at → em-dash (muted)
//   otherwise → muted
function SlaBadge({ ticket }: { ticket: Ticket }) {
  if (!ticket.sla_due_at) return <span className="muted">—</span>
  if (ticket.sla_breached) {
    return (
      <span className="pill pill-danger" title={fmtDate(ticket.sla_due_at)}>
        <ClockIcon size={11} /> Breached
      </span>
    )
  }
  const dueMs = new Date(ticket.sla_due_at).getTime()
  const nowMs = Date.now()
  const hourMs = 60 * 60 * 1000
  if (dueMs - nowMs <= hourMs && dueMs > nowMs) {
    return (
      <span className="pill pill-warning" title={fmtDate(ticket.sla_due_at)}>
        <ClockIcon size={11} /> Due soon
      </span>
    )
  }
  return <span className="pill pill-muted" title={fmtDate(ticket.sla_due_at)}>{fmtDateShort(ticket.sla_due_at)}</span>
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

export default function HelpdeskView({ token, canConfigure = false }: { token: string; canConfigure?: boolean }) {
  const [queues, setQueues] = useState<Queue[]>([])
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
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
        <div className="view-head"><h2>Helpdesk</h2></div>
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
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)' }}>Queues</span>
            {canConfigure && (
              <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px', fontSize: 12 }} onClick={() => setCreateQueueOpen(true)} title="Create queue">
                <PlusIcon size={12} />
              </button>
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
        <div className="view-head" style={{ paddingLeft: 16 }}>
          <h2>Helpdesk{selectedQueue ? ` — ${queues.find((q) => q.id === selectedQueue)?.name ?? ''}` : ''}</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon size={13} /> New ticket
          </button>
        </div>

        {/* Filters bar */}
        <div className="list-toolbar" style={{ paddingLeft: 16 }}>
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
        <div style={{ paddingLeft: 16 }}>
          {error && <ErrorBanner message={error} onRetry={loadData} />}
          {tickets === null && !error && <p className="muted">Loading…</p>}
          {tickets && tickets.length === 0 && !error && (
            <EmptyState
              icon={<InboxIcon size={40} />}
              title="No tickets yet"
              message="Create a ticket or adjust your filters."
              action={<button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>New ticket</button>}
            />
          )}

          {tickets && tickets.length > 0 && (
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th scope="col">Subject</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Status</th>
                    <th scope="col">Assignee</th>
                    <th scope="col">SLA</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id}>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</td>
                      <td className="muted">{t.customer_id ? (names[t.customer_id] ?? t.customer_id.slice(0, 8)) : '—'}</td>
                      <td>{priorityPill(t.priority)}</td>
                      <td>{statusPill(t.status)}</td>
                      <td className="muted">{t.assigned_agent_id ? t.assigned_agent_id.slice(0, 8) : '—'}</td>
                      <td><SlaBadge ticket={t} /></td>
                      <td className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetailId(t.id)}>
                          Open <ArrowRightIcon size={13} />
                        </button>
                      </td>
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
        <button className="btn btn-ghost btn-md" onClick={onClose}>Close</button>
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!ticket && !error && <p className="muted">Loading…</p>}

      {ticket && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Meta row */}
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

          {/* Assign */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: 13, minWidth: 60 }}>Assignee</span>
            <input
              className="inp inp-sm"
              style={{ width: 220 }}
              placeholder="Agent ID"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              aria-label="Agent ID to assign"
            />
            <button className="btn btn-primary btn-sm" disabled={busy || !agentId.trim()} onClick={handleAssign}>
              Assign
            </button>
          </div>

          {/* Actions */}
          <div className="bill-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canResolve && (
              <button className="btn btn-accent btn-sm" disabled={busy} onClick={() => handleAction('resolve')}>
                <CheckIcon size={13} /> Resolve
              </button>
            )}
            {canReopen && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => handleAction('reopen')}>
                Reopen
              </button>
            )}
            {canClose && (
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => handleAction('close')}>
                <CloseIcon size={13} /> Close
              </button>
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
          <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-md" disabled={saving || !subject.trim()} onClick={submit}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Subject <span style={{ color: 'var(--danger)' }}>*</span></span>
          <input
            className="inp inp-md"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What's the issue?"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            className="inp inp-md"
            rows={4}
            style={{ resize: 'vertical' }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Optional details…"
          />
        </label>
        <label className="field">
          <span>Priority</span>
          <select className="inp inp-md" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority | '')}>
            <option value="">Default</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Queue</span>
          <select className="inp inp-md" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
            <option value="">None</option>
            {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Customer ID</span>
          <input
            className="inp inp-md"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="optional"
          />
        </label>
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
          <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-md" disabled={saving || !name.trim()} onClick={submit}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Name <span style={{ color: 'var(--danger)' }}>*</span></span>
          <input
            className="inp inp-md"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Billing Support"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Description</span>
          <input
            className="inp inp-md"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="optional"
          />
        </label>
        <label className="field">
          <span>Default SLA (minutes)</span>
          <input
            className="inp inp-md inp-numeric"
            type="number"
            min={1}
            value={slaMins}
            onChange={(e) => setSlaMins(e.target.value)}
            placeholder="e.g. 480 (8 hours)"
          />
        </label>
      </div>
    </Modal>
  )
}
