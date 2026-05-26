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
import UsageView from './UsageView'
import ResourcePoolsView from './ResourcePoolsView'
import AccountsView from './AccountsView'
import PartiesView from './PartiesView'
import { useI18n, initI18n, type Lang } from './i18n'
import { GearIcon, SunIcon, MoonIcon, RowsIcon, SearchIcon, MenuIcon } from './icons'

type Me = { email: string; name: string; tenant_id: string; can_configure?: boolean }
type Entity = { key: string; label: string; label_plural: string; route_slug: string }
type OrgNode = { id: string; type: string; name: string; path: string }
type View = { type: 'org' } | { type: 'entity'; slug: string } | { type: 'studio' } | { type: 'reports' } | { type: 'dashboards' } | { type: 'messages' } | { type: 'activity' } | { type: 'invoices' } | { type: 'subscriptions' } | { type: 'products' } | { type: 'usage' } | { type: 'report-builder' } | { type: 'outbound' } | { type: 'webhooks' } | { type: 'services' } | { type: 'interactions' } | { type: 'resource-pools' } | { type: 'accounts' } | { type: 'parties' }

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
  const { t, lang, setLang } = useI18n()

  // (re)load translation strings for the current language whenever auth changes
  useEffect(() => { initI18n(token) }, [token])

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
          <p className="muted">{t('auth.signin', 'Sign in')}</p>
          <input className={'inp inp-md' + (error ? ' is-error' : '')} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.email', 'email')} aria-label={t('auth.email', 'email')} />
          <input className={'inp inp-md' + (error ? ' is-error' : '')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.password', 'password')} aria-label={t('auth.password', 'password')} />
          <button type="submit" className="btn btn-primary btn-md">{t('auth.signin', 'Sign in')}</button>
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
        <div className="nav-label">{t('nav.workspace', 'Workspace')}</div>
        <button className={'nav' + (view.type === 'org' ? ' on' : '')} onClick={() => setView({ type: 'org' })}>{t('nav.org', 'Org tree')}</button>
        <button className={'nav' + (view.type === 'dashboards' ? ' on' : '')} onClick={() => setView({ type: 'dashboards' })}>{t('nav.dashboards', 'Dashboards')}</button>
        <button className={'nav' + (view.type === 'reports' ? ' on' : '')} onClick={() => setView({ type: 'reports' })}>{t('nav.reports', 'Reports')}</button>
        <button className={'nav' + (view.type === 'messages' ? ' on' : '')} onClick={() => setView({ type: 'messages' })}>{t('nav.messages', 'Messages')}</button>
        <button className={'nav' + (view.type === 'activity' ? ' on' : '')} onClick={() => setView({ type: 'activity' })}>{t('nav.activity', 'Activity')}</button>
        <button className={'nav' + (view.type === 'report-builder' ? ' on' : '')} onClick={() => setView({ type: 'report-builder' })}>{t('nav.reportBuilder', 'Report Builder')}</button>
        <div className="nav-label">{t('nav.customers', 'Customers')}</div>
        <button className={'nav' + (view.type === 'accounts' ? ' on' : '')} onClick={() => setView({ type: 'accounts' })}>{t('nav.accounts', 'Accounts')}</button>
        <button className={'nav' + (view.type === 'parties' ? ' on' : '')} onClick={() => setView({ type: 'parties' })}>{t('nav.parties', 'Parties')}</button>
        <div className="nav-label">{t('nav.billing', 'Billing')}</div>
        <button className={'nav' + (view.type === 'invoices' ? ' on' : '')} onClick={() => setView({ type: 'invoices' })}>{t('nav.invoices', 'Invoices')}</button>
        <button className={'nav' + (view.type === 'subscriptions' ? ' on' : '')} onClick={() => setView({ type: 'subscriptions' })}>{t('nav.subscriptions', 'Subscriptions')}</button>
        <button className={'nav' + (view.type === 'products' ? ' on' : '')} onClick={() => setView({ type: 'products' })}>{t('nav.products', 'Products')}</button>
        <button className={'nav' + (view.type === 'usage' ? ' on' : '')} onClick={() => setView({ type: 'usage' })}>{t('nav.usage', 'Usage')}</button>
        <div className="nav-label">{t('nav.service', 'Service')}</div>
        <button className={'nav' + (view.type === 'services' ? ' on' : '')} onClick={() => setView({ type: 'services' })}>{t('nav.services', 'Services')}</button>
        <button className={'nav' + (view.type === 'interactions' ? ' on' : '')} onClick={() => setView({ type: 'interactions' })}>{t('nav.interactions', 'Interactions')}</button>
        <div className="nav-label">{t('nav.records', 'Records')}</div>
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
            <div className="nav-label">{t('nav.admin', 'Admin')}</div>
            <button className={'nav nav-icon' + (view.type === 'studio' ? ' on' : '')} onClick={() => setView({ type: 'studio' })}><GearIcon /> {t('nav.studio', 'Studio')}</button>
            <button className={'nav' + (view.type === 'outbound' ? ' on' : '')} onClick={() => setView({ type: 'outbound' })}>{t('nav.outbound', 'Outbound')}</button>
            <button className={'nav' + (view.type === 'webhooks' ? ' on' : '')} onClick={() => setView({ type: 'webhooks' })}>{t('nav.webhooks', 'Webhooks')}</button>
            <button className={'nav' + (view.type === 'resource-pools' ? ' on' : '')} onClick={() => setView({ type: 'resource-pools' })}>{t('nav.resourcePools', 'Resource Pools')}</button>
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
              <span>{t('common.search', 'Search')}</span>
              <kbd className="search-kbd">⌘K</kbd>
            </button>
            <div className="lang-switch" role="group" aria-label="Language">
              {(['en', 'hy'] as Lang[]).map((l) => (
                <button key={l} className={'lang-opt' + (lang === l ? ' on' : '')} onClick={() => setLang(l)} aria-pressed={lang === l}>
                  {l === 'en' ? 'EN' : 'ՀՅ'}
                </button>
              ))}
            </div>
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
            <button className="btn btn-ghost btn-sm" onClick={logout}>{t('common.signout', 'Sign out')}</button>
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
                  ? <div><div className="view-head"><h2>{t('nav.activity', 'Activity')}</h2></div><ActivityTimeline token={token} /></div>
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
                : view.type === 'usage'
                  ? <UsageView token={token} />
                : view.type === 'resource-pools'
                  ? <ResourcePoolsView token={token} />
                : view.type === 'accounts'
                  ? <AccountsView token={token} />
                : view.type === 'parties'
                  ? <PartiesView token={token} />
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
