// SidecarSlot — page authors call this to fill Zone 3 Right (the persistent context panel).
//
// Renders in the 30–35% width column. KEY PROPERTY: the sidecar does NOT re-mount when
// the user switches tabs in Zone 2 — only when the parent entity changes. This is what
// makes audit trail scroll position + open internal note inputs survive tab clicks.
//
// To get the persistence effect, place <SidecarSlot> OUTSIDE the per-tab conditional
// rendering (i.e. at the top of the page, not inside `{tab === 'x' && <X />}`).
import { useEffect, type ReactNode } from 'react'
import { useRegisterSlot } from '../MasterLayoutContext'

export default function SidecarSlot({ children }: { children: ReactNode }) {
  const register = useRegisterSlot()
  useEffect(() => {
    register('sidecar', children)
    return () => register('sidecar', null)
  }, [register, children])
  return null
}
