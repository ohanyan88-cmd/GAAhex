// LeftNav — the persistent left navigation column.
//
// Two states, driven by Zone 0's sidebar toggle:
//   - expanded (240px): brand mark + name, section headers, icon + label per item
//   - rail     (56px) : brand mark only, icons only, label as tooltip
//
// Layout sits to the left of Zone 0/1/2/3 (full viewport height). Zone widths
// adjust automatically as the nav expands/collapses (CSS grid template column).
import type { ComponentType, ReactNode } from 'react'
import { useMasterLayout } from './MasterLayoutContext'

export interface NavItem {
  id:      string
  label:   string
  icon:    ComponentType<{ size?: number; className?: string }>
  badge?:  number
}

export interface NavSection {
  id:    string
  label: string  // section header, e.g. "WORKSPACE"
  items: NavItem[]
}

export interface NavConfig {
  /** Tenant brand mark — initials (rail) + full name (expanded), shown at nav top. */
  brand: {
    initials: string
    name:     string
    logoNode?: ReactNode  // optional custom logo node (overrides initials box)
  }
  sections:    NavSection[]
  activeId:    string | null
  onItemClick: (id: string) => void
}

export interface LeftNavProps {
  nav: NavConfig
}

export default function LeftNav({ nav }: LeftNavProps) {
  const { navExpanded } = useMasterLayout()
  return (
    <nav
      className={`master-nav ${navExpanded ? 'master-nav--expanded' : 'master-nav--rail'}`}
      aria-label="Primary navigation"
    >
      {/* Brand header — aligned to Zone 0 height so the top row reads as a single bar */}
      <div className="master-nav-brand">
        {nav.brand.logoNode ?? (
          <div className="master-nav-brand-mark" title={nav.brand.name}>
            {nav.brand.initials}
          </div>
        )}
        {navExpanded && <span className="master-nav-brand-name">{nav.brand.name}</span>}
      </div>

      <div className="master-nav-body">
        {nav.sections.map(sec => (
          <div key={sec.id} className="master-nav-sec">
            {navExpanded && (
              <div className="master-nav-sec-head">{sec.label}</div>
            )}
            <ul className="master-nav-list" role="list">
              {sec.items.map(item => {
                const active = nav.activeId === item.id
                const Icon = item.icon
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`master-nav-item ${active ? 'master-nav-item--active' : ''}`}
                      onClick={() => nav.onItemClick(item.id)}
                      title={!navExpanded ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                    >
                      <span className="master-nav-item-icon"><Icon size={16} /></span>
                      {navExpanded && <span className="master-nav-item-label">{item.label}</span>}
                      {navExpanded && item.badge != null && item.badge > 0 && (
                        <span className="master-nav-item-badge">{item.badge > 99 ? '99+' : item.badge}</span>
                      )}
                      {!navExpanded && item.badge != null && item.badge > 0 && (
                        <span className="master-nav-item-dot" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}
