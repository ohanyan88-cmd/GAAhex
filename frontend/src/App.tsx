import { useEffect, useState } from 'react'
import { login, me, getEntities, orgTree } from './api'
import EntityView from './EntityView'
import StudioView from './StudioView'
import ReportsView from './ReportsView'
import DashboardView from './DashboardView'
import MessagesView from './MessagesView'
import NotificationCenter from './NotificationCenter'
import CommandPalette from './CommandPalette'
import ActivityTimeline from './ActivityTimeline'
import InvoicesView from './InvoicesView'
import SubscriptionsView from './SubscriptionsView'
import ProductsView from './ProductsView'
import ReportBuilderView from './ReportBuilderView'
import OutboundView from './OutboundView'
import WebhooksView from './WebhooksView'
import ServicesView from './ServicesView'
import InteractionsView from './InteractionsView'
import { GearIcon, SunIcon, MoonIcon, RowsIcon, SearchIcon, MenuIcon } from './icons'

type Me = { email: string; name: string; tenant_id: string; can_configure?: boolean }
type Entity = { key: string; label: string; label_plural: string; route_slug: string }
type OrgNode = { id: string; type: string; name: string; path: string }
type View = { type: 'org' } | { type: 'entity'; slug: string } | { type: 'studio' } | { type: 'reports' } | { type: 'dashboards' } | { type: 'messages' } | { type: 'activity' } | { type: 'invoices' } | { type: 'subscriptions' } | { type: 'products' } | { type: 'report-builder' } | { type: 'outbound' } | { type: 'webhooks' } | { type: 'services' } | { type: 'interactions' }

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<Me | null>(null)
  const [entities, setEntities] = useState<Entity[]>([])
  const [orgNodes, setOrgNodes] = useState<OrgNode[]>([])
  const [view, setView] = useState<View>({ type: 'org' })

  const [email, setEmail] = useState('admin@demo.isp')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)   // off-canvas sidebar on narrow widths

  // ⌘K / Ctrl-K opens the command palette (once signed in)
  useEffect(() => {
    if (!token) return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPaletteOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [token])

  // Theme: dark is the default (:root); light is the [data-theme="light"] override. Persisted.
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('gaaex-theme') === 'light' ? 'light' : 'dark'),
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('gaaex-theme', theme)
  }, [theme])

  // Density: 'comfortable' (default) | 'compact' — an axis separate from component sizes. Persisted.
  const [density, setDensity] = useState<'comfortable' | 'compact'>(
    () => (localStorage.getItem('gaaex-density') === 'compact' ? 'compact' : 'comfortable'),
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
    localStorage.setItem('gaaex-density', density)
  }, [density])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const t = await login(email, password)
      setToken(t)
      setUser(await me(t))
      setEntities(await getEntities(t))
      setOrgNodes((await orgTree()).nodes)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function logout() {
    setToken(null); setUser(null); setEntities([]); setView({ type: 'org' })
  }

  if (!token) {
    return (
      <div className="center">
        <form className="card" onSubmit={handleLogin}>
          <img src="/full-dark.png" alt="GAAex" className="logo-lg" />
          <p className="muted">Sign in</p>
          <input className={'inp inp-md' + (error ? ' is-error' : '')} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <input className={'inp inp-md' + (error ? ' is-error' : '')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
          <button type="submit" className="btn btn-primary btn-md">Sign in</button>
          {error && <p className="err">{error}</p>}
          <p className="hint">demo: admin@demo.isp / admin123</p>
        </form>
      </div>
    )
  }

  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <aside className={'sidebar' + (navOpen ? ' open' : '')} onClick={() => setNavOpen(false)}>
        <div className="brand"><img src="/icon-light.png" alt="GAAex" className="logo-sm" /></div>
        <div className="nav-label">Workspace</div>
        <button className={'nav' + (view.type === 'org' ? ' on' : '')} onClick={() => setView({ type: 'org' })}>Org tree</button>
        <button className={'nav' + (view.type === 'dashboards' ? ' on' : '')} onClick={() => setView({ type: 'dashboards' })}>Dashboards</button>
        <button className={'nav' + (view.type === 'reports' ? ' on' : '')} onClick={() => setView({ type: 'reports' })}>Reports</button>
        <button className={'nav' + (view.type === 'messages' ? ' on' : '')} onClick={() => setView({ type: 'messages' })}>Messages</button>
        <button className={'nav' + (view.type === 'activity' ? ' on' : '')} onClick={() => setView({ type: 'activity' })}>Activity</button>
        <button className={'nav' + (view.type === 'report-builder' ? ' on' : '')} onClick={() => setView({ type: 'report-builder' })}>Report Builder</button>
        <div className="nav-label">Billing</div>
        <button className={'nav' + (view.type === 'invoices' ? ' on' : '')} onClick={() => setView({ type: 'invoices' })}>Invoices</button>
        <button className={'nav' + (view.type === 'subscriptions' ? ' on' : '')} onClick={() => setView({ type: 'subscriptions' })}>Subscriptions</button>
        <button className={'nav' + (view.type === 'products' ? ' on' : '')} onClick={() => setView({ type: 'products' })}>Products</button>
        <div className="nav-label">Service</div>
        <button className={'nav' + (view.type === 'services' ? ' on' : '')} onClick={() => setView({ type: 'services' })}>Services</button>
        <button className={'nav' + (view.type === 'interactions' ? ' on' : '')} onClick={() => setView({ type: 'interactions' })}>Interactions</button>
        <div className="nav-label">Records</div>
        {entities.map((en) => (
          <button
            key={en.key}
            className={'nav' + (view.type === 'entity' && view.slug === en.route_slug ? ' on' : '')}
            onClick={() => setView({ type: 'entity', slug: en.route_slug })}
          >
            {en.label_plural}
          </button>
        ))}
        {user?.can_configure && (
          <>
            <div className="nav-label">Admin</div>
            <button className={'nav nav-icon' + (view.type === 'studio' ? ' on' : '')} onClick={() => setView({ type: 'studio' })}><GearIcon /> Studio</button>
            <button className={'nav' + (view.type === 'outbound' ? ' on' : '')} onClick={() => setView({ type: 'outbound' })}>Outbound</button>
            <button className={'nav' + (view.type === 'webhooks' ? ' on' : '')} onClick={() => setView({ type: 'webhooks' })}>Webhooks</button>
          </>
        )}
      </aside>

      <div className="content">
        <header>
          <button className="iconbtn nav-toggle" aria-label="Menu" onClick={() => setNavOpen((o) => !o)}><MenuIcon /></button>
          <span className="muted">{user?.name} · {user?.email}</span>
          <div className="header-right">
            <button className="cmdk-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search (Ctrl or Cmd K)">
              <SearchIcon size={15} />
              <span>Search</span>
              <kbd className="search-kbd">⌘K</kbd>
            </button>
            <button
              className="iconbtn"
              onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
              title={density === 'comfortable' ? 'Switch to compact density' : 'Switch to comfortable density'}
              aria-label="Toggle density"
            >
              <RowsIcon />
            </button>
            <button
              className="iconbtn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
            <NotificationCenter
              token={token}
              entities={entities}
              onOpen={(slug) => setView({ type: 'entity', slug })}
            />
            <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main id="main-content">
          {view.type === 'org'
            ? <OrgTreeView nodes={orgNodes} />
            : view.type === 'dashboards'
              ? <DashboardView token={token} />
              : view.type === 'messages'
                ? <MessagesView token={token} />
                : view.type === 'activity'
                  ? <div><div className="view-head"><h2>Activity</h2></div><ActivityTimeline token={token} /></div>
                : view.type === 'invoices'
                  ? <InvoicesView token={token} />
                : view.type === 'subscriptions'
                  ? <SubscriptionsView token={token} />
                : view.type === 'products'
                  ? <ProductsView token={token} />
                : view.type === 'report-builder'
                  ? <ReportBuilderView token={token} entities={entities} />
                : view.type === 'outbound'
                  ? <OutboundView token={token} />
                : view.type === 'webhooks'
                  ? <WebhooksView token={token} />
                : view.type === 'services'
                  ? <ServicesView token={token} />
                : view.type === 'interactions'
                  ? <InteractionsView token={token} />
                : view.type === 'reports'
                  ? <ReportsView token={token} />
                  : view.type === 'studio'
                    ? <StudioView token={token} onCreated={async () => setEntities(await getEntities(token))} />
                    : <EntityView token={token} slug={view.slug} />}
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          token={token}
          entities={entities}
          canConfigure={!!user?.can_configure}
          onEntity={(slug) => setView({ type: 'entity', slug })}
          onRoute={(r) => setView({ type: r })}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  )
}

function OrgTreeView({ nodes }: { nodes: OrgNode[] }) {
  return (
    <div>
      <h2>Org tree</h2>
      <ul className="tree">
        {nodes.map((n) => (
          <li key={n.id} style={{ marginLeft: (n.path.split('.').length - 1) * 22 }}>
            <span className="badge">{n.type}</span>{n.name} <span className="muted">/{n.path}/</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
