import type { WorkItemKind, WorkItemPriority } from '../../lib/workitems'

export type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

export type Tab = 'active' | 'all' | 'mine'

export const KINDS: WorkItemKind[] = ['task', 'install', 'repair', 'survey']
export const PRIORITIES: WorkItemPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
