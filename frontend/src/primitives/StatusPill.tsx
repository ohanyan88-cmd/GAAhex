// StatusPill.tsx — backward-compat alias for GxStatusBadge.
// EN: All status rendering is now canonical in gx-StatusBadge
//     (src/components/StatusBadge/gx-StatusBadge.tsx). This file
//     re-exports it under the old name so every existing callsite
//     continues to work without changes.
// HY: Amеn status rendering-ը canonical é gx-StatusBadge-um: Aysteghi
//     re-export ə hin anvov, vor amеn callsite-ə shаrum é ashxatel:
export {
  GxStatusBadge as StatusPill,
  type GxStatusBadgeProps as StatusPillProps,
  type GxStatusBadgeVariant,
} from '../components/StatusBadge/gx-StatusBadge'
