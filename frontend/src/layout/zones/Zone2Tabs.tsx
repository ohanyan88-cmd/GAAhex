// Zone 2 — 360° Context Tabs (44px, slot-driven).
//
// Persistent horizontal tab bar. Clicking a tab updates the active key (page-controlled);
// Zone 3 Left re-renders, Zone 3 Right stays mounted (sidecar persistence across tabs
// is the contract — audit/notes scroll position survives).
import { useSlot } from '../MasterLayoutContext'
import type { ReactNode } from 'react'

export interface Zone2Tab {
  key:    string
  label:  string
  badge?: number
  icon?:  ReactNode
}

export interface Zone2Props {
  activeKey: string
  onChange:  (key: string) => void
  tabs:      Zone2Tab[]
}

export default function Zone2Tabs() {
  const node = useSlot('tabs')
  if (!node) return null  // pages without tabs render nothing here (e.g. dashboard mode)
  return <>{node}</>
}

export function Zone2TabsRenderer({ activeKey, onChange, tabs }: Zone2Props) {
  return (
    <nav className="zone-2" role="tablist" aria-label="Page tabs">
      {tabs.map(t => {
        const active = t.key === activeKey
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            className={`zone-2-tab ${active ? 'zone-2-tab--active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.icon && <span className="zone-2-tab-icon">{t.icon}</span>}
            <span className="zone-2-tab-label">{t.label}</span>
            {t.badge != null && t.badge > 0 && (
              <span className="zone-2-tab-badge">{t.badge > 99 ? '99+' : t.badge}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
