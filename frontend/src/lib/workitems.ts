// WorkItems API helpers + types — A32 contract: base /api/workitems.
// Uses bget/bpost/bpatch/bdel from billing for consistent error handling.
import { bget, bpost, bpatch, bdel, type Fetched } from './billing'

// ── Types ────────────────────────────────────────────────────────────────────

export type WorkItemKind = 'task' | 'install' | 'repair' | 'survey'
export type WorkItemStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'
export type WorkItemPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export type WorkItem = {
  id: string
  title: string
  description?: string | null
  kind?: WorkItemKind | null
  status?: WorkItemStatus | null
  priority?: WorkItemPriority | null
  assigned_user_id?: string | null
  customer_id?: string | null
  due_at?: string | null
  scheduled_at?: string | null
  location?: string | null
  completed_at?: string | null
  created_at?: string | null
  [k: string]: any
}

export type WorkItemCreate = {
  title: string
  description?: string
  kind?: WorkItemKind
  priority?: WorkItemPriority
  assigned_user_id?: string
  customer_id?: string
  due_at?: string
  scheduled_at?: string
  location?: string
}

export type WorkItemPatch = Partial<Omit<WorkItemCreate, 'title'> & { title: string }>

export type WorkItemFilters = {
  status?: string
  assignee?: string
  mine?: boolean
  kind?: string
  scheduled_from?: string
  scheduled_to?: string
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export async function listWorkItems(token: string, filters: WorkItemFilters = {}): Promise<Fetched<WorkItem[]>> {
  const p = new URLSearchParams()
  if (filters.status) p.set('status', filters.status)
  if (filters.assignee) p.set('assignee', filters.assignee)
  if (filters.mine) p.set('mine', 'true')
  if (filters.kind) p.set('kind', filters.kind)
  if (filters.scheduled_from) p.set('scheduled_from', filters.scheduled_from)
  if (filters.scheduled_to) p.set('scheduled_to', filters.scheduled_to)
  const qs = p.toString()
  return bget<WorkItem[]>(token, `/api/workitems${qs ? `?${qs}` : ''}`)
}

export async function getWorkItem(token: string, id: string): Promise<Fetched<WorkItem>> {
  return bget<WorkItem>(token, `/api/workitems/${id}`)
}

export async function createWorkItem(token: string, data: WorkItemCreate): Promise<WorkItem> {
  return bpost<WorkItem>(token, '/api/workitems', data)
}

export async function patchWorkItem(token: string, id: string, data: WorkItemPatch): Promise<WorkItem> {
  return bpatch<WorkItem>(token, `/api/workitems/${id}`, data)
}

export async function assignWorkItem(token: string, id: string, user_id: string): Promise<WorkItem> {
  return bpost<WorkItem>(token, `/api/workitems/${id}/assign`, { user_id })
}

export async function startWorkItem(token: string, id: string): Promise<WorkItem> {
  return bpost<WorkItem>(token, `/api/workitems/${id}/start`)
}

export async function completeWorkItem(token: string, id: string): Promise<WorkItem> {
  return bpost<WorkItem>(token, `/api/workitems/${id}/complete`)
}

export async function blockWorkItem(token: string, id: string): Promise<WorkItem> {
  return bpost<WorkItem>(token, `/api/workitems/${id}/block`)
}

export async function cancelWorkItem(token: string, id: string): Promise<WorkItem> {
  return bpost<WorkItem>(token, `/api/workitems/${id}/cancel`)
}

export async function reopenWorkItem(token: string, id: string): Promise<WorkItem> {
  return bpost<WorkItem>(token, `/api/workitems/${id}/reopen`)
}

export async function deleteWorkItem(token: string, id: string): Promise<void> {
  return bdel(token, `/api/workitems/${id}`)
}
