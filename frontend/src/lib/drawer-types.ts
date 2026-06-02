/**
 * Canonical Drawer types per file 10 — Drawer Standard.
 * The rest of the app should import from this catalog instead of inventing
 * new drawer shapes. See modals/ConfigureDrawer.tsx for the existing
 * generic drawer pattern.
 */

export const DRAWER_TYPES = {
  EDIT: { width: { min: 480, max: 720 }, position: 'right',
          purpose: 'Edit a single object\'s fields (the 70% case for editing)' },
  CREATE: { width: { min: 480, max: 720 }, position: 'right',
            purpose: 'Create a new object via a focused form' },
  DETAIL_PREVIEW: { width: 480, position: 'right',
                    purpose: 'Quick-read of a single object without leaving context' },
  ASSIGNMENT: { width: 400, position: 'right',
                purpose: 'Reassign owner/assignee/queue' },
  STATUS_CHANGE: { width: 400, position: 'right',
                   purpose: 'Move through guarded status transitions' },
  FILTER: { width: { min: 320, max: 400 }, position: 'right',
            purpose: 'Scoped filter / saved view editor' },
  ACTIVITY: { width: 480, position: 'right',
              purpose: 'Timeline / audit drill-down' },
  RELATED_OBJECT: { width: { min: 480, max: 720 }, position: 'right',
                    purpose: 'View a related object in-place' },
} as const

export type DrawerType = keyof typeof DRAWER_TYPES

export interface DrawerSpec {
  type: DrawerType
  title: string
  closeOnEscape?: boolean   // default true
  closeOnBackdrop?: boolean // default false for EDIT/CREATE (lose work risk); true otherwise
}

// Per file 10 §Object Editing M2 — when to use what:
export const EDITING_DECISION = {
  drawer: '70% case: editing one object',
  modal: 'Confirms (delete?) and single-prompt collection (rename?, snooze how long?)',
  dedicated_page: 'Large/complex multi-step editing (workflow design, dashboard build, page config)',
} as const
