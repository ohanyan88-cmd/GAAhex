import { useState, useEffect } from 'react'
import { api, clearToken, type PortalCustomer } from '../lib/api'
import { IconDashboard, IconBills, IconSupport, IconService, IconLogout } from '../components/icons'
import type { Theme } from '../App'
import DashboardView from './DashboardView'
import BillsView from './BillsView'
import SupportView from './SupportView'
import ServiceView from './ServiceView'

type Tab = 'dashboard' | 'bills' | 'support' | 'service'

const NAV: { id: Tab; label: string; Icon: () => JSX.Element }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'bills',     label: 'Bills',     Icon: IconBills },
  { id: 'support',   label: 'Support',   Icon: IconSupport },
  { id: 'service',   label: 'Service',   Icon: IconService },
]

interface Props {
  onLogout: () => void
  theme: Theme
  onToggleTheme: () => void
}

/* Sun icon for light mode indicator */
function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

/* Moon icon for dark mode indicator */
function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export default function PortalShell({ onLogout, theme, onToggleTheme }: Props) {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [me, setMe]   = useState<PortalCustomer | null>(null)

  useEffect(() => {
    api.me().then(setMe).catch(() => {})
  }, [])

  function logout() {
    clearToken()
    onLogout()
  }

  const displayName = me?.name ?? me?.email ?? '—'
  const initials    = displayName.slice(0, 2).toUpperCase()

  return (
    <div className="shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-logo">G</div>
          <div className="sidebar-brand-name">
            GAAex
            <small>Customer Portal</small>
          </div>
        </div>

        {/* Nav */}
        <div className="sidebar-scroll">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav${tab === id ? ' on' : ''}`}
              onClick={() => setTab(id)}
            >
              <span className="nav-icon"><Icon /></span>
              {label}
            </button>
          ))}
        </div>

        {/* User footer */}
        <div className="sidebar-tenant">
          <div className="sidebar-tenant-avatar">{initials}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="sidebar-tenant-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </div>
            {me?.customer_name && (
              <div className="sidebar-tenant-role">{me.customer_name}</div>
            )}
          </div>
          <button
            className="iconbtn"
            onClick={logout}
            title="Sign out"
          >
            <IconLogout />
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="content">
        {/* Top header bar */}
        <header>
          <span style={{ color: 'var(--text-2)', fontSize: 13 }}>
            {NAV.find(n => n.id === tab)?.label}
          </span>
          <div className="header-right">
            {/* Theme toggle */}
            <button
              className="iconbtn"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
            {/* User chip */}
            <div className="user-chip">
              <div className="user-avatar">{initials}</div>
              <div>
                <div className="user-chip-name">{displayName}</div>
                {me?.customer_name && (
                  <div className="user-chip-role">{me.customer_name}</div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* View */}
        <main>
          {tab === 'dashboard' && <DashboardView />}
          {tab === 'bills'     && <BillsView />}
          {tab === 'support'   && <SupportView />}
          {tab === 'service'   && <ServiceView />}
        </main>
      </div>
    </div>
  )
}
