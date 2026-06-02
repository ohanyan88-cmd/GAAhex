/**
 * Canonical Action Menu ordering per file 10 — Action Menu Standard.
 * Items appear in THIS group order, divided by separators. Items the
 * caller lacks permission for must be HIDDEN (not greyed/disabled).
 */

export const ACTION_MENU_GROUPS = {
  read:        ['view', 'open'],
  edit:        ['edit', 'rename', 'duplicate'],
  action:      ['assign', 'change_status', 'escalate', 'resolve'],
  export:      ['export', 'download'],
  destructive: ['archive', 'soft_delete', 'restore'],
  hard_destructive: ['purge'],
} as const

export type ActionVerb =
  | 'view' | 'open'
  | 'edit' | 'rename' | 'duplicate'
  | 'assign' | 'change_status' | 'escalate' | 'resolve'
  | 'export' | 'download'
  | 'archive' | 'soft_delete' | 'restore'
  | 'purge'

export interface ActionItem {
  verb: ActionVerb
  label: string                 // localized display label
  permissionKey: string         // e.g. "task.edit"; if not granted, item is HIDDEN
  isDestructive?: boolean       // styling hint
  isSuperAdminOnly?: boolean    // 'purge' default true
  onClick: () => void | Promise<void>
}

/**
 * orderActions(items): re-order an arbitrary action list into the canonical
 * grouped order. Drops items whose verb isn't in any group.
 */
export function orderActions(items: ActionItem[]): ActionItem[] {
  const byVerb = new Map(items.map((it) => [it.verb, it]))
  const out: ActionItem[] = []
  const groups = [
    ACTION_MENU_GROUPS.read,
    ACTION_MENU_GROUPS.edit,
    ACTION_MENU_GROUPS.action,
    ACTION_MENU_GROUPS.export,
    ACTION_MENU_GROUPS.destructive,
    ACTION_MENU_GROUPS.hard_destructive,
  ] as const
  for (const group of groups) {
    for (const verb of group) {
      const it = byVerb.get(verb as ActionVerb)
      if (it) out.push(it)
    }
  }
  return out
}

/**
 * groupBoundaries(items): given an already-ordered list (from orderActions),
 * return the indices where a divider should appear between groups.
 * Adjacent empty groups collapse — no double dividers.
 */
export function groupBoundaries(orderedItems: ActionItem[]): number[] {
  const groupOf: Record<ActionVerb, keyof typeof ACTION_MENU_GROUPS> = {} as never
  for (const [k, verbs] of Object.entries(ACTION_MENU_GROUPS)) {
    for (const v of verbs) (groupOf as Record<string, string>)[v] = k as never
  }
  const boundaries: number[] = []
  for (let i = 1; i < orderedItems.length; i++) {
    if (groupOf[orderedItems[i].verb] !== groupOf[orderedItems[i-1].verb]) {
      boundaries.push(i)
    }
  }
  return boundaries
}
