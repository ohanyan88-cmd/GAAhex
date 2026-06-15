import type { WorkItemKind, WorkItemPriority } from '../../lib/workitems'

export type { PillVariant } from '../../lib/status-constants'

export type Tab = 'active' | 'all' | 'mine'

export const KINDS: WorkItemKind[] = ['task', 'install', 'repair', 'survey']
export const PRIORITIES: WorkItemPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
