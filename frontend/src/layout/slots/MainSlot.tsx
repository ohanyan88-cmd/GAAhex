// MainSlot — page authors call this to fill Zone 3 Left (the main workspace panel).
//
// Renders in the 65–70% width column. Re-mounts on every render call (so swapping
// the children based on active tab is correct — children change → Main re-renders).
import { useEffect, type ReactNode } from 'react'
import { useRegisterSlot } from '../MasterLayoutContext'

export default function MainSlot({ children }: { children: ReactNode }) {
  const register = useRegisterSlot()
  useEffect(() => {
    register('main', children)
    return () => register('main', null)
  }, [register, children])
  return null
}
