import { useState, useEffect } from 'react'
import { api, clearToken, type PortalCustomer } from '../api'
import { IconDashboard, IconBills, IconSupport, IconService, IconLogout } from '../icons'
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
}

export default function PortalShell({ onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [me, setMe] = useState<PortalCustomer | null>(null)

  useEffect(() => {
    api.me().then(setMe).catch(() => {})
  }, [])

  function logout() {
    clearToken()
    onLogout()
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* Logo / brand */}
        <div style={{
          padding: '20px 20px 14px',
          borderBottom: '1px solid var(--sidebar-border)',
        }}>
          <div style={{
            display: 'inline-block',
            background: 'var(--brand)',
            color: 'var(--accent)',
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: '0.02em',
            borderRadius: 'var(--radius)',
            padding: '5px 12px',
          }}>GAAex</div>
          <div style={{ color: 'var(--sidebar-label)', fontSize: 11, marginTop: 5 }}>Customer Portal</div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {NAV.map(({ id, label, Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 'var(--radius)',
                  background: active ? 'var(--sidebar-on)' : 'transparent',
                  color: active ? 'var(--sidebar-strong)' : 'var(--sidebar-text)',
                  fontWeight: active ? 600 : 400,
                  fontSize: 14,
                  marginBottom: 2,
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                <Icon />
                {label}
              </button>
            )
          })}
        </nav>

        {/* User + logout */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--sidebar-border)',
        }}>
          <div style={{ color: 'var(--sidebar-strong)', fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
            {me?.name ?? me?.email ?? '—'}
          </div>
          <div style={{ color: 'var(--sidebar-label)', fontSize: 11, marginBottom: 10 }}>
            {me?.customer_name ?? ''}
          </div>
          <button
            onClick={logout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--sidebar-text)',
              fontSize: 13,
              background: 'none',
              padding: '4px 0',
            }}
          >
            <IconLogout />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'dashboard' && <DashboardView />}
        {tab === 'bills'     && <BillsView />}
        {tab === 'support'   && <SupportView />}
        {tab === 'service'   && <ServiceView />}
      </main>
    </div>
  )
}
