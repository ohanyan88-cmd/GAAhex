import type { WorkItem, WorkItemKind, WorkItemPriority } from '../../lib/workitems'

export type { PillVariant } from '../../lib/status-constants'

export type ViewMode = 'table' | 'board'

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; items: WorkItem[] }
  | { kind: 'forbidden' }
  | { kind: 'error' }

export const PRIORITIES: WorkItemPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
export const KINDS: WorkItemKind[] = ['task', 'install', 'repair', 'survey']

export const MY_TASKS_COLUMNS = [
  { key: 'title', label: 'Title', visible: true },
  { key: 'kind', label: 'Kind', visible: true },
  { key: 'status', label: 'Status', visible: true },
  { key: 'priority', label: 'Priority', visible: true },
  { key: 'due', label: 'Due', visible: true },
  { key: 'scheduled', label: 'Scheduled', visible: true },
]
