// MasterLayoutContext — the slot publisher/subscriber backbone.
//
// Pages publish content into named slots (PageHeaderSlot, TabsSlot, MainSlot, SidecarSlot).
// Zone components subscribe to slots and wrap the content in their fixed chrome.
//
// Property: the page never renders chrome (header/tab-bar/split) directly. It only
// declares what goes IN the chrome. The Master Layout owns the structural contract.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type SlotName = 'pageHeader' | 'tabs' | 'main' | 'sidecar'

type SlotsMap = Partial<Record<SlotName, ReactNode>>

interface MasterLayoutCtx {
  slots: SlotsMap
  register: (name: SlotName, node: ReactNode | null) => void
  sidecarCollapsed: boolean
  setSidecarCollapsed: (v: boolean) => void
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
}

const Ctx = createContext<MasterLayoutCtx | null>(null)

export function MasterLayoutProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<SlotsMap>({})
  const [sidecarCollapsed, setSidecarCollapsed] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Stable register fn — slot components call register('main', node) on mount and
  // register('main', null) on unmount (cleanup). Setting null removes the slot.
  const register = useCallback((name: SlotName, node: ReactNode | null) => {
    setSlots(prev => {
      if (node === null) {
        if (!(name in prev)) return prev
        const next = { ...prev }
        delete next[name]
        return next
      }
      return { ...prev, [name]: node }
    })
  }, [])

  const value = useMemo<MasterLayoutCtx>(
    () => ({ slots, register, sidecarCollapsed, setSidecarCollapsed, sidebarOpen, setSidebarOpen }),
    [slots, register, sidecarCollapsed, sidebarOpen],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMasterLayout(): MasterLayoutCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMasterLayout must be used inside <MasterLayout>')
  return v
}

export function useSlot(name: SlotName): ReactNode | undefined {
  return useMasterLayout().slots[name]
}

export function useRegisterSlot() {
  return useMasterLayout().register
}
