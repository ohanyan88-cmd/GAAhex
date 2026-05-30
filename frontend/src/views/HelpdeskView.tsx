import { useEffect, useMemo, useState } from 'react'
import {
  listQueues, createQueue, listTickets, createTicket,
  assignTicket, resolveTicket, reopenTicket, closeTicket, getTicket,
  type Queue, type Ticket, type TicketFilters, type TicketPriority, type TicketStatus,
} from '../lib/helpdesk'
import { loadCustomers } from '../lib/billing'
import UserPicker from '../components/UserPicker'
import ViewHead from '../components/ViewHead'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner } from '../components/States'
import {
  InboxIcon, ArrowRightIcon, ChevronLeftIcon, SearchIcon, PlusIcon,
  DownloadIcon, ArrowUpIcon, ArrowDownIcon, CheckIcon, CloseIcon,
} from '../components/icons'
import { UserPlus } from 'lucide-react'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { Button, StatusPill, Input, FormField } from '../primitives'

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

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

// Priority → StatusPill variant.
//   urgent → critical · high → degraded · normal → info · low → neutral
function priorityPill(priority: string | null | undefined) {
  if (!priority) return <span className="muted">—</span>
  const p = priority.toLowerCase()
  const variant: PillVariant = p === 'urgent' ? 'critical'
    : p === 'high' ? 'degraded'
    : p === 'low' ? 'neutral'
    : 'info'
  return <StatusPill variant={variant} label={priority.charAt(0).toUpperCase() + priority.slice(1)} size="sm" />
}

// Status → StatusPill variant (per reskin spec).
//   open → info · pending → degraded · resolved → active · closed → neutral · urgent → critical
//   in_progress → degraded (in-flight work, same family as pending)
function mapTicketStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toLowerCase()
  if (v === 'resolved') return 'active'
  if (v === 'pending' || v === 'in_progress') return 'degraded'
  if (v === 'closed') return 'neutral'
  if (v === 'urgent') return 'critical'
  return 'info' // open / default
}
function ticketStatusLabel(s: string | null | undefined): string {
  const v = (s ?? '').toLowerCase()
  if (v === 'in_progress') return 'In Progress'
  if (!s) return '—'
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function statusPill(status: string | null | undefined) {
  if (!status) return <span className="muted">—</span>
  return <StatusPill variant={mapTicketStatus(status)} label={ticketStatusLabel(status)} size="sm" />
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
  return <span className="mono" title={fmtDate(ticket.sla_due_at)}>{fmtDateShort(ticket.sla_due_at)}</span>
}

// 3-dot row-menu icon (inline; no emoji rule — inline SVG only).
function MoreVerticalIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </svg>
  )
}

const STATUS_TABS: Array<[string, string]> = [
  ['', 'All'],
  ['open', 'Open'],
  ['in_progress', 'In Progress'],
  ['pending', 'Pending'],
  ['resolved', 'Resolved'],
  ['closed', 'Closed'],
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

  // Filters (status now lives in the tabs strip; queue + mine in the toolbar).
  const [statusFilter, setStatusFilter] = useState('')
  const [queueFilter, setQueueFilter] = useState('')
  const [mineOnly, setMineOnly] = useState(false)

  // UI state
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createQueueOpen, setCreateQueueOpen] = useState(false)

  // Reskin: client-only search/sort/select/page state.
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

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
  // Reset paging + selection whenever filter/search/sort changes.
  useEffect(() => { setPage(1); setSelected(new Set()) }, [statusFilter, queueFilter, mineOnly, selectedQueue, query, sortKey, sortDir])

  // Derived
  const all = tickets ?? []
  const totalAll = all.length
  const countForStatus = (s: string) => all.filter((t) => (t.status ?? '').toLowerCase() === s).length
  const breachedCount = all.filter((t) => t.sla_breached).length
  const urgentCount = all.filter((t) => (t.priority ?? '').toLowerCase() === 'urgent').length
  const resolvedCount = countForStatus('resolved')

  const custName = (t: Ticket) => t.customer_id ? (names[t.customer_id] ?? t.customer_id.slice(0, 8)) : '—'

  // Client-side search applied on top of server filters.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((t) => {
      const fields = [
        t.subject ?? '',
        t.id ?? '',
        t.status ?? '',
        t.priority ?? '',
        custName(t),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, names])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (t: Ticket): string | number => {
      switch (k) {
        case 'subject': return t.subject ?? ''
        case 'customer': return custName(t)
        case 'priority': return t.priority ?? ''
        case 'status': return t.status ?? ''
        case 'assignee': return t.assigned_agent_id ?? ''
        case 'sla': return t.sla_due_at ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, names])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }
  function toggleRow(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function togglePageAll() {
    setSelected((s) => {
      const n = new Set(s)
      if (allOnPageSelected) pageRows.forEach((r) => n.delete(r.id))
      else pageRows.forEach((r) => n.add(r.id))
      return n
    })
  }

  if (unavailable) {
    return (
      <div className="view-inner fade">
          <div className="crumbs"><span>Operations</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>
          <ViewHead icon={<InboxIcon size={18} />} title={cfg.title} />
          <EmptyState
            icon={<InboxIcon size={40} />}
            title="Helpdesk isn't available yet"
            message="Wire /api/helpdesk/tickets to populate."
          />
      </div>
    )
  }

  return (
    <div className="view-inner fade">
        <div className="crumbs"><span>Operations</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>

        <ViewHead
          icon={<InboxIcon size={18} />}
          title={cfg.title}
          sub={`${totalAll} record${totalAll === 1 ? '' : 's'} · ${queues.length} queue${queues.length === 1 ? '' : 's'}${selectedQueue ? ` · ${queues.find((q) => q.id === selectedQueue)?.name ?? ''}` : ''}`}
          actions={
            <>
              {canConfigure && (
                <Button variant="ghost" size="sm" leftIcon={PlusIcon} onClick={() => setCreateQueueOpen(true)}>
                  New queue
                </Button>
              )}
              <Button variant="primary" size="sm" leftIcon={PlusIcon} onClick={() => setCreateOpen(true)}>
                New ticket
              </Button>
            </>
          }
        />

        {totalAll > 0 && (
          <div className="widgets" style={{ marginBottom: 18 }}>
            <div className="widget">
              <div className="widget-label">Open</div>
              <div className="kpi">{countForStatus('open')}</div>
              <div className="kpi-sub">of {totalAll} ticket{totalAll !== 1 ? 's' : ''}</div>
            </div>
            <div className="widget">
              <div className="widget-label">In progress</div>
              <div className="kpi" style={{ color: 'var(--warning)' }}>{countForStatus('in_progress')}</div>
              <div className="kpi-sub">being handled</div>
            </div>
            <div className="widget">
              <div className="widget-label">Resolved</div>
              <div className="kpi" style={{ color: 'var(--success)' }}>{resolvedCount}</div>
              <div className="kpi-sub">awaiting close</div>
            </div>
            {(breachedCount + urgentCount) > 0 && (
              <div className="widget">
                <div className="widget-label">Breached / Urgent</div>
                <div className="kpi" style={{ color: 'var(--danger)' }}>{breachedCount + urgentCount}</div>
                <div className="kpi-sub">{breachedCount} breached · {urgentCount} urgent</div>
              </div>
            )}
          </div>
        )}

        {/* Status tabs */}
        <div className="tabs">
          {STATUS_TABS.map(([val, label]) => {
            const count = val === '' ? totalAll : countForStatus(val)
            return (
              <button
                key={val}
                className={'tab' + (statusFilter === val ? ' on' : '')}
                onClick={() => setStatusFilter(val)}
              >
                {label} <span className="tab-count">{count}</span>
              </button>
            )
          })}
        </div>

        {error && <ErrorBanner message={error} onRetry={loadData} />}
        {tickets === null && !error && <p className="muted">Loading…</p>}
        {tickets && tickets.length === 0 && !error && (
          <EmptyState
            icon={<InboxIcon size={40} />}
            title="No tickets yet"
            message="Create a ticket or adjust your filters."
            action={<Button variant="primary" size="sm" leftIcon={PlusIcon} onClick={() => setCreateOpen(true)}>New ticket</Button>}
          />
        )}

        {tickets && tickets.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {selected.size > 0 && (
              <div className="bulkbar">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{selected.size} selected</span>
                <span className="spacer" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { console.log('[helpdesk] bulk export', Array.from(selected)); toast.success(`Export queued for ${selected.size} ticket(s)`) }}
                >
                  <DownloadIcon size={13} /> Export
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Cancel</button>
              </div>
            )}

            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tickets"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              {queues.length > 0 && (
                <select
                  className="inp inp-sm"
                  aria-label="Filter by queue"
                  value={selectedQueue ?? queueFilter}
                  onChange={(e) => { setSelectedQueue(null); setQueueFilter(e.target.value) }}
                  style={{ marginLeft: 8 }}
                >
                  <option value="">All queues</option>
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}{queueCounts[q.id] != null ? ` (${queueCounts[q.id]})` : ''}
                    </option>
                  ))}
                </select>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, marginLeft: 8 }}>
                <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                My tickets
              </label>
              <span className="spacer" />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { console.log('[helpdesk] export all'); toast.success(`Export queued for ${sorted.length} ticket(s)`) }}
              >
                <DownloadIcon size={13} /> Export
              </button>
              <Button variant="primary" size="sm" leftIcon={PlusIcon} onClick={() => setCreateOpen(true)}>
                New ticket
              </Button>
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={togglePageAll}
                        aria-label="Select all rows on this page"
                      />
                    </th>
                    {cfg.columns.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        onClick={() => toggleSort(col.key)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {col.label}
                          {sortKey === col.key && (sortDir === 1 ? <ArrowUpIcon size={11} /> : <ArrowDownIcon size={11} />)}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => (
                    <tr
                      key={t.id}
                      className={selected.has(t.id) ? 'sel' : ''}
                      onClick={(e) => { if (!(e.target as Element).closest('td[role="button"]')) setDetailId(t.id) }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td onClick={(e) => { e.stopPropagation(); toggleRow(t.id) }} style={{ cursor: 'default' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggleRow(t.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ticket ${t.subject}`}
                        />
                      </td>
                      {cfg.columns.map((col) => {
                        if (col.key === 'subject') return (
                          <td key={col.key} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                            {t.subject}
                          </td>
                        )
                        if (col.key === 'customer') return <td key={col.key}>{custName(t)}</td>
                        if (col.key === 'priority') return <td key={col.key}>{priorityPill(t.priority)}</td>
                        if (col.key === 'status') return <td key={col.key}>{statusPill(t.status)}</td>
                        if (col.key === 'assignee') return <td key={col.key} className="mono muted">{t.assigned_agent_id ? t.assigned_agent_id.slice(0, 8) : '—'}</td>
                        if (col.key === 'sla') return <td key={col.key}><SlaBadge ticket={t} /></td>
                        return null
                      })}
                      {cf.cells(t.id)}
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 32 }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="iconbtn"
                            aria-label="Row menu"
                            title="Row actions"
                            onClick={(e) => { e.stopPropagation(); console.log('[helpdesk] row menu', t.id) }}
                          >
                            <MoreVerticalIcon size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + 2 + cfg.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching tickets.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
                {sorted.length === 0
                  ? '0 tickets'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeftIcon size={13} /> Prev
              </button>
              <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>Page {page} of {pageCount}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next <ArrowRightIcon size={13} />
              </button>
            </div>
          </div>
        )}

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
            <div><span className="muted">SLA due</span><div className="mono">{fmtDate(ticket.sla_due_at)}</div></div>
            <div><span className="muted">Created</span><div className="mono">{fmtDate(ticket.created_at)}</div></div>
          </div>

          {/* Body */}
          {ticket.body && (
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Description</div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{ticket.body}</p>
            </div>
          )}

          {/* Assign */}
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
              <Button variant="primary" size="sm" leftIcon={CheckIcon} disabled={busy} onClick={() => handleAction('resolve')}>
                Resolve
              </Button>
            )}
            {canReopen && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleAction('reopen')}>
                Reopen
              </Button>
            )}
            {canClose && (
              <Button variant="ghost" size="sm" leftIcon={CloseIcon} disabled={busy} onClick={() => handleAction('close')}>
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
