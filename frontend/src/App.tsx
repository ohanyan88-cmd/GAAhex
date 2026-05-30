import { useEffect, useState } from 'react'
import { login, me, getEntities, orgTree } from './lib/api'
import ErrorBoundary from './components/ErrorBoundary'
import EntityView from './views/EntityView'
import StudioView from './views/StudioView'
import ReportsView from './views/ReportsView'
import DashboardView from './views/DashboardView'
import MessagesView from './views/MessagesView'
import NotificationCenter from './components/NotificationCenter'
import ConfigureDrawer from './modals/ConfigureDrawer'
import ActivityTimeline from './components/ActivityTimeline'
import InvoicesView from './views/InvoicesView'
import PaymentsView from './views/PaymentsView'
import SubscriptionsView from './views/SubscriptionsView'
import ProductsView from './views/ProductsView'
import ReportBuilderView from './views/ReportBuilderView'
import OutboundView from './views/OutboundView'
import WebhooksView from './views/WebhooksView'
import ServicesView from './views/ServicesView'
import UsageView from './views/UsageView'
import ResourcePoolsView from './views/ResourcePoolsView'
import AccountsView from './views/AccountsView'
import PartiesView from './views/PartiesView'
import AnalyticsView from './views/AnalyticsView'
import LeadPipelineView from './views/LeadPipelineView'
import CustomerView from './views/CustomerView'
import AskGaaexView from './views/AskGaaexView'
import HelpdeskView from './views/HelpdeskView'
import PaymentGatewayView from './views/PaymentGatewayView'
import WorkItemsView from './views/WorkItemsView'
import CalendarView from './views/CalendarView'
import SettingsView from './views/SettingsView'
import OrgView from './views/OrgView'
import { NAV_SECTIONS, type NavItemDef } from './lib/nav-config'
import { useI18n, initI18n } from './lib/i18n'
import { RowsIcon, SparkleIcon,
  ChevronRightIcon, ServerIcon, UsersIcon, ShieldIcon, GlobeIcon, InfoIcon } from './components/icons'
import { PanelLeft, Wand, LogIn, Shield } from 'lucide-react'
import { fetchCapabilities, FULL_ACCESS, type Capabilities } from './lib/capabilities'
import ProfileModal from './modals/ProfileModal'
import SecurityModal from './modals/SecurityModal'
import { ShortcutsModal, DocsModal, WhatsNewModal } from './modals/SupportModals'

type Me = { email: string; name: string; can_configure?: boolean; avatar_url?: string | null }
type Entity = { key: string; label: string; label_plural: string; route_slug: string }
type OrgNode = { id: string; type: string; name: string; path: string; code?: string; parent_id?: string | null }
type View =
  | { type: 'org' }
  | { type: 'entity'; slug: string }
  | { type: 'studio'; focusSlug?: string }
  | { type: 'reports' }
  | { type: 'dashboards' }
  | { type: 'messages' }
  | { type: 'activity' }
  | { type: 'invoices' }
  | { type: 'payments' }
  | { type: 'subscriptions' }
  | { type: 'products' }
  | { type: 'usage' }
  | { type: 'report-builder' }
  | { type: 'outbound' }
  | { type: 'webhooks' }
  | { type: 'services' }
  | { type: 'resource-pools' }
  | { type: 'accounts' }
  | { type: 'parties' }
  | { type: 'analytics' }
  | { type: 'lead-pipeline' }
  | { type: 'customer'; id: string }
  | { type: 'ask' }
  | { type: 'settings' }
  | { type: 'calendar' }
  | { type: 'helpdesk' }
  | { type: 'workitems' }
  | { type: 'gateway' }
  | { type: 'module-stub'; moduleId: string; moduleLabel: string }

// Entity slugs that have dedicated nav-config items; others surface as extra Records
const BUILTIN_ENTITY_SLUGS = new Set(['customers', 'contacts', 'tickets', 'users'])

// "Demo Admin" → "DA", "Admin" → "A", "" → "U".
function initialsOf(name: string | null | undefined, fallback = 'U'): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase()
}

// Bespoke (non-entity) views that opt into "configure in place" — view.type → page-config key.
// Add a view.type here (and register the page in pageConfig.ts) to light up its Configure button +
// page-settings drawer. Template stage: Services only.
const BESPOKE_PAGE_KEYS: Partial<Record<View['type'], string>> = {
  services: 'services',
  invoices: 'invoices',
  payments: 'payments',
  subscriptions: 'subscriptions',
  accounts: 'accounts',
  products: 'products',
  usage: 'usage',
  webhooks: 'webhooks',
  'resource-pools': 'resource-pools',
  outbound: 'outbound',
  // Title-only pages.
  dashboards: 'dashboards',
  analytics: 'analytics',
  org: 'org',
  gateway: 'gateway',
  customer: 'customer',
  reports: 'reports',
  calendar: 'calendar',
  // Table-capable pages.
  helpdesk: 'helpdesk',
  workitems: 'workitems',
}


export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<Me | null>(null)
  const [entities, setEntities] = useState<Entity[]>([])
  const [orgNodes, setOrgNodes] = useState<OrgNode[]>([])
  const [view, setView] = useState<View>({ type: 'org' })
  const [customerReturn, setCustomerReturn] = useState<View>({ type: 'org' })
  const [cfgSlug, setCfgSlug] = useState<string | null>(null)   // open the in-place Configure drawer for this entity slug
  const [cfgPageKey, setCfgPageKey] = useState<string | null>(null)   // …or for this bespoke page (page-config, not an entity)
  const [pageConfigVersion, setPageConfigVersion] = useState(0)   // bumped on a page-config save so the live view re-reads it
  const [capabilities, setCapabilities] = useState<Capabilities>(FULL_ACCESS)

  function openCustomer(id: string) { setCustomerReturn(view); setView({ type: 'customer', id }) }

  // The config-entity slug for the current page (undefined ⇒ not an entity-config page).
  const configSlug: string | undefined =
    view.type === 'entity' ? (view as { type: 'entity'; slug: string }).slug
    : view.type === 'lead-pipeline' ? 'leads'
    : entities.some((e) => e.route_slug === (view as { type: string }).type) ? (view as { type: string }).type
    : undefined

  // The page-config key for the current bespoke page (undefined ⇒ not a page-config page).
  // Distinct from configSlug: this opens the drawer's "Page settings" pane, not entity Fields/Workflows.
  const pageConfigKey: string | undefined = configSlug ? undefined : BESPOKE_PAGE_KEYS[view.type]

  // Either kind of config makes the header "Configure page" button appear.
  const canConfigureThisPage = configSlug != null || pageConfigKey != null

  // P1: each view renders its own Configure-page button in its `.view-head`; the click
  // is wired here so the same drawer logic (entity-config vs bespoke page-config) lives
  // in one place. The callback only resolves at click time — no stale closure issues.
  const openConfigure = () => {
    if (configSlug) setCfgSlug(configSlug)
    else if (pageConfigKey) setCfgPageKey(pageConfigKey)
  }

  const [email, setEmail] = useState('admin@demo.isp')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // Account-menu modals (My Profile, Security, and SUPPORT items).
  const [accountModal, setAccountModal] = useState<'profile' | 'security' | 'shortcuts' | 'docs' | 'whatsnew' | null>(null)
  const { t } = useI18n()

  // Collapsible nav section state — pre-open sections marked defaultOpen in nav-config
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(NAV_SECTIONS.filter((s) => s.defaultOpen).map((s) => s.id)),
  )

  function toggleSection(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function navItemClick(item: NavItemDef, e: React.MouseEvent) {
    e.stopPropagation()
    if (!item.viewType) {
      setView({ type: 'module-stub', moduleId: item.id, moduleLabel: item.label })
      return
    }
    if (item.viewType === 'entity') {
      setView({ type: 'entity', slug: item.viewArgs!.slug })
      return
    }
    setView({ type: item.viewType } as View)
  }

  function isItemActive(item: NavItemDef): boolean {
    if (!item.viewType) {
      return view.type === 'module-stub' && (view as { type: 'module-stub'; moduleId: string }).moduleId === item.id
    }
    if (item.viewType === 'entity') {
      return view.type === 'entity' && (view as { type: 'entity'; slug: string }).slug === item.viewArgs?.slug
    }
    return view.type === item.viewType
  }

  useEffect(() => { initI18n(token) }, [token])

  // Close the user-profile menu on outside click or Escape
  useEffect(() => {
    if (!userMenuOpen) return
    function onMouseDown(e: MouseEvent) {
      const el = document.getElementById('user-menu')
      if (el && !el.contains(e.target as Node)) setUserMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen])

  // theme + setTheme are consumed by the user-menu theme toggle (P5 UserMenu).
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('gaaex-theme') === 'light' ? 'light' : 'dark'),
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('gaaex-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-density', 'comfortable')
    document.documentElement.removeAttribute('data-palette')
    document.documentElement.removeAttribute('data-gx-palette')
    localStorage.removeItem('gaaex-density')
    localStorage.removeItem('gaaex-palette')
    localStorage.removeItem('gaaex-gx-palette')
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const t = await login(email, password)
      setToken(t)
      setUser(await me(t))
      setEntities(await getEntities(t))
      setOrgNodes((await orgTree()).nodes)
      fetchCapabilities(t).then(setCapabilities).catch(() => setCapabilities(FULL_ACCESS))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function logout() {
    setToken(null); setUser(null); setEntities([]); setView({ type: 'org' }); setCapabilities(FULL_ACCESS)
  }

  if (!token) {
    return (
      <div className="login-wrap">
        <div className="login-brand">
          <img src="/logo/GAAex-logo-reversed.svg" alt="GAAex" style={{ height: 34, position: 'relative', zIndex: 1 }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="gx-eyebrow" style={{ marginBottom: 14 }}>THE OPERATING SYSTEM FOR ISPs</div>
            <h1 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 40, fontWeight: 600, lineHeight: 1.08, letterSpacing: '-.03em', margin: 0, maxWidth: 420 }}>
              Every department.<br />Every role.<br /><span style={{ color: 'var(--gx-gold)' }}>One system.</span>
            </h1>
            <p style={{ color: 'var(--gx-text-2)', fontSize: 14, marginTop: 18, maxWidth: 380, lineHeight: 1.6 }}>
              CRM, billing, network, field ops, finance &amp; more — rendered from configuration, built in Studio.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 22, position: 'relative', zIndex: 1 }}>
            {[['18', 'modules'], ['99.98%', 'uptime'], ['0', 'hardcoded screens']].map(s => (
              <div key={s[1]}>
                <div style={{ fontFamily: 'var(--gx-font-display)', fontSize: 22, fontWeight: 600, color: '#fff' }}>{s[0]}</div>
                <div style={{ fontSize: 11, color: 'var(--gx-text-3)' }}>{s[1]}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="login-card">
          <form className="login-form fade" onSubmit={handleLogin}>
            <h2 style={{ fontFamily: 'var(--gx-font-display)', fontSize: 24, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-.02em' }}>{t('auth.signin', 'Sign in')}</h2>
            <p className="hint" style={{ margin: '0 0 24px' }}>Welcome back. Use your tenant credentials.</p>
            <label className="field" style={{ marginBottom: 14 }}>
              <span>{t('auth.email', 'Email')}</span>
              <input className={'inp' + (error ? ' inp-error' : '')} value={email} onChange={(e) => setEmail(e.target.value)} aria-label={t('auth.email', 'Email')} />
            </label>
            <label className="field" style={{ marginBottom: 8 }}>
              <span>{t('auth.password', 'Password')}</span>
              <input className={'inp' + (error ? ' inp-error' : '')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label={t('auth.password', 'Password')} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 22px' }}>
              <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5, color: 'var(--gx-text-2)' }}>
                <input type="checkbox" defaultChecked /> Remember me
              </label>
              <a className="btn-link" style={{ fontSize: 12.5, cursor: 'pointer' }}>Forgot password?</a>
            </div>
            {error && <p className="err" style={{ marginTop: -10, marginBottom: 14, color: 'var(--gx-danger-fg)', fontSize: 12.5 }}>{error}</p>}
            <button className="btn btn-primary btn-lg" style={{ width: '100%' }} type="submit"><LogIn size={16} />{t('auth.signin', 'Sign in')}</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--gx-border)' }} />
              <span className="hint" style={{ fontSize: 11 }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--gx-border)' }} />
            </div>
            <button className="btn btn-secondary btn-lg" style={{ width: '100%' }} type="button"><Shield size={16} />Continue with SSO</button>
            <p className="hint" style={{ marginTop: 18, fontSize: 11, textAlign: 'center' }}>demo: admin@demo.isp / admin123</p>
          </form>
        </div>
      </div>
    )
  }

  // Entities not covered by built-in nav items (Studio-created custom entities)
  const extraEntities = entities.filter((e) => !BUILTIN_ENTITY_SLUGS.has(e.route_slug))

  const breadcrumbLabel = view.type === 'entity'
    ? (view as { type: 'entity'; slug: string }).slug
    : view.type === 'module-stub'
      ? (view as { type: 'module-stub'; moduleLabel: string }).moduleLabel
      : view.type

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '') + (navOpen ? ' navopen' : '')}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <aside className="sb">
        <div className="sb-head">
          <img
            src={collapsed ? '/logo/GAAex-mark.svg' : '/logo/GAAex-logo-reversed.svg'}
            alt="GAAex"
            className="wm"
          />
        </div>

        <div className="sb-scroll">
          {NAV_SECTIONS.filter((sec) => !sec.adminOnly || !!user?.can_configure).map((sec) => {
            const isOpen = openSections.has(sec.id)
            return (
              <div key={sec.id} className="sb-sec">
                <button
                  className={'sb-sec-btn' + (isOpen ? ' open' : '')}
                  onClick={(e) => toggleSection(sec.id, e)}
                  aria-expanded={isOpen}
                >
                  <sec.icon size={16} />
                  <span>{sec.label}</span>
                  <ChevronRightIcon size={14} className="chev" />
                </button>
                {isOpen && (
                  <div className="sb-items">
                    {sec.items.map((item) => (
                      <button
                        key={item.id}
                        className={'sb-item' + (isItemActive(item) ? ' on' : '')}
                        onClick={(e) => navItemClick(item, e)}
                      >
                        <span className="ic"><item.icon size={15} /></span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {extraEntities.length > 0 && (
            <div className="sb-sec">
              <button
                className={'sb-sec-btn' + (openSections.has('records') ? ' open' : '')}
                onClick={(e) => toggleSection('records', e)}
                aria-expanded={openSections.has('records')}
              >
                <RowsIcon size={16} />
                <span>Records</span>
                <ChevronRightIcon size={14} className="chev" />
              </button>
              {openSections.has('records') && (
                <div className="sb-items">
                  {extraEntities.map((en) => (
                    <button
                      key={en.key}
                      className={'sb-item' + (view.type === 'entity' && (view as { type: 'entity'; slug: string }).slug === en.route_slug ? ' on' : '')}
                      onClick={() => setView({ type: 'entity', slug: en.route_slug })}
                    >
                      <span className="ic"><RowsIcon size={15} /></span>
                      <span>{en.label_plural}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sb-foot">
          <button
            className="sb-item"
            style={{ paddingLeft: 10 }}
            onClick={() => user?.can_configure && setView({ type: 'studio' })}
            title={user?.can_configure ? 'Open Studio' : 'Studio (admin only)'}
          >
            <span className="ic"><Wand size={15} /></span>
            <span>Studio</span>
            <span className="pill pill-gold" style={{ marginLeft: 'auto', height: 18 }}>config</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="tb">
          <button
            className="tb-icon"
            aria-label="Toggle sidebar"
            onClick={() => {
              // On narrow screens the sidebar is an off-canvas drawer (navOpen).
              // On wide screens it collapses to the icon rail (collapsed).
              if (window.matchMedia('(max-width: 900px)').matches) setNavOpen((o) => !o)
              else setCollapsed((c) => !c)
            }}
          >
            <PanelLeft size={18} />
          </button>

          <span className="spacer" />

          {/* Notifications — wraps the existing NotificationCenter; visual is a tb-icon with red dot.
              P1 keeps this entry as-is; P4 replaces it with the new NotificationBell component. */}
          <div className="tb-icon" style={{ position: 'relative' }} aria-label="Notifications">
            <NotificationCenter
              token={token}
              entities={entities}
              onOpen={(slug) => setView({ type: 'entity', slug })}
            />
          </div>

          <div id="user-menu" className="user-menu" style={{ position: 'relative' }}>
            <button
              className="avatar"
              onClick={() => setUserMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label={t('common.accountMenu', 'Account menu')}
              title={user?.name}
              style={{ border: 'none', cursor: 'pointer' }}
            >
              {user?.avatar_url
                ? <img src={user.avatar_url} alt="" className="avatar-img" />
                : initialsOf(user?.name)}
            </button>

              {userMenuOpen && (
                /* Account menu — PERSONAL scope only. Boundary rule: anything that affects OTHER
                   users, billing, system config, or tenant administration does NOT belong here —
                   route those to a dedicated Settings module instead.
                   P1 keeps this menu inline; P5 replaces it with the UserMenu component (theme +
                   language live inside there, alongside the existing profile/security/support items). */
                <div className="menu user-menu-pop" role="menu" aria-label={t('common.accountMenu', 'Account menu')}>
                  <div className="menu-head">
                    <span className="user-avatar">
                      {user?.avatar_url
                        ? <img src={user.avatar_url} alt="" className="avatar-img" />
                        : initialsOf(user?.name)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="menu-head-name">{user?.name}</div>
                      <div className="menu-head-email">{user?.email}</div>
                      <span className="menu-head-rolebadge">{user?.can_configure ? t('role.admin', 'Admin') : t('role.member', 'Member')}</span>
                    </div>
                  </div>

                  <div className="menu-label">{t('account.section', 'Account')}</div>
                  <button className="menu-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('profile') }}>
                    <UsersIcon size={16} />
                    <span>{t('profile.title', 'My Profile')}</span>
                  </button>
                  <button className="menu-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('security') }}>
                    <ShieldIcon size={16} />
                    <span>{t('security.title', 'Security & Sign-in')}</span>
                  </button>

                  <div className="menu-sep" />

                  <div className="menu-label">{t('support.section', 'Support')}</div>
                  <button className="menu-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('shortcuts') }}>
                    <InfoIcon size={16} />
                    <span>{t('shortcuts.title', 'Keyboard shortcuts')}</span>
                  </button>
                  <button className="menu-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('docs') }}>
                    <GlobeIcon size={16} />
                    <span>{t('docs.title', 'Documentation')}</span>
                  </button>
                  <button className="menu-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setAccountModal('whatsnew') }}>
                    <SparkleIcon size={16} />
                    <span>{t('whatsnew.title', "What's new")}</span>
                  </button>

                  <div className="menu-sep" />
                  <button
                    className="menu-item danger"
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); logout() }}
                  >
                    <span>{t('common.signout', 'Sign out')}</span>
                  </button>
                </div>
              )}
            </div>
        </header>
        <main id="main-content" className="view">
          <ErrorBoundary>
            {view.type === 'org'
              ? <OrgView
                  nodes={orgNodes}
                  configVersion={pageConfigVersion}
                  token={token}
                  canConfigure={!!user?.can_configure}
                  onRefresh={async () => setOrgNodes((await orgTree()).nodes)}
                  onConfigure={canConfigureThisPage ? openConfigure : undefined}
                />
              : view.type === 'dashboards'
                ? <DashboardView token={token} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'analytics'
                ? <AnalyticsView token={token} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'lead-pipeline'
                ? <LeadPipelineView token={token} onOpenCustomer={openCustomer} canConfigure={!!user?.can_configure} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'customer'
                ? <CustomerView token={token} customerId={view.id} onBack={() => setView(customerReturn)} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'ask'
                ? <AskGaaexView token={token} />
              : view.type === 'messages'
                ? <MessagesView token={token} />
              : view.type === 'activity'
                ? <div><div className="view-head"><h2>{t('nav.activity', 'Activity')}</h2></div><ActivityTimeline token={token} /></div>
              : view.type === 'invoices'
                ? <InvoicesView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'payments'
                ? <PaymentsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'gateway'
                ? <PaymentGatewayView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'subscriptions'
                ? <SubscriptionsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'products'
                ? <ProductsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'report-builder'
                ? <ReportBuilderView token={token} entities={entities} />
              : view.type === 'outbound'
                ? <OutboundView token={token} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'webhooks'
                ? <WebhooksView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'services'
                ? <ServicesView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'usage'
                ? <UsageView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'resource-pools'
                ? <ResourcePoolsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'accounts'
                ? <AccountsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'parties'
                ? <PartiesView token={token} canConfigure={!!user?.can_configure} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'helpdesk'
                ? <HelpdeskView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'workitems'
                ? <WorkItemsView token={token} canConfigure={!!user?.can_configure} configVersion={pageConfigVersion} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'calendar'
                ? <CalendarView token={token} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'settings'
                ? <SettingsView token={token} />
              : view.type === 'reports'
                ? <ReportsView token={token} configVersion={pageConfigVersion} canConfigure={!!user?.can_configure} onConfigure={canConfigureThisPage ? openConfigure : undefined} />
              : view.type === 'studio'
                ? <StudioView token={token} onCreated={async () => setEntities(await getEntities(token))} />
              : view.type === 'module-stub'
                ? <ModuleStubView moduleId={view.moduleId} moduleLabel={view.moduleLabel} />
              : <EntityView token={token} slug={(view as { slug: string }).slug} onOpenCustomer={openCustomer} capabilities={capabilities} onBack={() => setView({ type: 'org' })} canConfigure={!!user?.can_configure} onConfigure={canConfigureThisPage ? openConfigure : undefined} />}
          </ErrorBoundary>
        </main>
      </div>

      {cfgSlug && (
        <ConfigureDrawer
          token={token}
          slug={cfgSlug}
          entities={entities}
          onClose={() => setCfgSlug(null)}
          onSwitchPage={(slug) => {
            setView(slug === 'leads' ? { type: 'lead-pipeline' } : { type: 'entity', slug })
            setCfgSlug(slug)
          }}
        />
      )}

      {/* Page-config drawer for bespoke pages (Services): same shell, "Page settings" pane. */}
      {cfgPageKey && (
        <ConfigureDrawer
          token={token}
          pageKey={cfgPageKey}
          entities={entities}
          onClose={() => setCfgPageKey(null)}
          onSaved={() => setPageConfigVersion((v) => v + 1)}
        />
      )}

      {/* Account-menu modals (personal scope only). */}
      <ProfileModal
        open={accountModal === 'profile'}
        onClose={() => setAccountModal(null)}
        token={token}
        name={user?.name ?? ''}
        email={user?.email ?? ''}
        avatarUrl={user?.avatar_url ?? null}
        onAvatarChange={(avatar_url) => setUser((u) => (u ? { ...u, avatar_url } : u))}
      />
      <SecurityModal
        open={accountModal === 'security'}
        onClose={() => setAccountModal(null)}
        token={token}
      />
      <ShortcutsModal open={accountModal === 'shortcuts'} onClose={() => setAccountModal(null)} />
      <DocsModal open={accountModal === 'docs'} onClose={() => setAccountModal(null)} />
      <WhatsNewModal open={accountModal === 'whatsnew'} onClose={() => setAccountModal(null)} />
    </div>
  )
}

function ModuleStubView({ moduleId, moduleLabel }: { moduleId: string; moduleLabel: string }) {
  return (
    <div>
      <div className="view-head">
        <div className="view-icon"><ServerIcon size={20} /></div>
        <div className="view-title-wrap">
          <h2>{moduleLabel}</h2>
          <span className="view-sub">Module · coming soon</span>
        </div>
      </div>
      <div style={{ marginTop: 40, textAlign: 'center', color: 'var(--text-3)' }}>
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          <strong style={{ color: 'var(--text-2)' }}>{moduleLabel}</strong> is not yet enabled for this tenant.
        </div>
        <div style={{ fontSize: 12 }}>Module ID: <code style={{ fontFamily: 'monospace' }}>{moduleId}</code></div>
      </div>
    </div>
  )
}
