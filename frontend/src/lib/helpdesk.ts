// Helpdesk API helpers + types — matches the B31/A31 contract (backend/app/routers/helpdesk.py).
// Uses bget/bpost/bpatch/bdel from ./billing for consistent error handling.
import { bget, bpost, bpatch, bdel, type Fetched } from './billing'

// ── Types ────────────────────────────────────────────────────────────────────

export type Queue = {
  id: string
  name: string
  description?: string | null
  default_sla_minutes?: number | null
  created_at?: string | null
  [k: string]: any
}

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketStatus = 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed'

export type Ticket = {
  id: string
  subject: string
  body?: string | null
  priority?: TicketPriority | null
  status?: TicketStatus | null
  customer_id?: string | null
  queue_id?: string | null
  assigned_agent_id?: string | null
  sla_due_at?: string | null
  sla_breached?: boolean | null
  resolved_at?: string | null
  created_at?: string | null
  [k: string]: any
}

// ── Queue endpoints ───────────────────────────────────────────────────────────

export async function listQueues(token: string): Promise<Fetched<Queue[]>> {
  return bget<Queue[]>(token, '/api/helpdesk/queues')
}

export async function createQueue(
  token: string,
  data: { name: string; description?: string; default_sla_minutes?: number },
): Promise<Queue> {
  return bpost<Queue>(token, '/api/helpdesk/queues', data)
}

// ── Ticket endpoints ──────────────────────────────────────────────────────────

export type TicketFilters = {
  status?: string
  queue?: string
  assignee?: string
  mine?: boolean
}

export async function listTickets(token: string, filters: TicketFilters = {}): Promise<Fetched<Ticket[]>> {
  const p = new URLSearchParams()
  if (filters.status) p.set('status', filters.status)
  if (filters.queue) p.set('queue', filters.queue)
  if (filters.assignee) p.set('assignee', filters.assignee)
  if (filters.mine) p.set('mine', 'true')
  const qs = p.toString()
  return bget<Ticket[]>(token, `/api/helpdesk/tickets${qs ? `?${qs}` : ''}`)
}

export async function getTicket(token: string, id: string): Promise<Fetched<Ticket>> {
  return bget<Ticket>(token, `/api/helpdesk/tickets/${id}`)
}

export async function createTicket(
  token: string,
  data: { subject: string; body?: string; priority?: string; queue_id?: string; customer_id?: string },
): Promise<Ticket> {
  return bpost<Ticket>(token, '/api/helpdesk/tickets', data)
}

export async function patchTicket(token: string, id: string, data: Record<string, any>): Promise<Ticket> {
  return bpatch<Ticket>(token, `/api/helpdesk/tickets/${id}`, data)
}

export async function assignTicket(token: string, id: string, agent_id: string): Promise<Ticket> {
  return bpost<Ticket>(token, `/api/helpdesk/tickets/${id}/assign`, { agent_id })
}

export async function resolveTicket(token: string, id: string): Promise<Ticket> {
  return bpost<Ticket>(token, `/api/helpdesk/tickets/${id}/resolve`)
}

export async function reopenTicket(token: string, id: string): Promise<Ticket> {
  return bpost<Ticket>(token, `/api/helpdesk/tickets/${id}/reopen`)
}

export async function closeTicket(token: string, id: string): Promise<Ticket> {
  return bpost<Ticket>(token, `/api/helpdesk/tickets/${id}/close`)
}

export async function deleteTicket(token: string, id: string): Promise<void> {
  return bdel(token, `/api/helpdesk/tickets/${id}`)
}
