import type { CustomFieldDef } from '../../lib/pageConfig'
import type { OrgNode, OrgTreeNode, OrgLayout } from './types'

export const STORAGE_KEY = 'gaahex-org-view'

export function loadLayout(): OrgLayout {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'tree') return 'outline'
    if (
      v === 'hierarchy' || v === 'cards' || v === 'outline' || v === 'list' ||
      v === 'grouped' || v === 'spans' || v === 'map' || v === 'sunburst' || v === 'treemap' ||
      v === 'network' || v === 'heatmap' || v === 'timeline' || v === 'raci'
    ) return v
  } catch { /* private mode */ }
  return 'hierarchy'
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export function buildTree(nodes: OrgNode[]): OrgTreeNode[] {
  const wrapped: OrgTreeNode[] = nodes.map((n) => ({ ...n, children: [] }))
  const byId = new Map(wrapped.map((n) => [n.id, n]))
  const roots: OrgTreeNode[] = []
  const hasParentId = wrapped.some((n) => n.parent_id != null)

  if (hasParentId) {
    for (const n of wrapped) {
      const parent = n.parent_id != null ? byId.get(n.parent_id) : undefined
      if (parent) parent.children.push(n)
      else roots.push(n)
    }
    return roots
  }

  const stack: OrgTreeNode[] = []
  for (const n of wrapped) {
    const depth = n.path.split('.').length
    while (stack.length >= depth) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(n)
    else roots.push(n)
    stack.push(n)
  }
  return roots
}

export function descendantCount(n: OrgTreeNode): number {
  let total = 0
  for (const c of n.children) total += 1 + descendantCount(c)
  return total
}

export function statusFieldKey(defs: CustomFieldDef[]): string | null {
  const byKey = defs.find((d) => d.key.toLowerCase() === 'status')
  if (byKey) return byKey.key
  const byLabel = defs.find((d) => d.label.trim().toLowerCase() === 'status')
  return byLabel ? byLabel.key : null
}

export function statusVariant(raw: unknown): 'active' | 'degraded' | 'critical' | 'neutral' | 'info' | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null
  if (/^(active|online|operational|healthy|live|ok|up|good|open)$/.test(s)) return 'active'
  if (/^(degraded|warning|warn|at risk|maintenance|partial|pending|paused)$/.test(s)) return 'degraded'
  if (/^(critical|down|offline|outage|failed|error|closed|inactive|suspended)$/.test(s)) return 'critical'
  return 'info'
}

export function toneClass(type: string): string {
  const t = type.toLowerCase()
  if (t === 'group') return 'org-badge-group'
  if (t === 'region') return 'org-badge-region'
  if (t === 'team') return 'org-badge-team'
  return 'org-badge-other'
}

export function typeFill(type: string): string {
  const t = type.toLowerCase()
  if (t === 'group') return 'var(--gx-gold)'
  if (t === 'region') return 'var(--gx-primary)'
  if (t === 'team') return 'var(--gx-text-2)'
  return 'var(--gx-text-3)'
}

export type FlatRow = { node: OrgTreeNode; depth: number; parentId: string | null }

export function flattenTree(roots: OrgTreeNode[]): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (nodes: OrgTreeNode[], depth: number, parentId: string | null) => {
    for (const n of nodes) {
      out.push({ node: n, depth, parentId })
      if (n.children.length > 0) walk(n.children, depth + 1, n.id)
    }
  }
  walk(roots, 0, null)
  return out
}
