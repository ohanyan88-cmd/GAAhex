// Public API for the Master Layout system.
//
// Page authors import ONLY from this file:
//
//   import { PageHeaderSlot, TabsSlot, MainSlot, SidecarSlot } from '@/layout'
//
// Pages MUST NOT import zone components directly — the zones are owned by MasterLayout.
export { default as MasterLayout } from './MasterLayout'
export { MasterLayoutProvider, useMasterLayout, useSlot, useRegisterSlot } from './MasterLayoutContext'

// Slot publishers (page-author API)
export { default as PageHeaderSlot } from './slots/PageHeaderSlot'
export { default as TabsSlot }       from './slots/TabsSlot'
export { default as MainSlot }       from './slots/MainSlot'
export { default as SidecarSlot }    from './slots/SidecarSlot'

// Public types
export type { Zone0Props }                          from './zones/Zone0GlobalBar'
export type { Zone1Props, Zone1ActionButton, StatusBadgeVariant } from './zones/Zone1PageHeader'
export type { Zone2Props, Zone2Tab }                from './zones/Zone2Tabs'
export type { SlotName }                            from './MasterLayoutContext'
